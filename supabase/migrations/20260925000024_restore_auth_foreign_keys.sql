-- =============================================================================
-- Restore the links from profiles to logins. Moving to the self-hosted
-- database loaded profiles before logins, so these foreign keys failed to
-- come back, and deleting a login no longer removed its profile. Clears
-- profiles left behind by removed accounts, then re-adds the keys. Safe to re-run.
-- =============================================================================

delete from public.workspaces w
where not exists (select 1 from auth.users a where a.id = w.owner_id);

delete from public.user_preferences p
where not exists (select 1 from auth.users a where a.id = p.user_id);

delete from public.users u
where not exists (select 1 from auth.users a where a.id = u.id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_id_fkey' and conrelid = 'public.users'::regclass) then
    alter table public.users add constraint users_id_fkey foreign key (id) references auth.users (id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_preferences_user_id_fkey' and conrelid = 'public.user_preferences'::regclass) then
    alter table public.user_preferences add constraint user_preferences_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;
  end if;
end $$;
