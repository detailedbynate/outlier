-- =============================================================================
-- Realtime growth for Shorts channels: views and subscribers gained over the
-- last ~24h and ~48h, from channel_snapshots (captured every few hours).
-- Columns are appended so `create or replace view` keeps existing ones intact.
-- =============================================================================

create or replace view public.shorts_channels
with (security_invoker = true) as
with recent as (
  select
    v.channel_id,
    v.format,
    v.view_count,
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
    count(*) filter (where format = 'short' and published_at > now() - interval '30 days') as shorts_last_30d
  from recent
  where rn <= 50
  group by channel_id
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
  -- Growth vs. the snapshot closest to 24h / 48h before the latest one.
  -- Null until enough history exists (the baseline must fall inside the window).
  (latest.view_count - d1.view_count)                    as views_24h,
  (latest.view_count - d2.view_count)                    as views_48h,
  (latest.subscriber_count - d1.subscriber_count)        as subs_24h,
  (latest.subscriber_count - d2.subscriber_count)        as subs_48h,
  latest.captured_at                                     as stats_captured_at
from public.channels c
join stats s on s.channel_id = c.id
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
-- A "Shorts channel": at least 3 Shorts, making up 60%+ of recent uploads.
where s.shorts_sampled >= 3
  and s.shorts_sampled::numeric / s.videos_sampled >= 0.6;
