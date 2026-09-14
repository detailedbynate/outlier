import { z } from "zod";
import { ValidationError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { PreferencesRepository } from "@/lib/database/repositories/preferences";
import { onboardingSchema, type OnboardingAnswers } from "@/lib/onboarding/schema";
import type { UserPreferencesRow } from "@/types/database";

export interface UserPreferences {
  goals: string[];
  contentFormats: string[];
  niches: string[];
  hasChannel: boolean | null;
  channel: string | null;
  competitors: string[];
  onboardingCompletedAt: string | null;
}

function toPreferences(row: UserPreferencesRow): UserPreferences {
  return {
    goals: row.goals,
    contentFormats: row.content_formats,
    niches: row.niches,
    hasChannel: row.has_channel,
    channel: row.channel,
    competitors: row.competitors,
    onboardingCompletedAt: row.onboarding_completed_at,
  };
}

/** First-run onboarding: saves preferences and tracks whether the user finished. */
export class OnboardingService {
  private readonly log: Logger;

  constructor(
    private readonly repository: Pick<PreferencesRepository, "findByUserId" | "upsert" | "reset">,
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ module: "services.onboarding" });
  }

  async getPreferences(userId: string): Promise<UserPreferences | null> {
    const row = await this.repository.findByUserId(userId);
    return row ? toPreferences(row) : null;
  }

  async isCompleted(userId: string): Promise<boolean> {
    return Boolean((await this.repository.findByUserId(userId))?.onboarding_completed_at);
  }

  /** Validate and save answers, marking onboarding complete. */
  async complete(userId: string, input: unknown, now: Date = new Date()): Promise<UserPreferences> {
    const parsed = onboardingSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Some answers need another look.", z.flattenError(parsed.error));
    }
    const answers: OnboardingAnswers = parsed.data;
    const row = await this.repository.upsert({
      user_id: userId,
      goals: answers.goals,
      content_formats: answers.contentFormats,
      niches: answers.niches,
      has_channel: answers.hasChannel,
      channel: answers.channel,
      competitors: answers.competitors,
      onboarding_completed_at: now.toISOString(),
    });
    this.log.info("onboarding completed", { goals: answers.goals.length, niches: answers.niches.length });
    return toPreferences(row);
  }

  async reset(userId: string): Promise<void> {
    await this.repository.reset(userId);
    this.log.info("onboarding reset");
  }
}
