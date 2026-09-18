-- Related words the AI suggested for a topic ("stoicism" -> "marcus aurelius"),
-- so later reports also match the channels found through them.
alter table public.niche_reports add column if not exists search_terms text[] not null default '{}';
