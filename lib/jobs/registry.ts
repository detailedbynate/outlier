import { z } from "zod";
import { AppError, ValidationError } from "@/lib/core/errors";
import type { JobDefinition } from "./types";

const JOB_TYPE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export class JobRegistry {
  private readonly definitions = new Map<string, JobDefinition>();

  register(definition: JobDefinition): this {
    if (!JOB_TYPE_PATTERN.test(definition.type)) {
      throw new AppError("CONFIG_ERROR", `Invalid job type "${definition.type}" (expected e.g. "channel.sync")`);
    }
    if (this.definitions.has(definition.type)) {
      throw new AppError("CONFIG_ERROR", `Job type registered twice: ${definition.type}`);
    }
    this.definitions.set(definition.type, definition);
    return this;
  }

  get(type: string): JobDefinition | undefined {
    return this.definitions.get(type);
  }

  require(type: string): JobDefinition {
    const definition = this.get(type);
    if (!definition) throw new ValidationError(`Unknown job type: ${type}`);
    return definition;
  }

  types(): string[] {
    return [...this.definitions.keys()];
  }

  /** Validate a payload against the job's schema, throwing a ValidationError with field details. */
  parsePayload(type: string, payload: unknown): unknown {
    const result = this.require(type).payloadSchema.safeParse(payload);
    if (!result.success) throw new ValidationError(`Invalid payload for job ${type}`, z.treeifyError(result.error));
    return result.data;
  }
}
