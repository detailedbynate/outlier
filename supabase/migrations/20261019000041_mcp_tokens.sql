-- Personal tokens for the Outlier MCP server (app/api/mcp/route.ts): members
-- connect Claude (or any MCP client) to their Outlier library with one.
-- Only a SHA-256 hash of the token is kept; the token is shown once.

create table if not exists public.mcp_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  token_hash   text not null unique,
  -- First characters, so people can tell their tokens apart.
  prefix       text not null,
  label        text not null default 'MCP',
  -- Made by staff: works without a paid plan.
  staff        boolean not null default false,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index if not exists mcp_tokens_user_idx on public.mcp_tokens (user_id) where revoked_at is null;

alter table public.mcp_tokens enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.mcp_tokens to service_role;
  end if;
end $$;
