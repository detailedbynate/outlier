-- Creator codes: a creator shares outlier.../?code=NATE, their viewers get money
-- off a paid plan, and the creator earns a cut of what those viewers pay.
-- Codes are made by an admin; commissions are tracked here and paid out by hand.

create table if not exists public.creator_codes (
  id                 uuid primary key default gen_random_uuid(),
  -- Lowercase letters, digits, - and _; shown uppercase.
  code               text not null unique,
  creator_name       text not null,
  -- The creator's Outlier account, when they have one: they see their own numbers.
  user_id            uuid references auth.users (id) on delete set null,
  discount_percent   integer not null check (discount_percent between 1 and 100),
  discount_months    integer not null check (discount_months between 1 and 36),
  commission_percent integer not null check (commission_percent between 0 and 100),
  -- How long a customer earns the creator commission; null = as long as they pay.
  commission_months  integer check (commission_months is null or commission_months between 1 and 120),
  stripe_coupon_id   text not null,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

create index if not exists creator_codes_user_idx on public.creator_codes (user_id) where user_id is not null;

-- One row per paid invoice from a customer who subscribed with a code.
create table if not exists public.creator_commissions (
  id                 uuid primary key default gen_random_uuid(),
  code_id            uuid not null references public.creator_codes (id) on delete cascade,
  stripe_invoice_id  text not null unique,
  stripe_customer_id text,
  user_id            uuid,
  -- What the customer paid before tax, and the creator's share, in cents.
  amount_cents       integer not null,
  commission_cents   integer not null,
  currency           text not null default 'usd',
  paid_at            timestamptz not null,
  -- Set when the commission has been paid out to the creator.
  paid_out_at        timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists creator_commissions_code_idx on public.creator_commissions (code_id, paid_at);
create index if not exists creator_commissions_customer_idx on public.creator_commissions (code_id, stripe_customer_id);

alter table public.creator_codes enable row level security;
alter table public.creator_commissions enable row level security;
-- Only the server (service role) reads and writes them; RLS keeps users out.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.creator_codes to service_role;
    grant all on public.creator_commissions to service_role;
  end if;
end $$;
