-- =============================================================================
-- Subscriptions: a paid plan that raises a user's monthly credit allowance for
-- as long as Stripe says they're paying. One row per user; Stripe is the source
-- of truth and the webhook keeps this in step with it.
-- No drop statements; safe to re-run.
-- =============================================================================

create table if not exists public.subscriptions (
  user_id                uuid primary key references public.users (id) on delete cascade,
  -- Plan id from lib/billing/plans.ts. 'free' means no paid plan.
  plan                   text not null default 'free',
  -- Stripe's own status, kept verbatim so support questions can be answered.
  status                 text not null default 'inactive',
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  -- When the current paid period ends: the allowance holds until then.
  current_period_end     timestamptz,
  -- They cancelled but the period they paid for is still running.
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint subscriptions_plan_valid check (plan in ('free', 'pro', 'expert'))
);

create index if not exists subscriptions_customer_idx on public.subscriptions (stripe_customer_id);

alter table public.subscriptions enable row level security;
-- Only the server (service role) reads and writes it; RLS keeps users out.
do $$
begin
  -- Supabase has this role; plain Postgres (tests) doesn't.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.subscriptions to service_role;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
    create trigger subscriptions_set_updated_at before update on public.subscriptions
      for each row execute function public.set_updated_at();
  end if;
end $$;
