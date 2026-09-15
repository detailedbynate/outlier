-- =============================================================================
-- Competitor alert preferences. Alerts themselves are computed from stored data
-- that scheduled jobs already refresh, so no polling or new tables are needed.
-- No drop statements; safe to re-run.
-- =============================================================================

alter table public.user_preferences
  add column if not exists competitor_alerts text[] not null default array['uploads', 'breakouts', 'subscriber_growth', 'view_growth']::text[];

do $$
begin
  alter table public.user_preferences
    add constraint user_preferences_competitor_alerts_valid
    check (competitor_alerts <@ array['uploads', 'breakouts', 'subscriber_growth', 'view_growth']::text[]);
exception
  when duplicate_object then null;
end $$;
