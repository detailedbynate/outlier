-- Discord: an Outlier account linked to a Discord account, so the server can
-- give paying members their Pro or Expert role (lib/services/discord-service.ts).
-- Linked with Discord sign-in from Billing; one Discord account per Outlier
-- account and the other way round.

create table if not exists public.discord_links (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  discord_id       text not null unique,
  discord_username text not null,
  linked_at        timestamptz not null default now(),
  -- The roles Outlier last gave them, and when: what the daily check compares with.
  synced_plan      text,
  synced_at        timestamptz
);

alter table public.discord_links enable row level security;
-- Only the server (service role) reads and writes it; RLS keeps users out.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.discord_links to service_role;
  end if;
end $$;
