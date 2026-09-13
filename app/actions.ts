"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireApprovedUser } from "@/lib/auth/session";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";

export interface TrackChannelState {
  error: string | null;
}

/** Track a channel: fetch it, save stats + latest uploads, compute metrics. Approved users only. */
export async function trackChannel(_prev: TrackChannelState, formData: FormData): Promise<TrackChannelState> {
  await requireApprovedUser();
  const identifier = String(formData.get("identifier") ?? "").trim();
  if (!identifier) return { error: "Enter a channel handle, URL, or ID." };

  let youtubeChannelId: string;
  try {
    const { channel } = await getServices().channels.refreshChannel(identifier, { track: true });
    youtubeChannelId = channel.youtube_channel_id;
  } catch (error) {
    logger.warn("track channel failed", { identifier, error });
    return { error: isAppError(error) && error.expose ? error.message : "Could not track that channel. Try again." };
  }

  revalidatePath("/");
  revalidatePath("/channels");
  redirect(`/channels/${youtubeChannelId}`);
}
