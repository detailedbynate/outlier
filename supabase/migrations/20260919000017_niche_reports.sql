-- =============================================================================
-- Niche Finder: cached niche reports shared across users, plus a refresh claim
-- so concurrent searches for the same topic trigger at most one YouTube fetch.
-- No drop statements; safe to re-run.
-- =============================================================================

create table if not exists public.niche_reports (
  topic_key             text primary key,
  topic                 text not null,
  report                jsonb not null default '{}'::jsonb,
  source                text not null default 'database',
  videos_analyzed       integer not null default 0,
  channels_analyzed     integer not null default 0,
  youtube_units         integer not null default 0,
  computed_at           timestamptz,
  youtube_refreshed_at  timestamptz,
  refresh_claimed_at    timestamptz,
  search_count          integer not null default 0,
  last_searched_at      timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  constraint niche_reports_source_valid check (source in ('database', 'youtube')),
  constraint niche_reports_key_format check (topic_key ~ '^[a-z0-9][a-z0-9 &''+.-]{0,79}$')
);

create index if not exists niche_reports_last_searched_idx on public.niche_reports (last_searched_at desc);
alter table public.niche_reports enable row level security;

/**
 * Claim the right to refresh a topic from YouTube. Returns true for exactly one
 * caller while the topic is stale and nobody else holds a fresh claim.
 */
create or replace function public.claim_niche_refresh(p_topic_key text, p_topic text, p_stale_before timestamptz, p_lock_seconds integer)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  insert into niche_reports (topic_key, topic) values (p_topic_key, p_topic)
  on conflict (topic_key) do nothing;

  update niche_reports
     set refresh_claimed_at = now()
   where topic_key = p_topic_key
     and (youtube_refreshed_at is null or youtube_refreshed_at < p_stale_before)
     and (refresh_claimed_at is null or refresh_claimed_at < now() - make_interval(secs => p_lock_seconds));
  return found;
end;
$$;

revoke all on function public.claim_niche_refresh(text, text, timestamptz, integer) from public, anon, authenticated;
