import { z } from "zod";
import type { TextProvider } from "@/lib/ai/types";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { ChannelTraitRepository } from "@/lib/database/repositories/traits";
import type { VideoRepository } from "@/lib/database/repositories/videos";

/** Faces don't come and go often: look again after this long. */
const RECHECK_DAYS = 60;
/** Thumbnails shown per channel: enough to see a pattern, few enough to stay cheap. */
const THUMBNAILS = 4;

/** The Partner Program's Shorts bar: 1,000 subscribers and 10M Shorts views in 90 days. */
export const YPP_MIN_SUBSCRIBERS = 1_000;
export const YPP_SHORTS_VIEWS_90D = 10_000_000;

export function yppEligible(subscribers: number | null, shortsViews90d: number | undefined): boolean {
  return (subscribers ?? 0) >= YPP_MIN_SUBSCRIBERS && (shortsViews90d ?? 0) >= YPP_SHORTS_VIEWS_90D;
}

const VERDICT = z.object({
  /** "faceless": no recurring creator on camera; "on_camera": a person who is clearly the creator shows up; "unsure": can't tell. */
  verdict: z.enum(["faceless", "on_camera", "unsure"]),
});

const SYSTEM = `You look at thumbnails from one YouTube Shorts channel and say whether it is a faceless channel.

- "on_camera": the same real person appears in several thumbnails as the presenter or subject — the creator shows their face.
- "faceless": no recurring person on camera. Gameplay, animation, text, stock footage, screenshots, AI images, hands only, or different strangers/celebrities each time.
- "unsure": too few usable thumbnails, or you genuinely can't tell.

Celebrities, movie scenes, streamers' clips and memes don't count as the creator. Answer with the verdict only.`;

/**
 * Faceless or on camera, judged by Claude Haiku from a few Shorts thumbnails
 * (small 320px frames, about $0.00005 a channel; 20 an hour is ~$0.70 a month). Runs from
 * the background budget, so it pauses when that's used up.
 */
export class ChannelTraitsService {
  private readonly log: Logger;

  constructor(
    private readonly deps: {
      vision: TextProvider | null;
      traits: ChannelTraitRepository;
      videos: Pick<VideoRepository, "latestShortsByChannel">;
    },
  ) {
    this.log = createLogger({ module: "services.traits" });
  }

  async classifyPending(options: { maxChannels: number; signal?: AbortSignal }, now: Date = new Date()): Promise<{ checked: number; faceless: number; skipped?: string }> {
    const vision = this.deps.vision;
    if (!vision) return { checked: 0, faceless: 0, skipped: "no ANTHROPIC_API_KEY" };
    const ids = await this.deps.traits.dueForFacelessCheck(options.maxChannels, new Date(now.getTime() - RECHECK_DAYS * 86_400_000));
    if (ids.length === 0) return { checked: 0, faceless: 0 };
    const previews = await this.deps.videos.latestShortsByChannel(ids, THUMBNAILS);

    let checked = 0;
    let faceless = 0;
    for (const id of ids) {
      if (options.signal?.aborted) break;
      const images = (previews.get(id) ?? []).map((v) => `https://i.ytimg.com/vi/${v.youtube_video_id}/mqdefault.jpg`);
      let result: boolean | null = null;
      let model = "none";
      if (images.length >= 2) {
        try {
          const { object, model: used } = await vision.generateObject({
            system: SYSTEM,
            messages: [{ role: "user", content: `${images.length} thumbnails from one channel. Faceless?`, images }],
            schema: VERDICT,
            schemaName: "faceless_verdict",
            effort: "low",
            maxOutputTokens: 600,
            signal: options.signal,
          });
          result = object.verdict === "unsure" ? null : object.verdict === "faceless";
          model = used;
        } catch (error) {
          // Out of budget or a provider error: stop, and try again next hour.
          this.log.warn("faceless check stopped", { channelId: id, error });
          break;
        }
      }
      await this.deps.traits.saveFaceless([{ channelId: id, faceless: result, model }], now);
      checked += 1;
      if (result) faceless += 1;
    }
    this.log.info("faceless checked", { checked, faceless, due: ids.length });
    return { checked, faceless };
  }
}
