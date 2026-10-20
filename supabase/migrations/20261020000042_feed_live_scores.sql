-- Viral feed fixes.
--
-- 1. views_per_day and outlier_score were copied from video_performance, which
--    is written once when a video syncs. A Short synced two hours after upload
--    kept "views / 2 hours" as its per-day rate forever (more per day than it
--    ever got in total). Both are now worked out live from the current view
--    count, and per-day divides by at least one day.
-- 2. A channel whose typical video gets 28 views made any 80K-view upload a
--    "2,960x outlier" at the top of Viral Videos. `viral_score` is the same
--    ratio against a baseline of at least 1,000 views, for ranking discovery
--    feeds; `outlier_score` stays the true ratio (a creator's own dashboard
--    and competitor views use it).
-- 3. Paid ads (brand videos run as YouTube ads: 50M views, 31 likes) beat
--    every real video. `promoted` flags 100K+ view videos with under 0.15%
--    likes per view (real videos get 0.3-4%); the feed leaves them out.
--
-- Columns keep their names, types and order; `promoted` and `viral_score` are added at the end.

create or replace view public.video_feed
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
  round(v.view_count::numeric / greatest(extract(epoch from (now() - v.published_at)) / 86400, 1), 4)::numeric(20,4) as views_per_day,
  p.engagement_rate,
  case
    when p.channel_median_views is null or p.channel_median_views <= 0 then null
    else round(v.view_count::numeric / p.channel_median_views, 4)
  end::numeric(12,4)     as outlier_score,
  p.channel_median_views,
  p.views_delta_24h,
  p.views_delta_7d,
  p.computed_at,
  (v.view_count >= 100000 and v.like_count is not null and v.like_count < v.view_count * 0.0015) as promoted,
  case
    when p.channel_median_views is null or p.channel_median_views <= 0 then null
    else round(v.view_count::numeric / greatest(p.channel_median_views, 1000), 4)
  end::numeric(12,4)     as viral_score
from public.videos v
join public.channels c on c.id = v.channel_id
left join public.video_performance p on p.video_id = v.id;
