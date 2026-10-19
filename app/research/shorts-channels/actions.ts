"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireApprovedUser } from "@/lib/auth/session";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { JobWorker } from "@/lib/jobs/worker";
import { writerAccess } from "@/lib/scripts/access";
import type { PeerPlan } from "@/lib/scripts/peer-ideas";
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

export interface AddChannelState {
  error: string | null;
}

/**
 * Pull in a channel we don't have yet (pasted as @handle or link), then show
 * the channels most like it. Costs what tracking a channel costs.
 */
export async function addChannelForSimilar(_prev: AddChannelState, formData: FormData): Promise<AddChannelState> {
  const { user } = await requireApprovedUser();
  const reference = String(formData.get("reference") ?? "").trim().slice(0, 300);
  if (!reference) return { error: "Paste a channel's @handle or link." };
  const services = getServices();
  let channelId: string;
  let youtubeChannelId: string;
  try {
    await services.credits.assertAvailable(user.id, "add_channel");
    const { channel } = await asUser(user.id, "action:add_channel", () => services.channels.refreshChannel(reference));
    await services.credits.charge(user.id, "add_channel", channel.youtube_channel_id);
    channelId = channel.id;
    youtubeChannelId = channel.youtube_channel_id;
    // Embedded now so the matches are there when the page loads.
    await services.similar.embedChannels([channel.id]).catch((error: unknown) => logger.warn("embedding a new channel failed", { channelId, error }));
  } catch (error) {
    logger.warn("add channel for similar failed", { reference, error });
    return { error: isAppError(error) && error.expose ? error.message : "Couldn't find that channel on YouTube. Check the handle or link." };
  }
  revalidatePath("/", "layout");
  redirect(formData.get("then") === "channel" ? `/channels/${youtubeChannelId}` : `/research/shorts-channels?similar=${channelId}`);
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

export interface PeerPlanState {
  plan: PeerPlan | null;
  error: string | null;
  charged: number;
}

/**
 * "What to make next" for a channel: Claude reads the breakouts on its most
 * similar channels for shared topics and title formats. On the Script Writer's plans.
 */
export async function findPeerPlan(_prev: PeerPlanState, formData: FormData): Promise<PeerPlanState> {
  const current = await requireApprovedUser();
  const channelId = String(formData.get("channelId") ?? "");
  if (!UUID_PATTERN.test(channelId)) return { plan: null, error: "Pick a channel first.", charged: 0 };
  const access = await writerAccess(current);
  if (!access) return { plan: null, error: "Suggestions are on the Pro and Expert plans.", charged: 0 };
  const services = getServices();
  try {
    await services.credits.assertAvailable(current.user.id, "peer_ideas");
    if (access.limit === "scriptUser") await services.rateLimits.enforce("scriptIdeasUser", current.user.id);
    const [channel, breakouts, [source]] = await Promise.all([
      services.repositories.channels.findById(channelId),
      services.research.peerBreakouts(channelId, 30),
      services.repositories.embeddings.sources([channelId], 15),
    ]);
    if (!channel) return { plan: null, error: "That channel isn't in Outlier.", charged: 0 };
    const plan = await services.scripts.peerPlan(
      {
        channel: channel.title,
        ownTitles: source?.recent_titles ?? [],
        breakouts: breakouts.map((b) => ({ title: b.title, channel: b.channel_title, views: b.view_count, multiplier: b.outlier_score })),
      },
      { premium: access.premium, basic: access.basic },
    );
    const { charged } = await services.credits.charge(current.user.id, "peer_ideas");
    revalidatePath("/", "layout");
    return { plan, error: null, charged };
  } catch (error) {
    logger.warn("peer plan failed", { channelId, error });
    return {
      plan: null,
      error: isAppError(error) && (error.expose || error.code === "RATE_LIMITED" || error.code === "VALIDATION_ERROR") ? error.message : "Couldn't put suggestions together just then. Try again in a moment.",
      charged: 0,
    };
  }
}
