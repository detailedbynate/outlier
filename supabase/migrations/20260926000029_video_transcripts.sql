-- What a video says, for the videos worth reading.
--
-- Stored per video, not per request: a breakout Short's opening is the same
-- for everyone who asks about it, and reading it costs a scrape slot. Only
-- outliers get one — there is no use for the transcript of a video nobody is
-- learning from, and 125k of them would be most of the database.

create table if not exists public.video_transcripts (
  video_id      uuid primary key references public.videos (id) on delete cascade,
  language      text not null,
  -- 'captions' is YouTube's own track, auto-generated in almost every case:
  -- no punctuation, names misheard. Fine for shape, not for quotation.
  source        text not null default 'captions',
  -- [{startSeconds, durationSeconds, text}], in order.
  segments      jsonb not null,
  -- The whole thing as one string, so the common read needs no unpacking.
  full_text     text not null,
  -- The first few seconds, which is where a Short's hook lives.
  opening       text not null default '',
  word_count    integer not null default 0,
  fetched_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  constraint video_transcripts_source_known check (source in ('captions', 'asr', 'provider')),
  constraint video_transcripts_word_count_non_negative check (word_count >= 0)
);

comment on table public.video_transcripts is
  'Spoken content of videos worth studying. Auto-generated captions: unpunctuated and approximate.';

-- "Which outliers in this niche have we already read?" is the only lookup that
-- isn't by primary key.
create index if not exists video_transcripts_fetched_at_idx
  on public.video_transcripts (fetched_at desc);

alter table public.video_transcripts enable row level security;

-- Same rule as the rest of the catalogue: readable by anyone signed in, written
-- only by the service role.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'video_transcripts' and policyname = 'video_transcripts_select_authenticated') then
    create policy video_transcripts_select_authenticated on public.video_transcripts
      for select to authenticated using (true);
  end if;
  -- Supabase has these roles; plain Postgres (tests) doesn't.
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.video_transcripts to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.video_transcripts to service_role;
  end if;
end $$;
