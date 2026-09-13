import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/core/env";
import { ConfigError } from "@/lib/core/errors";

describe("parseEnv", () => {
  it("applies defaults and treats empty strings as unset", () => {
    const env = parseEnv({ YOUTUBE_API_KEY: "", NEXT_PUBLIC_SUPABASE_URL: "" });
    expect(env.YOUTUBE_API_KEY).toBeUndefined();
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
    expect(env.YOUTUBE_MAX_RETRIES).toBe(2);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("uses defaults for blank values of every type", () => {
    const env = parseEnv({ LOG_LEVEL: "", YOUTUBE_API_BASE_URL: "", STORAGE_BUDGET_MB: " ", JOB_WORKER_CONCURRENCY: "" });
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.YOUTUBE_API_BASE_URL).toBe("https://www.googleapis.com/youtube/v3");
    expect(env.STORAGE_BUDGET_MB).toBe(250);
    expect(env.JOB_WORKER_CONCURRENCY).toBe(2);
  });

  it("coerces numbers", () => {
    expect(parseEnv({ JOB_WORKER_CONCURRENCY: "8" }).JOB_WORKER_CONCURRENCY).toBe(8);
  });

  it("throws a ConfigError naming invalid variables", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_SUPABASE_URL: "not a url", LOG_LEVEL: "loud" })).toThrow(ConfigError);
    expect(() => parseEnv({ LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });
});
