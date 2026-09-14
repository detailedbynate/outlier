-- =============================================================================
-- Account roles and per-user limits (credits, YouTube quota), managed by the
-- owner/admins at /admin/accounts. No drop statements; safe to re-run.
-- =============================================================================

create table if not exists public.account_settings (
  user_id              uuid primary key references public.users (id) on delete cascade,
  email                text not null,
  role                 text not null default 'member',
  -- null = use the app default
  daily_credits        integer,
  youtube_daily_units  integer,
  quota_tier           text not null default 'default',
  disabled             boolean not null default false,
  note                 text,
  created_by           uuid references public.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint account_settings_role_valid check (role in ('owner', 'admin', 'member')),
  constraint account_settings_credits_valid check (daily_credits is null or daily_credits >= 0),
  constraint account_settings_units_valid check (youtube_daily_units is null or youtube_daily_units >= 0)
);

create unique index if not exists account_settings_email_idx on public.account_settings (lower(email));
alter table public.account_settings enable row level security;

create or replace trigger account_settings_set_updated_at
  before update on public.account_settings
  for each row execute function public.set_updated_at();

-- Founder account.
insert into public.account_settings (user_id, email, role)
select id, email, 'owner' from public.users where lower(email) = 'nathanchintu@icloud.com'
on conflict (user_id) do update set role = 'owner', disabled = false;
