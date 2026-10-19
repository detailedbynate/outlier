-- requires: vector
-- Similar channels: each channel's title, description, labels and latest
-- upload titles embedded into one vector (lib/services/similar-channels-service.ts),
-- searched by cosine distance. halfvec(256) keeps a row near 0.5 KB, so the
-- whole library and its index stay a few tens of MB.

create extension if not exists vector with schema extensions;

create table if not exists public.channel_embeddings (
  channel_id  uuid primary key references public.channels (id) on delete cascade,
  embedding   extensions.halfvec(256) not null,
  model       text not null,
  -- Hash of the text that was embedded: unchanged text isn't paid for twice.
  source_hash text not null,
  embedded_at timestamptz not null default now()
);

create index if not exists channel_embeddings_hnsw_idx
  on public.channel_embeddings using hnsw (embedding extensions.halfvec_cosine_ops);
create index if not exists channel_embeddings_embedded_at_idx on public.channel_embeddings (embedded_at);

alter table public.channel_embeddings enable row level security;
-- Only the server (service role) reads and writes it; RLS keeps users out.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.channel_embeddings to service_role;
  end if;
end $$;

-- The channels most like `target`, closest first. Similarity is 1 - cosine distance.
create or replace function public.match_similar_channels(target uuid, match_count integer default 60)
returns table (channel_id uuid, similarity real)
language sql
stable
set search_path = public, extensions
as $$
  select e.channel_id, (1 - (e.embedding <=> (select t.embedding from channel_embeddings t where t.channel_id = target)))::real
  from channel_embeddings e
  where e.channel_id <> target
  order by e.embedding <=> (select t.embedding from channel_embeddings t where t.channel_id = target)
  limit least(greatest(match_count, 1), 500);
$$;

-- Channels with no embedding, or one older than `stale_before`, biggest first. Removed channels are skipped.
create or replace function public.channels_to_embed(batch_size integer, stale_before timestamptz)
returns setof uuid
language sql
stable
set search_path = public
as $$
  select c.id
  from channels c
  left join channel_embeddings e on e.channel_id = c.id
  where (e.channel_id is null or e.embedded_at < stale_before)
    and not ('removed' = any (c.quality_flags))
  order by e.embedded_at nulls first, c.subscriber_count desc nulls last
  limit least(greatest(batch_size, 1), 2000);
$$;

-- What to embed for each channel: its own text plus its latest upload titles.
create or replace function public.channel_embedding_sources(ids uuid[], titles_per_channel integer default 20)
returns table (
  channel_id uuid,
  title text,
  handle text,
  description text,
  keywords text[],
  niche_category text,
  niche_labels text[],
  recent_titles text[]
)
language sql
stable
set search_path = public
as $$
  select c.id, c.title, c.handle, c.description, c.keywords, c.niche_category, c.niche_labels,
         coalesce(v.titles, '{}')
  from channels c
  left join lateral (
    select array_agg(x.title) as titles
    from (
      select title from videos
      where videos.channel_id = c.id
      order by published_at desc nulls last
      limit least(greatest(titles_per_channel, 0), 50)
    ) x
  ) v on true
  where c.id = any (ids);
$$;

-- Server only: Supabase grants new functions to the API roles by default.
revoke execute on function public.match_similar_channels(uuid, integer) from public, anon, authenticated;
revoke execute on function public.channels_to_embed(integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.channel_embedding_sources(uuid[], integer) from public, anon, authenticated;
