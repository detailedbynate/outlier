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
export type WaitlistStatus = "pending" | "invited" | "joined" | "declined";

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
  /** Tracked channels refresh daily; channels found by research tools refresh weekly. */
  tracked: boolean;
  /** Detected from recent uploads: 'en', 'other', or null when unknown. */
  content_language: string | null;
  monitor_priority: number;
  next_check_at: string | null;
  language_checked_at: string | null;
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
  /** Current views/hour from the latest two monitoring checks (or since upload). */
  views_per_hour: number | null;
  /** Change in views/hour since the previous check. */
  view_acceleration: number | null;
  monitor_priority: number;
  next_check_at: string | null;
  last_checked_at: string | null;
};

export type QuotaLane = "background" | "user";

export type YouTubeQuotaUsageRow = {
  day: string;
  lane: QuotaLane;
  operation: string;
  user_key: string;
  units: number;
  requests: number;
  denied: number;
  updated_at: string;
};

export type YouTubeApiCacheRow = {
  cache_key: string;
  endpoint: string;
  response: Json;
  fetched_at: string;
  expires_at: string;
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

export type WaitlistEntryRow = Timestamps & {
  id: string;
  email: string;
  name: string | null;
  channel_url: string | null;
  niche: string | null;
  use_case: string | null;
  source: string | null;
  status: WaitlistStatus;
  invited_at: string | null;
  joined_at: string | null;
  invited_by: string | null;
};

export type UserPreferencesRow = Timestamps & {
  user_id: string;
  goals: string[];
  content_formats: string[];
  niches: string[];
  has_channel: boolean | null;
  channel: string | null;
  competitors: string[];
  onboarding_completed_at: string | null;
};

export type AccountRole = "owner" | "admin" | "member";

export type AccountSettingsRow = {
  user_id: string;
  email: string;
  role: AccountRole;
  /** null = app default (DAILY_CREDITS). */
  daily_credits: number | null;
  /** null = tier default (YOUTUBE_USER_DAILY_UNITS). */
  youtube_daily_units: number | null;
  quota_tier: string;
  disabled: boolean;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type RateLimitRow = {
  key: string;
  window_start: string;
  hits: number;
};

export type TrendingPickRow = {
  id: string;
  pick_date: string;
  niche: string;
  rank: number;
  youtube_channel_id: string;
  channel_title: string;
  channel_thumbnail_url: string | null;
  channel_country: string | null;
  subscriber_count: number | null;
  youtube_video_id: string;
  video_title: string;
  video_published_at: string | null;
  video_views: number;
  video_likes: number | null;
  video_comments: number | null;
  channel_median_views: number | null;
  outlier_multiplier: number | null;
  underrated_score: number | null;
  views_1h: number | null;
  views_24h: number | null;
  stats_updated_at: string | null;
  created_at: string;
};

export type TrendingPickStatRow = {
  id: string;
  pick_id: string;
  captured_at: string;
  views: number;
  likes: number | null;
  comments: number | null;
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

export type ShortsChannelRow = {
  channel_id: string;
  youtube_channel_id: string;
  title: string;
  handle: string | null;
  thumbnail_url: string | null;
  country: string | null;
  channel_created_at: string | null;
  subscriber_count: number | null;
  hidden_subscriber_count: boolean;
  view_count: number;
  video_count: number;
  tracked: boolean;
  last_synced_at: string | null;
  videos_sampled: number;
  shorts_sampled: number;
  shorts_share: number;
  avg_short_views: number | null;
  median_short_views: number | null;
  top_short_views: number | null;
  last_short_at: string | null;
  shorts_last_30d: number;
  /** Growth vs. ~24h/48h ago; null until enough snapshot history exists. */
  views_24h: number | null;
  views_48h: number | null;
  subs_24h: number | null;
  subs_48h: number | null;
  stats_captured_at: string | null;
  /** Average (likes + comments) / views across recent Shorts. */
  avg_engagement: number | null;
  shorts_per_week: number;
  views_per_sub: number | null;
  /** Share of recent Shorts with at least 2x the channel's median views. */
  hit_rate: number;
  /** Top recent Short views / median Short views. */
  top_multiplier: number | null;
  content_language: string | null;
  is_target_language: boolean;
  /** Average views/hour since upload for Shorts from the last 7 days (no history needed). */
  recent_vph: number | null;
  /** Current views/hour summed across recently monitored Shorts. */
  live_vph: number | null;
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
      waitlist_entries: TableDef<WaitlistEntryRow, "email">;
      user_preferences: TableDef<UserPreferencesRow, "user_id">;
      trending_picks: TableDef<
        TrendingPickRow,
        "pick_date" | "niche" | "youtube_channel_id" | "channel_title" | "youtube_video_id" | "video_title"
      >;
      trending_pick_stats: TableDef<TrendingPickStatRow, "pick_id" | "views">;
      account_settings: TableDef<AccountSettingsRow, "user_id" | "email">;
      youtube_quota_usage: {
        Row: YouTubeQuotaUsageRow;
        Insert: Pick<YouTubeQuotaUsageRow, "day" | "lane" | "operation"> & Partial<YouTubeQuotaUsageRow>;
        Update: Partial<YouTubeQuotaUsageRow>;
        Relationships: [];
      };
      youtube_api_cache: {
        Row: YouTubeApiCacheRow;
        Insert: Pick<YouTubeApiCacheRow, "cache_key" | "endpoint" | "response" | "expires_at"> & Partial<YouTubeApiCacheRow>;
        Update: Partial<YouTubeApiCacheRow>;
        Relationships: [];
      };
      rate_limits: {
        Row: RateLimitRow;
        Insert: Pick<RateLimitRow, "key" | "window_start"> & Partial<RateLimitRow>;
        Update: Partial<RateLimitRow>;
        Relationships: [];
      };
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
      shorts_channels: {
        Row: ShortsChannelRow;
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
      apply_video_monitoring: {
        Args: { updates: Json };
        Returns: number;
      };
      consume_youtube_quota: {
        Args: {
          p_day: string;
          p_lane: QuotaLane;
          p_operation: string;
          p_user_key: string;
          p_units: number;
          p_total_limit: number;
          p_lane_limit: number;
          p_user_limit: number | null;
        };
        Returns: boolean;
      };
      rate_limit_hit: {
        Args: { limit_key: string; window_seconds: number; max_hits: number };
        Returns: { allowed: boolean; hits: number; resets_at: string }[];
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
      waitlist_status: WaitlistStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];
