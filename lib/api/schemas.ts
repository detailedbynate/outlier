import { z } from "zod";

/** Shared request schemas for API v1 routes. */

export const pageQuerySchema = z.object({
  maxResults: z.coerce.number().int().min(1).max(50).optional(),
  pageToken: z.string().max(200).optional(),
});

/** Channel id, @handle, or URL-encoded channel URL (Next.js decodes path params once). */
export const identifierParamsSchema = z.object({ identifier: z.string().min(1).max(500) });

export const idParamsSchema = z.object({ id: z.string().min(1).max(200) });

export const uuidParamsSchema = z.object({ id: z.uuid() });

export const booleanQuery = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1")
  .optional();
