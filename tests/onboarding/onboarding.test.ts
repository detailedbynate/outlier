import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/lib/core/logger";
import type { PreferencesRepository } from "@/lib/database/repositories/preferences";
import {
  addCompetitor,
  addNiche,
  EMPTY_DRAFT,
  progressFor,
  stepError,
  stepForField,
  toggleBothFormats,
  toggleValue,
  toSubmission,
} from "@/lib/onboarding/flow";
import { MAX_NICHES, onboardingSchema } from "@/lib/onboarding/schema";
import { OnboardingService } from "@/lib/services/onboarding-service";
import type { UserPreferencesRow } from "@/types/database";

const valid = {
  goals: ["grow_channel", "find_niches"],
  contentFormats: ["shorts"],
  niches: ["Gaming", "gaming", "AI"],
  hasChannel: true,
  channel: "  https://www.youtube.com/@mkbhd ",
  competitors: ["@veritasium", "@Veritasium"],
};

describe("onboardingSchema", () => {
  it("accepts valid answers and normalizes them", () => {
    const parsed = onboardingSchema.parse(valid);
    expect(parsed.niches).toEqual(["Gaming", "AI"]);
    expect(parsed.competitors).toEqual(["@veritasium"]);
    expect(parsed.channel).toBe("https://www.youtube.com/@mkbhd");
  });

  it("requires goals and content types", () => {
    expect(onboardingSchema.safeParse({ ...valid, goals: [] }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...valid, contentFormats: [] }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...valid, goals: ["hack"] }).success).toBe(false);
  });

  it("requires a valid channel only when the user has one", () => {
    const missing = onboardingSchema.safeParse({ ...valid, channel: "" });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]?.path).toEqual(["channel"]);
    expect(onboardingSchema.safeParse({ ...valid, channel: "not a channel!!" }).success).toBe(false);
    expect(onboardingSchema.parse({ ...valid, hasChannel: false, channel: "ignored" }).channel).toBeNull();
  });

  it("rejects invalid competitors and too many niches", () => {
    expect(onboardingSchema.safeParse({ ...valid, competitors: ["https://vimeo.com/someone"] }).success).toBe(false);
    const niches = Array.from({ length: MAX_NICHES + 1 }, (_, i) => `niche ${i}`);
    expect(onboardingSchema.safeParse({ ...valid, niches }).success).toBe(false);
  });
});

describe("onboarding flow logic", () => {
  it("blocks required steps until answered", () => {
    expect(stepError("goals", EMPTY_DRAFT)).toMatch(/at least one/);
    expect(stepError("goals", { ...EMPTY_DRAFT, goals: ["analyze_videos"] })).toBeNull();
    expect(stepError("formats", EMPTY_DRAFT)).not.toBeNull();
    expect(stepError("channel", EMPTY_DRAFT)).toMatch(/have a channel/);
    expect(stepError("channel", { ...EMPTY_DRAFT, hasChannel: true, channel: "" })).not.toBeNull();
    expect(stepError("channel", { ...EMPTY_DRAFT, hasChannel: true, channel: "@creator" })).toBeNull();
    expect(stepError("channel", { ...EMPTY_DRAFT, hasChannel: false })).toBeNull();
    expect(stepError("niches", EMPTY_DRAFT)).toBeNull();
  });

  it("tracks progress across question steps", () => {
    expect(progressFor("welcome")).toBe(0);
    expect(progressFor("goals")).toBeGreaterThan(0);
    expect(progressFor("competitors")).toBeLessThan(1);
    expect(progressFor("complete")).toBe(1);
  });

  it("toggles selections and the Both shortcut", () => {
    expect(toggleValue(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleBothFormats(["shorts"])).toEqual(["shorts", "long_form"]);
    expect(toggleBothFormats(["shorts", "long_form"])).toEqual([]);
  });

  it("adds niches and competitors with validation and de-duplication", () => {
    expect(addNiche(["Gaming"], "gaming")).toEqual({ ok: false, error: "Already added." });
    expect(addNiche([], "x")).toMatchObject({ ok: false });
    expect(addNiche(["Gaming"], "  AI ")).toEqual({ ok: true, values: ["Gaming", "AI"] });
    expect(addCompetitor([], "nope nope")).toMatchObject({ ok: false });
    expect(addCompetitor([], "youtube.com/@mrbeast")).toEqual({ ok: true, values: ["youtube.com/@mrbeast"] });
  });

  it("builds submissions and maps server fields back to steps", () => {
    const draft = { ...EMPTY_DRAFT, goals: ["grow_channel" as const], contentFormats: ["shorts" as const], hasChannel: false, channel: "@stale" };
    expect(toSubmission(draft)).toMatchObject({ hasChannel: false, channel: null });
    expect(stepForField("channel")).toBe("channel");
    expect(stepForField("contentFormats")).toBe("formats");
    expect(stepForField(undefined)).toBeNull();
  });
});

describe("OnboardingService", () => {
  function setup(existing: Partial<UserPreferencesRow> | null = null) {
    const repository = {
      findByUserId: vi.fn(async () => (existing ? ({ goals: [], content_formats: [], niches: [], competitors: [], ...existing } as UserPreferencesRow) : null)),
      upsert: vi.fn(async (row: Partial<UserPreferencesRow>) => row as UserPreferencesRow),
      reset: vi.fn(async () => {}),
    } as unknown as Pick<PreferencesRepository, "findByUserId" | "upsert" | "reset"> & {
      upsert: ReturnType<typeof vi.fn>;
      reset: ReturnType<typeof vi.fn>;
    };
    return { repository, service: new OnboardingService(repository, createLogger()) };
  }

  it("saves validated answers and stamps completion", async () => {
    const { service, repository } = setup();
    const now = new Date("2026-09-14T12:00:00Z");
    const saved = await service.complete("user-1", valid, now);
    expect(repository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", niches: ["Gaming", "AI"], onboarding_completed_at: now.toISOString() }),
    );
    expect(saved.onboardingCompletedAt).toBe(now.toISOString());
  });

  it("rejects invalid answers without saving", async () => {
    const { service, repository } = setup();
    await expect(service.complete("user-1", { ...valid, goals: [] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it("updates preferences while keeping the original completion time", async () => {
    const { service, repository } = setup({ onboarding_completed_at: "2026-09-01T00:00:00Z" });
    const saved = await service.updatePreferences("user-1", { ...valid, niches: ["Cooking"] }, new Date("2026-09-14T12:00:00Z"));
    expect(repository.upsert).toHaveBeenCalledWith(expect.objectContaining({ niches: ["Cooking"], onboarding_completed_at: "2026-09-01T00:00:00Z" }));
    expect(saved.onboardingCompletedAt).toBe("2026-09-01T00:00:00Z");
  });

  it("reports completion from the stored timestamp", async () => {
    expect(await setup(null).service.isCompleted("u")).toBe(false);
    expect(await setup({ onboarding_completed_at: null }).service.isCompleted("u")).toBe(false);
    expect(await setup({ onboarding_completed_at: "2026-09-14T00:00:00Z" }).service.isCompleted("u")).toBe(true);
  });
});
