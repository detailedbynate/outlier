-- =============================================================================
-- Research tools: tracked vs. discovered channels, and the Shorts channels view.
-- =============================================================================

-- Tracked channels are refreshed daily. Channels found by research tools are
-- stored lighter and refreshed weekly.
alter table public.channels add column tracked boolean not null default false;

-- Everything that existed before this migration was tracked on purpose.
update public.channels set tracked = true;

create index channels_tracked_synced_idx on public.channels (tracked, last_synced_at nulls first);

-- Per-channel stats over the latest 50 stored uploads. Computed on read, so it
-- costs no storage.
create view public.shorts_channels
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
  s.shorts_last_30d
from public.channels c
join stats s on s.channel_id = c.id
-- A "Shorts channel": at least 3 Shorts, making up 60%+ of recent uploads.
where s.shorts_sampled >= 3
  and s.shorts_sampled::numeric / s.videos_sampled >= 0.6;
