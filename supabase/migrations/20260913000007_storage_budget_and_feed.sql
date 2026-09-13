-- =============================================================================
-- Storage budget, snapshot retention, and the discovery feed view.
-- =============================================================================

-- Current database size in bytes. The app compares it to STORAGE_BUDGET_MB and
-- stops ingesting new data before the plan limit is reached.
create or replace function public.database_size_bytes()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select pg_database_size(current_database());
$$;

-- Thin out snapshot history:
--   * newer than daily_days  -> keep the latest snapshot per day
--   * older than daily_days  -> keep the latest snapshot per week
--   * older than max_days    -> delete
-- Returns how many rows were removed from each table.
create or replace function public.prune_snapshots(daily_days integer default 30, max_days integer default 365)
returns table (channel_snapshots_deleted bigint, video_snapshots_deleted bigint)
language plpgsql
volatile
as $$
declare
  daily_cutoff constant timestamptz := now() - make_interval(days => daily_days);
  max_cutoff   constant timestamptz := now() - make_interval(days => max_days);
  channel_count bigint;
  video_count   bigint;
begin
  if daily_days < 1 or max_days <= daily_days then
    raise exception 'prune_snapshots: require 1 <= daily_days < max_days (got %, %)', daily_days, max_days;
  end if;

  with ranked as (
    select id, captured_at,
           row_number() over (
             partition by channel_id,
               case when captured_at >= daily_cutoff then date_trunc('day', captured_at)
                    else date_trunc('week', captured_at) end
             order by captured_at desc
           ) as rn
    from public.channel_snapshots
  ), deleted as (
    delete from public.channel_snapshots s
    using ranked r
    where s.id = r.id and (r.rn > 1 or r.captured_at < max_cutoff)
    returning 1
  )
  select count(*) into channel_count from deleted;

  with ranked as (
    select id, captured_at,
           row_number() over (
             partition by video_id,
               case when captured_at >= daily_cutoff then date_trunc('day', captured_at)
                    else date_trunc('week', captured_at) end
             order by captured_at desc
           ) as rn
    from public.video_snapshots
  ), deleted as (
    delete from public.video_snapshots s
    using ranked r
    where s.id = r.id and (r.rn > 1 or r.captured_at < max_cutoff)
    returning 1
  )
  select count(*) into video_count from deleted;

  return query select channel_count, video_count;
end;
$$;

revoke execute on function public.database_size_bytes() from public, anon, authenticated;
revoke execute on function public.prune_snapshots(integer, integer) from public, anon, authenticated;

-- Flattened feed for discovery UIs: video + channel + derived performance.
create view public.video_feed
with (security_invoker = true) as
select
  v.id                   as video_id,
  v.youtube_video_id,
  v.title,
  v.thumbnail_url,
  v.published_at,
  v.format,
  v.duration_seconds,
  v.view_count,
  v.like_count,
  v.comment_count,
  c.id                   as channel_id,
  c.youtube_channel_id,
  c.title                as channel_title,
  c.thumbnail_url        as channel_thumbnail_url,
  c.subscriber_count,
  p.views_per_day,
  p.engagement_rate,
  p.outlier_score,
  p.channel_median_views,
  p.views_delta_24h,
  p.views_delta_7d,
  p.computed_at
from public.videos v
join public.channels c on c.id = v.channel_id
left join public.video_performance p on p.video_id = v.id;
