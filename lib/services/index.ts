import "server-only";
import { env } from "@/lib/core/env";
import { SupabaseAccountProvisioner, SupabaseAuthModeration, SupabaseInviteSender } from "@/lib/auth/invites";
import { ModerationRepository } from "@/lib/database/repositories/moderation";
import { NicheRepository } from "@/lib/database/repositories/niches";
import { ReferralRepository } from "@/lib/database/repositories/referrals";
import { parseMilestones } from "@/lib/referrals/milestones";
import { CompetitorRepository } from "@/lib/database/repositories/competitors";
import { AccountRepository } from "@/lib/database/repositories/accounts";
import { PreferencesRepository } from "@/lib/database/repositories/preferences";
import { RateLimitRepository } from "@/lib/database/repositories/rate-limits";
import { TrendingRepository } from "@/lib/database/repositories/trending";
import { WaitlistRepository } from "@/lib/database/repositories/waitlist";
import {
  ChannelRepository,
  getAdminDatabase,
  JobRepository,
  SystemRepository,
  UsageRepository,
  VideoRepository,
} from "@/lib/database";
import { createJobRegistry, LIBRARY_GROWTH_JOB_TYPE, NICHE_LABEL_JOB_TYPE } from "@/lib/jobs/definitions";
import { JobQueue } from "@/lib/jobs/queue";
import type { JobRegistry } from "@/lib/jobs/registry";
import { JobScheduler } from "@/lib/jobs/scheduler";
import { labelingProvider } from "@/lib/ai/select";
import { getAIProviders } from "@/lib/ai/registry";
import { LIBRARY_SEEDS } from "@/lib/niches/seeds";
import { LibraryGrowthService } from "./library-growth-service";
import { NicheLabelingService } from "./niche-labeling-service";
import { qualityConfigFrom } from "@/lib/research/quality";
import { YouTubeCacheRepository, YouTubeQuotaRepository } from "@/lib/database/repositories/youtube-quota";
import { getQuotaManager, getYouTubeService, quotaDay, setQuotaUserLimits, type QuotaManager } from "@/lib/youtube";
import { AccountService } from "./account-service";
import { DashboardService } from "./dashboard-service";
import { NicheService } from "./niche-service";
import { ReferralService } from "./referral-service";
import { CompetitorService } from "./competitor-service";
import { ModerationService } from "./moderation-service";
import { ChannelService } from "./channel-service";
import { CreditsService } from "./credits-service";
import { DiscoveryService } from "./discovery-service";
import { JobService } from "./job-service";
import { MONITOR_CHANNELS_JOB_TYPE, MONITOR_VIDEOS_JOB_TYPE, MonitoringService } from "./monitoring-service";
import { CompareService } from "./compare-service";
import { OnboardingService } from "./onboarding-service";
import { RateLimitService } from "./rate-limit-service";
import { ResearchService } from "./research-service";
import { StorageBudgetService } from "./storage-budget-service";
import { TRENDING_JOB_TYPE, TRENDING_REFRESH_JOB_TYPE, TrendingService } from "./trending-service";
import { VideoService } from "./video-service";
import { WaitlistService } from "./waitlist-service";

export { ChannelService, CreditsService, DiscoveryService, JobService, ResearchService, StorageBudgetService, VideoService };

