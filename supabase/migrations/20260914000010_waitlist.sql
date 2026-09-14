-- =============================================================================
-- Waitlist & invites. Signups arrive from the public landing page; an admin
-- invites people in batches, and invited emails are approved to use the app.
-- Server-only (service role): RLS is enabled with no public policies.
-- Safe to re-run.
-- =============================================================================

do $$
begin
  create type public.waitlist_status as enum ('pending', 'invited', 'joined', 'declined');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.waitlist_entries (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  name          text,
  channel_url   text,
  niche         text,
  use_case      text,
  source        text,
  status        public.waitlist_status not null default 'pending',
  invited_at    timestamptz,
  joined_at     timestamptz,
  -- Auth user id of the admin who sent the invite (informational, no FK).
  invited_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint waitlist_email_format check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  constraint waitlist_field_lengths check (
    coalesce(char_length(name), 0) <= 100
    and coalesce(char_length(channel_url), 0) <= 300
    and coalesce(char_length(niche), 0) <= 100
    and coalesce(char_length(use_case), 0) <= 500
    and coalesce(char_length(source), 0) <= 100
  )
);

create unique index if not exists waitlist_entries_email_key on public.waitlist_entries (lower(email));
create index if not exists waitlist_entries_status_created_idx on public.waitlist_entries (status, created_at);

create or replace trigger waitlist_entries_set_updated_at
  before update on public.waitlist_entries
  for each row execute function public.set_updated_at();

alter table public.waitlist_entries enable row level security;
