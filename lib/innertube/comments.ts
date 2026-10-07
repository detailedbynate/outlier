import { Innertube, Log } from "youtubei.js";
import type { InnerTubeGate } from "./gate";
import { parseCountText } from "./source";

/**
 * A video's top comments, from the web comments panel: one request for the
 * first page of about 20. The Data API's commentThreads.list costs a unit per
 * call too, but this keeps the radar off the quota entirely.
 */

export interface VideoComment {
  id: string;
  videoId: string;
  text: string;
  likes: number;
}

export class InnerTubeComments {
  private client: Promise<Innertube> | null = null;

  constructor(private readonly gate: InnerTubeGate) {
    Log.setLevel(Log.Level.NONE);
  }

  private yt(): Promise<Innertube> {
    this.client ??= Innertube.create({ retrieve_player: false, generate_session_locally: true, lang: "en", location: "US" });
    return this.client;
  }

  async top(videoId: string, options: { lane?: "user" | "background" } = {}): Promise<VideoComment[]> {
    return this.gate.run({ label: `comments:${videoId}`, cacheKey: `comments:${videoId}`, lane: options.lane ?? "background" }, async () => {
      const yt = await this.yt();
      try {
        const page = await yt.getComments(videoId, "TOP_COMMENTS");
        return page.contents.flatMap((thread) => {
          const c = thread.comment;
          const text = c?.content?.toString().trim();
          return c && text ? [{ id: c.comment_id, videoId, text: text.slice(0, 500), likes: parseCountText(c.like_count) ?? 0 }] : [];
        });
      } catch (error) {
        // Comments turned off is an answer, not a failure worth a retry or a breaker trip.
        if (error instanceof Error && /did not have any content|comments are turned off/i.test(error.message)) return [];
        throw error;
      }
    });
  }
}
