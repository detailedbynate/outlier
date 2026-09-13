"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedUser } from "@/lib/auth/session";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { JobWorker } from "@/lib/jobs/worker";
import { getServices } from "@/lib/services";

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
    const result = await services.research.discoverShortsChannels(keyword, user.id);
    let processed = 0;
    if (result.channelsQueued > 0) {
      const worker = new JobWorker(services.repositories.jobs, services.jobRegistry, { workerId: `discover:${user.id.slice(0, 8)}` });
      ({ processed } = await worker.drain({ deadline: startedAt + INLINE_WORK_MS, maxJobs: result.channelsQueued }));
    }
    revalidatePath("/research/shorts-channels");

    const remaining = Math.max(result.channelsQueued - processed, 0);
    const parts = [
      `Found ${result.channelsFound} channels for “${result.keyword}”.`,
      result.channelsQueued === 0
        ? "They were already up to date."
        : `Added ${processed}${remaining > 0 ? `, ${remaining} more will appear within the hour` : ""}.`,
      "Only channels that mostly post Shorts show in the list.",
      `${result.searchesLeftToday} discovery searches left today.`,
    ];
    return { message: parts.join(" "), error: null };
  } catch (error) {
    logger.warn("shorts discovery failed", { keyword, error });
    return { message: null, error: isAppError(error) && error.expose ? error.message : "Discovery failed. Try again." };
  }
}
