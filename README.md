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

**Login:** accounts are invite-only. Create them in Supabase → Authentication → Users → Add user (auto-confirm), and turn off "Allow new users to sign up". `ALLOWED_EMAILS` (comma-separated) can restrict access further. Every page and server action checks the session (`requireApprovedUser`), and `proxy.ts` redirects signed-out visitors to `/login`.

### Landing page, waitlist & invites

Signed-out visitors see the landing page at `/` with a waitlist form. Admins (`ADMIN_EMAILS`) invite people from `/admin/waitlist`, either by sending an invite email or by copying a one-time sign-in link. Invited people land on `/auth/confirm` and set a password at `/set-password`. Anyone invited from the waitlist is approved automatically.

Supabase setup:
- **Authentication → URL Configuration:** set Site URL to your deployed URL.
- **Authentication → Email Templates → Invite user:** set the link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`.
- Supabase's built-in email only sends a few messages per hour. Add custom SMTP (e.g. Resend) before large batches, or use "Get link".

### Auto-sync on Vercel (free)

`.github/workflows/sync.yml` calls `POST /api/cron/tick` every hour. Each call enqueues due recurring jobs, recovers stuck ones, and runs queued jobs for up to ~40s. Set the repository secrets `APP_URL` and `CRON_SECRET`, and set `CRON_SECRET` in Vercel.

If Node can't verify Supabase's TLS certificate (a corporate proxy or antivirus that intercepts HTTPS), start with `NODE_OPTIONS=--use-system-ca`.

### Background worker & auto-sync

```bash
npm run worker                    # polls Postgres for jobs; Ctrl+C to stop
```

While running, the worker schedules:

- `catalog.refresh` every `SYNC_INTERVAL_HOURS` (24): refreshes up to `SYNC_MAX_CHANNELS_PER_RUN` (50) of the stalest tracked channels
- `maintenance.prune_snapshots` daily: keeps daily snapshots for 30 days, then weekly, and deletes them after 365 days

### InnerTube scraper (optional)

```bash
npm run scraper                   # reads channel pages instead of the API; Ctrl+C to stop
```

A separate, deliberately slow process that refreshes channels from YouTube's own
web endpoints (`youtubei.js`), so the daily API quota goes to users instead. It
picks up channels shortly before the worker's `catalog.refresh` would, reads the
channel page plus the Videos and Shorts tabs, and then spends one quota unit per
50 videos on `videos.list` for exact view/like counts — listing pages only show
rounded numbers.

**One gate for the whole application** (`lib/innertube/gate.ts`). Every scraped
read in the process goes through it, whatever the caller — the limit is not per
user, per endpoint, or per scraper instance. In order, a read is:

1. **cached** in memory (`INNERTUBE_CACHE_TTL_SECONDS`, 30 min), and identical
   reads in flight at once share one request — which is why channel info plus
   uploads costs one page load, not two;
2. **refused** outright while the circuit breaker is open;
3. **queued** — one FIFO queue, at most `INNERTUBE_MAX_CONCURRENT` (1) in flight,
   spaced to `INNERTUBE_REQUESTS_PER_MINUTE` (4);
4. **retried** on a transient failure, `INNERTUBE_MAX_RETRIES` (2) times, with
   exponential backoff and ±20% jitter (the queue slot is freed while it waits);
5. **paused** — a bot check, a 429, or `INNERTUBE_FAILURE_THRESHOLD` (5) failures
   in a row trips the breaker for `INNERTUBE_BREAKER_MINUTES` (30), doubling up
   to `INNERTUBE_MAX_BREAKER_HOURS` (12) while blocks keep coming, and resetting
   after one good read. A definite answer (a channel that doesn't exist) is not a
   failure and is never retried.

The official Data API is only a **controlled fallback**, with its own separate
tracker: every API call still goes through `QuotaManager` (daily units, lanes,
per-user caps), so a fallback can be refused there and the scraper waits rather
than digging into the users' reserve. Handle lookups, paging, per-format
listings, and 50-channel batches stay on the API deliberately.

**The rate finds its own level.** There is no published limit on these
endpoints — only YouTube's tolerance — so the scraper walks up a ladder,
`INNERTUBE_RAMP_STEPS` (`4,6,9,12,16,20,25` per minute). One clean
`INNERTUBE_RAMP_CLEAN_HOURS` (24) at a rate earns the next step; a single block
gives the step back, records the refused rate as the ceiling, and freezes the
ladder one rung below it. The position lives in `scraper-ramp.json` under
`INNERTUBE_STATE_DIR` (systemd's `StateDirectory`), so restarts and deploys don't
forget what YouTube already refused. Set `INNERTUBE_RAMP_STEPS` to a single value
to pin the rate, and delete the file to start a fresh search.

Roughly, one channel costs 4 page reads, so 4/min is ~1,400 channels/day and
25/min is ~9,000 — which is where `videos.list` becomes the binding limit again.

While the breaker is open the worker's ordinary API refresh covers everything, so
stopping the scraper changes no behaviour except quota use. Round size is
`SCRAPER_BATCH` (20); on the server it runs as its own capped service — see
`deploy/outlier-scraper.service`.

### Search without quota

`search.list` costs 100 quota units per call, which is why discovery and Niche
Finder had daily caps at all. Searches now go to YouTube's web endpoints first
(`lib/youtube/search-first.ts`), which costs nothing, and only the result *ids*
come from there: `searchVideos`/`searchChannels` still hydrate through
`videos.list`/`channels.list` (1 unit per 50), so ranking and stored stats keep
exact numbers. A discovery run went from ~101 units to ~1.

Interactive reads use the gate's **user lane** — their own allowance
(`INNERTUBE_USER_REQUESTS_PER_MINUTE`, 30/min) on top of the scraper's pace, served
ahead of queued background reads, and refused after
`INNERTUBE_USER_MAX_WAIT_MS` (2s) rather than making anyone wait. A refusal, a
failure, an empty result, or an open breaker all fall back to the API in the same
request. Follow-up result pages may wait three times as long, and if one is
refused the search returns the results already in hand instead of paying 100
units for the same thing.

These stay on the API deliberately, because the web search can't express them
faithfully: paging by token, searches inside one channel, playlist searches, the
`date`/`title`/`videoCount` orders, and category filters. Shorts searches use
YouTube's own `shorts` type, which also means the format is known rather than
guessed. Set `INNERTUBE_SEARCH_ENABLED=false` to put everything back on the API.

With search effectively free, `DISCOVERY_DAILY_LIMIT` and
`NICHE_DAILY_YOUTUBE_REFRESHES` went from 10 and 15 to 250 each. They still exist,
but they now guard the channel ingestion and storage a search triggers, not the
search itself.

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

## End-to-end tests (Playwright)

```bash
npm run test:e2e
```

- Uses the Microsoft Edge already installed on Windows (no browser download; the package is ~10 MB).
- Starts its own dev server on port 3100 and signs in as the owner through a test-only cookie. The bypass (`lib/auth/e2e.ts`) only works when `NODE_ENV` isn't `production` **and** `E2E_AUTH_TOKEN` is set; never set that variable in production.
- Checks every signed-in page on desktop (1280px) and phone (375px): renders, no errors, no sideways overflow. Also covers the mobile menu, dropdowns staying on screen, competitor tabs, and the public landing/login pages.
- Tests only read data: no YouTube calls and no waitlist signups. Test sessions don't record dashboard visits.

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
  innertube/        Scraped channel reads: global gate (queue, limiter, cache, breaker) + API fallback
scripts/worker.ts   Job worker entrypoint
scripts/scraper.ts  InnerTube scraper entrypoint
deploy/             systemd units for the server
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

### Quota-aware ingestion

`YouTubeClient` is the only code that calls the API. Every request goes through two layers:

1. **Response cache** (`youtube_api_cache`): identical requests from any user reuse a recent response (videos 15 min, channels/playlist items 30 min, searches and playlists 6 h). Monitoring jobs bypass it for fresh statistics.
2. **`QuotaManager`** (`youtube_quota_usage` + `consume_youtube_quota`): an atomic check-and-record per request, by quota day (Pacific), lane, operation, and user.

| Budget (defaults) | Units |
|---|---|
| Daily quota (`YOUTUBE_DAILY_QUOTA`) | 10,000 |
| Never spent (`YOUTUBE_SAFETY_BUFFER_UNITS`) | 300 |
| Reserved for users (`YOUTUBE_USER_RESERVE_UNITS`) | 3,000 |
| Background max | 6,700 |
| Per user per day (`YOUTUBE_USER_DAILY_UNITS`, tier `default`; `pro` = 3×) | 1,000 |

Who a request is for comes from an async context: jobs run as `background` (`job:<type>`), API routes and server actions as `user` (`api:…`, `action:…`, `page:…`). Wrap new entry points with `asUser(userId, "action:name", fn)` or `asBackground("name", fn)`.

When quota is unavailable: a stale cached response (up to 2 days old) is served if there is one; jobs are **deferred** to the quota reset without using an attempt; compare falls back to stored data; tracking a known channel is queued. `GET /api/v1/quota` reports today's usage.

### Background monitoring

`monitor.videos` (hourly) re-checks due videos in batches of 50 (1 unit per 50): views/hour, acceleration, and outlier score vs the channel's median. Priority sets the next check: **hot** 1 h (fast, accelerating, or breaking out), **warm** 3 h (young or ≥200 views/h), **normal** 12 h, **cold** 72 h; stale videos (60+ days, slow) drop out. New uploads are picked up automatically. Hot videos raise their channel's priority; `monitor.channels` (hourly) snapshots due channels and re-syncs uploads for hot channels to find sibling breakouts.

---

## Niche labels & library growth

Search used to match niches by text ("cooking" = any title containing "cooking"). Channels now carry **labels**, and every research tool queries them first.

- **`niches.label_channels`** (hourly) labels channels that were never labeled. It's **free**: `lib/niches/rule-labeler.ts` matches each channel's recent uploads, tags, name and description against `lib/niches/dictionary.ts` (~230 games and topics with their aliases and hashtags) and uses YouTube's own topic categories for the category. Each channel gets a category, its game or topic, specific sub-niches, content formats and quality flags.
- **Only confident labels become niches.** A game or topic has to show up in most of a channel's uploads (or its name) before the channel is linked to it. Weaker guesses are kept as searchable sub-niche tags, and don't feed niche analysis. When YouTube's topic categories contradict a weak match (a news channel that often covers AI), the topics win.
- **Optional AI second opinion**: channels the rules weren't sure about go to an AI in batches. `NICHE_LABEL_PROVIDER=auto` uses Google Gemini when `GEMINI_API_KEY` is set (free tier, default model `gemini-3.6-flash`; Google may use free-tier inputs, which here are public channel metadata), then Claude when `ANTHROPIC_API_KEY` is set, otherwise rules only. Answers are JSON validated against the same schema either way. If a call fails or is rate-limited, the rule label stands.
- **Search** (Shorts Channels, Niche Finder) matches a term against niche names, aliases and sub-niches as well as text.
- **Quality flags**: channels flagged `reupload`, `compilation` or `spam_or_misleading` are left out of niche analysis.
- **Underrated niches** are mined from confident labels first, so they're real niches rather than title words.
- **Shorts Channels ranks creators by `underrated_score`** by default (a column on the `shorts_channels` view, 0-100): average Short views relative to subscribers (up to 500x), how often uploads beat the channel's median, real demand, still posting, and a size factor that gives 1M+ channels nothing. On the library at the time, the top 30 went from a median of 1.7M subscribers (sorted by average views) to 8K. Channels flagged as reuploads, compilations or spam are hidden.
- **`library.grow`** (every 6h) first follows **featured channels**: creators list peers in their niche on their channel page, and `channelSections.list` costs 1 unit versus 100 for a search. It checks `LIBRARY_FEATURED_CHECKS_PER_RUN` confidently labeled channels under `LIBRARY_FEATURED_MAX_SUBSCRIBERS` and queues up to `LIBRARY_FEATURED_NEW_PER_RUN` creators we don't have. Then it runs Shorts discovery for the seed niches in `lib/niches/seeds.ts` (~240, mostly games) the library is thinnest on, skipping any searched in the last `LIBRARY_GROWTH_RESEED_DAYS`. It runs in the background quota lane, has its own daily cap (`LIBRARY_GROWTH_DAILY_SEARCHES`), and never uses up users' daily discovery searches.

**Storage:** each channel with its uploads and stat history takes roughly 100-170 KB, so the free Supabase plan (with `STORAGE_BUDGET_MB=250`) holds about 2,000 channels before ingestion pauses. A library of tens of thousands of creators needs a paid database plan.

To teach the labeler a new game or topic, add it to `lib/niches/dictionary.ts` with the names people write for it.

---

## Credits & referrals

Credits are a **monthly** allowance (`MONTHLY_CREDITS`, default 400; per-account overrides in Admin → Accounts) that resets on the 1st (UTC). Bonus grants in `credit_grants` add to the allowance for the month they're granted.

Every waitlist signup and account gets a code. Share link: `/?ref=CODE` (stored in a 30-day cookie); public progress: `/waitlist/CODE`; in-app: `/referrals`.

- `REFERRAL_PRIORITY_THRESHOLD` (3) referred signups → priority on the waitlist (Admin → Waitlist → "Top referrers first").
- When a referred person creates an account: they get `REFERRAL_REFERRED_CREDITS` (50) and the referrer gets `REFERRAL_REFERRER_CREDITS` (25) — held until the referrer has an account, capped at `REFERRAL_MAX_REWARDS_PER_MONTH` (20) per month. Self-referrals are ignored and each reward is granted once.
- `REFERRAL_MILESTONES` (`1:75,3:100,5:200,10:375`) adds a bonus on top at those friend counts, so the running total is **100 / 250 / 500 / 1000 credits** at 1 / 3 / 5 / 10 friends. Referrals are unlimited: the last milestone repeats (20, 30, … friends), so there is always a next goal.

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
