import { activityItem, channelAlerts, channelGrowth, type ActivityItem, type ChannelAlert, type ChannelGrowth } from "@/lib/analytics/dashboard";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { ChannelRepository, ShortsChannelFilters } from "@/lib/database/repositories/channels";
import type { UsageRepository } from "@/lib/database/repositories/usage";
import type { FastVideo, VideoRepository } from "@/lib/database/repositories/videos";
import { parseChannelIdentifier } from "@/lib/youtube/parse";
import type { ChannelRow, ShortsChannelRow, VideoFeedRow } from "@/types/database";
import type { CreditStatus, CreditsService } from "./credits-service";
import { SHORTS_DISCOVERY_EVENT, type ResearchService } from "./research-service";
import type { TrendingPickView, TrendingService } from "./trending-service";

/**
 * Read-only data for the dashboard. Uses only stored data (no YouTube API
 * calls), so opening the dashboard never spends quota.
 */

export const DASHBOARD_VISIT_EVENT = "dashboard.visit";
const RESEARCH_EVENTS = [SHORTS_DISCOVERY_EVENT, "credits.track_channel", "credits.analyze_video"];
/** Visits closer together than this count as the same session. */
const VISIT_SESSION_MS = 30 * 60_000;

export interface Overview {
  trackedChannels: number;
  researchThisWeek: number;
  credits: CreditStatus;
  lastVisitAt: string | null;
}

export interface NichePulse {
  topics: { label: string; mine: boolean }[];
  fastShorts: (FastVideo & { channel: Pick<ChannelRow, "title" | "youtube_channel_id" | "thumbnail_url" | "subscriber_count"> | null })[];
  movers: ShortsChannelRow[];
  picks: TrendingPickView[];
  newSinceLastVisit: number;
  scoped: boolean;
}

export interface ChannelSummary {
  channel: ChannelRow;
  growth: ChannelGrowth;
  recent: VideoFeedRow[];
  alerts: ChannelAlert[];
}

export interface YourChannels {
  own: ChannelSummary | null;
  /** Set when the user saved a channel we haven't synced yet. */
  ownPending: string | null;
  tracked: (ChannelRow & { growth: ChannelGrowth })[];
}

export interface CompetitorWatch {
  configured: number;
  found: (ChannelRow & { growth: ChannelGrowth })[];
  missing: string[];
  uploads: VideoFeedRow[];
  topPerformers: VideoFeedRow[];
}

function splitIdentifiers(values: readonly string[]): { ids: string[]; handles: string[]; unparsable: string[] } {
  const ids: string[] = [];
  const handles: string[] = [];
  const unparsable: string[] = [];
  for (const value of values) {
    try {
      const parsed = parseChannelIdentifier(value);
      if (parsed.type === "id") ids.push(parsed.value);
      else if (parsed.type === "handle") handles.push(parsed.value);
      else unparsable.push(value);
    } catch {
      unparsable.push(value);
    }
  }
  return { ids, handles, unparsable };
}

const matches = (channel: ChannelRow, identifier: string) => {
  try {
    const parsed = parseChannelIdentifier(identifier);
    return parsed.type === "id" ? channel.youtube_channel_id === parsed.value : channel.handle?.toLowerCase() === parsed.value.toLowerCase();
  } catch {
    return false;
  }
};

export class DashboardService {
  private readonly log: Logger;

