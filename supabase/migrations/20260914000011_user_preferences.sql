-- =============================================================================
-- Onboarding preferences: what each user wants from Outlier, used to
-- personalize research and recommendations. One row per auth user.
-- Safe to re-run.
-- =============================================================================

create table if not exists public.user_preferences (
  user_id                  uuid primary key references auth.users (id) on delete cascade,
  goals                    text[] not null default '{}',
  content_formats          text[] not null default '{}',
  niches                   text[] not null default '{}',
  has_channel              boolean,
  channel                  text,
  competitors              text[] not null default '{}',
  onboarding_completed_at  timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint user_preferences_goals_valid check (
    goals <@ array['grow_channel', 'find_viral_videos', 'research_competitors', 'find_niches', 'content_ideas', 'analyze_videos']::text[]
  ),
  constraint user_preferences_formats_valid check (content_formats <@ array['shorts', 'long_form']::text[]),
  constraint user_preferences_list_sizes check (
    cardinality(niches) <= 10 and cardinality(competitors) <= 10
  ),
  constraint user_preferences_channel_length check (channel is null or char_length(channel) <= 300),
  constraint user_preferences_channel_consistent check (has_channel is true or channel is null)
);

create index if not exists user_preferences_niches_gin_idx on public.user_preferences using gin (niches);

create or replace trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function public.set_updated_at();

alter table public.user_preferences enable row level security;

-- Users may read and edit only their own preferences (the server uses the service role).
do $$
begin
  create policy user_preferences_select_own on public.user_preferences
    for select to authenticated using (user_id = auth.uid());
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create policy user_preferences_upsert_own on public.user_preferences
    for insert to authenticated with check (user_id = auth.uid());
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create policy user_preferences_update_own on public.user_preferences
    for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
exception
  when duplicate_object then null;
end $$;
