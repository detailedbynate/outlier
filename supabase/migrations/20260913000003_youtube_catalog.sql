-- =============================================================================
-- YouTube catalog: niches, channels, videos, and their time-series snapshots.
-- These are shared reference data (not workspace-owned): one row per YouTube
-- entity, refreshed by background jobs. Snapshots are append-only so growth
-- can be computed over any window.
-- =============================================================================

create table public.niches (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references public.niches (id) on delete set null,
  slug        text not null,
  name        text not null,
  description text,
  keywords    text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint niches_slug_key unique (slug),
  constraint niches_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint niches_not_own_parent check (parent_id is null or parent_id <> id)
);

create index niches_parent_id_idx on public.niches (parent_id);
create index niches_keywords_gin_idx on public.niches using gin (keywords);

create trigger niches_set_updated_at
  before update on public.niches
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------

create table public.channels (
  id                      uuid primary key default gen_random_uuid(),
  youtube_channel_id      text not null,
  handle                  text,
  title                   text not null,
  description             text,
  custom_url              text,
  country                 text,
  default_language        text,
  thumbnail_url           text,
  banner_url              text,
  uploads_playlist_id     text,
  published_at            timestamptz,
  subscriber_count        bigint,
  view_count              bigint not null default 0,
  video_count             integer not null default 0,
  hidden_subscriber_count boolean not null default false,
  made_for_kids           boolean,
  topic_categories        text[] not null default '{}',
  keywords                text[] not null default '{}',
  niche_id                uuid references public.niches (id) on delete set null,
  last_synced_at          timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint channels_youtube_channel_id_key unique (youtube_channel_id),
  constraint channels_youtube_channel_id_format check (youtube_channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  constraint channels_counts_non_negative check (
    (subscriber_count is null or subscriber_count >= 0) and view_count >= 0 and video_count >= 0
  ),
  constraint channels_country_format check (country is null or country ~ '^[A-Z]{2}$')
);

create unique index channels_handle_lower_key on public.channels (lower(handle)) where handle is not null;
create index channels_niche_id_idx on public.channels (niche_id);
create index channels_subscriber_count_idx on public.channels (subscriber_count desc nulls last);
create index channels_published_at_idx on public.channels (published_at desc);
create index channels_last_synced_at_idx on public.channels (last_synced_at nulls first);
create index channels_title_trgm_idx on public.channels using gin (title gin_trgm_ops);
create index channels_keywords_gin_idx on public.channels using gin (keywords);

create trigger channels_set_updated_at
  before update on public.channels
  for each row execute function public.set_updated_at();

create table public.channel_snapshots (
  id               uuid primary key default gen_random_uuid(),
  channel_id       uuid not null references public.channels (id) on delete cascade,
  captured_at      timestamptz not null default now(),
  subscriber_count bigint,
  view_count       bigint not null,
  video_count      integer not null,
  created_at       timestamptz not null default now(),
  constraint channel_snapshots_unique unique (channel_id, captured_at),
  constraint channel_snapshots_counts_non_negative check (
    (subscriber_count is null or subscriber_count >= 0) and view_count >= 0 and video_count >= 0
  )
);

-- The unique constraint's index covers (channel_id, captured_at) lookups; add
-- a descending variant for "latest snapshot" queries.
create index channel_snapshots_channel_latest_idx on public.channel_snapshots (channel_id, captured_at desc);

-- -----------------------------------------------------------------------------

create table public.videos (
  id                     uuid primary key default gen_random_uuid(),
  youtube_video_id       text not null,
  channel_id             uuid not null references public.channels (id) on delete cascade,
  title                  text not null,
  description            text,
  published_at           timestamptz not null,
  duration_seconds       integer,
  format                 public.video_format not null default 'long_form',
  category_id            text,
  tags                   text[] not null default '{}',
  default_language       text,
  default_audio_language text,
  thumbnail_url          text,
  definition             text,
  has_captions           boolean,
  made_for_kids          boolean,
  view_count             bigint not null default 0,
  like_count             bigint,
  comment_count          bigint,
  niche_id               uuid references public.niches (id) on delete set null,
  last_synced_at         timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint videos_youtube_video_id_key unique (youtube_video_id),
  constraint videos_youtube_video_id_format check (youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  constraint videos_duration_non_negative check (duration_seconds is null or duration_seconds >= 0),
  constraint videos_counts_non_negative check (
    view_count >= 0 and (like_count is null or like_count >= 0) and (comment_count is null or comment_count >= 0)
  )
);

create index videos_channel_published_idx on public.videos (channel_id, published_at desc);
create index videos_published_at_idx on public.videos (published_at desc);
create index videos_view_count_idx on public.videos (view_count desc);
create index videos_format_published_idx on public.videos (format, published_at desc);
create index videos_niche_id_idx on public.videos (niche_id);
create index videos_title_trgm_idx on public.videos using gin (title gin_trgm_ops);
create index videos_tags_gin_idx on public.videos using gin (tags);

create trigger videos_set_updated_at
  before update on public.videos
  for each row execute function public.set_updated_at();

create table public.video_snapshots (
  id            uuid primary key default gen_random_uuid(),
  video_id      uuid not null references public.videos (id) on delete cascade,
  captured_at   timestamptz not null default now(),
  view_count    bigint not null,
  like_count    bigint,
  comment_count bigint,
  created_at    timestamptz not null default now(),
  constraint video_snapshots_unique unique (video_id, captured_at),
  constraint video_snapshots_counts_non_negative check (
    view_count >= 0 and (like_count is null or like_count >= 0) and (comment_count is null or comment_count >= 0)
  )
);

create index video_snapshots_video_latest_idx on public.video_snapshots (video_id, captured_at desc);

-- -----------------------------------------------------------------------------
-- Derived metrics, recomputed by analytics jobs. One current row per video;
-- history lives in video_snapshots. Indexed for "viral/outlier" discovery.
-- -----------------------------------------------------------------------------

create table public.video_performance (
  id                   uuid primary key default gen_random_uuid(),
  video_id             uuid not null references public.videos (id) on delete cascade,
  views_per_day        numeric(20, 4) not null default 0,
  engagement_rate      numeric(10, 6),
  outlier_score        numeric(12, 4),
  channel_median_views bigint,
  views_delta_24h      bigint,
  views_delta_7d       bigint,
  views_delta_30d      bigint,
  computed_at          timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint video_performance_video_id_key unique (video_id),
  constraint video_performance_non_negative check (
    views_per_day >= 0 and (engagement_rate is null or engagement_rate >= 0) and (outlier_score is null or outlier_score >= 0)
  )
);

create index video_performance_outlier_score_idx on public.video_performance (outlier_score desc nulls last);
create index video_performance_views_per_day_idx on public.video_performance (views_per_day desc);
create index video_performance_views_delta_7d_idx on public.video_performance (views_delta_7d desc nulls last);

create trigger video_performance_set_updated_at
  before update on public.video_performance
  for each row execute function public.set_updated_at();
