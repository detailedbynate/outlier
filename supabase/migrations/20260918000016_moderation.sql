-- =============================================================================
-- Moderation: bans (permanent or temporary), temporary restrictions, an audit
-- log of moderation actions, and full account removal.
-- No drop statements; safe to re-run.
-- =============================================================================

-- Permanent bans use a far-future timestamp.
alter table public.account_settings add column if not exists banned_until timestamptz;
alter table public.account_settings add column if not exists ban_reason text;
-- Restricted accounts can sign in but can't spend credits or YouTube data.
alter table public.account_settings add column if not exists restricted_until timestamptz;
alter table public.account_settings add column if not exists restrict_reason text;

create table if not exists public.moderation_actions (
  id              uuid primary key default gen_random_uuid(),
  target_user_id  uuid references public.users (id) on delete set null,
  target_email    text not null,
  action          text not null,
  reason          text,
  until           timestamptz,
  actor_id        uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint moderation_actions_action_valid check (
    action in ('ban', 'temp_ban', 'unban', 'restrict', 'unrestrict', 'remove', 'set_limits', 'waitlist_remove', 'waitlist_decline')
  )
);

create index if not exists moderation_actions_created_idx on public.moderation_actions (created_at desc);
create index if not exists moderation_actions_target_idx on public.moderation_actions (target_user_id, created_at desc);
alter table public.moderation_actions enable row level security;

/**
 * Permanently delete an account: owned workspaces (and their data), then the
 * auth user, which cascades to the profile, preferences, and settings.
 */
create or replace function public.delete_user_account(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.workspaces where owner_id = p_user_id;
  delete from auth.users where id = p_user_id;
  return found;
end;
$$;

revoke all on function public.delete_user_account(uuid) from public, anon, authenticated;