  constructor(
    private readonly deps: {
      channels: Pick<ChannelRepository, "count" | "list" | "findByIds" | "findByIdentifiers" | "snapshotsForChannels" | "findChannelIdsByKeywords" | "searchShortsChannels">;
      videos: Pick<VideoRepository, "fastMoving" | "feed">;
      usage: Pick<UsageRepository, "recentForUser" | "countForUserSince" | "record">;
      credits: Pick<CreditsService, "status">;
      research: Pick<ResearchService, "popularKeywords">;
      trending: Pick<TrendingService, "currentPicks">;
      targetCountries: readonly string[];
    },
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ module: "services.dashboard" });
  }

  /** Previous visit (before this session), then record this one. */
  async registerVisit(userId: string, now: Date = new Date()): Promise<string | null> {
    try {
      const visits = await this.deps.usage.recentForUser(userId, 10, [DASHBOARD_VISIT_EVENT]);
      const latest = visits[0];
      const inSession = latest !== undefined && now.getTime() - Date.parse(latest.occurred_at) < VISIT_SESSION_MS;
      if (!inSession) await this.deps.usage.record({ event_type: DASHBOARD_VISIT_EVENT, user_id: userId, occurred_at: now.toISOString() });
      // The last visit from an earlier session (reloads within this session don't count).
      const sessionStart = inSession ? Date.parse(latest.occurred_at) : now.getTime();
      return visits.find((v) => sessionStart - Date.parse(v.occurred_at) >= VISIT_SESSION_MS)?.occurred_at ?? null;
    } catch (error) {
      this.log.warn("dashboard visit tracking failed", { error });
      return null;
    }
  }

  async overview(userId: string, lastVisitAt: string | null, now: Date = new Date()): Promise<Overview> {
    const [trackedChannels, researchThisWeek, credits] = await Promise.all([
      this.deps.channels.count({ tracked: true }),
      this.deps.usage.countForUserSince(userId, RESEARCH_EVENTS, new Date(now.getTime() - 7 * 86_400_000)),
      this.deps.credits.status(userId, now),
    ]);
    return { trackedChannels, researchThisWeek, credits, lastVisitAt };
  }

  async nichePulse(niches: readonly string[], lastVisitAt: string | null, now: Date = new Date()): Promise<NichePulse> {
    const scoped = niches.length > 0;
    const since = new Date(now.getTime() - 48 * 3_600_000);
    const [popular, fastScoped, picks, movers] = await Promise.all([
      this.deps.research.popularKeywords(8, now),
      this.deps.videos.fastMoving({ since, limit: 6, format: "short", titleTerms: scoped ? [...niches] : undefined }, now),
      this.deps.trending.currentPicks().catch(() => []),
      this.nicheMovers(niches),
    ]);
    // Niche keywords don't always appear in titles; fall back to everything so the section isn't empty.
    const fast = fastScoped.length >= 3 || !scoped ? fastScoped : await this.deps.videos.fastMoving({ since, limit: 6, format: "short" }, now);

    const byUuid = await this.channelsByUuid(fast.map((v) => v.channel_id));

    const mine = new Set(niches.map((n) => n.toLowerCase()));
    const topics = [
      ...niches.map((label) => ({ label, mine: true })),
      ...popular.filter((p) => !mine.has(p.toLowerCase())).map((label) => ({ label, mine: false })),
    ].slice(0, 12);

    return {
      topics,
      // Full rows only (the grid is 3 wide).
      fastShorts: (fast.length > 3 ? fast.slice(0, Math.floor(fast.length / 3) * 3) : fast).map((v) => ({ ...v, channel: byUuid.get(v.channel_id) ?? null })),
      movers: [...movers].sort((a, b) => Number(b.live_vph ?? b.recent_vph ?? 0) - Number(a.live_vph ?? a.recent_vph ?? 0)),
      picks: picks.slice(0, 3),
      newSinceLastVisit: lastVisitAt ? fast.filter((v) => Date.parse(v.published_at) > Date.parse(lastVisitAt)).length : 0,
      scoped: scoped && fast === fastScoped,
    };
  }

  async yourChannels(ownIdentifier: string | null, now: Date = new Date()): Promise<YourChannels> {
    const own = ownIdentifier ? splitIdentifiers([ownIdentifier]) : null;
    const [ownRows, tracked] = await Promise.all([
      own ? this.deps.channels.findByIdentifiers(own.ids, own.handles) : Promise.resolve([]),
      this.deps.channels.list({ limit: 24, tracked: true }),
    ]);
    const ownChannel = ownIdentifier ? (ownRows.find((c) => matches(c, ownIdentifier)) ?? null) : null;
    const ids = [...new Set([...(ownChannel ? [ownChannel.id] : []), ...tracked.map((c) => c.id)])];
    const growth = await this.growthFor(ids, now);

    let ownSummary: ChannelSummary | null = null;
    if (ownChannel) {
      const recent = await this.deps.videos.feed({ orderBy: "published_at", limit: 6, channelIds: [ownChannel.id] });
      const channelGrowthValue = growth.get(ownChannel.id) ?? empty();
      ownSummary = {
        channel: ownChannel,
        growth: channelGrowthValue,
        recent,
        alerts: channelAlerts({ growth: channelGrowthValue, videos: recent, lastUploadAt: recent[0]?.published_at ?? null }, now),
      };
    }

    const trackedWithGrowth = tracked
      .filter((c) => c.id !== ownChannel?.id)
      .map((c) => ({ ...c, growth: growth.get(c.id) ?? empty() }))
      .sort((a, b) => (b.growth.views24h ?? -1) - (a.growth.views24h ?? -1))
      .slice(0, 5);

    return { own: ownSummary, ownPending: ownIdentifier && !ownChannel ? ownIdentifier : null, tracked: trackedWithGrowth };
  }

  async competitorWatch(competitors: readonly string[], now: Date = new Date()): Promise<CompetitorWatch> {
    if (competitors.length === 0) return { configured: 0, found: [], missing: [], uploads: [], topPerformers: [] };
    const { ids, handles } = splitIdentifiers(competitors);
    const rows = await this.deps.channels.findByIdentifiers(ids, handles);
    const found = competitors.map((identifier) => rows.find((c) => matches(c, identifier))).filter((c): c is ChannelRow => Boolean(c));
    const unique = [...new Map(found.map((c) => [c.id, c])).values()];
    const missing = competitors.filter((identifier) => !rows.some((c) => matches(c, identifier)));
    const channelIds = unique.map((c) => c.id);

    const [growth, uploads, top] = await Promise.all([
      this.growthFor(channelIds, now),
      this.deps.videos.feed({ orderBy: "published_at", limit: 6, channelIds, publishedAfter: new Date(now.getTime() - 14 * 86_400_000) }),
      this.deps.videos.feed({ orderBy: "outlier_score", limit: 4, channelIds, publishedAfter: new Date(now.getTime() - 30 * 86_400_000) }),
    ]);
    return {
      configured: competitors.length,
      found: unique.map((c) => ({ ...c, growth: growth.get(c.id) ?? empty() })).sort((a, b) => (b.growth.subs7d ?? -Infinity) - (a.growth.subs7d ?? -Infinity)),
      missing,
      uploads,
      topPerformers: top.filter((v) => (v.outlier_score ?? 0) > 1),
    };
  }

  async recentActivity(userId: string, limit = 6): Promise<ActivityItem[]> {
    const events = await this.deps.usage.recentForUser(userId, limit * 2, RESEARCH_EVENTS);
    const seen = new Set<string>();
    return events
      .map(activityItem)
      .filter((item): item is ActivityItem => {
        if (!item) return false;
        const key = `${item.kind}:${item.label}:${item.href}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }

  private async nicheMovers(niches: readonly string[]): Promise<ShortsChannelRow[]> {
    const filters: Omit<ShortsChannelFilters, "channelIds"> = { orderBy: "recent_vph", limit: 5, targetMarket: { countries: this.deps.targetCountries } };
    if (niches.length === 0) return this.deps.channels.searchShortsChannels(filters);
    const channelIds = await this.deps.channels.findChannelIdsByKeywords([...niches], 300);
    if (channelIds.length === 0) return [];
    return this.deps.channels.searchShortsChannels({ ...filters, channelIds });
  }

  private async growthFor(channelIds: string[], now: Date): Promise<Map<string, ChannelGrowth>> {
    const snapshots = await this.deps.channels.snapshotsForChannels(channelIds, new Date(now.getTime() - 8 * 86_400_000));
    const grouped = new Map<string, typeof snapshots>();
    for (const s of snapshots) grouped.set(s.channel_id, [...(grouped.get(s.channel_id) ?? []), s]);
    return new Map(channelIds.map((id) => [id, channelGrowth(grouped.get(id) ?? [])]));
  }

  private async channelsByUuid(uuids: string[]): Promise<Map<string, Pick<ChannelRow, "title" | "youtube_channel_id" | "thumbnail_url" | "subscriber_count">>> {
    const rows = await this.deps.channels.findByIds([...new Set(uuids)]);
    return new Map(rows.map((r) => [r.id, r]));
  }}

function empty(): ChannelGrowth {
  return { subs24h: null, subs7d: null, views24h: null, views7d: null };
}
