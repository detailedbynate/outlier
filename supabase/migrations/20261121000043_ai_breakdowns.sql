-- Claude's read on what's working, organized by one fixed vocabulary
-- (lib/videos/breakdown.ts) so it can be filtered and grouped:
--   video_breakdowns: why an outlier video beat its channel: hook, style,
--                     emotional angle, title pattern, thumbnail, how to copy it.
--   channel_traits:   gains a channel profile next to the faceless verdict: a
--                     one-line summary, main style, presentation, tone,
--                     audience and recurring series.
-- Also fixes the faceless check, which has failed since 20261019000040 because
-- revoking execute from public took it from the app's own role too.

create table if not exists public.video_breakdowns (
  video_id         uuid primary key references public.videos (id) on delete cascade,
  hook_type        text not null,
  style            text not null,
  angle            text not null,
  topic            text not null,
  title_pattern    text not null,
  thumbnail_style  text not null,
  why_it_worked    text not null,
  how_to_copy      text not null,
  tags             text[] not null default '{}',
  model            text not null,
  analyzed_at      timestamptz not null default now()
);

create index if not exists video_breakdowns_style_idx on public.video_breakdowns (style);
create index if not exists video_breakdowns_hook_idx on public.video_breakdowns (hook_type);
create index if not exists video_breakdowns_angle_idx on public.video_breakdowns (angle);

alter table public.video_breakdowns enable row level security;

alter table public.channel_traits
  add column if not exists summary          text,
  add column if not exists main_style       text,
  add column if not exists presentation     text,
  add column if not exists tone             text,
  add column if not exists audience         text,
  add column if not exists content_pillars  text[] not null default '{}';

create index if not exists channel_traits_style_idx on public.channel_traits (main_style) where main_style is not null;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.video_breakdowns to service_role;
    grant execute on function public.channels_for_faceless_check(integer, timestamptz) to service_role;
    grant execute on function public.channel_shorts_views_90d(uuid[]) to service_role;
  end if;
end $$;
