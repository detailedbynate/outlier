import { z } from "zod";
import { ValidationError } from "@/lib/core/errors";
import type { ChannelService } from "@/lib/services/channel-service";
import type { DiscoveryService } from "@/lib/services/discovery-service";
import type { VideoService } from "@/lib/services/video-service";
import { searchParamsSchema } from "@/lib/youtube/service";
import { defineTool, type McpToolContext, type McpToolDefinition } from "./types";

export interface McpDependencies {
  channels: ChannelService;
  videos: VideoService;
  discovery: DiscoveryService;
}

const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

export function createMcpTools(deps: McpDependencies): McpToolDefinition[] {
  return [
    defineTool({
      name: "youtube_get_channel",
      title: "Get YouTube channel",
      description: "Look up a YouTube channel by id, @handle, or URL. Returns metadata and statistics.",
      inputSchema: z.object({ identifier: z.string().min(1) }),
      annotations: readOnly,
      handler: ({ identifier }) => deps.channels.lookupChannel(identifier),
    }),
    defineTool({
      name: "youtube_list_channel_videos",
      title: "List channel videos",
      description: "List a channel's most recent uploads with statistics. Filter to Shorts or long-form.",
      inputSchema: z.object({
        channelId: z.string().min(1),
        filter: z.enum(["all", "shorts", "long_form"]).default("all"),
        maxResults: z.number().int().min(1).max(50).default(25),
        pageToken: z.string().optional(),
      }),
      annotations: readOnly,
      handler: ({ channelId, ...options }) => deps.channels.listChannelVideos(channelId, options),
    }),
    defineTool({
      name: "youtube_analyze_video",
      title: "Analyze YouTube video",
      description: "Get a video's metadata and performance metrics (views/day, engagement, outlier score vs. its channel).",
      inputSchema: z.object({ video: z.string().min(1).describe("Video id or URL") }),
      annotations: readOnly,
      handler: ({ video }) => deps.videos.analyzeVideo(video),
    }),
    defineTool({
      name: "youtube_search",
      title: "Search YouTube",
      description: "Search YouTube for videos, channels, or playlists. Costs 100 API quota units per call.",
      inputSchema: searchParamsSchema,
      annotations: readOnly,
      handler: (params) => deps.discovery.search(params),
    }),
  ];
}

/** Validate input and run a tool by name. Used by the future MCP transport and by tests. */
export async function callMcpTool(
  tools: readonly McpToolDefinition[],
  name: string,
  input: unknown,
  context: McpToolContext,
): Promise<unknown> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new ValidationError(`Unknown tool: ${name}`);
  const parsed = tool.inputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(`Invalid input for ${name}`, z.flattenError(parsed.error));
  return tool.handler(parsed.data, context);
}

/** JSON Schema for a tool's input, as MCP's tools/list requires. */
export function toolInputJsonSchema(tool: McpToolDefinition): unknown {
  return z.toJSONSchema(tool.inputSchema, { io: "input" });
}
