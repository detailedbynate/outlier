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

  it("reports database size and exposes the video feed", async () => {
    const size = await db.query<{ bytes: string | number }>(`select public.database_size_bytes() as bytes`);
    expect(Number(size.rows[0]!.bytes)).toBeGreaterThan(0);

    const { rows } = await db.query<{ id: string }>(
      `insert into public.channels (youtube_channel_id, title, subscriber_count) values ('UCffffffffffffffffffffff', 'Feed', 10) returning id`,
    );
    const video = await db.query<{ id: string }>(
      `insert into public.videos (youtube_video_id, channel_id, title, published_at, view_count)
       values ('feedvideo01', $1, 'Feed video', now(), 500) returning id`,
      [rows[0]!.id],
    );
    await db.query(`insert into public.video_performance (video_id, views_per_day, outlier_score) values ($1, 100, 4.5)`, [
      video.rows[0]!.id,
    ]);
    const feed = await db.query<{ channel_title: string; outlier_score: string }>(
      `select channel_title, outlier_score from public.video_feed where youtube_video_id = 'feedvideo01'`,
    );
    expect(feed.rows[0]!.channel_title).toBe("Feed");
    expect(Number(feed.rows[0]!.outlier_score)).toBe(4.5);
  });

  it("prunes snapshots to one per day recently, one per week later, none past retention", async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.channels (youtube_channel_id, title) values ('UCpppppppppppppppppppppp', 'Prune') returning id`,
    );
    const channelId = rows[0]!.id;
    // Today: 3 snapshots (keep 1). 60 days ago: 3 in the same week (keep 1). 400 days ago: 1 (delete).
    await db.query(
      `insert into public.channel_snapshots (channel_id, captured_at, view_count, video_count)
       select $1, ts, 1, 1 from unnest(array[
         date_trunc('day', now()) + interval '1 hour',
         date_trunc('day', now()) + interval '2 hours',
         date_trunc('day', now()) + interval '3 hours',
         date_trunc('week', now() - interval '60 days') + interval '1 day',
         date_trunc('week', now() - interval '60 days') + interval '2 days',
         date_trunc('week', now() - interval '60 days') + interval '3 days',
         now() - interval '400 days'
       ]::timestamptz[]) as ts`,
      [channelId],
    );
    const result = await db.query<{ channel_snapshots_deleted: string | number }>(
      `select * from public.prune_snapshots(30, 365)`,
    );
    expect(Number(result.rows[0]!.channel_snapshots_deleted)).toBe(5);
    const left = await db.query<{ n: number }>(
      `select count(*)::int as n from public.channel_snapshots where channel_id = $1`,
      [channelId],
    );
    expect(left.rows[0]!.n).toBe(2);
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
