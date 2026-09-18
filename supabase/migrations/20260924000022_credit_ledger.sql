-- =============================================================================
-- Credit ledger: credits that don't reset monthly. Purchases and owner
-- adjustments add to it; when a user's monthly allowance runs out, spending
-- draws it down (recorded as "spend" rows). Balance = sum(amount).
-- No drop statements; safe to re-run.
-- =============================================================================

create table if not exists public.credit_ledger (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users (id) on delete cascade,
  amount             integer not null,
  kind               text not null,
  note               text,
  -- One purchase per Stripe Checkout session, however often the webhook fires.
  stripe_session_id  text unique,
  actor_id           uuid references public.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint credit_ledger_kind_valid check (kind in ('purchase', 'admin', 'spend')),
  constraint credit_ledger_amount_nonzero check (amount <> 0),
  constraint credit_ledger_spend_negative check (kind <> 'spend' or amount < 0),
  constraint credit_ledger_purchase_positive check (kind <> 'purchase' or amount > 0)
);

create index if not exists credit_ledger_user_time_idx on public.credit_ledger (user_id, created_at desc);
alter table public.credit_ledger enable row level security;
-- Only the server (service role) reads and writes it; RLS keeps users out.
do $$
begin
  -- Supabase has this role; plain Postgres (tests) doesn't.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.credit_ledger to service_role;
  end if;
end $$;
