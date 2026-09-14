-- =============================================================================
-- Quota-aware YouTube ingestion: daily quota ledger (by lane, operation, user),
-- an API response cache, priority monitoring fields, and views-per-hour stats.
-- No drop statements; safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Quota ledger. `day` is the YouTube quota day (resets at midnight Pacific).
-- `user_key` is '' for requests not tied to a user.
-- -----------------------------------------------------------------------------
create table if not exists public.youtube_quota_usage (
  day         date not null,
  lane        text not null,
  operation   text not null,
  user_key    text not null default '',
  units       integer not null default 0,
  requests    integer not null default 0,
  denied      integer not null default 0,
  updated_at  timestamptz not null default now(),
  constraint youtube_quota_usage_pk primary key (day, lane, operation, user_key),
  constraint youtube_quota_usage_lane_valid check (lane in ('background', 'user'))
);

create index if not exists youtube_quota_usage_day_idx on public.youtube_quota_usage (day, lane);
alter table public.youtube_quota_usage enable row level security;

/**
 * Atomically check limits and record usage. Returns true when the request may
 * proceed. Limits are passed in so they stay configurable per tier in the app.
 * A day-scoped advisory lock serializes concurrent consumers.
 */
create or replace function public.consume_youtube_quota(
  p_day date,
  p_lane text,
  p_operation text,
  p_user_key text,
  p_units integer,
  p_total_limit integer,
  p_lane_limit integer,
  p_user_limit integer
) returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_total integer;
  v_lane integer;
  v_user integer;
begin
  perform pg_advisory_xact_lock(hashtext('youtube_quota:' || p_day::text));

  select coalesce(sum(units), 0) into v_total from youtube_quota_usage where day = p_day;
  select coalesce(sum(units), 0) into v_lane from youtube_quota_usage where day = p_day and lane = p_lane;
  select coalesce(sum(units), 0) into v_user from youtube_quota_usage
    where day = p_day and lane = p_lane and p_user_key <> '' and user_key = p_user_key;

  if v_total + p_units > p_total_limit
     or v_lane + p_units > p_lane_limit
     or (p_user_limit is not null and p_user_key <> '' and v_user + p_units > p_user_limit) then
    insert into youtube_quota_usage (day, lane, operation, user_key, denied)
    values (p_day, p_lane, p_operation, coalesce(p_user_key, ''), 1)
    on conflict (day, lane, operation, user_key)
    do update set denied = youtube_quota_usage.denied + 1, updated_at = now();
    return false;
  end if;

  insert into youtube_quota_usage (day, lane, operation, user_key, units, requests)
  values (p_day, p_lane, p_operation, coalesce(p_user_key, ''), p_units, 1)
  on conflict (day, lane, operation, user_key)
  do update set units = youtube_quota_usage.units + excluded.units,
                requests = youtube_quota_usage.requests + 1,
                updated_at = now();
  return true;
end;
$$;

revoke all on function public.consume_youtube_quota(date, text, text, text, integer, integer, integer, integer) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- API response cache: identical requests (any user) reuse recent responses.
-- -----------------------------------------------------------------------------
create table if not exists public.youtube_api_cache (
  cache_key   text primary key,
  endpoint    text not null,
  response    jsonb not null,
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists youtube_api_cache_expires_idx on public.youtube_api_cache (expires_at);
alter table public.youtube_api_cache enable row level security;

-- -----------------------------------------------------------------------------
-- Priority monitoring. Rising content gets short `next_check_at` intervals.
-- -----------------------------------------------------------------------------
alter table public.videos add column if not exists views_per_hour numeric(14, 2);
alter table public.videos add column if not exists view_acceleration numeric(14, 2);
alter table public.videos add column if not exists monitor_priority smallint not null default 0;
alter table public.videos add column if not exists next_check_at timestamptz;
alter table public.videos add column if not exists last_checked_at timestamptz;
create index if not exists videos_next_check_idx on public.videos (next_check_at) where next_check_at is not null;
create index if not exists videos_unchecked_recent_idx on public.videos (published_at desc) where last_checked_at is null;

alter table public.channels add column if not exists monitor_priority smallint not null default 0;
alter table public.channels add column if not exists next_check_at timestamptz;
create index if not exists channels_next_check_idx on public.channels (next_check_at) where next_check_at is not null;

/** Apply one monitoring pass: new stats, momentum, and next check time per video (one round trip). */
create or replace function public.apply_video_monitoring(updates jsonb)
returns integer
language sql
set search_path = public
as $$
  with input as (
    select * from jsonb_to_recordset(updates) as r(
      id uuid,
      view_count bigint,
      like_count bigint,
      comment_count bigint,
      views_per_hour numeric,
      view_acceleration numeric,
      monitor_priority smallint,
      next_check_at timestamptz,
      last_checked_at timestamptz
    )
  ), updated as (
    update videos v set
      view_count = coalesce(r.view_count, v.view_count),
      like_count = coalesce(r.like_count, v.like_count),
      comment_count = coalesce(r.comment_count, v.comment_count),
      views_per_hour = r.views_per_hour,
      view_acceleration = r.view_acceleration,
      monitor_priority = r.monitor_priority,
      next_check_at = r.next_check_at,
      last_checked_at = r.last_checked_at,
      updated_at = now()
    from input r
    where v.id = r.id
    returning 1
  )
  select count(*)::int from updated;
$$;

revoke all on function public.apply_video_monitoring(jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Shorts channels view: previous columns unchanged, plus views per hour.
--   recent_vph: average views/hour since upload for Shorts from the last 7 days (instant, no history needed)
--   live_vph:   current views/hour summed across recently monitored Shorts (from snapshots)
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
    v.views_per_hour,
    v.last_checked_at,
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
      filter (where format = 'short' and (like_count is not null or comment_count is not null)) as avg_engagement,
    avg(view_count / greatest(extract(epoch from (now() - published_at)) / 3600, 1))
      filter (where format = 'short' and published_at > now() - interval '7 days') as recent_vph,
    sum(views_per_hour)
      filter (where format = 'short' and views_per_hour is not null and last_checked_at > now() - interval '6 hours') as live_vph
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
  round(s.avg_engagement, 5)                                                     as avg_engagement,
  round(s.shorts_last_28d::numeric / 4, 2)                                        as shorts_per_week,
  round(s.avg_short_views / nullif(c.subscriber_count, 0), 3)                     as views_per_sub,
  round(coalesce(h.big_hits, 0)::numeric / s.shorts_sampled, 4)                   as hit_rate,
  round(s.top_short_views::numeric / nullif(s.median_short_views, 0)::numeric, 2) as top_multiplier,
  c.content_language,
  (c.content_language is distinct from 'other')                                   as is_target_language,
  -- New in this migration
  round(s.recent_vph, 1)                                                          as recent_vph,
  round(s.live_vph, 1)                                                            as live_vph
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
