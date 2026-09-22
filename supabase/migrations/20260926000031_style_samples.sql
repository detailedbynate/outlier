-- =============================================================================
-- Style samples: scripts the writer learns its voice from.
--
-- The prompt ships with two worked examples so it has a shape to copy. They're
-- invented, which is fine for teaching structure and useless for teaching a
-- particular creator's voice. A sample is a real script someone pasted in, and
-- when there are enough of them they replace the built-in pair.
--
-- Only a person's own samples are ever shown to their own generations. Nobody's
-- writing becomes anybody else's house style.
-- No drop statements; safe to re-run.
-- =============================================================================

create table if not exists public.style_samples (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  -- What it was called, so a list of them is readable. Optional.
  label      text,
  -- The script itself, as spoken words.
  body       text not null,
  created_at timestamptz not null default now(),
  constraint style_samples_body_length check (char_length(body) between 40 and 6000)
);

-- The only query there is: one person's samples, newest first.
create index if not exists style_samples_user_time_idx on public.style_samples (user_id, created_at desc);

alter table public.style_samples enable row level security;
-- Only the server (service role) reads and writes it; RLS keeps users out.
do $$
begin
  -- Supabase has this role; plain Postgres (tests) doesn't.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.style_samples to service_role;
  end if;
end $$;
