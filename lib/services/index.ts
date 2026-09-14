import "server-only";
import { env } from "@/lib/core/env";
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
import { getYouTubeService } from "@/lib/youtube";
import { ChannelService } from "./channel-service";
import { CreditsService } from "./credits-service";
import { DiscoveryService } from "./discovery-service";
import { JobService } from "./job-service";
import { ResearchService } from "./research-service";
import { StorageBudgetService } from "./storage-budget-service";
import { VideoService } from "./video-service";

export { ChannelService, CreditsService, DiscoveryService, JobService, ResearchService, StorageBudgetService, VideoService };

export interface Services {
  channels: ChannelService;
  credits: CreditsService;
  videos: VideoService;
  discovery: DiscoveryService;
  jobs: JobService;
  research: ResearchService;
  storage: StorageBudgetService;
  jobRegistry: JobRegistry;
  scheduler: JobScheduler;
  repositories: {
    channels: ChannelRepository;
    videos: VideoRepository;
    jobs: JobRepository;
    usage: UsageRepository;
    system: SystemRepository;
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
  };
  const youtube = lazy(() => getYouTubeService());

  const storage = new StorageBudgetService(() => repositories.system.databaseSizeBytes(), {
    budgetMb: config.STORAGE_BUDGET_MB,
    planLimitMb: config.SUPABASE_PLAN_LIMIT_MB,
  });
  const channels = new ChannelService(youtube, repositories.channels, repositories.videos, {
    storage,
    snapshotVideoMaxAgeDays: config.SNAPSHOT_VIDEO_MAX_AGE_DAYS,
  });
  const videos = new VideoService(youtube);

  // Job handlers enqueue follow-up jobs, but the queue needs the registry first: bind late.
  const queueRef: { current?: JobQueue } = {};
  const enqueue = (type: string, payload: unknown, options?: Parameters<JobQueue["enqueue"]>[2]) =>
    queueRef.current!.enqueue(type, payload, options);

  const jobRegistry = createJobRegistry({
    channels,
    videos,
    storage,
    channelRepository: repositories.channels,
    systemRepository: repositories.system,
    enqueue,
    config: {
      syncIntervalHours: config.SYNC_INTERVAL_HOURS,
      syncMaxChannelsPerRun: config.SYNC_MAX_CHANNELS_PER_RUN,
      snapshotDailyRetentionDays: config.SNAPSHOT_DAILY_RETENTION_DAYS,
      snapshotRetentionDays: config.SNAPSHOT_RETENTION_DAYS,
    },
  });
  const queue = new JobQueue(repositories.jobs, jobRegistry);
  queueRef.current = queue;

  const scheduler = new JobScheduler({ findLatestByType: (type) => repositories.jobs.findLatestByType(type), enqueue }, [
    { type: "catalog.refresh", everyHours: config.SYNC_INTERVAL_HOURS },
    { type: "maintenance.prune_snapshots", everyHours: 24 },
  ]);

  services = {
    channels,
    credits: new CreditsService(repositories.usage, config.DAILY_CREDITS),
    videos,
    discovery: new DiscoveryService(youtube),
    jobs: new JobService(queue, repositories.jobs),
    research: new ResearchService(
      { youtube, channels: repositories.channels, videos: repositories.videos, usage: repositories.usage, storage, enqueue },
      { discoveryDailyLimit: config.DISCOVERY_DAILY_LIMIT, discoveryMaxChannels: config.DISCOVERY_MAX_CHANNELS },
    ),
    storage,
    jobRegistry,
    scheduler,
    repositories,
  };
  return services;
}
