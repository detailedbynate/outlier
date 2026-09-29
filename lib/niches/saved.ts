import { topicKey } from "./analysis";

/**
 * Niches someone is keeping an eye on. Stored on the account (auth user
 * metadata) because it's a short personal list, so it needs no table of its own.
 */
export const SAVED_NICHES_KEY = "saved_niches";
export const MAX_SAVED_NICHES = 20;

export interface SavedNiche {
  topic: string;
  key: string;
  /** Opportunity score when it was saved, to show how it has moved since. */
  score: number;
  savedAt: string;
}

/** The saved list from user metadata, ignoring anything malformed. */
export function readSavedNiches(metadata: Record<string, unknown> | undefined): SavedNiche[] {
  const raw = metadata?.[SAVED_NICHES_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): SavedNiche[] => {
    if (typeof item !== "object" || item === null) return [];
    const { topic, key, score, savedAt } = item as Record<string, unknown>;
    if (typeof topic !== "string" || typeof score !== "number" || typeof savedAt !== "string") return [];
    return [{ topic, key: typeof key === "string" ? key : topicKey(topic), score, savedAt }];
  });
}

export function isSaved(list: readonly SavedNiche[], topic: string): boolean {
  const key = topicKey(topic);
  return list.some((n) => n.key === key);
}

/** Adds a niche to the front (or moves it there with a fresh score), keeping the list short. */
export function withSaved(list: readonly SavedNiche[], topic: string, score: number, now: Date): SavedNiche[] {
  const key = topicKey(topic);
  return [{ topic, key, score, savedAt: now.toISOString() }, ...list.filter((n) => n.key !== key)].slice(0, MAX_SAVED_NICHES);
}

export function withoutSaved(list: readonly SavedNiche[], topic: string): SavedNiche[] {
  const key = topicKey(topic);
  return list.filter((n) => n.key !== key);
}
