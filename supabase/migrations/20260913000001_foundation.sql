-- =============================================================================
-- Foundation: extensions, shared helpers, enums
-- =============================================================================

create extension if not exists pg_trgm;

-- Keeps updated_at current on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create type public.workspace_role as enum ('owner', 'admin', 'member', 'viewer');

create type public.video_format as enum ('long_form', 'short', 'live', 'upcoming');

create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');

create type public.credit_source as enum ('grant', 'purchase', 'usage', 'refund', 'adjustment', 'expiry');
