-- =============================================================================
-- Rate limiting without Redis: fixed-window counters in Postgres.
-- Keys are opaque strings like "waitlist:ip:<sha256>" (never raw IPs).
-- Server-only; safe to re-run.
-- =============================================================================

create table if not exists public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key, window_start),
  constraint rate_limits_key_length check (char_length(key) <= 200),
  constraint rate_limits_hits_positive check (hits >= 0)
);

create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;

-- Atomically count one hit in the current window and report whether it is allowed.
create or replace function public.rate_limit_hit(limit_key text, window_seconds integer, max_hits integer)
returns table (allowed boolean, hits integer, resets_at timestamptz)
language sql
volatile
as $$
  with bucket as (
    select to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds) as start
  ), upserted as (
    insert into public.rate_limits as r (key, window_start, hits)
    select limit_key, bucket.start, 1 from bucket
    on conflict (key, window_start) do update set hits = r.hits + 1
    returning r.hits, r.window_start
  )
  select upserted.hits <= max_hits, upserted.hits, upserted.window_start + make_interval(secs => window_seconds)
  from upserted;
$$;

revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
