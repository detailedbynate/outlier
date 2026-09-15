import {
  ALERT_KINDS,
  channelProfile,
  compareToCompetitors,
  competitorAlerts,
  competitorBreakouts,
  dailySeries,
  findOpportunities,
  scoreVideos,
  sortProfiles,
  weeklyUploads,
  whatsWorking,
  type AlertKind,
  type ChannelProfile,
  type IntelChannel,
  type SortKey,
} from "@/lib/competitors/intel";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { ChannelRepository } from "@/lib/database/repositories/channels";
import type { CompetitorRepository } from "@/lib/database/repositories/competitors";
import { parseChannelIdentifier } from "@/lib/youtube/parse";
import type { ChannelRow } from "@/types/database";
import { FRESH_MS, type CompareService } from "./compare-service";

/**
 * Competitor intelligence. Reading is database-only: channels, snapshots,
 * videos, and performance that scheduled jobs keep fresh. YouTube is only
 * called from `sync`, for channels that are missing or stale, through the
 * existing CompareService path (quota-gated, cached, user lane).
 */

const HISTORY_DAYS = 35;
const VIDEO_DAYS = 90;
/** `sync` skips channels synced more recently than this (same window CompareService uses, so skips and refreshes agree). */
const SYNC_STALE_MS = FRESH_MS;
/** Competitors get warm monitoring (channel stats every few hours; recent uploads checked by priority). */
const COMPETITOR_MONITOR_PRIORITY = 2;

export interface CompetitorWorkspace {
  you: ChannelProfile | null;
  youPending: string | null;
  competitors: ChannelProfile[];
  missing: string[];
  comparison: ReturnType<typeof compareToCompetitors> | null;
  breakouts: ReturnType<typeof competitorBreakouts>;
  working: ReturnType<typeof whatsWorking>;
  opportunities: ReturnType<typeof findOpportunities>;
  alerts: ReturnType<typeof competitorAlerts>;
  enabledAlerts: AlertKind[];
  latestUploads: (ChannelProfile["videos"][number] & { channel: IntelChannel })[];
}

export interface CompetitorDetail {
  profile: ChannelProfile;
  topVideos: ChannelProfile["videos"];
  weekly: ReturnType<typeof weeklyUploads>;
  subscribers: ReturnType<typeof dailySeries>;
  views: ReturnType<typeof dailySeries>;
  working: ReturnType<typeof whatsWorking>;
}

function matches(channel: Pick<ChannelRow, "youtube_channel_id" | "handle">, identifier: string): boolean {
  try {
    const parsed = parseChannelIdentifier(identifier);
    return parsed.type === "id" ? channel.youtube_channel_id === parsed.value : channel.handle?.toLowerCase() === parsed.value.toLowerCase();
  } catch {
    return false;
  }
}

export class CompetitorService {
  private readonly log: Logger;

