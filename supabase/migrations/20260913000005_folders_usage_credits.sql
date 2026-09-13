-- =============================================================================
-- Folders (channel watchlists), usage metering, and a credits ledger.
-- =============================================================================

create table public.folders (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by   uuid references public.users (id) on delete set null,
  name         text not null,
  description  text,
  color        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint folders_name_length check (char_length(name) between 1 and 100),
  constraint folders_color_format check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint folders_workspace_name_key unique (workspace_id, name)
);

create trigger folders_set_updated_at
  before update on public.folders
  for each row execute function public.set_updated_at();

create table public.folder_channels (
  id         uuid primary key default gen_random_uuid(),
  folder_id  uuid not null references public.folders (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  added_by   uuid references public.users (id) on delete set null,
  note       text,
  created_at timestamptz not null default now(),
  constraint folder_channels_unique unique (folder_id, channel_id)
);

create index folder_channels_channel_id_idx on public.folder_channels (channel_id);

-- -----------------------------------------------------------------------------
-- Usage events: append-only metering of billable/quota'd actions
-- (YouTube API calls, AI generations, exports, API v1 requests...).
-- -----------------------------------------------------------------------------

create table public.usage_events (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid references public.workspaces (id) on delete cascade,
  user_id       uuid references public.users (id) on delete set null,
  event_type    text not null,
  quantity      integer not null default 1,
  credits_cost  integer not null default 0,
  resource_type text,
  resource_id   text,
  metadata      jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  constraint usage_events_type_format check (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint usage_events_quantity_positive check (quantity > 0),
  constraint usage_events_credits_non_negative check (credits_cost >= 0),
  constraint usage_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index usage_events_workspace_occurred_idx on public.usage_events (workspace_id, occurred_at desc);
create index usage_events_type_occurred_idx on public.usage_events (event_type, occurred_at desc);

-- -----------------------------------------------------------------------------
-- Credits: an immutable ledger. Balance = sum(delta) of unexpired entries.
-- A ledger (vs. a mutable balance column) gives a full audit trail and makes
-- refunds/expiry simple inserts.
-- -----------------------------------------------------------------------------

create table public.credits (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  delta          integer not null,
  source         public.credit_source not null,
  reason         text,
  usage_event_id uuid references public.usage_events (id) on delete set null,
  expires_at     timestamptz,
  created_by     uuid references public.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint credits_delta_nonzero check (delta <> 0),
  constraint credits_sign_matches_source check (
    (source in ('grant', 'purchase', 'refund') and delta > 0)
    or (source in ('usage', 'expiry') and delta < 0)
    or source = 'adjustment'
  )
);

create index credits_workspace_created_idx on public.credits (workspace_id, created_at desc);
create unique index credits_usage_event_key on public.credits (usage_event_id) where usage_event_id is not null;

create view public.workspace_credit_balances
with (security_invoker = true) as
select workspace_id, coalesce(sum(delta), 0)::bigint as balance
from public.credits
where expires_at is null or expires_at > now()
group by workspace_id;
