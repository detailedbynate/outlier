import "server-only";
import { CHANGELOG } from "@/lib/changelog";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";

/** Logged when the owner shows the changelog to everyone again. */
export const CHANGELOG_REPUBLISH_EVENT = "changelog.republish";

/** Every signed-in page asks, so the answer is kept briefly rather than read each time. */
const CACHE_MS = 30_000;
let cached: { version: string; at: number } | null = null;

/**
 * The changelog version people have to have seen: the id in code, plus the time
 * of the latest "show it again", so pressing that button makes it new to everyone.
 */
export async function currentChangelogVersion(): Promise<string> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.version;
  let version: string = CHANGELOG.id;
  try {
    const republishedAt = await getServices().repositories.usage.latestAt(CHANGELOG_REPUBLISH_EVENT);
    if (republishedAt) version = `${CHANGELOG.id}@${republishedAt}`;
  } catch (error) {
    logger.warn("changelog version lookup failed", { error });
  }
  cached = { version, at: Date.now() };
  return version;
}

/** Drop the cached version so a republish shows up straight away on this server. */
export function forgetChangelogVersion(): void {
  cached = null;
}
