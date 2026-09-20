"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireApprovedUser } from "@/lib/auth/session";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { JobWorker } from "@/lib/jobs/worker";
import { getServices } from "@/lib/services";
import { asBackground, asUser } from "@/lib/youtube/quota-context";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bookmark: tracked channels refresh daily and show in Tracked Channels. No YouTube quota is used here. */
export async function setChannelTracked(formData: FormData): Promise<void> {
  const current = await requireApprovedUser();
  const channelId = String(formData.get("channelId") ?? "");
  if (!UUID_PATTERN.test(channelId)) return;
  await getServices().repositories.channels.setFollowing(current.user.id, channelId, formData.get("tracked") === "true");
  revalidatePath("/research/shorts-channels");
  revalidatePath("/channels");
}

/** Admin: remove every trending pick (the section hides until the next re-pick). */
export async function clearTrendingPicks(): Promise<void> {
  await requireAdmin();
  await getServices().trending.clearAll();
  revalidatePath("/research/shorts-channels");
}

/** Admin: hide one pick; its niche's backup pick takes its place. */
export async function removeTrendingPick(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("pickId") ?? "");
  if (!UUID_PATTERN.test(id)) return;
  await getServices().trending.removePick(id);
  revalidatePath("/research/shorts-channels");
}

/** Admin: re-pick today's trending Shorts now (~600 quota units). */
export async function repickTrending(): Promise<void> {
  await requireAdmin();
  const services = getServices();
  try {
    // Same work as the daily job, so it draws from the background budget.
    await asBackground("admin:repick_trending", () => services.trending.computeDailyPicks());
  } catch (error) {
    logger.warn("trending re-pick failed", { error });
  }
  revalidatePath("/research/shorts-channels");
}

export interface DiscoverState {
  message: string | null;
  error: string | null;
}

/** Leave headroom under the page's 60s maxDuration. */
const INLINE_WORK_MS = 40_000;

/** Find Shorts channels for a keyword, then ingest as many as fit in the request; the rest finish via the hourly sync. */
export async function discoverShortsChannels(_prev: DiscoverState, formData: FormData): Promise<DiscoverState> {
  const { user } = await requireApprovedUser();
  const keyword = String(formData.get("keyword") ?? "");
  const startedAt = Date.now();
  const services = getServices();

  try {
    // Charged for the deep search up front: a search that has to dig costs more.
    await services.credits.assertAvailable(user.id, "discover_channels_deep");
    const result = await asUser(user.id, "action:discover_shorts", () => services.research.discoverShortsChannels(keyword, user.id));
    const action = result.searchPasses > 1 ? "discover_channels_deep" : "discover_channels";
    const { charged } = await services.credits.charge(user.id, action);
    let processed = 0;
    if (result.channelsQueued > 0) {
      const worker = new JobWorker(services.repositories.jobs, services.jobRegistry, { workerId: `discover:${user.id.slice(0, 8)}` });
      ({ processed } = await worker.drain({ deadline: startedAt + INLINE_WORK_MS, maxJobs: result.channelsQueued }));
    }
    // Layout revalidation refreshes the sidebar credits meter.
    revalidatePath("/", "layout");

    const remaining = Math.max(result.channelsQueued - processed, 0);
    const parts = [
      result.channelsNew > 0
        ? `Found ${result.channelsNew} new channel${result.channelsNew === 1 ? "" : "s"} for “${result.keyword}”.`
        : `No channels we don't already have for “${result.keyword}” — try a more specific keyword.`,
      result.channelsQueued === 0
        ? "Everything else was already up to date."
        : `Added ${processed}${remaining > 0 ? `, ${remaining} more will appear within the hour` : ""}.`,
      "Only channels that mostly post Shorts show in the list.",
      `Used ${charged} credits${result.searchPasses > 1 ? ` (searched YouTube ${result.searchPasses} times to find them)` : ""}.`,
    ];
    return { message: parts.join(" "), error: null };
  } catch (error) {
    logger.warn("shorts discovery failed", { keyword, error });
    return { message: null, error: isAppError(error) && error.expose ? error.message : "Discovery failed. Try again." };
  }
}
