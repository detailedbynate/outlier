import { z } from "zod";
import { isAppError } from "@/lib/core/errors";
import type { ShortsChannelFilters } from "@/lib/database/repositories/channels";
import type { VideoRepository } from "@/lib/database/repositories/videos";
import type { ResearchService, ShortsChannelWithPreviews } from "@/lib/services/research-service";
import { matchPercent } from "@/lib/services/similar-channels-service";
import type { VideoFeedRow } from "@/types/database";

/**
 * The Outlier MCP server: Streamable HTTP, stateless, JSON responses (no
 * streaming). Every tool reads the Outlier library only, so a call never spends
 * YouTube quota or AI budget; the route rate-limits per token.
 *
 * https://modelcontextprotocol.io/specification — initialize, ping,
 * tools/list and tools/call are all a tools-only server needs.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const SERVER_INFO = { name: "outlier", title: "Outlier", version: "1.0.0" };

const INSTRUCTIONS = `Outlier is a YouTube Shorts research library: channels with their stats, recent Shorts, niche labels, faceless and YPP badges, and similar-channel matching.
Use search_shorts_channels to find channels in a niche, find_similar_channels with an @handle or channel link to find look-alikes, whats_working_for_peers for Shorts beating their channel's usual views on similar channels, viral_shorts for outliers across the library, and removed_channels for channels YouTube took down.
Numbers come from Outlier's last refresh, not live YouTube.`;

export interface McpDeps {
  research: Pick<ResearchService, "browseShortsChannels" | "similarShortsChannels" | "findChannelByReference" | "peerBreakouts">;
  videos: Pick<VideoRepository, "feed">;
  /** OUTLIER_COUNTRIES, for the English-markets filter. */
  targetCountries: readonly string[];
  siteUrl: string;
}

type JsonRpcId = string | number | null;
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

const SORTS = {
  underrated: "underrated_score",
  avg_views: "avg_short_views",
  subscribers: "subscriber_count",
  newest_channels: "channel_created_at",
  latest_upload: "last_short_at",
  views_24h: "views_24h",
  outlier_multiplier: "top_multiplier",
} as const satisfies Record<string, ShortsChannelFilters["orderBy"]>;

const channelRef = z.string().min(2).max(300).describe("An @handle, a youtube.com channel link, or a UC… channel id.");
const limit = (max: number, fallback: number) => z.number().int().min(1).max(max).default(fallback).describe(`How many to return (max ${max}).`);
const faceless = z.boolean().optional().describe("true: only faceless channels; false: only creators on camera. Leave out for both.");
const language = z.enum(["english", "any"]).default("english").describe("english: English-language channels in the main English markets (default).");

const TOOLS = {
  search_shorts_channels: {
    title: "Search Shorts channels",
    description: "Find YouTube Shorts channels in the Outlier library by niche keywords and size. Returns stats, niche, faceless and YPP badges, and a link to each channel in Outlier.",
    input: z.object({
      query: z.string().max(150).default("").describe('Niche keywords, e.g. "minecraft", "skincare, makeup". Comma-separate to search several. Empty lists everything.'),
      min_subscribers: z.number().int().min(0).optional(),
      max_subscribers: z.number().int().min(0).optional(),
      min_avg_views: z.number().int().min(0).optional().describe("Minimum average views per Short."),
      faceless,
      language,
      sort: z.enum(Object.keys(SORTS) as [keyof typeof SORTS, ...(keyof typeof SORTS)[]]).default("underrated").describe("underrated: big views for their size (default)."),
      limit: limit(50, 20),
    }),
  },
  find_similar_channels: {
    title: "Find similar channels",
    description: "Channels most like a given channel (by what they post: upload titles, topics, niche), best match first, with a match percentage.",
    input: z.object({ channel: channelRef, faceless, language, limit: limit(50, 20) }),
  },
  whats_working_for_peers: {
    title: "What's working for similar channels",
    description: "Shorts from the last 30 days beating their channel's usual views, on the channels most similar to the given one. Use it to decide what to make next.",
    input: z.object({ channel: channelRef, limit: limit(30, 15) }),
  },
  viral_shorts: {
    title: "Viral Shorts",
    description: "Shorts across the library ranked by how far they beat their channel's usual views (outlier score).",
    input: z.object({
      days: z.union([z.literal(1), z.literal(7), z.literal(30)]).default(7).describe("Published within this many days."),
      limit: limit(50, 20),
    }),
  },
  removed_channels: {
    title: "Removed channels",
    description: "Channels YouTube deleted or terminated, with the stats they had before they went. Newest removals first.",
    input: z.object({ query: z.string().max(150).default("").describe("Optional niche keywords."), limit: limit(50, 20) }),
  },
} as const;

type ToolName = keyof typeof TOOLS;

export function toolList() {
  return Object.entries(TOOLS).map(([name, tool]) => ({
    name,
    title: tool.title,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.input, { io: "input" }),
    annotations: { title: tool.title, readOnlyHint: true, openWorldHint: false },
  }));
}

