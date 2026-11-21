import type { TextProvider } from "@/lib/ai/types";
import { buildChannelProfilePrompt, CHANNEL_PROFILE_SYSTEM, channelProfileSchema, cleanProfile, type ChannelProfile } from "@/lib/breakdowns/channel";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { ChannelRepository } from "@/lib/database/repositories/channels";
import type { ChannelTraitRepository } from "@/lib/database/repositories/traits";
import type { VideoRepository } from "@/lib/database/repositories/videos";

/** Faces don't come and go often: look again after this long. */
const RECHECK_DAYS = 60;
/** Thumbnails shown per channel: enough to see a pattern, few enough to stay cheap. */
const THUMBNAILS = 4;
/** Latest titles read for the profile. */
const TITLES = 12;

/** The Partner Program's Shorts bar: 1,000 subscribers and 10M Shorts views in 90 days. */
export const YPP_MIN_SUBSCRIBERS = 1_000;
export const YPP_SHORTS_VIEWS_90D = 10_000_000;

export function yppEligible(subscribers: number | null, shortsViews90d: number | undefined): boolean {
  return (subscribers ?? 0) >= YPP_MIN_SUBSCRIBERS && (shortsViews90d ?? 0) >= YPP_SHORTS_VIEWS_90D;
}

/**
 * Faceless or on camera, plus a profile filed under the shared vocabulary
 * (lib/breakdowns/taxonomy.ts): one-line summary, main style, presentation,
 * tone, audience and recurring series. One Claude Haiku call per channel from
 * four small thumbnails, the description and the latest titles, about $0.0003
 * a channel. Runs from the background budget, so it pauses when that's used up.
 */
export class ChannelTraitsService {
  private readonly log: Logger;

  constructor(
    private readonly deps: {
      vision: TextProvider | null;
      traits: ChannelTraitRepository;
      videos: Pick<VideoRepository, "latestShortsByChannel">;
      /** Titles and descriptions for the profile; without it Claude goes on thumbnails and Short titles alone. */
      channels?: Pick<ChannelRepository, "findByIds">;
    },
  ) {
    this.log = createLogger({ module: "services.traits" });
  }

  async classifyPending(options: { maxChannels: number; signal?: AbortSignal }, now: Date = new Date()): Promise<{ checked: number; faceless: number; skipped?: string }> {
    const vision = this.deps.vision;
    if (!vision) return { checked: 0, faceless: 0, skipped: "no ANTHROPIC_API_KEY" };
    const ids = await this.deps.traits.dueForFacelessCheck(options.maxChannels, new Date(now.getTime() - RECHECK_DAYS * 86_400_000));
    if (ids.length === 0) return { checked: 0, faceless: 0 };
    const [previews, channels] = await Promise.all([
      this.deps.videos.latestShortsByChannel(ids, TITLES),
      this.deps.channels ? this.deps.channels.findByIds(ids) : Promise.resolve([]),
    ]);
    const channelById = new Map(channels.map((c) => [c.id, c]));

    let checked = 0;
    let faceless = 0;
    for (const id of ids) {
      if (options.signal?.aborted) break;
      const shorts = previews.get(id) ?? [];
      const images = shorts.slice(0, THUMBNAILS).map((v) => `https://i.ytimg.com/vi/${v.youtube_video_id}/mqdefault.jpg`);
      const channel = channelById.get(id);
      let result: boolean | null = null;
      let profile: ChannelProfile | undefined;
      let model = "none";
      if (images.length >= 2) {
        try {
          const { object, model: used } = await vision.generateObject({
            system: CHANNEL_PROFILE_SYSTEM,
            messages: [
              {
                role: "user",
                content: buildChannelProfilePrompt(
                  {
                    title: channel?.title ?? "(unknown)",
                    description: channel?.description ?? null,
                    subscriberCount: channel?.subscriber_count ?? null,
                    shorts: shorts.map((v) => ({ title: v.title ?? "", views: v.view_count ?? null })),
                  },
                  images.length,
                ),
                images,
              },
            ],
            schema: channelProfileSchema,
            schemaName: "channel_profile",
            effort: "low",
            maxOutputTokens: 2_500,
            signal: options.signal,
          });
          profile = cleanProfile(object);
          result = object.verdict === "unsure" ? null : object.verdict === "faceless";
          model = used;
        } catch (error) {
          // Out of budget or a provider error: stop, and try again next hour.
          this.log.warn("channel profile stopped", { channelId: id, error });
          break;
        }
      }
      await this.deps.traits.saveFaceless([{ channelId: id, faceless: result, model, ...(profile ? { profile } : {}) }], now);
      checked += 1;
      if (result) faceless += 1;
    }
    this.log.info("faceless checked", { checked, faceless, due: ids.length });
    return { checked, faceless };
  }
}
