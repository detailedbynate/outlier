-- Niche Finder track record: the games it picked each week, and whether small
-- channels that posted them afterwards actually broke out.

create table if not exists public.niche_picks (
  id          uuid primary key default gen_random_uuid(),
  picked_on   date not null,
  kind        text not null default 'game',
  name        text not null,
  format      text not null,
  score       integer not null,
  -- The numbers it was picked on: median views, breakout rate, channels posting.
  baseline    jsonb not null default '{}'::jsonb,
  -- The same numbers for uploads posted in the 30 days after the pick.
  outcome     jsonb,
  hit         boolean,
  scored_at   timestamptz,
  created_at  timestamptz not null default now(),
  unique (picked_on, kind, name, format)
);

create index if not exists niche_picks_due_idx on public.niche_picks (picked_on) where scored_at is null;
create index if not exists niche_picks_scored_idx on public.niche_picks (scored_at desc) where scored_at is not null;

alter table public.niche_picks enable row level security;
-- Only the server (service role) reads and writes it; RLS keeps users out.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.niche_picks to service_role;
  end if;
end $$;
