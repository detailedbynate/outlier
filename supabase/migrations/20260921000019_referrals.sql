-- =============================================================================
-- Referrals: every waitlist signup and every account gets a shareable code.
-- Signups through a code are credited to the referrer; when a referred person
-- creates an account, both sides get bonus credits (recorded as grants).
-- No drop statements; safe to re-run.
-- =============================================================================

create table if not exists public.referral_codes (
  code               text primary key,
  waitlist_entry_id  uuid unique references public.waitlist_entries (id) on delete cascade,
  user_id            uuid unique references public.users (id) on delete cascade,
  created_at         timestamptz not null default now(),
  constraint referral_codes_format check (code ~ '^[a-z0-9]{6,16}$'),
  constraint referral_codes_owner check (waitlist_entry_id is not null or user_id is not null)
);

alter table public.referral_codes enable row level security;

-- Which code a waitlist signup came through.
alter table public.waitlist_entries add column if not exists referred_by_code text references public.referral_codes (code) on delete set null;
create index if not exists waitlist_entries_referred_by_idx on public.waitlist_entries (referred_by_code) where referred_by_code is not null;

-- One reward per referred account. The referrer side stays pending until the referrer has an account.
create table if not exists public.referral_rewards (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null references public.referral_codes (code) on delete cascade,
  referred_user_id   uuid not null unique references public.users (id) on delete cascade,
  referrer_user_id   uuid references public.users (id) on delete set null,
  referred_credits   integer not null default 0,
  referrer_credits   integer not null default 0,
  referrer_rewarded_at timestamptz,
  created_at         timestamptz not null default now(),
  constraint referral_rewards_credits_valid check (referred_credits >= 0 and referrer_credits >= 0)
);

create index if not exists referral_rewards_code_idx on public.referral_rewards (code);
create index if not exists referral_rewards_referrer_idx on public.referral_rewards (referrer_user_id, referrer_rewarded_at);
alter table public.referral_rewards enable row level security;

-- Bonus credits added to a user's allowance for the month they're granted.
create table if not exists public.credit_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  amount      integer not null,
  reason      text not null,
  source_id   text,
  created_at  timestamptz not null default now(),
  constraint credit_grants_amount_positive check (amount > 0),
  -- The same reward can't be granted twice.
  constraint credit_grants_unique_source unique (user_id, reason, source_id)
);

create index if not exists credit_grants_user_time_idx on public.credit_grants (user_id, created_at desc);
alter table public.credit_grants enable row level security;

-- Codes for everyone already on the waitlist.
insert into public.referral_codes (code, waitlist_entry_id)
select substr(md5(random()::text || e.id::text), 1, 8), e.id
from public.waitlist_entries e
where not exists (select 1 from public.referral_codes rc where rc.waitlist_entry_id = e.id)
on conflict do nothing;
