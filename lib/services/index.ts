import "server-only";
import { env } from "@/lib/core/env";
import { SupabaseInviteSender } from "@/lib/auth/invites";
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
import { createJobRegistry } from "@/lib/jobs/definitions";
import { JobQueue } from "@/lib/jobs/queue";
import type { JobRegistry } from "@/lib/jobs/registry";
import { JobScheduler } from "@/lib/jobs/scheduler";
import { qualityConfigFrom } from "@/lib/research/quality";
import { getYouTubeService } from "@/lib/youtube";
import { ChannelService } from "./channel-service";
import { CreditsService } from "./credits-service";
import { DiscoveryService } from "./discovery-service";
import { JobService } from "./job-service";
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
  compare: CompareService;
  rateLimits: RateLimitService;
  discovery: DiscoveryService;
  jobs: JobService;
  research: ResearchService;
  trending: TrendingService;
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
  };
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

  const jobRegistry = createJobRegistry({
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
  ]);

  services = {
    channels,
    credits: new CreditsService(repositories.usage, config.DAILY_CREDITS),
    onboarding: new OnboardingService(repositories.preferences),
    compare: new CompareService({ channels: repositories.channels, videos: repositories.videos, channelService: channels }),
    rateLimits: new RateLimitService(repositories.rateLimits, config.RATE_LIMIT_SALT ?? config.CRON_SECRET ?? "outlier-rate-limit"),
    waitlist: new WaitlistService(repositories.waitlist, lazy(() => new SupabaseInviteSender(lazyDb()))),
    videos,
    discovery: new DiscoveryService(youtube),
    jobs: new JobService(queue, repositories.jobs),
    trending,
    research: new ResearchService(
      { youtube, channels: repositories.channels, videos: repositories.videos, usage: repositories.usage, storage, enqueue },
      { discoveryDailyLimit: config.DISCOVERY_DAILY_LIMIT, discoveryMaxChannels: config.DISCOVERY_MAX_CHANNELS, quality, regionCode },
    ),
    storage,
    jobRegistry,
    scheduler,
    repositories,
  };
  return services;
}
