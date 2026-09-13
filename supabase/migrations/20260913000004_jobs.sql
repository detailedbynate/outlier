-- =============================================================================
-- Background jobs: a Postgres-backed queue (no Redis). Workers claim work with
-- FOR UPDATE SKIP LOCKED, so any number of workers can run concurrently.
-- =============================================================================

create table public.jobs (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid references public.workspaces (id) on delete cascade,
  created_by      uuid references public.users (id) on delete set null,
  type            text not null,
  status          public.job_status not null default 'queued',
  payload         jsonb not null default '{}'::jsonb,
  priority        smallint not null default 0,
  attempts        smallint not null default 0,
  max_attempts    smallint not null default 3,
  run_at          timestamptz not null default now(),
  locked_at       timestamptz,
  locked_by       text,
  last_error      text,
  idempotency_key text,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint jobs_type_format check (type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint jobs_attempts_valid check (attempts >= 0 and max_attempts >= 1 and attempts <= max_attempts),
  constraint jobs_priority_range check (priority between -100 and 100),
  constraint jobs_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint jobs_running_is_locked check (status <> 'running' or locked_at is not null)
);

-- Dedupe enqueues: the same key can't be queued/running twice.
create unique index jobs_idempotency_active_key on public.jobs (idempotency_key)
  where idempotency_key is not null and status in ('queued', 'running');

-- The claim query's access path.
create index jobs_claimable_idx on public.jobs (priority desc, run_at) where status = 'queued';
create index jobs_workspace_created_idx on public.jobs (workspace_id, created_at desc);
create index jobs_type_status_idx on public.jobs (type, status);
create index jobs_stale_running_idx on public.jobs (locked_at) where status = 'running';

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

create table public.job_results (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.jobs (id) on delete cascade,
  kind         text not null default 'output',
  output       jsonb,
  storage_path text,
  created_at   timestamptz not null default now(),
  constraint job_results_has_content check (output is not null or storage_path is not null)
);

create index job_results_job_id_idx on public.job_results (job_id, created_at);

-- Atomically claim up to batch_size due jobs for a worker.
create or replace function public.claim_jobs(worker_id text, batch_size integer default 1, job_types text[] default null)
returns setof public.jobs
language sql
volatile
as $$
  update public.jobs j
  set status = 'running',
      attempts = j.attempts + 1,
      locked_at = now(),
      locked_by = worker_id,
      started_at = coalesce(j.started_at, now())
  where j.id in (
    select id from public.jobs
    where status = 'queued'
      and run_at <= now()
      and attempts < max_attempts
      and (job_types is null or type = any (job_types))
    order by priority desc, run_at
    limit greatest(batch_size, 1)
    for update skip locked
  )
  returning j.*;
$$;

-- Return jobs whose worker died (lock older than the timeout) to the queue.
create or replace function public.requeue_stale_jobs(lock_timeout interval default interval '15 minutes')
returns integer
language sql
volatile
as $$
  with stale as (
    update public.jobs
    set status = case when attempts >= max_attempts then 'failed'::public.job_status else 'queued'::public.job_status end,
        locked_at = null,
        locked_by = null,
        last_error = coalesce(last_error, 'Worker lock expired'),
        finished_at = case when attempts >= max_attempts then now() else null end
    where status = 'running' and locked_at < now() - lock_timeout
    returning 1
  )
  select count(*)::integer from stale;
$$;
