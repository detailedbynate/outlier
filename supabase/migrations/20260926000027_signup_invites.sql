-- =============================================================================
-- Signup invites: the one-time link a new subscriber gets after paying.
--
-- Only the SHA-256 of the token is stored, so a copy of this table isn't a set
-- of working links. A row is spent the moment it's used, and it expires on its
-- own if it never is.
-- No drop statements; safe to re-run.
-- =============================================================================

create table if not exists public.signup_invites (
  -- SHA-256 hex of the token that was emailed; the token itself is never stored.
  token_hash text primary key,
  user_id    uuid not null references public.users (id) on delete cascade,
  email      text not null,
  expires_at timestamptz not null,
  -- Set the moment the invite is spent; a spent invite is never accepted again.
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists signup_invites_user_idx on public.signup_invites (user_id, created_at desc);

alter table public.signup_invites enable row level security;
-- Only the server (service role) reads and writes it; RLS keeps users out.
do $$
begin
  -- Supabase has this role; plain Postgres (tests) doesn't.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.signup_invites to service_role;
  end if;
end $$;
