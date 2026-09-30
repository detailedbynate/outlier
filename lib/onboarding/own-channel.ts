import "server-only";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";
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
    await asUser(userId, "onboarding:own_channel", () => services.channels.refreshChannel(identifier, { dailyRefresh: true }));
  } catch (error) {
    logger.warn("own channel sync failed", { userId, identifier, error });
  }
}
