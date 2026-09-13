# YT Intelligence

Backend foundation for a YouTube intelligence platform: discover viral videos and channels, research niches, track growth over time, analyze videos, organize channels into folders, and later generate content and expose everything through a public API and MCP tools.

**Stack:** Next.js 16 (App Router) · TypeScript · Supabase/PostgreSQL · Zod · Vitest. No Redis or paid queues. Background jobs run on Postgres.

---

## Quick start

```bash
npm install
cp .env.example .env.local        # fill in YOUTUBE_API_KEY + Supabase values
npm run dev                       # http://localhost:3000/api/health
```

### Database

With the [Supabase CLI](https://supabase.com/docs/guides/local-development) and Docker:

```bash
supabase start                    # local Postgres + Auth + Storage; prints URL and keys
supabase db reset                 # applies supabase/migrations
```

Hosted project: `supabase link --project-ref <ref>`, then `supabase db push`.

### UI

`npm run dev` and open http://localhost:3000:

- **Dashboard**: counts, storage meter, track a channel, top outliers (last 30 days)
- **Viral videos**: outlier feed with date/format/sort filters
- **Channels**: tracked channels, plus a page per channel with a subscriber chart, outliers, and uploads
- **Analyze video**: score any video against its channel

The UI has no login yet, so tracking channels from the UI is disabled when `NODE_ENV=production`.

If Node can't verify Supabase's TLS certificate (a corporate proxy or antivirus that intercepts HTTPS), start with `NODE_OPTIONS=--use-system-ca`.

### Background worker & auto-sync

```bash
npm run worker                    # polls Postgres for jobs; Ctrl+C to stop
```

While running, the worker schedules:

- `catalog.refresh` every `SYNC_INTERVAL_HOURS` (24): refreshes up to `SYNC_MAX_CHANNELS_PER_RUN` (50) of the stalest tracked channels
- `maintenance.prune_snapshots` daily: keeps daily snapshots for 30 days, then weekly, and deletes them after 365 days

### Storage budget

To stay well inside Supabase's free 500 MB, ingestion stops once the database reaches `STORAGE_BUDGET_MB` (default **250 MB**). Reads keep working and the dashboard shows usage. Growth is kept small by:

- snapshotting only videos newer than `SNAPSHOT_VIDEO_MAX_AGE_DAYS` (90)
- capping stored descriptions at 1,000 characters
- syncing only the latest 50 uploads per channel on each refresh
- pruning snapshot history

### Checks

```bash
npm run check                     # typecheck + lint + tests
```

The migration tests apply every migration to an in-memory Postgres ([PGlite](https://pglite.dev)), so schema changes are tested without Docker.

---

## Architecture

```
app/api/            Thin HTTP routes: validate -> call a service -> return
  health/           Public health check
  v1/               Versioned public API (bearer-key auth)
lib/
  core/             env validation (Zod), logger, error hierarchy
  api/              Route wrapper: auth, validation, response envelope, error mapping
  services/         Business logic + composition root (getServices)
  youtube/          YouTube Data API v3 client, schemas, mappers, service
  database/         Supabase clients, repositories, DB error mapping
  jobs/             Postgres job queue, registry, worker, job definitions
  analytics/        Pure performance metrics (views/day, engagement, outliers, growth)
  search/           Catalog search + similarity interfaces (pg_trgm, later pgvector)
  ai/               Provider interfaces for text, embeddings, image, voice, video
  storage/          Object storage interface + Supabase Storage provider
  mcp/              Transport-agnostic MCP tool definitions over services
types/              Database, YouTube domain, and API types
supabase/           config.toml + SQL migrations
scripts/worker.ts   Job worker entrypoint
tests/              Vitest suites
```

**Rules**

- Routes hold no business logic. They validate input with Zod, call a service, and return.
- Services get their dependencies through constructors. `lib/services/index.ts` wires the real ones, so tests can pass in fakes.
- Services throw `AppError` subclasses. The API layer turns them into `{ error: { code, message, requestId } }` with the right HTTP status. Unexpected errors come back as a generic 500 and never leak internals.
- Secrets stay on the server (`server-only`). The service-role DB client is only used in trusted server code.

---

## Database schema

| Table | Purpose |
|---|---|
| `users` | Profile row 1:1 with `auth.users`. Created by a trigger on signup, along with a personal workspace. |
| `workspaces`, `workspace_members` | Tenancy. Folders, jobs, usage, and credits belong to a workspace. |
| `niches` | Hierarchical niche taxonomy with keywords |
| `channels`, `channel_snapshots` | Shared YouTube channel catalog plus append-only stat history |
| `videos`, `video_snapshots` | Shared video catalog (format: long_form/short/live/upcoming) plus stat history |
| `video_performance` | Derived metrics per video (views/day, engagement, outlier score, 24h/7d/30d deltas) |
| `jobs`, `job_results` | Postgres job queue (`claim_jobs` uses `FOR UPDATE SKIP LOCKED`) and outputs |
| `folders`, `folder_channels` | Channel watchlists per workspace |
| `usage_events` | Append-only metering of quota'd or billable actions |
| `credits` | Immutable credit ledger. Balance is shown in the `workspace_credit_balances` view. |

Every table uses UUID keys, foreign keys, check constraints, `created_at`/`updated_at` triggers, and RLS. Catalog tables are readable by signed-in users. Workspace data is limited to members. Writes go through the service role.

---

## YouTube integration

`lib/youtube` calls the real YouTube Data API v3 using `YOUTUBE_API_KEY`.

- **Lookups:** channel by id, @handle, or URL; batched channel and video lookups (50 per call, input order kept)
- **Channel content:** uploads, **Shorts** (from the channel's `UUSH…` playlist), long-form (`UULF…`), playlists
- **Search:** videos, channels, and playlists with filters, plus a hydrated variant with full statistics
- **Other:** trending by region/category, video categories, playlist items
- **Reliability:** timeouts, retries with backoff on transient errors, Zod-validated responses, quota errors mapped to `QUOTA_EXCEEDED`, and an `onQuotaUsage` hook for metering

Quota: `search.list` costs **100 units**. Most other calls cost 1. The default daily quota is 10,000.

Shorts classification records how sure it is (`formatSource`). A match against the Shorts playlist is authoritative. Otherwise a duration of 3 minutes or less is used as a guess.

---

## API v1

Every `/api/v1/*` route needs `Authorization: Bearer $INTERNAL_API_KEY`. In development with no key set, the routes are open. In production, the key is required.

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check and which integrations are configured |
| GET | `/api/v1/channels/:identifier` | Channel by id/@handle. Add `?sync=true` to also persist it with a snapshot. |
| GET | `/api/v1/channels/:identifier/videos` | Uploads. `?filter=all\|shorts\|long_form&maxResults&pageToken` |
| GET | `/api/v1/channels/:identifier/shorts` | Shorts only |
| GET | `/api/v1/channels/:identifier/playlists` | Channel playlists |
| GET | `/api/v1/videos/:id` | Video metadata and stats. Add `?analyze=true` for performance vs. the channel. |
| GET | `/api/v1/search` | `?q&type&order&publishedAfter&regionCode&videoDuration&hydrate=true` |
| GET | `/api/v1/trending` | `?regionCode&videoCategoryId` |
| GET | `/api/v1/playlists/:id` | Playlist plus hydrated videos |
| GET | `/api/v1/jobs` | Registered job types |
| POST | `/api/v1/jobs` | Enqueue `{ type, payload, priority?, runAt?, idempotencyKey? }` |
| GET/DELETE | `/api/v1/jobs/:id` | Job status and results / cancel a queued job |

Success responses look like `{ data, meta: { requestId, nextPageToken? } }`. Errors look like `{ error: { code, message, details?, requestId } }`.

### Jobs

| Type | Payload |
|---|---|
| `channel.sync` | `{ identifier }`: upsert the channel and a snapshot |
| `channel.sync_videos` | `{ channelId, maxPages?, filter? }`: ingest uploads and snapshots, recompute performance |
| `video.analyze` | `{ video }`: score a video against its channel |

Add a job with `defineJob` in `lib/jobs/definitions.ts`. Failed jobs retry with exponential backoff up to `max_attempts`. Validation and not-found errors fail right away. Jobs whose lock goes stale are put back in the queue.

---

## Future modules (interfaces only)

- `lib/ai`: `TextProvider`, `EmbeddingProvider`, `ImageProvider`, `VoiceProvider`, `VideoProvider`. Until one is registered, the registry returns `NOT_IMPLEMENTED`.
- `lib/youtube/transcripts.ts`: `TranscriptProvider` and `VideoProcessor`
- `lib/search`: channel/video search and similarity providers, plus cosine/Jaccard helpers
- `lib/storage`: `StorageProvider`, with a working Supabase Storage implementation
- `lib/mcp`: tool definitions (`youtube_get_channel`, `youtube_list_channel_videos`, `youtube_analyze_video`, `youtube_search`) with JSON Schema output, ready to plug into an MCP transport
