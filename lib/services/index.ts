import "server-only";
import { ChannelRepository, getAdminDatabase, JobRepository, UsageRepository, VideoRepository } from "@/lib/database";
import { createJobRegistry } from "@/lib/jobs/definitions";
import { JobQueue } from "@/lib/jobs/queue";
import type { JobRegistry } from "@/lib/jobs/registry";
import { getYouTubeService } from "@/lib/youtube";
import { ChannelService } from "./channel-service";
import { DiscoveryService } from "./discovery-service";
import { JobService } from "./job-service";
import { VideoService } from "./video-service";

export { ChannelService, DiscoveryService, JobService, VideoService };

export interface Services {
  channels: ChannelService;
  videos: VideoService;
  discovery: DiscoveryService;
  jobs: JobService;
  jobRegistry: JobRegistry;
  repositories: {
    channels: ChannelRepository;
    videos: VideoRepository;
    jobs: JobRepository;
    usage: UsageRepository;
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
  };
  const youtube = lazy(() => getYouTubeService());

  const channels = new ChannelService(youtube, repositories.channels, repositories.videos);
  const videos = new VideoService(youtube);
  const jobRegistry = createJobRegistry({ channels, videos });

  services = {
    channels,
    videos,
    discovery: new DiscoveryService(youtube),
    jobs: new JobService(new JobQueue(repositories.jobs, jobRegistry), repositories.jobs),
    jobRegistry,
    repositories,
  };
  return services;
}