export interface Services {
  channels: ChannelService;
  credits: CreditsService;
  videos: VideoService;
  waitlist: WaitlistService;
  onboarding: OnboardingService;
  accounts: AccountService;
  dashboard: DashboardService;
  niches: NicheService;
  referrals: ReferralService;
  competitors: CompetitorService;
  moderation: ModerationService;
  compare: CompareService;
  rateLimits: RateLimitService;
  discovery: DiscoveryService;
  jobs: JobService;
  research: ResearchService;
  trending: TrendingService;
  monitoring: MonitoringService;
  nicheLabeling: NicheLabelingService;
  libraryGrowth: LibraryGrowthService;
  /** YouTube quota budgets and usage reports. */
  quota: QuotaManager;
  storage: StorageBudgetService;
  jobRegistry: JobRegistry;
  scheduler: JobScheduler;
  repositories: {
    channels: ChannelRepository;
    videos: VideoRepository;
    jobs: JobRepository;
    usage: UsageRepository;
    system: SystemRepository;
    waitlist: WaitlistRepository;
    preferences: PreferencesRepository;
    rateLimits: RateLimitRepository;
    trending: TrendingRepository;
    youtubeQuota: YouTubeQuotaRepository;
    accounts: AccountRepository;
    moderation: ModerationRepository;
    niches: NicheRepository;
    referrals: ReferralRepository;
    competitors: CompetitorRepository;
    youtubeCache: YouTubeCacheRepository;
  };
}

let services: Services | undefined;


/**
 * Composition root: wires env-configured clients into repositories and services.
 * Services receive dependencies via constructors so tests can build them with fakes.
 * Clients are resolved lazily per-service, so routes that only need YouTube
 * don't require database credentials and vice versa.
 */
