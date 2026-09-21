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

  /** InnerTube (scraped web endpoints). One gate for the whole process: see lib/innertube/gate.ts. */
  INNERTUBE_REQUESTS_PER_MINUTE: z.coerce.number().min(0.1).max(120).default(4),
  INNERTUBE_MAX_CONCURRENT: z.coerce.number().int().min(1).max(8).default(1),
  INNERTUBE_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  /** Failed reads in a row that pause InnerTube. */
  INNERTUBE_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(50).default(5),
  /** First pause after a block or rate limit; doubles while blocks keep coming. */
  INNERTUBE_BREAKER_MINUTES: z.coerce.number().min(1).max(1440).default(30),
  INNERTUBE_MAX_BREAKER_HOURS: z.coerce.number().min(1).max(72).default(12),
  /** How long a scraped page stays reusable in memory. */
  INNERTUBE_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(86_400).default(1_800),
  /** Uploads read per channel. */
  /** File the scrape budget and circuit breaker are shared through, so every process on the box paces as one. Unset keeps each process pacing itself. */
  INNERTUBE_SHARED_STATE_PATH: z.string().min(1).optional(),
  INNERTUBE_MAX_VIDEOS: z.coerce.number().int().min(5).max(50).default(30),
  /**
   * Interactive reads per minute, on top of the background rate: someone is waiting
   * on these. One search can read up to three result pages, so this is a few times
   * the number of searches per minute it supports.
   */
  INNERTUBE_USER_REQUESTS_PER_MINUTE: z.coerce.number().min(1).max(240).default(30),
  /** How long an interactive read waits for a slot before falling back to the API. */
  INNERTUBE_USER_MAX_WAIT_MS: z.coerce.number().int().min(0).max(30_000).default(2_000),
  /** Read channel pages and uploads from the web endpoints for ingestion (~1 unit per channel instead of 3-4). */
  INNERTUBE_INGEST_ENABLED: z.preprocess((v) => (typeof v === "string" ? !["false", "0", "no", "off"].includes(v.toLowerCase()) : v), z.boolean()).default(true),
  /** Run searches on YouTube's web endpoints (free) instead of search.list (100 units). */
  INNERTUBE_SEARCH_ENABLED: z.preprocess((v) => (typeof v === "string" ? !["false", "0", "no", "off"].includes(v.toLowerCase()) : v), z.boolean()).default(true),

  JOB_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  JOB_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),

  /**
   * Space the database is allowed to grow into: the disk on a self-hosted box, or
   * the plan's limit on a managed one. (Named for Supabase because that is where
   * this started; production has run on its own server since 2026-09-17.)
   */
  SUPABASE_PLAN_LIMIT_MB: z.coerce.number().positive().default(180_000),
  /** Ingestion stops once the database reaches this size. Keep well under the limit above. */
  STORAGE_BUDGET_MB: z.coerce.number().positive().default(150_000),

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

  /** Research discovery searches per UTC day, all users combined. Scraped search is free; the cap now only guards the channel ingestion each one triggers. */
  DISCOVERY_DAILY_LIMIT: z.coerce.number().int().min(0).max(5_000).default(250),
  DISCOVERY_MAX_CHANNELS: z.coerce.number().int().min(1).max(50).default(25),
  /** Niche Finder: topics refreshed from YouTube per UTC day, all users combined. Scraped search is free; the cap now only guards ingestion and storage. */
  NICHE_DAILY_YOUTUBE_REFRESHES: z.coerce.number().int().min(0).max(5_000).default(250),

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

  /**
   * Credits a user on the free plan gets per UTC month (plus bonus credits, e.g.
   * from referrals). Paid plans set their own allowance in lib/billing/plans.ts.
   * Actions that spend YouTube quota cost credits.
   */
  MONTHLY_CREDITS: z.coerce.number().int().min(0).max(1_000_000).default(50),
  /** Referral rewards: bonus credits per friend who creates an account, and a welcome bonus for that friend. */
  REFERRAL_REFERRER_CREDITS: z.coerce.number().int().min(0).max(100_000).default(25),
  REFERRAL_REFERRED_CREDITS: z.coerce.number().int().min(0).max(100_000).default(50),
  /**
   * Extra bonus on top of the per-friend credits, as "referrals:credits" pairs.
   * The defaults make the running total 100 / 250 / 500 / 1000 credits at 1 / 3 / 5 / 10 friends,
   * and the last milestone repeats forever (20, 30, … friends).
   */
  REFERRAL_MILESTONES: z.string().trim().default("1:75,3:100,5:200,10:375"),
  /** Waitlist referrals needed to earn priority access. */
  REFERRAL_PRIORITY_THRESHOLD: z.coerce.number().int().min(1).max(100).default(3),
  /** Max referral rewards one referrer can earn per month (limits abuse). */
  REFERRAL_MAX_REWARDS_PER_MONTH: z.coerce.number().int().min(0).max(1_000).default(20),

  /** Stripe secret key (sk_live_… or sk_test_…). Credit purchases are off without it. */
  STRIPE_SECRET_KEY: optionalString,
  /** Signing secret of the Stripe webhook pointed at /api/stripe/webhook (whsec_…). */
  STRIPE_WEBHOOK_SECRET: optionalString,
  /**
   * Recurring Stripe Price ids for the paid plans (price_…). A plan without one
   * isn't offered, so a half-configured Stripe can't sell something it can't bill.
   */
  STRIPE_PRICE_PRO: optionalString,
  STRIPE_PRICE_EXPERT: optionalString,

  /** Resend API key, for the emails Outlier sends itself (the subscriber's signup link). */
  RESEND_API_KEY: optionalString,
  /** From address on those emails; must be on a domain verified with Resend. */
  EMAIL_FROM: z.string().trim().default("Outlier <no-reply@useoutlier.online>"),

  ANTHROPIC_API_KEY: optionalString,
  OPENAI_API_KEY: optionalString,

  /** Google AI Studio key: the free Gemini tier gives unsure channels an AI second opinion. */
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().trim().min(1).default("gemini-3.6-flash"),
  /** OpenRouter key: its free models take over when Gemini's free tier is rate-limited. */
  OPENROUTER_API_KEY: optionalString,
  /** Comma-separated OpenRouter models, tried in order. Blank uses a built-in list of free ones. */
  OPENROUTER_MODELS: optionalString,
  /**
   * Who gives unsure channels a second opinion: "auto" uses Gemini, falling back to OpenRouter's free
   * models, whichever keys are set; Claude only when neither is; otherwise rules only. "rules" never calls an AI.
   */
  NICHE_LABEL_PROVIDER: z.enum(["auto", "gemini", "openrouter", "anthropic", "rules"]).default("auto"),
  /** Claude model for niche labeling when Anthropic is the provider. */
  NICHE_LABEL_MODEL: z.string().trim().min(1).default("claude-opus-5"),
  /** Channels per model call when labeling. */
  NICHE_LABEL_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(20),
  /** Channels labeled per hourly run. */
  NICHE_LABEL_MAX_PER_RUN: z.coerce.number().int().min(0).max(5_000).default(200),
  /** Library growth: discovery searches per run (runs every 6h) and per UTC day. 0 turns growth off. */
  LIBRARY_GROWTH_SEARCHES_PER_RUN: z.coerce.number().int().min(0).max(50).default(3),
  LIBRARY_GROWTH_DAILY_SEARCHES: z.coerce.number().int().min(0).max(500).default(12),
  /** Days before a seed niche is searched again. */
  LIBRARY_GROWTH_RESEED_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  /** Growth through channels creators feature: checks per run (1 unit each), new creators queued per run, and the size cap for channels it follows. */
  LIBRARY_FEATURED_CHECKS_PER_RUN: z.coerce.number().int().min(0).max(2_000).default(60),
  LIBRARY_FEATURED_NEW_PER_RUN: z.coerce.number().int().min(0).max(2_000).default(80),
  LIBRARY_FEATURED_MAX_SUBSCRIBERS: z.coerce.number().int().min(1_000).default(1_000_000),
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
