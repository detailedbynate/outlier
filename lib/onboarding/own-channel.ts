import "server-only";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";
import { parseChannelIdentifier } from "@/lib/youtube/parse";
import { asUser } from "@/lib/youtube/quota-context";

/**
 * Pulls the creator's own channel in, so the dashboard has something to show
 * the first time they see it. Run from `after()`: nobody waits on it.
 *
 * Throttled per user, because the dashboard calls it on every visit while the
 * channel is still missing and a handle that doesn't resolve would otherwise
 * be looked up again on each one. Marked for the daily refresh, since this is
 * the channel whose numbers they'll check most.
 */
export async function syncOwnChannel(userId: string, identifier: string): Promise<void> {
  const services = getServices();
  try {
    await services.rateLimits.enforce("ownChannelSync", userId);
  } catch (error) {
    if (isAppError(error) && error.code === "RATE_LIMITED") return;
    throw error;
  }
  try {
    const synced = await asUser(userId, "onboarding:own_channel", () => services.channels.refreshChannel(identifier, { dailyRefresh: true }));
    await followRename(userId, identifier, synced.channel);
  } catch (error) {
    logger.warn("own channel sync failed", { userId, identifier, error });
  }
}

/**
 * YouTube keeps answering for a channel's old handle after it changes, so a
 * saved "@oldname" still pulls the right channel in, but the row it saves
 * carries the new handle and the dashboard, matching on the saved one, keeps
 * saying "Loading" forever. When that happens the saved handle is moved on to
 * the channel's current one (its id when it has none).
 */
async function followRename(userId: string, identifier: string, channel: { youtube_channel_id: string; handle: string | null }): Promise<void> {
  let saved: ReturnType<typeof parseChannelIdentifier>;
  try {
    saved = parseChannelIdentifier(identifier);
  } catch {
    return;
  }
  if (saved.type !== "handle") return;
  const current = channel.handle?.trim() || null;
  if (current && current.toLowerCase() === saved.value.toLowerCase()) return;
  const services = getServices();
  const preferences = await services.onboarding.getPreferences(userId);
  if (!preferences || preferences.channel !== identifier) return;
  const next = current ?? channel.youtube_channel_id;
  await services.repositories.preferences.updateChannels(userId, next, preferences.competitors);
  logger.info("own channel handle followed", { userId, from: saved.value, to: next });
}

/** How old the creator's own channel can get before a dashboard visit re-reads it. */
const OWN_CHANNEL_FRESH_MS = 3 * 3_600_000;

/**
 * Re-reads the creator's channel when its uploads are a few hours old. The
 * daily-refresh mark shares a flag with following, so it can lapse when nobody
 * follows the channel; this keeps "last upload" true whenever they look.
 */
export async function refreshOwnChannelIfStale(userId: string, channel: { youtube_channel_id: string; last_synced_at: string | null }, now = new Date()): Promise<void> {
  const synced = channel.last_synced_at ? Date.parse(channel.last_synced_at) : 0;
  if (now.getTime() - synced > OWN_CHANNEL_FRESH_MS) await syncOwnChannel(userId, channel.youtube_channel_id);
}
