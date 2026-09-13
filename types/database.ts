/**
 * Supabase database types, hand-maintained to match supabase/migrations.
 * Once a Supabase project is linked, `npm run db:types` generates
 * types/database.generated.ts; swap the export below to use it.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";
export type VideoFormat = "long_form" | "short" | "live" | "upcoming";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type CreditSource = "grant" | "purchase" | "usage" | "refund" | "adjustment" | "expiry";

type Timestamps = { created_at: string; updated_at: string };

/** Build Insert/Update shapes: `Required` keys must be supplied on insert; everything else has a DB default or is nullable. */
type TableDef<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>;
  Relationships: [];
};

export type UserRow = Timestamps & {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
};

export type WorkspaceRow = Timestamps & {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  plan: string;
};

export type WorkspaceMemberRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at: string;
};

export type NicheRow = Timestamps & {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  keywords: string[];
};

export type ChannelRow = Timestamps & {
  id: string;
  youtube_channel_id: string;
  handle: string | null;
  title: string;
  description: string | null;
  custom_url: string | null;
  country: string | null;
  default_language: string | null;
  thumbnail_url: string | null;
  banner_url: string | null;
  uploads_playlist_id: string | null;
  published_at: string | null;
  subscriber_count: number | null;
  view_count: number;
  video_count: number;
  hidden_subscriber_count: boolean;
  made_for_kids: boolean | null;
  topic_categories: string[];
  keywords: string[];
  niche_id: string | null;
  last_synced_at: string | null;
};

export type ChannelSnapshotRow = {
  id: string;
  channel_id: string;
  captured_at: string;
  subscriber_count: number | null;
  view_count: number;
  video_count: number;
  created_at: string;
};

export type VideoRow = Timestamps & {
  id: string;
  youtube_video_id: string;
  channel_id: string;
  title: string;
  description: string | null;
  published_at: string;
  duration_seconds: number | null;
  format: VideoFormat;
  category_id: string | null;
  tags: string[];
  default_language: string | null;
  default_audio_language: string | null;
  thumbnail_url: string | null;
  definition: string | null;
  has_captions: boolean | null;
  made_for_kids: boolean | null;
  view_count: number;
  like_count: number | null;
  comment_count: number | null;
  niche_id: string | null;
  last_synced_at: string | null;
};

export type VideoSnapshotRow = {
  id: string;
  video_id: string;
  captured_at: string;
  view_count: number;
  like_count: number | null;
  comment_count: number | null;
  created_at: string;
};

export type VideoPerformanceRow = Timestamps & {
  id: string;
  video_id: string;
  views_per_day: number;
  engagement_rate: number | null;
  outlier_score: number | null;
  channel_median_views: number | null;
  views_delta_24h: number | null;
  views_delta_7d: number | null;
  views_delta_30d: number | null;
  computed_at: string;
};

export type JobRow = Timestamps & {
  id: string;
  workspace_id: string | null;
  created_by: string | null;
  type: string;
  status: JobStatus;
  payload: Json;
  priority: number;
  attempts: number;
  max_attempts: number;
  run_at: string;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  idempotency_key: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type JobResultRow = {
  id: string;
  job_id: string;
  kind: string;
  output: Json | null;
  storage_path: string | null;
  created_at: string;
};

export type FolderRow = Timestamps & {
  id: string;
  workspace_id: string;
  created_by: string | null;
  name: string;
  description: string | null;
  color: string | null;
};

export type FolderChannelRow = {
  id: string;
  folder_id: string;
  channel_id: string;
  added_by: string | null;
  note: string | null;
  created_at: string;
};

export type UsageEventRow = {
  id: string;
  workspace_id: string | null;
  user_id: string | null;
  event_type: string;
  quantity: number;
  credits_cost: number;
  resource_type: string | null;
  resource_id: string | null;
  metadata: Json;
  occurred_at: string;
  created_at: string;
};

export type CreditRow = {
  id: string;
  workspace_id: string;
  delta: number;
  source: CreditSource;
  reason: string | null;
  usage_event_id: string | null;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type VideoFeedRow = {
  video_id: string;
  youtube_video_id: string;
  title: string;
  thumbnail_url: string | null;
  published_at: string;
  format: VideoFormat;
  duration_seconds: number | null;
  view_count: number;
  like_count: number | null;
  comment_count: number | null;
  channel_id: string;
  youtube_channel_id: string;
  channel_title: string;
  channel_thumbnail_url: string | null;
  subscriber_count: number | null;
  views_per_day: number | null;
  engagement_rate: number | null;
  outlier_score: number | null;
  channel_median_views: number | null;
  views_delta_24h: number | null;
  views_delta_7d: number | null;
  computed_at: string | null;
};

export type Database = {
  public: {
    Tables: {
      users: TableDef<UserRow, "id" | "email">;
      workspaces: TableDef<WorkspaceRow, "name" | "slug" | "owner_id">;
      workspace_members: TableDef<WorkspaceMemberRow, "workspace_id" | "user_id">;
      niches: TableDef<NicheRow, "slug" | "name">;
      channels: TableDef<ChannelRow, "youtube_channel_id" | "title">;
      channel_snapshots: TableDef<ChannelSnapshotRow, "channel_id" | "view_count" | "video_count">;
      videos: TableDef<VideoRow, "youtube_video_id" | "channel_id" | "title" | "published_at">;
      video_snapshots: TableDef<VideoSnapshotRow, "video_id" | "view_count">;
      video_performance: TableDef<VideoPerformanceRow, "video_id">;
      jobs: TableDef<JobRow, "type">;
      job_results: TableDef<JobResultRow, "job_id">;
      folders: TableDef<FolderRow, "workspace_id" | "name">;
      folder_channels: TableDef<FolderChannelRow, "folder_id" | "channel_id">;
      usage_events: TableDef<UsageEventRow, "event_type">;
      credits: TableDef<CreditRow, "workspace_id" | "delta" | "source">;
    };
    Views: {
      workspace_credit_balances: {
        Row: { workspace_id: string; balance: number };
        Relationships: [];
      };
      video_feed: {
        Row: VideoFeedRow;
        Relationships: [];
      };
    };
    Functions: {
      claim_jobs: {
        Args: { worker_id: string; batch_size?: number; job_types?: string[] | null };
        Returns: JobRow[];
      };
      requeue_stale_jobs: {
        Args: { lock_timeout?: string };
        Returns: number;
      };
      is_workspace_member: {
        Args: { target_workspace: string };
        Returns: boolean;
      };
      database_size_bytes: {
        Args: Record<string, never>;
        Returns: number;
      };
      prune_snapshots: {
        Args: { daily_days?: number; max_days?: number };
        Returns: { channel_snapshots_deleted: number; video_snapshots_deleted: number }[];
      };
    };
    Enums: {
      workspace_role: WorkspaceRole;
      video_format: VideoFormat;
      job_status: JobStatus;
      credit_source: CreditSource;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];
