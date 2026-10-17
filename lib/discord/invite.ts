import { env } from "@/lib/core/env";

/** Community invite; DISCORD_INVITE_URL overrides it. */
const DISCORD_INVITE = "https://discord.gg/outlierhq";

export function discordInviteUrl(): string {
  return env().DISCORD_INVITE_URL ?? DISCORD_INVITE;
}
