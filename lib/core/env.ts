import "server-only";
import { z } from "zod";
import { ConfigError } from "./errors";

/** Treat empty strings from .env files as "not set". */
const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "silent"]).default("info"),

  NEXT_PUBLIC_SUPABASE_URL: optionalString.pipe(z.url().optional()),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default("media"),

  YOUTUBE_API_KEY: optionalString,
  YOUTUBE_API_BASE_URL: z.url().default("https://www.googleapis.com/youtube/v3"),
  YOUTUBE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  YOUTUBE_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  /** Daily YouTube Data API quota for the key (default project quota is 10,000). */
  YOUTUBE_DAILY_QUOTA: z.coerce.number().int().min(100).default(10_000),
  /** Units background jobs can never touch, kept for user-triggered requests. */
  YOUTUBE_USER_RESERVE_UNITS: z.coerce.number().int().min(0).default(3_000),
  /** Units never spent by anyone (headroom for retries and clock skew). */
  YOUTUBE_SAFETY_BUFFER_UNITS: z.coerce.number().int().min(0).default(300),
  /** Units one user may spend per quota day on the default tier. */
  YOUTUBE_USER_DAILY_UNITS: z.coerce.number().int().min(1).default(1_000),
  /** Check and record quota before every request. */
  YOUTUBE_QUOTA_ENFORCED: z.preprocess((v) => (typeof v === "string" ? !["false", "0", "no", "off"].includes(v.toLowerCase()) : v), z.boolean()).default(true),
  /** Reuse recent API responses stored in Supabase. */
  YOUTUBE_CACHE_ENABLED: z.preprocess((v) => (typeof v === "string" ? !["false", "0", "no", "off"].includes(v.toLowerCase()) : v), z.boolean()).default(true),
  /** Videos checked per monitoring run (1 quota unit per 50). */
  MONITOR_MAX_VIDEOS_PER_RUN: z.coerce.number().int().min(50).max(20_000).default(2_000),
  /** Channels checked per monitoring run (1 quota unit per 50). */
  MONITOR_MAX_CHANNELS_PER_RUN: z.coerce.number().int().min(50).max(20_000).default(1_000),

  INTERNAL_API_KEY: optionalString,
  /** End-to-end tests only: lets Playwright sign in as the owner outside production. Never set in production. */
  E2E_AUTH_TOKEN: optionalString,
  /** Bearer secret for /api/cron/* (called by GitHub Actions). */
  CRON_SECRET: optionalString,
  /** Comma-separated emails allowed to use the app. Blank = any signed-in user. People invited from the waitlist are always allowed. */
  ALLOWED_EMAILS: optionalString,
  /** Comma-separated owner/founder emails: unlimited, can manage admins and every account. */
  OWNER_EMAILS: z.string().default("nathanchintu@icloud.com"),
  /** Comma-separated emails that can manage the waitlist at /admin/waitlist. */
  ADMIN_EMAILS: optionalString,
  /** Public site URL for invite links, e.g. https://outlier.vercel.app. Falls back to the request origin. */
  SITE_URL: optionalString.pipe(z.url().optional()),
  /** Secret salt for hashing IPs/emails in rate-limit keys. Falls back to CRON_SECRET. */
  RATE_LIMIT_SALT: optionalString,
  /** Discord invite link shown on the landing page (e.g. https://discord.gg/abc123). */
  DISCORD_INVITE_URL: optionalString.pipe(z.url().optional()),

  JOB_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  JOB_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),

  /** Supabase plan's database size limit (free tier: 500 MB). */
  SUPABASE_PLAN_LIMIT_MB: z.coerce.number().positive().default(500),
  /** Ingestion stops once the database reaches this size. Keep well under the plan limit. */
  STORAGE_BUDGET_MB: z.coerce.number().positive().default(250),

  SYNC_INTERVAL_HOURS: z.coerce.number().positive().max(168).default(24),
  SYNC_MAX_CHANNELS_PER_RUN: z.coerce.number().int().min(1).max(500).default(50),
  /** Only videos newer than this get daily stat snapshots (older videos still get their totals refreshed). */
  SNAPSHOT_VIDEO_MAX_AGE_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  SNAPSHOT_DAILY_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  SNAPSHOT_RETENTION_DAYS: z.coerce.number().int().min(2).default(365),
  /** How often every catalog channel gets a stats snapshot (powers 24h/48h growth). */
  STATS_SNAPSHOT_INTERVAL_HOURS: z.coerce.number().positive().max(24).default(6),
  /** Channels per stats snapshot run (1 YouTube quota unit per 50). */
  STATS_SNAPSHOT_MAX_CHANNELS: z.coerce.number().int().min(50).max(50_000).default(5_000),

  /** Research discovery searches per UTC day, all users combined (100 YouTube quota units each). */
  DISCOVERY_DAILY_LIMIT: z.coerce.number().int().min(0).max(90).default(10),
  DISCOVERY_MAX_CHANNELS: z.coerce.number().int().min(1).max(50).default(25),
  /** Niche Finder: topics refreshed from YouTube per UTC day, all users combined (~102 units each). Everything else is database-only. */
  NICHE_DAILY_YOUTUBE_REFRESHES: z.coerce.number().int().min(0).max(80).default(15),

  /** Outlier quality rules (Trending Today and Discovery). */
  OUTLIER_LANGUAGE: z.string().regex(/^[a-z]{2}$/i).default("en"),
  OUTLIER_REGION: z.string().regex(/^[A-Z]{2}$/i).default("US"),
  OUTLIER_COUNTRIES: z.string().default("US,GB,CA,AU,NZ,IE"),
  OUTLIER_MIN_VIEWS: z.coerce.number().int().min(0).default(100_000),
  OUTLIER_MAX_SUBSCRIBERS: z.coerce.number().int().min(1).default(100_000),
  OUTLIER_MIN_VIEWS_PER_SUB: z.coerce.number().min(0).default(10),
  OUTLIER_MIN_ENGAGEMENT: z.coerce.number().min(0).max(1).default(0.01),
  /** Trending picks need at least this multiple of their channel's median Short views. */
  OUTLIER_MIN_MULTIPLIER: z.coerce.number().min(1).default(2),

  /** Credits each user gets per UTC month (plus bonus credits, e.g. from referrals). Actions that spend YouTube quota cost credits. */
  MONTHLY_CREDITS: z.coerce.number().int().min(0).max(1_000_000).default(1_000),
  /** Referral rewards: bonus credits for the referrer and for the person they referred, when that person creates an account. */
  REFERRAL_REFERRER_CREDITS: z.coerce.number().int().min(0).max(100_000).default(100),
  REFERRAL_REFERRED_CREDITS: z.coerce.number().int().min(0).max(100_000).default(50),
  /** Waitlist referrals needed to earn priority access. */
  REFERRAL_PRIORITY_THRESHOLD: z.coerce.number().int().min(1).max(100).default(3),
  /** Max referral rewards one referrer can earn per month (limits abuse). */
  REFERRAL_MAX_REWARDS_PER_MONTH: z.coerce.number().int().min(0).max(1_000).default(20),

  ANTHROPIC_API_KEY: optionalString,
  OPENAI_API_KEY: optionalString,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Parse an environment record. Exported separately so it can be tested without process.env. */
export function parseEnv(source: Record<string, string | undefined>): ServerEnv {
  // Blank values (e.g. an empty variable in a hosting dashboard) mean "unset" so defaults apply.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ""));
  const result = serverEnvSchema.safeParse(cleaned);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(`Invalid environment configuration: ${issues}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/**
 * Validated server environment. Parsed lazily so `next build` and tests don't
 * require every secret to be present; individual integrations assert what they need.
 */
export function env(): ServerEnv {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Test helper: forget the cached env so the next call re-reads process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}

/** Return a required value or throw a ConfigError naming the missing variable. */
export function requireEnv<K extends keyof ServerEnv>(key: K): NonNullable<ServerEnv[K]> {
  const value = env()[key];
  if (value === undefined || value === null) {
    throw new ConfigError(`Missing required environment variable: ${String(key)}`);
  }
  return value as NonNullable<ServerEnv[K]>;
}
