import type { PageOptions, SearchParams, YouTubeService } from "@/lib/youtube/service";
import type { Page, YouTubeChannel, YouTubePlaylist, YouTubeSearchResult, YouTubeVideo, YouTubeVideoCategory } from "@/types/youtube";

/**
 * Discovery & research use cases (search, trending, playlists).
 * Today these proxy YouTube; later they will prefer the local catalog
 * (lib/search) and fall back to YouTube to conserve quota.
 */
export class DiscoveryService {
  constructor(private readonly youtube: YouTubeService) {}

  search(params: SearchParams): Promise<Page<YouTubeSearchResult>> {
    return this.youtube.search(params);
  }

  searchVideos(params: Omit<SearchParams, "type">): Promise<Page<YouTubeVideo>> {
    return this.youtube.searchVideos(params);
  }

  searchChannels(params: Omit<SearchParams, "type">): Promise<Page<YouTubeChannel>> {
    return this.youtube.searchChannels(params);
  }

  trending(options: PageOptions & { regionCode?: string; videoCategoryId?: string } = {}): Promise<Page<YouTubeVideo>> {
    return this.youtube.getTrendingVideos(options);
  }

  categories(regionCode?: string): Promise<YouTubeVideoCategory[]> {
    return this.youtube.getVideoCategories(regionCode);
  }

  async playlist(idOrUrl: string, options: PageOptions = {}): Promise<{ playlist: YouTubePlaylist; videos: Page<YouTubeVideo> }> {
    const [playlist, videos] = await Promise.all([
      this.youtube.getPlaylist(idOrUrl),
      this.youtube.getPlaylistVideos(idOrUrl, options),
    ]);
    return { playlist, videos };
  }
}
