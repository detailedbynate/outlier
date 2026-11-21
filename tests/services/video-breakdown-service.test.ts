import { describe, expect, it, vi } from "vitest";
import { AiBudgetSpentError } from "@/lib/ai/budget";
import { buildVideoBreakdownPrompt, videoBreakdownSchema } from "@/lib/breakdowns/video";
import { HOOK_TYPES, termLabel, VIDEO_STYLES } from "@/lib/breakdowns/taxonomy";
import { AppError } from "@/lib/core/errors";
import { VideoBreakdownService } from "@/lib/services/video-breakdown-service";
import type { VideoFeedRow } from "@/types/database";

const NOW = new Date("2026-11-21T12:00:00Z");

function video(id: string, outlier: number, overrides: Partial<VideoFeedRow> = {}): VideoFeedRow {
  return {
    video_id: id,
    youtube_video_id: `yt-${id}`,
    title: `I survived 100 days in hardcore ${id}`,
    thumbnail_url: null,
    published_at: "2026-11-18T10:00:00Z",
    format: "short",
    duration_seconds: 42,
    view_count: 2_400_000,
    like_count: 90_000,
    comment_count: 1_200,
    channel_id: "c1",
    youtube_channel_id: "UC1",
    channel_title: "Blocky",
    channel_thumbnail_url: null,
    subscriber_count: 18_000,
    views_per_day: 600_000,
    engagement_rate: null,
    outlier_score: outlier,
    channel_median_views: 20_000,
    views_delta_24h: null,
    views_delta_7d: null,
    computed_at: null,
    promoted: false,
    viral_score: outlier,
    ...overrides,
  };
}

const ANSWER = {
  hook_type: "challenge",
  style: "gameplay",
  angle: "curiosity",
  topic: " Minecraft hardcore survival ",
  title_pattern: "I survived [N] days in [mode]",
  thumbnail_style: "skull icon over a dark cave",
  why_it_worked: "A clear stake in the title.",
  how_to_copy: "Pick a hard mode and count the days.",
  tags: ["Minecraft", "#hardcore", "minecraft", "survival"],
};

function setup(options: { week?: VideoFeedRow[]; month?: VideoFeedRow[]; done?: string[]; answers?: unknown[] } = {}) {
  const generateObject = vi.fn();
  for (const answer of options.answers ?? []) {
    if (answer instanceof Error) generateObject.mockRejectedValueOnce(answer);
    else generateObject.mockResolvedValueOnce({ object: answer, model: "claude-haiku-5-5", usage: { inputTokens: 1, outputTokens: 1 } });
  }
  const feed = vi.fn(async (query: { publishedAfter?: Date }) => {
    const days = Math.round((NOW.getTime() - (query.publishedAfter?.getTime() ?? 0)) / 86_400_000);
    return days === 7 ? (options.week ?? []) : (options.month ?? []);
  });
  const saved: unknown[] = [];
  const breakdowns = { existing: vi.fn(async () => new Set(options.done ?? [])), save: vi.fn(async (rows: unknown[]) => void saved.push(...rows)) };
  const service = new VideoBreakdownService({ ai: { name: "anthropic", generateText: vi.fn(), generateObject } as never, videos: { feed } as never, breakdowns });
  return { service, generateObject, saved, feed };
}

describe("VideoBreakdownService.breakdownPending", () => {
  it("explains this week's strongest outliers first, skips weak and done ones, and saves a tidy breakdown", async () => {
    const { service, generateObject, saved } = setup({
      week: [video("w1", 12), video("weak", 1.8)],
      month: [video("w1", 12), video("m1", 6), video("done", 9)],
      done: ["done"],
      answers: [ANSWER, ANSWER],
    });
    const result = await service.breakdownPending({ maxVideos: 5 }, NOW);

    expect(result).toEqual({ analyzed: 2, failed: 0 });
    const asked = generateObject.mock.calls.map((c) => (c as unknown as [{ messages: { images: string[] }[] }])[0].messages[0]!.images[0]);
    expect(asked).toEqual(["https://i.ytimg.com/vi/yt-w1/hqdefault.jpg", "https://i.ytimg.com/vi/yt-m1/hqdefault.jpg"]);
    expect(saved[0]).toMatchObject({ video_id: "w1", topic: "Minecraft hardcore survival", tags: ["minecraft", "hardcore", "survival"], model: "claude-haiku-5-5" });
  });

  it("moves past one unusable answer but stops for the hour when the budget is used up", async () => {
    const { service, generateObject } = setup({
      week: [video("a", 10), video("b", 9), video("c", 8), video("d", 7)],
      answers: [new AppError("UPSTREAM_ERROR", "video_breakdown: the model returned invalid JSON.", { retryable: true }), ANSWER, new AiBudgetSpentError(), ANSWER],
    });
    expect(await service.breakdownPending({ maxVideos: 10 }, NOW)).toEqual({ analyzed: 1, failed: 2 });
    expect(generateObject).toHaveBeenCalledTimes(3);
  });

  it("does nothing without Claude", async () => {
    const service = new VideoBreakdownService({ ai: null, videos: {} as never, breakdowns: {} as never });
    expect(await service.breakdownPending({ maxVideos: 10 }, NOW)).toMatchObject({ analyzed: 0, skipped: "no ANTHROPIC_API_KEY" });
  });
});

describe("breakdown vocabulary", () => {
  it("files an off-list answer under 'other' instead of failing the whole response", () => {
    const parsed = videoBreakdownSchema.parse({ ...ANSWER, hook_type: "jump_scare", style: "gameplay" });
    expect(parsed.hook_type).toBe("other");
    expect(parsed.style).toBe("gameplay");
  });

  it("labels stored keys, and keys from an older list still read sensibly", () => {
    expect(termLabel(VIDEO_STYLES, "gameplay")).toBe("Gameplay moment");
    expect(termLabel(HOOK_TYPES, "old_key")).toBe("old key");
    expect(termLabel(HOOK_TYPES, null)).toBeNull();
  });

  it("gives Claude the numbers that make it an outlier", () => {
    const prompt = buildVideoBreakdownPrompt(video("x", 12));
    expect(prompt).toContain("YouTube Short, 42s");
    expect(prompt).toContain("Views: 2.4M (12× the channel's usual), 600K a day");
    expect(prompt).toContain("Blocky (18K subscribers)");
  });
});
