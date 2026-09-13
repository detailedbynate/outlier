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

  INTERNAL_API_KEY: optionalString,
  /** Bearer secret for /api/cron/* (called by GitHub Actions). */
  CRON_SECRET: optionalString,
  /** Comma-separated emails allowed to use the app. Blank = any signed-in user. */
  ALLOWED_EMAILS: optionalString,

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

  /** Research discovery searches per UTC day, all users combined (100 YouTube quota units each). */
  DISCOVERY_DAILY_LIMIT: z.coerce.number().int().min(0).max(90).default(10),
  DISCOVERY_MAX_CHANNELS: z.coerce.number().int().min(1).max(50).default(25),

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
