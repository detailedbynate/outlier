-- =============================================================================
-- Trending picks as first-class rows (clearable, refreshed hourly), detected
-- content language per channel, and richer Shorts channel stats.
-- No drop statements; safe to re-run.
-- =============================================================================

-- Detected from recent uploads ('en', 'other', or null when unknown).
alter table public.channels add column if not exists content_language text;
alter table public.channels add column if not exists language_checked_at timestamptz;
create index if not exists channels_language_check_idx on public.channels (language_checked_at nulls first);

-- -----------------------------------------------------------------------------
-- Daily trending picks: one breakout Short per niche (plus a backup), with the
-- stats needed to show why it's an outlier. Denormalized so the section never
-- depends on a channel finishing its catalog sync.
-- -----------------------------------------------------------------------------
create table if not exists public.trending_picks (
  id                    uuid primary key default gen_random_uuid(),
  pick_date             date not null,
  niche                 text not null,
  rank                  smallint not null default 0,
  youtube_channel_id    text not null,
  channel_title         text not null,
  channel_thumbnail_url text,
  channel_country       text,
  subscriber_count      bigint,
  youtube_video_id      text not null,
  video_title           text not null,
  video_published_at    timestamptz,
  video_views           bigint not null default 0,
  video_likes           bigint,
  video_comments        bigint,
  channel_median_views  bigint,
  outlier_multiplier    numeric(10, 2),
  underrated_score      numeric(12, 3),
  views_1h              bigint,
  views_24h             bigint,
  stats_updated_at      timestamptz,
  created_at            timestamptz not null default now(),
  constraint trending_picks_unique_video unique (pick_date, youtube_video_id),
  constraint trending_picks_rank_valid check (rank between 0 and 5),
  constraint trending_picks_counts_non_negative check (
    video_views >= 0 and (subscriber_count is null or subscriber_count >= 0)
  )
);

create index if not exists trending_picks_date_rank_idx on public.trending_picks (pick_date desc, niche, rank);

-- Hourly view history for picks (a few hundred rows per day, pruned after 3 days).
create table if not exists public.trending_pick_stats (
  id           uuid primary key default gen_random_uuid(),
  pick_id      uuid not null references public.trending_picks (id) on delete cascade,
  captured_at  timestamptz not null default now(),
  views        bigint not null,
  likes        bigint,
  comments     bigint,
  constraint trending_pick_stats_unique unique (pick_id, captured_at)
);

create index if not exists trending_pick_stats_pick_time_idx on public.trending_pick_stats (pick_id, captured_at desc);

alter table public.trending_picks enable row level security;
alter table public.trending_pick_stats enable row level security;

-- -----------------------------------------------------------------------------
-- Shorts channels view: same columns as before, plus engagement, posting pace,
-- views per subscriber, hit rate, outlier multiplier, and content language.
-- New columns are appended so `create or replace` keeps existing ones intact.
-- -----------------------------------------------------------------------------
create or replace view public.shorts_channels
with (security_invoker = true) as
with recent as (
  select
    v.channel_id,
    v.format,
    v.view_count,
    v.like_count,
    v.comment_count,
    v.published_at,
    row_number() over (partition by v.channel_id order by v.published_at desc) as rn
  from public.videos v
  where v.format in ('short', 'long_form')
), stats as (
  select
    channel_id,
    count(*)                                                                   as videos_sampled,
    count(*) filter (where format = 'short')                                   as shorts_sampled,
    avg(view_count) filter (where format = 'short')                            as avg_short_views,
    percentile_cont(0.5) within group (order by view_count) filter (where format = 'short') as median_short_views,
    max(view_count) filter (where format = 'short')                            as top_short_views,
    max(published_at) filter (where format = 'short')                          as last_short_at,
    count(*) filter (where format = 'short' and published_at > now() - interval '30 days') as shorts_last_30d,
    count(*) filter (where format = 'short' and published_at > now() - interval '28 days') as shorts_last_28d,
    avg((coalesce(like_count, 0) + coalesce(comment_count, 0))::numeric / nullif(view_count, 0))
      filter (where format = 'short' and (like_count is not null or comment_count is not null)) as avg_engagement
  from recent
  where rn <= 50
  group by channel_id
), hits as (
  select r.channel_id, count(*) as big_hits
  from recent r
  join stats s on s.channel_id = r.channel_id
  where r.rn <= 50 and r.format = 'short' and s.median_short_views > 0 and r.view_count >= 2 * s.median_short_views
  group by r.channel_id
)
select
  c.id                  as channel_id,
  c.youtube_channel_id,
  c.title,
  c.handle,
  c.thumbnail_url,
  c.country,
  c.published_at        as channel_created_at,
  c.subscriber_count,
  c.hidden_subscriber_count,
  c.view_count,
  c.video_count,
  c.tracked,
  c.last_synced_at,
  s.videos_sampled,
  s.shorts_sampled,
  round(s.shorts_sampled::numeric / s.videos_sampled, 4) as shorts_share,
  round(s.avg_short_views)::bigint                        as avg_short_views,
  round(s.median_short_views::numeric)::bigint            as median_short_views,
  s.top_short_views,
  s.last_short_at,
  s.shorts_last_30d,
  (latest.view_count - d1.view_count)                    as views_24h,
  (latest.view_count - d2.view_count)                    as views_48h,
  (latest.subscriber_count - d1.subscriber_count)        as subs_24h,
  (latest.subscriber_count - d2.subscriber_count)        as subs_48h,
  latest.captured_at                                     as stats_captured_at,
  -- New stat trackers
  round(s.avg_engagement, 5)                                                     as avg_engagement,
  round(s.shorts_last_28d::numeric / 4, 2)                                        as shorts_per_week,
  round(s.avg_short_views / nullif(c.subscriber_count, 0), 3)                     as views_per_sub,
  round(coalesce(h.big_hits, 0)::numeric / s.shorts_sampled, 4)                   as hit_rate,
  round(s.top_short_views::numeric / nullif(s.median_short_views, 0)::numeric, 2) as top_multiplier,
  c.content_language,
  (c.content_language is distinct from 'other')                                   as is_target_language
from public.channels c
join stats s on s.channel_id = c.id
left join hits h on h.channel_id = c.id
left join lateral (
  select cs.view_count, cs.subscriber_count, cs.captured_at
  from public.channel_snapshots cs
  where cs.channel_id = c.id
  order by cs.captured_at desc
  limit 1
) latest on true
left join lateral (
  select cs.view_count, cs.subscriber_count
  from public.channel_snapshots cs
  where cs.channel_id = c.id
    and cs.captured_at between latest.captured_at - interval '36 hours' and latest.captured_at - interval '18 hours'
  order by abs(extract(epoch from (cs.captured_at - (latest.captured_at - interval '24 hours'))))
  limit 1
) d1 on true
left join lateral (
  select cs.view_count, cs.subscriber_count
  from public.channel_snapshots cs
  where cs.channel_id = c.id
    and cs.captured_at between latest.captured_at - interval '60 hours' and latest.captured_at - interval '40 hours'
  order by abs(extract(epoch from (cs.captured_at - (latest.captured_at - interval '48 hours'))))
  limit 1
) d2 on true
where s.shorts_sampled >= 3
  and s.shorts_sampled::numeric / s.videos_sampled >= 0.6;
