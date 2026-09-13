import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase, migrationFiles } from "../helpers/database";

const EXPECTED_TABLES = [
  "users",
  "workspaces",
  "workspace_members",
  "channels",
  "channel_snapshots",
  "videos",
  "video_snapshots",
  "niches",
  "video_performance",
  "jobs",
  "job_results",
  "folders",
  "folder_channels",
  "usage_events",
  "credits",
];

const CHANNEL_ID = "UC_x5XG1OV2P6uZZ5FSM9Ttw";

describe("supabase migrations", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createMigratedDatabase();
  });

  afterAll(async () => {
    await db?.close();
  });

  it("has timestamp-ordered migration files", () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(f).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
  });

  it("creates every table with RLS enabled", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );
    const byName = new Map(rows.map((r) => [r.relname, r.relrowsecurity]));
    for (const table of EXPECTED_TABLES) {
      expect(byName.has(table), `missing table ${table}`).toBe(true);
      expect(byName.get(table), `RLS disabled on ${table}`).toBe(true);
    }
  });

  it("provisions a profile and personal workspace on signup", async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into auth.users (email) values ('creator@example.com') returning id`,
    );
    const userId = rows[0]!.id;
    const membership = await db.query<{ role: string; name: string }>(
      `select m.role, w.name from public.workspace_members m
       join public.workspaces w on w.id = m.workspace_id where m.user_id = $1`,
      [userId],
    );
    expect(membership.rows).toEqual([{ role: "owner", name: "Personal" }]);
  });

  it("enforces YouTube id formats and uniqueness", async () => {
    await expect(
      db.query(`insert into public.channels (youtube_channel_id, title) values ('not-a-channel', 'x')`),
    ).rejects.toThrow(/channels_youtube_channel_id_format/);

    await db.query(`insert into public.channels (youtube_channel_id, title) values ($1, 'Google for Developers')`, [
      CHANNEL_ID,
    ]);
    await expect(
      db.query(`insert into public.channels (youtube_channel_id, title) values ($1, 'dupe')`, [CHANNEL_ID]),
    ).rejects.toThrow(/channels_youtube_channel_id_key/);
  });

  it("cascades snapshots and videos when a channel is deleted", async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.channels (youtube_channel_id, title) values ('UCaaaaaaaaaaaaaaaaaaaaaa', 'Temp') returning id`,
    );
    const channelId = rows[0]!.id;
    await db.query(
      `insert into public.channel_snapshots (channel_id, view_count, video_count, subscriber_count) values ($1, 10, 1, 5)`,
      [channelId],
    );
    await db.query(
      `insert into public.videos (youtube_video_id, channel_id, title, published_at) values ('dQw4w9WgXcQ', $1, 'v', now())`,
      [channelId],
    );
    await db.query(`delete from public.channels where id = $1`, [channelId]);
    const left = await db.query<{ n: number }>(
      `select (select count(*) from public.channel_snapshots where channel_id = $1)::int
            + (select count(*) from public.videos where channel_id = $1)::int as n`,
      [channelId],
    );
    expect(left.rows[0]!.n).toBe(0);
  });

  it("claims queued jobs exactly once and respects priority", async () => {
    await db.query(`insert into public.jobs (type, priority) values ('channel.sync', 0), ('channel.sync', 10)`);
    const first = await db.query<{ priority: number; status: string; attempts: number; locked_by: string }>(
      `select priority, status, attempts, locked_by from public.claim_jobs('worker-a', 1)`,
    );
    expect(first.rows).toEqual([{ priority: 10, status: "running", attempts: 1, locked_by: "worker-a" }]);

    const second = await db.query<{ priority: number }>(`select priority from public.claim_jobs('worker-b', 5)`);
    expect(second.rows.map((r) => r.priority)).toEqual([0]);

    const none = await db.query(`select * from public.claim_jobs('worker-c', 5)`);
    expect(none.rows).toHaveLength(0);
  });

  it("prevents duplicate active jobs with the same idempotency key", async () => {
    await db.query(`insert into public.jobs (type, idempotency_key) values ('video.sync', 'video:abc')`);
    await expect(
      db.query(`insert into public.jobs (type, idempotency_key) values ('video.sync', 'video:abc')`),
    ).rejects.toThrow(/jobs_idempotency_active_key/);
  });

  it("computes credit balances from the ledger and validates sign by source", async () => {
    const { rows } = await db.query<{ id: string }>(`select id from public.workspaces limit 1`);
    const ws = rows[0]!.id;
    await db.query(
      `insert into public.credits (workspace_id, delta, source) values ($1, 100, 'grant'), ($1, -30, 'usage'),
       ($1, 50, 'grant')`,
      [ws],
    );
    await db.query(
      `insert into public.credits (workspace_id, delta, source, expires_at) values ($1, 999, 'grant', now() - interval '1 day')`,
      [ws],
    );
    const balance = await db.query<{ balance: string | number }>(
      `select balance from public.workspace_credit_balances where workspace_id = $1`,
      [ws],
    );
    expect(Number(balance.rows[0]!.balance)).toBe(120);

    await expect(
      db.query(`insert into public.credits (workspace_id, delta, source) values ($1, 10, 'usage')`, [ws]),
    ).rejects.toThrow(/credits_sign_matches_source/);
  });
});
