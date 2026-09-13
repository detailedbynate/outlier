import type { z } from "zod";

/**
 * Transport-agnostic MCP tool definitions. Each tool is a thin adapter over a
 * service, mirroring an API v1 endpoint. A future MCP server (e.g. a
 * Streamable HTTP route at app/api/mcp using @modelcontextprotocol/sdk) only
 * needs to iterate these and convert Zod schemas to JSON Schema.
 */

export interface McpToolContext {
  workspaceId: string | null;
  userId: string | null;
}

export interface McpToolDefinition<TInput extends z.ZodType = z.ZodType> {
  name: string;
  title: string;
  description: string;
  inputSchema: TInput;
  /** Hints for MCP clients: read-only tools can be auto-approved. */
  annotations: { readOnlyHint: boolean; openWorldHint: boolean };
  handler: (input: z.infer<TInput>, context: McpToolContext) => Promise<unknown>;
}

export function defineTool<TInput extends z.ZodType>(tool: McpToolDefinition<TInput>): McpToolDefinition<TInput> {
  return tool;
}
