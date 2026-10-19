-- Channel traits shown as badges and filters on Shorts Channels:
--   faceless: whether the creator appears on camera, judged from a few Shorts
--             thumbnails by Claude Haiku (lib/services/channel-traits-service.ts).
--   YPP eligibility is computed at read time from views, so it isn't stored.

create table if not exists public.channel_traits (
  channel_id          uuid primary key references public.channels (id) on delete cascade,
  faceless            boolean,
  faceless_checked_at timestamptz,
  model               text
);

create index if not exists channel_traits_faceless_idx on public.channel_traits (faceless) where faceless is not null;

alter table public.channel_traits enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.channel_traits to service_role;
  end if;
end $$;

-- Channels to look at next: established ones (1,000+ subscribers) with Shorts
-- thumbnails to judge, never checked or checked before `stale_before`, biggest first.
create or replace function public.channels_for_faceless_check(batch_size integer, stale_before timestamptz)
returns setof uuid
language sql
stable
set search_path = public
as $$
  select c.id
  from channels c
  left join channel_traits t on t.channel_id = c.id
  where (t.faceless_checked_at is null or t.faceless_checked_at < stale_before)
    and c.subscriber_count >= 1000
    and not ('removed' = any (c.quality_flags))
    and exists (
      select 1 from videos v
      where v.channel_id = c.id and v.format = 'short' and v.thumbnail_url is not null
    )
  order by t.faceless_checked_at nulls first, c.subscriber_count desc nulls last
  limit least(greatest(batch_size, 1), 500);
$$;

-- Views on each channel's Shorts published in the last 90 days: the Partner
-- Program's Shorts bar is 10M of those (with 1,000 subscribers).
create or replace function public.channel_shorts_views_90d(ids uuid[])
returns table (channel_id uuid, views bigint)
language sql
stable
set search_path = public
as $$
  select v.channel_id, coalesce(sum(v.view_count), 0)::bigint
  from videos v
  where v.channel_id = any (ids)
    and v.format = 'short'
    and v.published_at > now() - interval '90 days'
  group by v.channel_id;
$$;

revoke execute on function public.channels_for_faceless_check(integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.channel_shorts_views_90d(uuid[]) from public, anon, authenticated;
