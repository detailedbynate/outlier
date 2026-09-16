-- =============================================================================
-- Niche labels: every channel gets a category, a canonical game or topic, and
-- specific sub-niches, so research queries labels instead of guessing from text.
-- Reuses public.niches (entities) and channels.niche_id from the catalog.
-- No drop statements; safe to re-run.
-- =============================================================================

-- What kind of entity a niche row is: a broad category, a specific game, or a topic.
alter table public.niches add column if not exists kind text not null default 'topic';
alter table public.niches add column if not exists channel_count integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'niches_kind_valid') then
    alter table public.niches add constraint niches_kind_valid check (kind in ('category', 'game', 'topic'));
  end if;
end $$;

create index if not exists niches_kind_idx on public.niches (kind, channel_count desc);
alter table public.niches enable row level security;

-- Per-channel labels.
alter table public.channels add column if not exists niche_category text;
alter table public.channels add column if not exists niche_labels text[] not null default '{}';
alter table public.channels add column if not exists content_formats text[] not null default '{}';
alter table public.channels add column if not exists quality_flags text[] not null default '{}';
alter table public.channels add column if not exists niche_confidence real;
alter table public.channels add column if not exists niche_labeled_at timestamptz;
alter table public.channels add column if not exists niche_label_model text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'channels_niche_confidence_range') then
    alter table public.channels add constraint channels_niche_confidence_range check (niche_confidence is null or (niche_confidence >= 0 and niche_confidence <= 1));
  end if;
end $$;

create index if not exists channels_niche_id_idx on public.channels (niche_id);
create index if not exists channels_niche_category_idx on public.channels (niche_category);
create index if not exists channels_niche_labels_gin_idx on public.channels using gin (niche_labels);
create index if not exists channels_quality_flags_gin_idx on public.channels using gin (quality_flags);
-- The labeling job looks for channels that were never labeled.
create index if not exists channels_unlabeled_idx on public.channels (created_at) where niche_labeled_at is null;

-- Keep channel_count current for browsing niches by size.
create or replace function public.refresh_niche_channel_counts()
returns void
language sql
set search_path = public
as $$
  update niches n
  set channel_count = coalesce(c.total, 0)
  from (
    select n2.id, count(ch.id)::int as total
    from niches n2
    left join channels ch on ch.niche_id = n2.id
    group by n2.id
  ) c
  where c.id = n.id and n.channel_count is distinct from coalesce(c.total, 0);
$$;

-- Library growth follows the channels creators feature on their pages; this marks which were checked.
alter table public.channels add column if not exists featured_checked_at timestamptz;
create index if not exists channels_featured_unchecked_idx on public.channels (created_at) where featured_checked_at is null;

-- Shorts channels, now with niche labels and an underrated score for ranking creators.
-- Same definition as 20260916000014 with columns appended (a replaced view may only add columns at the end).
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
  round(s.live_vph, 1)                                                            as live_vph,
  -- New in 20260922000020: niche labels and the underrated score.
  c.niche_id,
  c.niche_category,
  c.niche_labels,
  c.quality_flags,
  c.niche_confidence,
  -- 0-100. High when a channel's Shorts pull far more views than its size predicts,
  -- often beat its own median, are still posting, and it isn't already huge.
  round((100 * (
      0.35 * least(ln(1 + coalesce(s.avg_short_views / nullif(c.subscriber_count, 0), 0)) / ln(501), 1)
    + 0.20 * least(coalesce(h.big_hits, 0)::numeric / s.shorts_sampled / 0.3, 1)
    + 0.15 * least(ln(1 + coalesce(s.avg_short_views, 0)) / ln(1000001), 1)
    + 0.15 * (case when s.last_short_at > now() - interval '30 days' then 1 when s.last_short_at > now() - interval '90 days' then 0.5 else 0 end)
    + 0.15 * (case
        when c.subscriber_count is null then 0.5
        when c.subscriber_count < 10000 then 1
        when c.subscriber_count < 100000 then 0.85
        when c.subscriber_count < 500000 then 0.55
        when c.subscriber_count < 1000000 then 0.3
        else 0 end)
  ))::numeric, 1)                                                                 as underrated_score
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
