-- =============================================================================
-- Niche Radar: search phrases found outside the channel library.
--
-- The library only knows niches it already has channels for. The radar starts
-- from seed topics, grows them through YouTube autocomplete (what people really
-- type), and checks each phrase's supply (are the top results old, are small
-- channels winning?), demand and pay (search volume and CPC, when DataForSEO is
-- set up) and how easy the videos are to make (AI). Reddit posts from
-- high-paying communities add both phrases and video ideas.
-- No drop statements; safe to re-run.
-- =============================================================================

create table if not exists public.niche_keywords (
  -- Lowercased, single-spaced phrase.
  keyword           text primary key,
  -- The seed topic this phrase grew from.
  seed              text not null,
  -- seed | autocomplete | rising | reddit | stackexchange | translation | launch
  source            text not null default 'autocomplete',
  -- Search language (lib/radar/markets.ts): translations of English phrases are read in their own market.
  market            text not null default 'en',
  -- 0 for seeds, +1 per autocomplete hop.
  depth             smallint not null default 0,
  -- Position in YouTube's suggestions (0 = first), a free demand signal.
  suggest_rank      smallint,
  category          text,
  discovered_at     timestamptz not null default now(),
  expanded_at       timestamptz,
  supply_checked_at timestamptz,
  supply            jsonb,
  demand_checked_at timestamptz,
  demand            jsonb,
  ease_checked_at   timestamptz,
  ease              jsonb,
  -- 0-100, recomputed whenever a signal lands.
  score             numeric,
  -- Which unchecked phrases to read first: pay, autocomplete position, new searches.
  priority          smallint not null default 0,
  updated_at        timestamptz not null default now()
);

create index if not exists niche_keywords_expand_idx on public.niche_keywords (depth, expanded_at nulls first);
create index if not exists niche_keywords_supply_idx on public.niche_keywords (supply_checked_at nulls first, priority desc);
create index if not exists niche_keywords_demand_idx on public.niche_keywords (demand_checked_at nulls first);
create index if not exists niche_keywords_score_idx on public.niche_keywords (score desc nulls last);
create index if not exists niche_keywords_source_idx on public.niche_keywords (source, seed);

create table if not exists public.niche_ideas (
  id           uuid primary key default gen_random_uuid(),
  -- reddit | stackexchange | comments | launches
  source       text not null,
  -- Where it came from, e.g. "r/personalfinance", "money.stackexchange.com", or the niche whose videos' comments asked.
  community    text,
  title        text not null,
  url          text not null unique,
  score        integer not null default 0,
  comments     integer not null default 0,
  -- Stack Exchange counts views: a question read 200K times is proven search demand.
  views        integer,
  posted_at    timestamptz,
  -- question | story | discussion | request (a viewer asking for a video) | launch (a new tool)
  kind         text not null default 'discussion',
  category     text,
  collected_at timestamptz not null default now()
);

create index if not exists niche_ideas_recent_idx on public.niche_ideas (collected_at desc);
create index if not exists niche_ideas_category_idx on public.niche_ideas (category, score desc);
create index if not exists niche_ideas_source_idx on public.niche_ideas (source, collected_at desc);

alter table public.niche_keywords enable row level security;
alter table public.niche_ideas enable row level security;
-- Only the server (service role) reads and writes them; RLS keeps users out.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.niche_keywords to service_role;
    grant all on public.niche_ideas to service_role;
  end if;
end $$;
