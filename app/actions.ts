"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireApprovedUser } from "@/lib/auth/session";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";
import { asUser, isQuotaUnavailable, parseChannelIdentifier } from "@/lib/youtube";

export interface TrackChannelState {
  error: string | null;
  message?: string | null;
}

/** Track a channel: fetch it, save stats + latest uploads, compute metrics. Approved users only. */
export async function trackChannel(_prev: TrackChannelState, formData: FormData): Promise<TrackChannelState> {
  const { user } = await requireApprovedUser();
  const identifier = String(formData.get("identifier") ?? "").trim();
  if (!identifier) return { error: "Enter a channel handle, URL, or ID." };

  let youtubeChannelId: string;
  const services = getServices();
  try {
    await services.credits.assertAvailable(user.id, "track_channel");
    const { channel } = await asUser(user.id, "action:track_channel", () => services.channels.refreshChannel(identifier, { followedBy: user.id }));
    await services.credits.charge(user.id, "track_channel", channel.youtube_channel_id);
    youtubeChannelId = channel.youtube_channel_id;
  } catch (error) {
    if (isQuotaUnavailable(error)) return queueWhenQuotaReturns(identifier, error.message);
    logger.warn("track channel failed", { identifier, error });
    return { error: isAppError(error) && error.expose ? error.message : "Could not track that channel. Try again." };
  }

  revalidatePath("/", "layout");
  redirect(`/channels/${youtubeChannelId}`);
}

/** Out of YouTube quota: queue the sync so the channel appears once quota frees up. */
async function queueWhenQuotaReturns(identifier: string, reason: string): Promise<TrackChannelState> {
  const parsed = (() => {
    try {
      return parseChannelIdentifier(identifier);
    } catch {
      return null;
    }
  })();
  const services = getServices();
  // Handles need a (quota-using) lookup, unless we already know the channel.
  const channelId =
    parsed?.type === "id" ? parsed.value : parsed?.type === "handle" ? (await services.repositories.channels.findByHandle(parsed.value))?.youtube_channel_id : undefined;
  if (!channelId) return { error: reason };
  await services.jobs.enqueue("channel.refresh", { channelId, light: false }, { idempotencyKey: `channel.refresh:${channelId}:queued`, priority: 10 });
  return { error: null, message: "YouTube data is at today's limit, so this channel is queued and will appear once it syncs." };
}