function channelOut(row: ShortsChannelWithPreviews, siteUrl: string) {
  return {
    title: row.title,
    handle: row.handle,
    youtube_url: `https://www.youtube.com/channel/${row.youtube_channel_id}`,
    outlier_url: `${siteUrl}/channels/${row.youtube_channel_id}`,
    subscribers: row.subscriber_count,
    avg_short_views: row.avg_short_views,
    median_short_views: row.median_short_views,
    shorts_per_week: row.shorts_per_week,
    last_short_at: row.last_short_at,
    country: row.country,
    niche: [row.niche_category, ...(row.niche_labels ?? [])].filter(Boolean).join(", ") || null,
    ...(row.faceless !== undefined ? { faceless: row.faceless } : {}),
    ...(row.ypp !== undefined ? { ypp_eligible: row.ypp } : {}),
    ...(row.similarity !== undefined ? { match_percent: matchPercent(row.similarity) } : {}),
    recent_shorts: row.recentShorts.slice(0, 3).map((v) => ({ title: v.title, views: v.view_count, url: `https://www.youtube.com/shorts/${v.youtube_video_id}` })),
  };
}

function videoOut(row: VideoFeedRow) {
  return {
    title: row.title,
    url: `https://www.youtube.com/shorts/${row.youtube_video_id}`,
    channel: row.channel_title,
    channel_subscribers: row.subscriber_count,
    views: row.view_count,
    outlier_score: row.outlier_score,
    channel_median_views: row.channel_median_views,
    published_at: row.published_at,
  };
}

class ToolError extends Error {}

async function callTool(name: ToolName, args: unknown, deps: McpDeps): Promise<unknown> {
  const parsed = TOOLS[name].input.safeParse(args ?? {});
  // Checked here so a bad call reads as a tool error; each case below parses its own shape again.
  if (!parsed.success) throw new ToolError(`Invalid arguments: ${z.prettifyError(parsed.error)}`);
  const market = (lang: string) => (lang === "english" ? { targetMarket: { countries: deps.targetCountries } } : {});

  const resolve = async (reference: string) => {
    const channel = await deps.research.findChannelByReference(reference);
    if (!channel) throw new ToolError(`${reference} isn't in the Outlier library. Add it in Outlier (Shorts Channels → paste the link) and try again.`);
    return channel;
  };

  switch (name) {
    case "search_shorts_channels": {
      const i = TOOLS.search_shorts_channels.input.parse(args ?? {});
      const { channels, terms } = await deps.research.browseShortsChannels(
        i.query,
        { minSubscribers: i.min_subscribers, maxSubscribers: i.max_subscribers, minAvgViews: i.min_avg_views, faceless: i.faceless, ...market(i.language), orderBy: SORTS[i.sort], limit: i.limit },
        3,
      );
      return { matched_terms: terms, channels: channels.map((c) => channelOut(c, deps.siteUrl)) };
    }
    case "find_similar_channels": {
      const i = TOOLS.find_similar_channels.input.parse(args ?? {});
      const target = await resolve(i.channel);
      const channels = await deps.research.similarShortsChannels(target.id, { faceless: i.faceless, ...market(i.language), orderBy: "subscriber_count", limit: i.limit }, 3);
      return { similar_to: target.title, channels: channels.map((c) => channelOut(c, deps.siteUrl)) };
    }
    case "whats_working_for_peers": {
      const i = TOOLS.whats_working_for_peers.input.parse(args ?? {});
      const target = await resolve(i.channel);
      const videos = await deps.research.peerBreakouts(target.id, i.limit);
      return { channel: target.title, breakouts: videos.map(videoOut) };
    }
    case "viral_shorts": {
      const i = TOOLS.viral_shorts.input.parse(args ?? {});
      const videos = await deps.videos.feed({ orderBy: "outlier_score", format: "short", publishedAfter: new Date(Date.now() - i.days * 86_400_000), limit: i.limit });
      return { days: i.days, shorts: videos.map(videoOut) };
    }
    case "removed_channels": {
      const i = TOOLS.removed_channels.input.parse(args ?? {});
      const { channels } = await deps.research.browseShortsChannels(i.query, { removed: "only", excludeLowQuality: false, orderBy: "last_synced_at", limit: i.limit }, 3);
      return { channels: channels.map((c) => ({ ...channelOut(c, deps.siteUrl), removed_around: c.last_synced_at })) };
    }
  }
}

const result = (id: JsonRpcId, value: unknown) => ({ jsonrpc: "2.0" as const, id, result: value });
const failure = (id: JsonRpcId, code: number, message: string) => ({ jsonrpc: "2.0" as const, id, error: { code, message } });

/** One JSON-RPC message in, its response out (null for notifications). */
export async function handleMcpMessage(message: unknown, deps: McpDeps): Promise<object | null> {
  if (!message || typeof message !== "object" || (message as JsonRpcRequest).jsonrpc !== "2.0" || typeof (message as JsonRpcRequest).method !== "string") {
    return failure(null, -32600, "Invalid Request");
  }
  const { id, method, params } = message as JsonRpcRequest;
  // Notifications (no id) get no response.
  if (id === undefined) return null;

  switch (method) {
    case "initialize": {
      const requested = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
      return result(id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, { tools: toolList() });
    case "tools/call": {
      const name = params?.name;
      if (typeof name !== "string" || !(name in TOOLS)) return failure(id, -32602, `Unknown tool: ${String(name)}`);
      try {
        const output = await callTool(name as ToolName, params?.arguments, deps);
        return result(id, { content: [{ type: "text", text: JSON.stringify(output, null, 1) }], structuredContent: output, isError: false });
      } catch (error) {
        // Tool failures go back to the model as results it can read and react to.
        const text = error instanceof ToolError || (isAppError(error) && error.expose) ? (error as Error).message : "Outlier couldn't run that just now. Try again shortly.";
        return result(id, { content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return failure(id, -32601, `Method not found: ${method}`);
  }
}
