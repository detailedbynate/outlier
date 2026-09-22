-- =============================================================================
-- Saved Shorts scripts.
--
-- A script costs eight credits and is rate limited to one every three hours,
-- so losing one to a closed tab is expensive in a way nothing else here is.
-- Every script is kept from the moment it's written; there is no "save" button
-- to forget to press, only a delete for the ones that weren't any good.
--
-- The request is stored beside the result because "what did I ask for?" is the
-- useful thing when comparing two attempts at the same idea.
-- No drop statements; safe to re-run.
-- =============================================================================

create table if not exists public.saved_scripts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  -- What they asked for.
  topic       text not null,
  idea        text not null,
  angle       text,
  seconds     smallint not null,
  tone        text not null,
  -- What came back. Titles are a small ordered list, so jsonb rather than a table.
  script      text not null,
  titles      jsonb not null default '[]'::jsonb,
  words       integer not null default 0,
  model       text not null default '',
  created_at  timestamptz not null default now(),
  constraint saved_scripts_seconds_sane check (seconds between 5 and 120),
  constraint saved_scripts_words_non_negative check (words >= 0)
);

-- The only query there is: one person's scripts, newest first.
create index if not exists saved_scripts_user_time_idx on public.saved_scripts (user_id, created_at desc);

alter table public.saved_scripts enable row level security;
-- Only the server (service role) reads and writes it; RLS keeps users out.
do $$
begin
  -- Supabase has this role; plain Postgres (tests) doesn't.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.saved_scripts to service_role;
  end if;
end $$;
