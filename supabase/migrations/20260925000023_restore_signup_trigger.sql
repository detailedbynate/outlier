-- =============================================================================
-- Restore the signup trigger. Moving to the self-hosted database copied the
-- public schema but not triggers that live on auth.users, so new signups got a
-- login without a profile. Recreates the trigger and backfills anyone who
-- signed up while it was missing. Safe to re-run.
-- =============================================================================

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Create what the trigger would have for accounts that have a login but no profile.
with missing as (
  select a.id, a.email, a.raw_user_meta_data
  from auth.users a
  left join public.users u on u.id = a.id
  where u.id is null
), profiles as (
  insert into public.users (id, email, display_name)
  select id, email, coalesce(raw_user_meta_data ->> 'full_name', split_part(email, '@', 1)) from missing
  returning id
), spaces as (
  insert into public.workspaces (name, slug, owner_id)
  select 'Personal', 'ws-' || replace(id::text, '-', ''), id from profiles
  returning id, owner_id
)
insert into public.workspace_members (workspace_id, user_id, role)
select id, owner_id, 'owner' from spaces;
