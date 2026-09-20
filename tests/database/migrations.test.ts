import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase, migrationFiles } from "../helpers/database";

const EXPECTED_TABLES = [
  "users",
  "account_settings",
  "moderation_actions",
  "niche_reports",
  "referral_codes",
  "referral_rewards",
  "credit_grants",
  "credit_ledger",
  "subscriptions",
  "channel_follows",
  "youtube_quota_usage",
  "youtube_api_cache",
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

  it("keeps one person's tracked channels out of everyone else's", async () => {
    const user = async (email: string) =>
      (await db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0]!.id;
    const [alice, bob] = [await user("alice@example.com"), await user("bob@example.com")];
    const channel = (
      await db.query<{ id: string }>(`insert into public.channels (youtube_channel_id, title) values ($1, 'Shared') returning id`, [
        "UCshared0000000000000000",
      ])
    ).rows[0]!.id;

    await db.query(`insert into public.channel_follows (user_id, channel_id) values ($1, $2)`, [alice, channel]);
    const forBob = await db.query(`select 1 from public.channel_follows where user_id = $1`, [bob]);
    expect(forBob.rows).toHaveLength(0);

    // Following twice is the same as following once.
    await db.query(`insert into public.channel_follows (user_id, channel_id) values ($1, $2) on conflict do nothing`, [alice, channel]);
    const forAlice = await db.query(`select 1 from public.channel_follows where user_id = $1`, [alice]);
    expect(forAlice.rows).toHaveLength(1);

    // A deleted channel takes the follows with it, rather than leaving orphans.
    await db.query(`delete from public.channels where id = $1`, [channel]);
    const left = await db.query(`select 1 from public.channel_follows where channel_id = $1`, [channel]);
    expect(left.rows).toHaveLength(0);
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

  it("lists channels whose recent uploads are mostly Shorts, with stats", async () => {
    const insertChannel = async (ytId: string, title: string) =>
      (
        await db.query<{ id: string }>(
          `insert into public.channels (youtube_channel_id, title, subscriber_count) values ($1, $2, 1000) returning id`,
          [ytId, title],
        )
      ).rows[0]!.id;
    const insertVideos = async (channelId: string, prefix: string, formats: string[], views: number[]) => {
      for (const [i, format] of formats.entries()) {
        await db.query(
          `insert into public.videos (youtube_video_id, channel_id, title, published_at, format, view_count)
           values ($1, $2, 'v', now() - make_interval(days => $3), $4::public.video_format, $5)`,
          [`${prefix}${String(i).padStart(11 - prefix.length, "0")}`, channelId, i + 1, format, views[i]],
        );
      }
    };

    const shortsChannel = await insertChannel("UCssssssssssssssssssssss", "Shorts Maker");
    await insertVideos(shortsChannel, "sh", ["short", "short", "short", "short", "long_form"], [100, 200, 300, 400, 5000]);
    const longChannel = await insertChannel("UCllllllllllllllllllllll", "Long Form Only");
    await insertVideos(longChannel, "lf", ["long_form", "long_form", "short", "short", "short"], [1, 1, 1, 1, 1].map((x) => x * 10));
    // 3 Shorts of 5 uploads is exactly 60%; a third long-form upload drops it below the threshold.
    await db.query(
      `insert into public.videos (youtube_video_id, channel_id, title, published_at, format) values ('lfextra0001', $1, 'v', now(), 'long_form')`,
      [longChannel],
    );

    const { rows } = await db.query<{
      title: string;
      shorts_sampled: number;
      shorts_share: string;
      avg_short_views: string;
      median_short_views: string;
    }>(`select title, shorts_sampled::int, shorts_share, avg_short_views, median_short_views from public.shorts_channels order by title`);
    expect(rows.map((r) => r.title)).toEqual(["Shorts Maker"]);
    expect(rows[0]).toMatchObject({ shorts_sampled: 4 });
    expect(Number(rows[0]!.shorts_share)).toBe(0.8);
    expect(Number(rows[0]!.avg_short_views)).toBe(250);
    expect(Number(rows[0]!.median_short_views)).toBe(250);
  });

  it("computes 24h and 48h growth from snapshots, null without history", async () => {
    const { rows } = await db.query<{ id: string }>(
      `select channel_id as id from public.shorts_channels where youtube_channel_id = 'UCssssssssssssssssssssss'`,
    );
    const channelId = rows[0]!.id;
    const growth = async () =>
      (
        await db.query<{ views_24h: string | null; views_48h: string | null; subs_24h: string | null; subs_48h: string | null }>(
          `select views_24h, views_48h, subs_24h, subs_48h from public.shorts_channels where channel_id = $1`,
          [channelId],
        )
      ).rows[0]!;

    await db.query(
      `insert into public.channel_snapshots (channel_id, captured_at, view_count, video_count, subscriber_count) values ($1, now(), 5000, 5, 1200)`,
      [channelId],
    );
    expect(await growth()).toEqual({ views_24h: null, views_48h: null, subs_24h: null, subs_48h: null });

    await db.query(
      `insert into public.channel_snapshots (channel_id, captured_at, view_count, video_count, subscriber_count) values
        ($1, now() - interval '49 hours', 1000, 5, 1000),
        ($1, now() - interval '30 hours', 2500, 5, 1080),
        ($1, now() - interval '25 hours', 3000, 5, 1100),
        ($1, now() - interval '5 days', 10, 5, 1)`,
      [channelId],
    );
    const g = await growth();
    expect([g.views_24h, g.views_48h, g.subs_24h, g.subs_48h].map(Number)).toEqual([2000, 4000, 100, 200]);
  });

  it("stores waitlist signups once per email, case-insensitively", async () => {
    await db.query(`insert into public.waitlist_entries (email, niche) values ('Creator@Example.com', 'cooking')`);
    await expect(db.query(`insert into public.waitlist_entries (email) values ('creator@example.com')`)).rejects.toThrow(
      /waitlist_entries_email_key/,
    );
    await expect(db.query(`insert into public.waitlist_entries (email) values ('not-an-email')`)).rejects.toThrow(
      /waitlist_email_format/,
    );
    const { rows } = await db.query<{ status: string; relrowsecurity: boolean }>(
      `select w.status, c.relrowsecurity from public.waitlist_entries w, pg_class c where c.relname = 'waitlist_entries'`,
    );
    expect(rows[0]).toEqual({ status: "pending", relrowsecurity: true });
  });

  it("stores one preferences row per user and enforces allowed values", async () => {
    const { rows } = await db.query<{ id: string }>(`insert into auth.users (email) values ('onboard@example.com') returning id`);
    const userId = rows[0]!.id;
    await db.query(
      `insert into public.user_preferences (user_id, goals, content_formats, niches, has_channel, channel)
       values ($1, array['grow_channel','find_niches'], array['shorts'], array['gaming'], true, '@me')`,
      [userId],
    );
    await expect(
      db.query(`update public.user_preferences set goals = array['world_domination'] where user_id = $1`, [userId]),
    ).rejects.toThrow(/user_preferences_goals_valid/);
    await expect(
      db.query(`update public.user_preferences set has_channel = false where user_id = $1`, [userId]),
    ).rejects.toThrow(/user_preferences_channel_consistent/);

    // Re-running the migration is a no-op.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    await db.exec(readFileSync(join(process.cwd(), "supabase/migrations/20260914000011_user_preferences.sql"), "utf8"));
    await db.exec(readFileSync(join(process.cwd(), "supabase/migrations/20260914000010_waitlist.sql"), "utf8"));
  });

  it("counts rate-limit hits per window and blocks past the maximum", async () => {
    const hit = async () =>
      (await db.query<{ allowed: boolean; hits: number }>(`select allowed, hits from public.rate_limit_hit('test:ip:abc', 3600, 2)`)).rows[0]!;
    expect(await hit()).toEqual({ allowed: true, hits: 1 });
    expect(await hit()).toEqual({ allowed: true, hits: 2 });
    expect(await hit()).toEqual({ allowed: false, hits: 3 });
    const other = await db.query<{ allowed: boolean }>(`select allowed from public.rate_limit_hit('test:ip:other', 3600, 2)`);
    expect(other.rows[0]!.allowed).toBe(true);
  });

  it("adds engagement, pace, hit rate, multiplier, and language to Shorts channels", async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.channels (youtube_channel_id, title, subscriber_count) values ('UCmmmmmmmmmmmmmmmmmmmmmm', 'Stats', 1000) returning id`,
    );
    const channelId = rows[0]!.id;
    // Views 100, 100, 100, 500 -> median 100, top 500, one Short at >= 2x median.
    for (const [i, views] of [100, 100, 100, 500].entries()) {
      await db.query(
        `insert into public.videos (youtube_video_id, channel_id, title, published_at, format, view_count, like_count, comment_count)
         values ($1, $2, 'v', now() - make_interval(days => $3), 'short', $4, $5, 0)`,
        [`stats${String(i).padStart(6, "0")}`, channelId, i + 1, views, views / 10],
      );
    }
    await db.query(`update public.channels set content_language = 'other' where id = $1`, [channelId]);
    const stat = (
      await db.query<Record<string, string | number | boolean | null>>(
        `select avg_engagement, shorts_per_week, views_per_sub, hit_rate, top_multiplier, content_language, is_target_language
         from public.shorts_channels where channel_id = $1`,
        [channelId],
      )
    ).rows[0]!;
    expect(Number(stat.avg_engagement)).toBeCloseTo(0.1);
    expect(Number(stat.shorts_per_week)).toBe(1);
    expect(Number(stat.views_per_sub)).toBeCloseTo(0.2);
    expect(Number(stat.hit_rate)).toBe(0.25);
    expect(Number(stat.top_multiplier)).toBe(5);
    expect(stat.is_target_language).toBe(false);
  });

  it("stores trending picks with hourly stats that cascade on delete", async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.trending_picks (pick_date, niche, youtube_channel_id, channel_title, youtube_video_id, video_title, video_views, outlier_multiplier)
       values (current_date, 'comedy', 'UCtttttttttttttttttttttt', 'Funny', 'trendvid001', 'Clip', 900000, 3.4) returning id`,
    );
    await db.query(`insert into public.trending_pick_stats (pick_id, views) values ($1, 900000)`, [rows[0]!.id]);
    await expect(
      db.query(
        `insert into public.trending_picks (pick_date, niche, youtube_channel_id, channel_title, youtube_video_id, video_title)
         values (current_date, 'pets', 'UCx', 'x', 'trendvid001', 'dupe')`,
      ),
    ).rejects.toThrow(/trending_picks_unique_video/);
    await db.query(`delete from public.trending_picks where id = $1`, [rows[0]!.id]);
    const left = await db.query<{ n: number }>(`select count(*)::int as n from public.trending_pick_stats`);
    expect(left.rows[0]!.n).toBe(0);
  });

  it("consumes YouTube quota atomically within total, lane, and per-user limits", async () => {
    const consume = async (lane: string, user: string, units: number, userLimit: number | null = null) =>
      (
        await db.query<{ ok: boolean }>(`select public.consume_youtube_quota('2026-09-16', $1, 'op', $2, $3, 1000, $4, $5) as ok`, [
          lane,
          user,
          units,
          lane === "background" ? 600 : 1000,
          userLimit,
        ])
      ).rows[0]!.ok;
    expect(await consume("background", "", 500)).toBe(true);
    expect(await consume("background", "", 101)).toBe(false); // lane cap 600
    expect(await consume("user", "u1", 100, 150)).toBe(true);
    expect(await consume("user", "u1", 100, 150)).toBe(false); // per-user cap
    expect(await consume("user", "u2", 400, 500)).toBe(true); // total now 1000
    expect(await consume("user", "u3", 1, 500)).toBe(false); // total cap
    const usage = await db.query<{ units: number; denied: number }>(
      `select sum(units)::int as units, sum(denied)::int as denied from public.youtube_quota_usage where day = '2026-09-16'`,
    );
    expect(usage.rows[0]).toEqual({ units: 1000, denied: 3 });
  });

  it("adds views per hour to Shorts channels", async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.channels (youtube_channel_id, title, subscriber_count) values ('UCvvvvvvvvvvvvvvvvvvvvvv', 'Vph', 1000) returning id`,
    );
    for (const [i, views] of [1000, 2000, 3000].entries()) {
      await db.query(
        `insert into public.videos (youtube_video_id, channel_id, title, published_at, format, view_count, views_per_hour, last_checked_at)
         values ($1, $2, 'v', now() - interval '10 hours', 'short', $3, 50, now())`,
        [`vphvid${String(i).padStart(5, "0")}`, rows[0]!.id, views],
      );
    }
    const stat = (
      await db.query<{ recent_vph: string; live_vph: string }>(`select recent_vph, live_vph from public.shorts_channels where channel_id = $1`, [
        rows[0]!.id,
      ])
    ).rows[0]!;
    expect(Number(stat.recent_vph)).toBeCloseTo(200, 0);
    expect(Number(stat.live_vph)).toBe(150);

    const video = (await db.query<{ id: string }>(`select id from public.videos where youtube_video_id = 'vphvid00000'`)).rows[0]!;
    const updated = await db.query<{ n: number }>(`select public.apply_video_monitoring($1::jsonb) as n`, [
      JSON.stringify([{ id: video.id, view_count: 5000, views_per_hour: 400, view_acceleration: 350, monitor_priority: 3, next_check_at: "2026-09-16T13:00:00Z", last_checked_at: "2026-09-16T12:00:00Z" }]),
    ]);
    expect(updated.rows[0]!.n).toBe(1);
    const row = (await db.query<Record<string, unknown>>(`select view_count, like_count, monitor_priority from public.videos where id = $1`, [video.id])).rows[0]!;
    expect(row).toMatchObject({ monitor_priority: 3, like_count: null });
    expect(Number(row.view_count)).toBe(5000);
  });

  it("stores account roles and limits with validation", async () => {
    const { rows } = await db.query<{ id: string }>(`insert into auth.users (email) values ('member@example.com') returning id`);
    const userId = rows[0]!.id;
    await db.query(`insert into public.account_settings (user_id, email, daily_credits, youtube_daily_units) values ($1, 'member@example.com', 250, 500)`, [userId]);
    const row = (await db.query<{ role: string; quota_tier: string; disabled: boolean }>(`select role, quota_tier, disabled from public.account_settings where user_id = $1`, [userId])).rows[0];
    expect(row).toEqual({ role: "member", quota_tier: "default", disabled: false });
    await expect(db.query(`update public.account_settings set role = 'superuser' where user_id = $1`, [userId])).rejects.toThrow(/account_settings_role_valid/);
    await expect(db.query(`update public.account_settings set daily_credits = -1 where user_id = $1`, [userId])).rejects.toThrow(/account_settings_credits_valid/);
  });

  it("logs moderation actions and fully removes accounts with their workspaces", async () => {
    const { rows } = await db.query<{ id: string }>(`insert into auth.users (email) values ('gone@example.com') returning id`);
    const userId = rows[0]!.id;
    await db.query(`insert into public.account_settings (user_id, email, banned_until, ban_reason) values ($1, 'gone@example.com', now() + interval '1 day', 'spam')`, [userId]);
    await db.query(`insert into public.moderation_actions (target_user_id, target_email, action, reason) values ($1, 'gone@example.com', 'temp_ban', 'spam')`, [userId]);
    await expect(db.query(`insert into public.moderation_actions (target_email, action) values ('x@example.com', 'nuke')`)).rejects.toThrow(/moderation_actions_action_valid/);

    const removed = await db.query<{ ok: boolean }>(`select public.delete_user_account($1) as ok`, [userId]);
    expect(removed.rows[0]!.ok).toBe(true);
    const left = await db.query<{ users: number; workspaces: number; settings: number; log_target: string | null }>(
      `select (select count(*) from public.users where id = $1)::int as users,
              (select count(*) from public.workspaces where owner_id = $1)::int as workspaces,
              (select count(*) from public.account_settings where user_id = $1)::int as settings,
              (select target_user_id::text from public.moderation_actions where target_email = 'gone@example.com') as log_target`,
      [userId],
    );
    expect(left.rows[0]).toEqual({ users: 0, workspaces: 0, settings: 0, log_target: null });
  });

  it("lets exactly one caller claim a stale niche refresh", async () => {
    const claim = async (staleBefore: string) =>
      (await db.query<{ ok: boolean }>(`select public.claim_niche_refresh('gaming', 'Gaming', $1::timestamptz, 120) as ok`, [staleBefore])).rows[0]!.ok;
    expect(await claim(new Date().toISOString())).toBe(true);
    expect(await claim(new Date().toISOString())).toBe(false); // already claimed
    await db.query(`update public.niche_reports set refresh_claimed_at = null, youtube_refreshed_at = now() where topic_key = 'gaming'`);
    expect(await claim(new Date(Date.now() - 86_400_000).toISOString())).toBe(false); // refreshed recently
    await expect(db.query(`insert into public.niche_reports (topic_key, topic) values ('Bad Key!', 'x')`)).rejects.toThrow(/niche_reports_key_format/);
  });

  it("stores competitor alert preferences with valid kinds only", async () => {
    const { rows } = await db.query<{ id: string }>(`insert into auth.users (email) values ('alerts@example.com') returning id`);
    const saved = await db.query<{ competitor_alerts: string[] }>(
      `insert into public.user_preferences (user_id) values ($1) returning competitor_alerts`,
      [rows[0]!.id],
    );
    expect(saved.rows[0]!.competitor_alerts).toEqual(["uploads", "breakouts", "subscriber_growth", "view_growth"]);
    await expect(db.query(`update public.user_preferences set competitor_alerts = array['spam'] where user_id = $1`, [rows[0]!.id])).rejects.toThrow(
      /user_preferences_competitor_alerts_valid/,
    );
  });

  it("stores referral codes, tracks referred signups, and grants credits once", async () => {
    const waitlist = await db.query<{ id: string }>(`insert into public.waitlist_entries (email) values ('ref-owner@example.com'), ('ref-friend@example.com') returning id`);
    const [owner, friend] = waitlist.rows;
    await db.query(`insert into public.referral_codes (code, waitlist_entry_id) values ('abcd2345', $1)`, [owner!.id]);
    await expect(db.query(`insert into public.referral_codes (code) values ('BAD CODE')`)).rejects.toThrow(/referral_codes_format|referral_codes_owner/);
    await db.query(`update public.waitlist_entries set referred_by_code = 'abcd2345' where id = $1`, [friend!.id]);
    const count = await db.query<{ n: number }>(`select count(*)::int as n from public.waitlist_entries where referred_by_code = 'abcd2345'`);
    expect(count.rows[0]!.n).toBe(1);

    const { rows } = await db.query<{ id: string }>(`insert into auth.users (email) values ('ref-friend@example.com') returning id`);
    await db.query(`insert into public.referral_rewards (code, referred_user_id, referred_credits) values ('abcd2345', $1, 50)`, [rows[0]!.id]);
    await expect(db.query(`insert into public.referral_rewards (code, referred_user_id) values ('abcd2345', $1)`, [rows[0]!.id])).rejects.toThrow(/referred_user_id/);
    await db.query(`insert into public.credit_grants (user_id, amount, reason, source_id) values ($1, 50, 'referral_welcome', 'r1')`, [rows[0]!.id]);
    await expect(db.query(`insert into public.credit_grants (user_id, amount, reason, source_id) values ($1, 50, 'referral_welcome', 'r1')`, [rows[0]!.id])).rejects.toThrow(/credit_grants_unique_source/);
    await expect(db.query(`insert into public.credit_grants (user_id, amount, reason) values ($1, 0, 'x')`, [rows[0]!.id])).rejects.toThrow(/credit_grants_amount_positive/);
  });

  it("labels channels with a niche entity and keeps entity channel counts current", async () => {
    const category = await db.query<{ id: string }>(`insert into public.niches (slug, name, kind) values ('gaming-labels', 'Gaming', 'category') returning id`);
    const game = await db.query<{ id: string }>(
      `insert into public.niches (slug, name, kind, parent_id, keywords) values ('clash-royale-labels', 'Clash Royale', 'game', $1, '{cr,clashroyale}') returning id`,
      [category.rows[0]!.id],
    );
    await expect(db.query(`insert into public.niches (slug, name, kind) values ('bad-kind', 'Bad', 'genre')`)).rejects.toThrow(/niches_kind_valid/);

    const channel = await db.query<{ id: string; niche_labels: string[]; quality_flags: string[]; niche_labeled_at: string | null }>(
      `insert into public.channels (youtube_channel_id, title) values ('UClabelsxxxxxxxxxxxxxxxx', 'Deck Lab') returning id, niche_labels, quality_flags, niche_labeled_at`,
    );
    expect(channel.rows[0]).toMatchObject({ niche_labels: [], quality_flags: [], niche_labeled_at: null });

    await db.query(
      `update public.channels set niche_id = $1, niche_category = 'Gaming', niche_labels = '{clash royale deck guides}', quality_flags = '{}', niche_confidence = 0.92, niche_labeled_at = now(), niche_label_model = 'claude-opus-5' where id = $2`,
      [game.rows[0]!.id, channel.rows[0]!.id],
    );
    await expect(db.query(`update public.channels set niche_confidence = 1.5 where id = $1`, [channel.rows[0]!.id])).rejects.toThrow(/channels_niche_confidence_range/);

    await db.query(`select public.refresh_niche_channel_counts()`);
    const counts = await db.query<{ slug: string; channel_count: number }>(
      `select slug, channel_count from public.niches where slug in ('gaming-labels', 'clash-royale-labels') order by slug`,
    );
    expect(counts.rows).toEqual([
      { slug: "clash-royale-labels", channel_count: 1 },
      { slug: "gaming-labels", channel_count: 0 },
    ]);

    const byLabel = await db.query<{ n: number }>(`select count(*)::int as n from public.channels where niche_labels && array['clash royale deck guides']`);
    expect(byLabel.rows[0]!.n).toBe(1);
  });

  it("ranks small channels with outsized Shorts views above huge channels by underrated score", async () => {
    const insertChannel = async (ytId: string, title: string, subscribers: number) =>
      (
        await db.query<{ id: string }>(`insert into public.channels (youtube_channel_id, title, subscriber_count) values ($1, $2, $3) returning id`, [
          ytId,
          title,
          subscribers,
        ])
      ).rows[0]!.id;
    const small = await insertChannel("UCunderratedxxxxxxxxxxxx", "Small Gem", 4_000);
    const huge = await insertChannel("UChugechannelxxxxxxxxxxx", "Huge Star", 8_000_000);

    const views: [string, string, number[]][] = [
      [small, "gem", [180_000, 240_000, 90_000, 400_000]],
      [huge, "big", [900_000, 1_100_000, 950_000, 1_000_000]],
    ];
    for (const [channelId, prefix, counts] of views) {
      for (const [i, count] of counts.entries()) {
        await db.query(
          `insert into public.videos (youtube_video_id, channel_id, title, published_at, format, view_count) values ($1, $2, $3, now() - ($4 || ' days')::interval, 'short', $5)`,
          [`${prefix}vid${i}`.padEnd(11, "0"), channelId, `${prefix} short ${i}`, String(i + 1), count],
        );
      }
    }

    const { rows } = await db.query<{ title: string; underrated_score: string; niche_labels: string[]; quality_flags: string[] }>(
      `select title, underrated_score, niche_labels, quality_flags from public.shorts_channels where channel_id in ($1, $2) order by underrated_score desc`,
      [small, huge],
    );
    expect(rows.map((r) => r.title)).toEqual(["Small Gem", "Huge Star"]);
    expect(Number(rows[0]!.underrated_score)).toBeGreaterThan(Number(rows[1]!.underrated_score) + 20);
    expect(Number(rows[0]!.underrated_score)).toBeLessThanOrEqual(100);
    expect(rows[0]).toMatchObject({ niche_labels: [], quality_flags: [] });
  });

  it("defaults new channels to untracked", async () => {
    const { rows } = await db.query<{ tracked: boolean }>(
      `insert into public.channels (youtube_channel_id, title) values ('UCnnnnnnnnnnnnnnnnnnnnnn', 'New') returning tracked`,
    );
    expect(rows[0]!.tracked).toBe(false);
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