export function getServices(): Services {
  if (services) return services;

  const config = env();
  const lazyDb = () => getAdminDatabase();
  const lazy = <T extends object>(factory: () => T): T => {
    let instance: T | undefined;
    return new Proxy({} as T, {
      get: (_target, prop) => {
        instance ??= factory();
        const value = Reflect.get(instance, prop, instance);
        return typeof value === "function" ? value.bind(instance) : value;
      },
    });
  };

  const repositories = {
    channels: lazy(() => new ChannelRepository(lazyDb())),
    videos: lazy(() => new VideoRepository(lazyDb())),
    jobs: lazy(() => new JobRepository(lazyDb())),
    usage: lazy(() => new UsageRepository(lazyDb())),
    system: lazy(() => new SystemRepository(lazyDb())),
    waitlist: lazy(() => new WaitlistRepository(lazyDb())),
    preferences: lazy(() => new PreferencesRepository(lazyDb())),
    rateLimits: lazy(() => new RateLimitRepository(lazyDb())),
    trending: lazy(() => new TrendingRepository(lazyDb())),
    youtubeQuota: lazy(() => new YouTubeQuotaRepository(lazyDb())),
    accounts: lazy(() => new AccountRepository(lazyDb())),
    moderation: lazy(() => new ModerationRepository(lazyDb())),
    referrals: lazy(() => new ReferralRepository(lazyDb())),
    niches: lazy(() => new NicheRepository(lazyDb())),
    competitors: lazy(() => new CompetitorRepository(lazyDb())),
    youtubeCache: lazy(() => new YouTubeCacheRepository(lazyDb())),
  };
  const accounts = new AccountService(
    {
      repository: repositories.accounts,
      provisioner: lazy(() => new SupabaseAccountProvisioner(lazyDb(), (email) => repositories.accounts.userIdByEmail(email))),
    },
    { ownerEmails: config.OWNER_EMAILS.split(",") },
  );
  setQuotaUserLimits(async (userId) => {
    const limits = await accounts.limitsFor(userId);
    return { dailyUnits: limits.youtubeDailyUnits, tier: limits.quotaTier };
  });
  const youtube = lazy(() => getYouTubeService());

  const storage = new StorageBudgetService(() => repositories.system.databaseSizeBytes(), {
    budgetMb: config.STORAGE_BUDGET_MB,
    planLimitMb: config.SUPABASE_PLAN_LIMIT_MB,
  });
  const channels = new ChannelService(youtube, repositories.channels, repositories.videos, {
    storage,
    snapshotVideoMaxAgeDays: config.SNAPSHOT_VIDEO_MAX_AGE_DAYS,
    language: config.OUTLIER_LANGUAGE.toLowerCase(),
  });
  const videos = new VideoService(youtube);

  // Job handlers enqueue follow-up jobs, but the queue needs the registry first: bind late.
  const queueRef: { current?: JobQueue } = {};
  const enqueue = (type: string, payload: unknown, options?: Parameters<JobQueue["enqueue"]>[2]) =>
    queueRef.current!.enqueue(type, payload, options);

  const quality = qualityConfigFrom(config);
  const regionCode = config.OUTLIER_REGION.toUpperCase();
  const trending = new TrendingService(
    { youtube, repository: repositories.trending, enqueue },
    { quality, regionCode, minMultiplier: config.OUTLIER_MIN_MULTIPLIER },
  );

  const monitoring = new MonitoringService({
    youtube,
    videos: repositories.videos,
    channels: repositories.channels,
    channelService: channels,
    enqueue,
  });

  const research = new ResearchService(
    { youtube, channels: repositories.channels, videos: repositories.videos, usage: repositories.usage, storage, enqueue },
    { discoveryDailyLimit: config.DISCOVERY_DAILY_LIMIT, discoveryMaxChannels: config.DISCOVERY_MAX_CHANNELS, quality, regionCode },
  );

  // Niche labeling is rule-based and free; an AI provider only gives unsure channels a second opinion.
  const text = labelingProvider(config);
  if (text && !getAIProviders().has("text")) getAIProviders().register("text", text);
  const nicheLabeling = new NicheLabelingService(
    { text, channels: repositories.channels, niches: repositories.niches },
    { batchSize: config.NICHE_LABEL_BATCH_SIZE },
  );
  const libraryGrowth = new LibraryGrowthService(
    { research, usage: repositories.usage, niches: repositories.niches, seeds: LIBRARY_SEEDS, youtube, channels: repositories.channels, enqueue },
    {
      searchesPerRun: config.LIBRARY_GROWTH_SEARCHES_PER_RUN,
      dailySearches: config.LIBRARY_GROWTH_DAILY_SEARCHES,
      reseedDays: config.LIBRARY_GROWTH_RESEED_DAYS,
      featuredChecksPerRun: config.LIBRARY_FEATURED_CHECKS_PER_RUN,
      featuredNewPerRun: config.LIBRARY_FEATURED_NEW_PER_RUN,
      featuredMaxSubscribers: config.LIBRARY_FEATURED_MAX_SUBSCRIBERS,
    },
  );

  const jobRegistry = createJobRegistry({
    monitoring,
    nicheLabeling,
    libraryGrowth,
    youtubeHousekeeping: {
      pruneCache: () => repositories.youtubeCache.pruneExpired(),
      // Keep ~90 days of quota history for reporting.
      pruneQuotaHistory: () => repositories.youtubeQuota.deleteBefore(quotaDay(new Date(Date.now() - 90 * 86_400_000))),
    },
    channels,
    videos,
    storage,
    trending,
    channelRepository: repositories.channels,
    systemRepository: repositories.system,
    rateLimitRepository: repositories.rateLimits,
    enqueue,
    config: {
      syncIntervalHours: config.SYNC_INTERVAL_HOURS,
      syncMaxChannelsPerRun: config.SYNC_MAX_CHANNELS_PER_RUN,
      snapshotDailyRetentionDays: config.SNAPSHOT_DAILY_RETENTION_DAYS,
      snapshotRetentionDays: config.SNAPSHOT_RETENTION_DAYS,
      statsSnapshotMaxChannels: config.STATS_SNAPSHOT_MAX_CHANNELS,
      monitorMaxVideosPerRun: config.MONITOR_MAX_VIDEOS_PER_RUN,
      monitorMaxChannelsPerRun: config.MONITOR_MAX_CHANNELS_PER_RUN,
      nicheLabelMaxPerRun: config.NICHE_LABEL_MAX_PER_RUN,
    },
  });
  const queue = new JobQueue(repositories.jobs, jobRegistry);
  queueRef.current = queue;

  const scheduler = new JobScheduler({ findLatestByType: (type) => repositories.jobs.findLatestByType(type), enqueue }, [
    { type: "catalog.refresh", everyHours: config.SYNC_INTERVAL_HOURS },
    { type: "catalog.snapshot_stats", everyHours: config.STATS_SNAPSHOT_INTERVAL_HOURS },
    { type: "maintenance.prune_snapshots", everyHours: 24 },
    { type: TRENDING_JOB_TYPE, everyHours: 24 },
    { type: TRENDING_REFRESH_JOB_TYPE, everyHours: 1 },
    { type: "catalog.detect_languages", everyHours: 24 },
    { type: MONITOR_VIDEOS_JOB_TYPE, everyHours: 1 },
    { type: MONITOR_CHANNELS_JOB_TYPE, everyHours: 1 },
    { type: NICHE_LABEL_JOB_TYPE, everyHours: 1 },
    ...(config.LIBRARY_GROWTH_SEARCHES_PER_RUN > 0 || config.LIBRARY_FEATURED_CHECKS_PER_RUN > 0 ? [{ type: LIBRARY_GROWTH_JOB_TYPE, everyHours: 6 }] : []),
  ]);

  const credits = new CreditsService(
    repositories.usage,
    config.MONTHLY_CREDITS,
    async (userId) => (await accounts.limitsFor(userId)).monthlyCredits,
    (userId, since) => repositories.referrals.bonusSince(userId, since),
  );
  const referrals = new ReferralService(
    { referrals: repositories.referrals, waitlist: repositories.waitlist, userIdByEmail: (email) => repositories.accounts.userIdByEmail(email) },
    {
      referrerCredits: config.REFERRAL_REFERRER_CREDITS,
      referredCredits: config.REFERRAL_REFERRED_CREDITS,
      priorityThreshold: config.REFERRAL_PRIORITY_THRESHOLD,
      maxRewardsPerMonth: config.REFERRAL_MAX_REWARDS_PER_MONTH,
      milestones: parseMilestones(config.REFERRAL_MILESTONES),
    },
  );

  const compare = new CompareService({ channels: repositories.channels, videos: repositories.videos, channelService: channels });

  services = {
    channels,
    referrals,
    competitors: new CompetitorService({ channels: repositories.channels, competitors: repositories.competitors, compare }),
    niches: new NicheService(
      {
        niches: repositories.niches,
        youtube,
        channels: repositories.channels,
        videos: repositories.videos,
        usage: repositories.usage,
        credits,
        storage,
        enqueue,
      },
      { dailyYoutubeRefreshes: config.NICHE_DAILY_YOUTUBE_REFRESHES, language: quality.language, regionCode },
    ),
    dashboard: new DashboardService({
      channels: repositories.channels,
      videos: repositories.videos,
      usage: repositories.usage,
      credits,
      research,
      trending,
      targetCountries: quality.countries,
    }),
    credits,
    accounts,
    moderation: new ModerationService({
      moderation: repositories.moderation,
      accounts: repositories.accounts,
      waitlist: repositories.waitlist,
      auth: lazy(() => new SupabaseAuthModeration(lazyDb())),
      onAccountChanged: (userId) => accounts.invalidate(userId),
      isOwnerEmail: (email) => accounts.isOwnerEmail(email),
    }),
    onboarding: new OnboardingService(repositories.preferences),
    compare,
    rateLimits: new RateLimitService(repositories.rateLimits, config.RATE_LIMIT_SALT ?? config.CRON_SECRET ?? "outlier-rate-limit"),
    waitlist: new WaitlistService(repositories.waitlist, lazy(() => new SupabaseInviteSender(lazyDb()))),
    videos,
    discovery: new DiscoveryService(youtube),
    jobs: new JobService(queue, repositories.jobs),
    trending,
    monitoring,
    nicheLabeling,
    libraryGrowth,
    quota: lazy(() => getQuotaManager()),
    research,
    storage,
    jobRegistry,
    scheduler,
    repositories,
  };
  return services;
}
