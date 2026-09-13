import type { z } from "zod";
import type { Logger } from "@/lib/core/logger";
import type { Json, JobRow } from "@/types/database";

export interface JobContext {
  job: JobRow;
  attempt: number;
  logger: Logger;
  /** Aborted when the worker is shutting down; long handlers should check it. */
  signal: AbortSignal;
}

export interface JobDefinition<TSchema extends z.ZodType = z.ZodType> {
  /** Dotted, lowercase identifier stored in jobs.type, e.g. "channel.sync". */
  type: string;
  description: string;
  payloadSchema: TSchema;
  maxAttempts?: number;
  /** Returned JSON is stored in job_results. Return undefined to store nothing. */
  handler: (payload: z.infer<TSchema>, context: JobContext) => Promise<Json | undefined>;
}

export function defineJob<TSchema extends z.ZodType>(definition: JobDefinition<TSchema>): JobDefinition<TSchema> {
  return definition;
}
