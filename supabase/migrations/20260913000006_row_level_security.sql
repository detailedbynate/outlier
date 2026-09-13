-- =============================================================================
-- Row Level Security
-- The server uses the service-role key (bypasses RLS) for ingestion and jobs.
-- These policies govern direct access with a user's JWT (anon/authenticated),
-- so a future client-side Supabase integration is safe by default.
-- =============================================================================

alter table public.users              enable row level security;
alter table public.workspaces         enable row level security;
alter table public.workspace_members  enable row level security;
alter table public.niches             enable row level security;
alter table public.channels           enable row level security;
alter table public.channel_snapshots  enable row level security;
alter table public.videos             enable row level security;
alter table public.video_snapshots    enable row level security;
alter table public.video_performance  enable row level security;
alter table public.jobs               enable row level security;
alter table public.job_results        enable row level security;
alter table public.folders            enable row level security;
alter table public.folder_channels    enable row level security;
alter table public.usage_events       enable row level security;
alter table public.credits            enable row level security;

-- Users: read/update own profile.
create policy users_select_self on public.users
  for select to authenticated using (id = auth.uid());
create policy users_update_self on public.users
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Workspaces & membership: visible to members.
create policy workspaces_select_member on public.workspaces
  for select to authenticated using (public.is_workspace_member(id));
create policy workspace_members_select_member on public.workspace_members
  for select to authenticated using (public.is_workspace_member(workspace_id));

-- Shared YouTube catalog: read-only for signed-in users; writes via service role.
create policy niches_select_authenticated on public.niches
  for select to authenticated using (true);
create policy channels_select_authenticated on public.channels
  for select to authenticated using (true);
create policy channel_snapshots_select_authenticated on public.channel_snapshots
  for select to authenticated using (true);
create policy videos_select_authenticated on public.videos
  for select to authenticated using (true);
create policy video_snapshots_select_authenticated on public.video_snapshots
  for select to authenticated using (true);
create policy video_performance_select_authenticated on public.video_performance
  for select to authenticated using (true);

-- Jobs: members can see their workspace's jobs; creation goes through the API.
create policy jobs_select_member on public.jobs
  for select to authenticated using (workspace_id is not null and public.is_workspace_member(workspace_id));
create policy job_results_select_member on public.job_results
  for select to authenticated using (
    exists (
      select 1 from public.jobs j
      where j.id = job_id and j.workspace_id is not null and public.is_workspace_member(j.workspace_id)
    )
  );

-- Folders: full CRUD for workspace members.
create policy folders_all_member on public.folders
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy folder_channels_all_member on public.folder_channels
  for all to authenticated
  using (exists (select 1 from public.folders f where f.id = folder_id and public.is_workspace_member(f.workspace_id)))
  with check (exists (select 1 from public.folders f where f.id = folder_id and public.is_workspace_member(f.workspace_id)));

-- Usage & credits: read-only for members; only the server writes.
create policy usage_events_select_member on public.usage_events
  for select to authenticated using (workspace_id is not null and public.is_workspace_member(workspace_id));
create policy credits_select_member on public.credits
  for select to authenticated using (public.is_workspace_member(workspace_id));

-- Queue functions are server-only.
revoke execute on function public.claim_jobs(text, integer, text[]) from public, anon, authenticated;
revoke execute on function public.requeue_stale_jobs(interval) from public, anon, authenticated;
