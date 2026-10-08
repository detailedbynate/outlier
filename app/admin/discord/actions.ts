"use server";

import { requireAdmin } from "@/lib/auth/session";
import { logger } from "@/lib/core/logger";
import { DiscordApiError } from "@/lib/discord/api";
import { composeMessage } from "@/lib/discord/messages";
import { getServices } from "@/lib/services";

export interface DiscordFormState {
  status: "idle" | "ok" | "error";
  message: string | null;
  /** Bumped on each successful post, so the composer knows to clear. */
  sent: number;
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

/** Discord's answer, in words an admin can act on. */
function explain(error: unknown): string {
  if (error instanceof DiscordApiError) {
    if (error.code === 50001 || error.code === 50013) return "The bot can't post there: give its role View Channel, Send Messages and Embed Links in that channel.";
    if (error.code === 10003) return "That channel doesn't exist any more.";
    if (error.status === 401) return "Discord rejected the bot token. Check DISCORD_BOT_TOKEN.";
    if (error.code === 50035) return "Discord didn't accept that message: check the links and image addresses.";
    return `Discord said no (${error.status}${error.code ? `, code ${error.code}` : ""}).`;
  }
  return "Couldn't reach Discord. Try again.";
}

export async function postMessage(prev: DiscordFormState, formData: FormData): Promise<DiscordFormState> {
  await requireAdmin();
  const channelId = text(formData, "channelId").trim();
  if (!/^\d{15,25}$/.test(channelId)) return { ...prev, status: "error", message: "Pick a channel." };
  const message = composeMessage({
    content: text(formData, "content"),
    title: text(formData, "title"),
    description: text(formData, "description"),
    color: text(formData, "color"),
    url: text(formData, "url"),
    imageUrl: text(formData, "imageUrl"),
    thumbnailUrl: text(formData, "thumbnailUrl"),
    footer: text(formData, "footer"),
    buttonLabel: text(formData, "buttonLabel"),
    buttonUrl: text(formData, "buttonUrl"),
    ping: formData.get("ping") === "on",
  });
  if ("error" in message) return { ...prev, status: "error", message: message.error };
  try {
    await getServices().discord.post(channelId, message);
    return { status: "ok", message: "Posted.", sent: prev.sent + 1 };
  } catch (error) {
    logger.warn("discord post failed", { channelId, error: error instanceof Error ? error.message : String(error) });
    return { ...prev, status: "error", message: explain(error) };
  }
}

export async function postPicksNow(prev: DiscordFormState, formData: FormData): Promise<DiscordFormState> {
  await requireAdmin();
  const channelId = text(formData, "channelId").trim() || undefined;
  try {
    const result = await getServices().discord.postPicks(channelId ?? undefined);
    if ("skipped" in result) {
      const why = { discord_off: "Discord isn't set up.", no_picks_channel: "Pick a channel, or set DISCORD_PICKS_CHANNEL_ID.", no_picks: "There are no Daily Picks yet today." }[result.skipped];
      return { ...prev, status: "error", message: why ?? "Nothing to post." };
    }
    return { status: "ok", message: `Posted ${result.posted} picks.`, sent: prev.sent + 1 };
  } catch (error) {
    return { ...prev, status: "error", message: explain(error) };
  }
}

export async function syncAllRoles(prev: DiscordFormState): Promise<DiscordFormState> {
  await requireAdmin();
  try {
    const result = await getServices().discord.syncAll();
    return {
      ...prev,
      status: "ok",
      message: `Checked ${result.checked} linked member${result.checked === 1 ? "" : "s"}: ${result.changed} fixed${result.failed ? `, ${result.failed} failed (see the logs)` : ""}.`,
    };
  } catch (error) {
    return { ...prev, status: "error", message: explain(error) };
  }
}
