import { Innertube, Log, type YT } from "youtubei.js";
import { NotFoundError } from "@/lib/core/errors";
import { parseChannelKeywords } from "@/lib/youtube/parse";
import { currentQuotaContext } from "@/lib/youtube/quota-context";
import type { YouTubeChannel } from "@/types/youtube";
import type { InnerTubeGate } from "./gate";

type YTChannel = YT.Channel;

/**
 * Reads public channel pages through YouTube's own web API (InnerTube) instead
 * of the Data API, so it costs no quota. Every request waits its turn behind a
 * fixed gap, which keeps the scraper slow and polite on purpose.
 *
 * Listing pages only show rounded view counts, so this returns video ids and
 * formats; exact video stats still come from the Data API in one cheap batch.
 */

export interface InnerTubeSourceOptions {
  /** Uploads to read per channel (the first page of each tab holds about 30). */
  maxVideos: number;
  /** How long a user-lane read waits for a slot before giving up (the caller then uses the API). */
  userMaxWaitMs?: number;
}

export interface ChannelUploads {
  /** Newest first, Shorts and long-form merged. */
  ids: string[];
  shortIds: Set<string>;
  longFormIds: Set<string>;
}

/** "1,003 videos" / "140,334,066,914 views" → number. Rounded forms ("517M") → approximate number. */
export function parseCountText(text: string | undefined | null): number | null {
  if (!text) return null;
  const match = /([\d.,]+)\s*([KMB])?/i.exec(text.replace(/ /g, " "));
  if (!match) return null;
  const suffix = match[2]?.toUpperCase();
  const base = Number(match[1]!.replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const scale = suffix === "K" ? 1e3 : suffix === "M" ? 1e6 : suffix === "B" ? 1e9 : 1;
  return Math.round(base * scale);
}

/** "Joined Feb 19, 2012" → ISO date. */
function parseJoined(text: string | undefined): string | null {
  const date = text ? Date.parse(text.replace(/^Joined\s+/i, "")) : NaN;
  return Number.isFinite(date) ? new Date(date).toISOString() : null;
}

const text = (value: unknown): string | undefined => (value == null ? undefined : String(value));

export class InnerTubeSource {
  private client: Promise<Innertube> | null = null;

  constructor(
    private readonly gate: InnerTubeGate,
    private readonly options: InnerTubeSourceOptions,
  ) {
    Log.setLevel(Log.Level.NONE);
  }

  /**
   * User-triggered work goes in the interactive lane and gives up quickly; jobs
   * and the scraper take the background lane. The quota context already says
   * which is which, so callers don't have to pass it.
   */
  private laneOptions(): { lane: "user" | "background"; maxWaitMs?: number } {
    return currentQuotaContext().lane === "user"
      ? { lane: "user", maxWaitMs: this.options.userMaxWaitMs }
      : { lane: "background" };
  }

  private async yt(): Promise<Innertube> {
    this.client ??= Innertube.create({ retrieve_player: false, generate_session_locally: true, lang: "en", location: "US" });
    return this.client;
  }

  /**
   * The channel page, through the shared gate. The gate's cache is what makes
   * reading channel info and uploads cost one page load, not two.
   */
  private channelPage(channelId: string): Promise<YTChannel> {
    return this.gate.run({ label: `channel:${channelId}`, cacheKey: `channel:${channelId}`, ...this.laneOptions() }, async () => {
      const yt = await this.yt();
      const channel = await yt.getChannel(channelId).catch((error: unknown) => {
        if (error instanceof Error && /does ?n[o']t exist|not found|unavailable|404/i.test(error.message)) throw new NotFoundError("YouTube channel", channelId);
        throw error;
      });
      // A page without the channel's own id is a consent wall or a blocked response, not a real channel.
      if (channel.metadata.external_id !== channelId) throw this.gate.trip(`channel page for ${channelId} came back empty`);
      return channel;
    });
  }

  async getChannel(channelId: string): Promise<YouTubeChannel> {
    const channel = await this.channelPage(channelId);
    const meta = channel.metadata;

    const about = channel.has_about
      ? await this.gate.run({ label: `about:${channelId}`, cacheKey: `about:${channelId}`, ...this.laneOptions() }, () => channel.getAbout())
      : null;
    const details = (about && "metadata" in about ? about.metadata : about) as Record<string, unknown> | null;
    const header = channel.header as { content?: { banner?: { image?: { url: string }[] } } } | undefined;
    const vanity = text(meta.vanity_channel_url);
    const handle = vanity?.match(/\/(@[^/?#]+)/)?.[1] ?? null;
    const subscriberText = text(details?.subscriber_count);

    return {
      id: channelId,
      handle,
      title: text(meta.title) ?? "",
      description: text(details?.description) ?? text(meta.description) ?? "",
      customUrl: handle,
      // The about page gives a country name; the API gives a code. Leave it to the API rather than guess.
      country: null,
      defaultLanguage: null,
      publishedAt: parseJoined(text((details?.joined_date as { text?: string } | undefined)?.text)),
      thumbnailUrl: meta.avatar?.[0]?.url ?? meta.thumbnail?.[0]?.url ?? null,
      bannerUrl: header?.content?.banner?.image?.[0]?.url ?? null,
      uploadsPlaylistId: `UU${channelId.slice(2)}`,
      madeForKids: meta.is_family_safe === false ? false : null,
      topicCategories: [],
      // InnerTube gives the raw keywords string, same as the API's brandingSettings.
      keywords: parseChannelKeywords(Array.isArray(meta.keywords) ? meta.keywords.join(" ") : text(meta.keywords)),
      statistics: {
        subscriberCount: parseCountText(subscriberText),
        viewCount: parseCountText(text(details?.view_count)) ?? 0,
        videoCount: parseCountText(text(details?.video_count)) ?? 0,
        hiddenSubscriberCount: !subscriberText,
      },
    };
  }

  /** Latest uploads from the Videos and Shorts tabs. The tab tells us the format, which the API can't. */
  async getUploads(channelId: string): Promise<ChannelUploads> {
    const channel = await this.channelPage(channelId);
    const idsOf = (items: readonly unknown[]) =>
      items
        .map((item) => {
          const node = item as { content_id?: string; id?: string; video_id?: string; on_tap_endpoint?: { payload?: { videoId?: string } } };
          return node.content_id ?? node.video_id ?? node.on_tap_endpoint?.payload?.videoId ?? node.id;
        })
        .filter((id): id is string => typeof id === "string" && /^[\w-]{11}$/.test(id));

    const longForm = channel.has_videos
      ? idsOf((await this.gate.run({ label: `videos:${channelId}`, cacheKey: `videos:${channelId}`, ...this.laneOptions() }, () => channel.getVideos())).videos)
      : [];
    const shorts = channel.has_shorts
      ? idsOf((await this.gate.run({ label: `shorts:${channelId}`, cacheKey: `shorts:${channelId}`, ...this.laneOptions() }, () => channel.getShorts())).videos)
      : [];

    // Interleave so both formats make the cut; the API batch sorts out dates.
    const ids: string[] = [];
    for (let i = 0; ids.length < this.options.maxVideos && (i < longForm.length || i < shorts.length); i += 1) {
      if (longForm[i]) ids.push(longForm[i]!);
      if (shorts[i] && ids.length < this.options.maxVideos) ids.push(shorts[i]!);
    }
    return { ids, shortIds: new Set(shorts), longFormIds: new Set(longForm) };
  }
}
