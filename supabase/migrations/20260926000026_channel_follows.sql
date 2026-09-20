-- =============================================================================
-- Channel follows: who tracks which channel.
--
-- Tracking used to be a single boolean on the channel itself, so one person
-- tracking a channel put it in everyone's Tracked Channels. Following is a
-- relationship between a user and a channel, so it belongs in its own table.
--
-- channels.tracked stays, but only as "somebody follows this", which is what
-- the daily refresh scheduler actually needs to know.
-- No drop statements; safe to re-run.
-- =============================================================================

create table if not exists public.channel_follows (
  user_id    uuid not null references public.users (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

-- "Does anyone still follow this channel?", asked on every unfollow.
create index if not exists channel_follows_channel_idx on public.channel_follows (channel_id);
-- A user's own list, newest first.
create index if not exists channel_follows_user_time_idx on public.channel_follows (user_id, created_at desc);

alter table public.channel_follows enable row level security;
-- Only the server (service role) reads and writes it; RLS keeps users out.
do $$
begin
  -- Supabase has this role; plain Postgres (tests) doesn't.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.channel_follows to service_role;
  end if;
end $$;

-- Backfill: nothing recorded who tracked what, so every existing tracked
-- channel goes to the owner accounts. Other users start with an empty list
-- rather than inheriting a stranger's.
insert into public.channel_follows (user_id, channel_id)
select s.user_id, c.id
from public.channels c
cross join (select user_id from public.account_settings where role = 'owner') s
where c.tracked
on conflict do nothing;