  constructor(
    private readonly deps: {
      channels: Pick<ChannelRepository, "findByIdentifiers" | "snapshotsForChannels" | "findByYouTubeId" | "raiseMonitorPriority">;
      competitors: Pick<CompetitorRepository, "videosForChannels" | "topVideos" | "alertSettings" | "saveAlertSettings">;
      compare: Pick<CompareService, "compare">;
    },
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ module: "services.competitors" });
  }

  /** Everything the competitor page shows, from stored data only. */
  async workspace(input: { you: string | null; competitors: readonly string[]; userId: string; sort?: SortKey; now?: Date }): Promise<CompetitorWorkspace> {
    const now = input.now ?? new Date();
    const identifiers = [...new Set(input.competitors.map((c) => c.trim()).filter(Boolean))];
    const all = [...identifiers, ...(input.you ? [input.you] : [])];
    const rows = await this.resolve(all);

    const youRow = input.you ? (rows.find((r) => matches(r, input.you!)) ?? null) : null;
    const competitorRows = [...new Map(identifiers.map((id) => rows.find((r) => matches(r, id))).filter((r): r is ChannelRow => Boolean(r) && r!.id !== youRow?.id).map((r) => [r.id, r])).values()];
    const missing = identifiers.filter((id) => !rows.some((r) => matches(r, id)));
    const channelIds = [...competitorRows.map((r) => r.id), ...(youRow ? [youRow.id] : [])];

    const [snapshots, videos, alertSetting] = await Promise.all([
      this.deps.channels.snapshotsForChannels(channelIds, new Date(now.getTime() - HISTORY_DAYS * 86_400_000)),
      this.deps.competitors.videosForChannels(channelIds, new Date(now.getTime() - VIDEO_DAYS * 86_400_000)),
      this.deps.competitors.alertSettings(input.userId).catch(() => null),
    ]);

    const profiles = competitorRows.map((r) => channelProfile(r, videos, snapshots, now));
    const you = youRow ? channelProfile(youRow, videos, snapshots, now) : null;
    const enabledAlerts = (alertSetting ?? [...ALERT_KINDS]).filter((k): k is AlertKind => (ALERT_KINDS as readonly string[]).includes(k));

    return {
      you,
      youPending: input.you && !youRow ? input.you : null,
      competitors: sortProfiles(profiles, input.sort ?? "growth"),
      missing,
      comparison: you && profiles.length ? compareToCompetitors(you, profiles) : null,
      breakouts: competitorBreakouts(profiles, now),
      working: whatsWorking(profiles, now),
      opportunities: findOpportunities(you, profiles, now),
      alerts: competitorAlerts(profiles, new Set(enabledAlerts), now).slice(0, 20),
      enabledAlerts,
      latestUploads: profiles
        .flatMap((p) => p.videos.slice(0, 6).map((v) => ({ ...v, channel: p.channel })))
        .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
        .slice(0, 12),
    };
  }

  /**
   * User-triggered: bring missing or stale channels in from YouTube (quota-gated
   * via CompareService) and give competitors warm monitoring so scheduled jobs
   * keep them fresh. Fresh channels cost nothing.
   */
  async sync(input: { you: string | null; competitors: readonly string[]; now?: Date }): Promise<{ synced: number; skipped: number; failures: { identifier: string; error: string }[] }> {
    const now = input.now ?? new Date();
    const all = [...new Set([...(input.you ? [input.you] : []), ...input.competitors].map((c) => c.trim()).filter(Boolean))];
    const rows = await this.resolve(all);
    const needs = all.filter((id) => {
      const row = rows.find((r) => matches(r, id));
      return !row || !row.last_synced_at || now.getTime() - Date.parse(row.last_synced_at) > SYNC_STALE_MS;
    });

    let failures: { identifier: string; error: string }[] = [];
    let synced: ChannelRow[] = [];
    if (needs.length > 0) {
      const youNeeds = input.you && needs.includes(input.you.trim()) ? input.you.trim() : null;
      const result = await this.deps.compare.compare(youNeeds, needs.filter((n) => n !== youNeeds), now);
      failures = result.failures;
      synced = [...(result.you ? [result.you.channel] : []), ...result.competitors.map((c) => c.channel)];
    }

    const ids = [...new Set([...rows.map((r) => r.id), ...synced.map((r) => r.id)])];
    await this.deps.channels.raiseMonitorPriority(ids, COMPETITOR_MONITOR_PRIORITY, now).catch((error: unknown) => this.log.warn("monitor priority update failed", { error }));
    this.log.info("competitors synced", { requested: all.length, synced: synced.length, skipped: all.length - needs.length, failures: failures.length });
    return { synced: synced.length, skipped: all.length - needs.length, failures };
  }

  /** Detailed profile for one stored channel (database only). */
  async detail(youtubeChannelId: string, now: Date = new Date()): Promise<CompetitorDetail | null> {
    const channel = await this.deps.channels.findByYouTubeId(youtubeChannelId);
    if (!channel) return null;
    const [snapshots, videos, top] = await Promise.all([
      this.deps.channels.snapshotsForChannels([channel.id], new Date(now.getTime() - HISTORY_DAYS * 86_400_000)),
      this.deps.competitors.videosForChannels([channel.id], new Date(now.getTime() - VIDEO_DAYS * 86_400_000)),
      this.deps.competitors.topVideos(channel.id, 10),
    ]);
    const profile = channelProfile(channel, videos, snapshots, now);
    // Top videos use the recent-sample median so multipliers are comparable.
    const scoredTop = scoreVideos([...videos, ...top.filter((t) => !videos.some((v) => v.id === t.id))], now).filter((v) => top.some((t) => t.id === v.id));
    return {
      profile,
      topVideos: scoredTop.sort((a, b) => b.view_count - a.view_count),
      weekly: weeklyUploads(videos, 8, now),
      subscribers: dailySeries(snapshots, "subscriber_count", 30, now),
      views: dailySeries(snapshots, "view_count", 30, now),
      working: whatsWorking([profile], now, 90),
    };
  }

  async setAlerts(userId: string, kinds: readonly string[]): Promise<AlertKind[]> {
    const valid = [...new Set(kinds)].filter((k): k is AlertKind => (ALERT_KINDS as readonly string[]).includes(k));
    await this.deps.competitors.saveAlertSettings(userId, valid);
    return valid;
  }

  private async resolve(identifiers: readonly string[]): Promise<ChannelRow[]> {
    const ids: string[] = [];
    const handles: string[] = [];
    for (const value of identifiers) {
      try {
        const parsed = parseChannelIdentifier(value);
        if (parsed.type === "id") ids.push(parsed.value);
        else if (parsed.type === "handle") handles.push(parsed.value);
      } catch {
        // Unparseable identifiers are reported as missing.
      }
    }
    return this.deps.channels.findByIdentifiers(ids, handles);
  }
}
