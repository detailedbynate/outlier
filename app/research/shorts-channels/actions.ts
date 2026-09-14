"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedUser } from "@/lib/auth/session";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { JobWorker } from "@/lib/jobs/worker";
import { getServices } from "@/lib/services";
import { CREDIT_COSTS } from "@/lib/services/credits-service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bookmark: tracked channels refresh daily and show in Tracked Channels. No YouTube quota is used here. */
export async function setChannelTracked(formData: FormData): Promise<void> {
  await requireApprovedUser();
  const channelId = String(formData.get("channelId") ?? "");
  if (!UUID_PATTERN.test(channelId)) return;
  await getServices().repositories.channels.setTracked(channelId, formData.get("tracked") === "true");
  revalidatePath("/research/shorts-channels");
  revalidatePath("/channels");
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
    await services.credits.assertAvailable(user.id, "discover_channels");
    const result = await services.research.discoverShortsChannels(keyword, user.id);
    await services.credits.charge(user.id, "discover_channels");
    let processed = 0;
    if (result.channelsQueued > 0) {
      const worker = new JobWorker(services.repositories.jobs, services.jobRegistry, { workerId: `discover:${user.id.slice(0, 8)}` });
      ({ processed } = await worker.drain({ deadline: startedAt + INLINE_WORK_MS, maxJobs: result.channelsQueued }));
    }
    // Layout revalidation refreshes the sidebar credits meter.
    revalidatePath("/", "layout");

    const remaining = Math.max(result.channelsQueued - processed, 0);
    const parts = [
      `Found ${result.channelsFound} channels for “${result.keyword}”.`,
      result.channelsQueued === 0
        ? "They were already up to date."
        : `Added ${processed}${remaining > 0 ? `, ${remaining} more will appear within the hour` : ""}.`,
      "Only channels that mostly post Shorts show in the list.",
      `Used ${CREDIT_COSTS.discover_channels} credits.`,
    ];
    return { message: parts.join(" "), error: null };
  } catch (error) {
    logger.warn("shorts discovery failed", { keyword, error });
    return { message: null, error: isAppError(error) && error.expose ? error.message : "Discovery failed. Try again." };
  }
}
