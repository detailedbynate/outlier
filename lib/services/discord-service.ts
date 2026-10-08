import type { PlanId } from "@/lib/billing/plans";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { DiscordLinkRepository } from "@/lib/database/repositories/discord-links";
import { DiscordApi, type DiscordMessage } from "@/lib/discord/api";
import { BRAND_COLOR, EPHEMERAL, linkButtons, picksMessage, rolesFor, type PickForDiscord } from "@/lib/discord/messages";

/**
 * Outlier's Discord bot.
 *
 * - Roles: someone links their Discord account from Billing, and from then on
 *   their Pro or Expert role follows their plan: given when they subscribe or
 *   start a trial, swapped when they change plan, taken when it ends. Any plan
 *   change triggers it (SubscriptionService), and a daily job catches drift.
 * - Posting: the admin composer and the Daily Picks post go out as the bot.
 * - Slash commands (/picks, /plan, /link, /sync, /outlier), answered by the
 *   bot process (scripts/discord-bot.ts), which also keeps the bot online.
 *
 * Everything here is plain REST, so the web app can do it without the bot
 * process; only being online and answering commands need that process.
 */

export interface DiscordConfig {
  clientId: string;
  clientSecret: string;
  botToken: string;
  guildId: string;
  roles: { pro: string | null; expert: string | null };
  picksChannelId: string | null;
}

export interface DiscordDeps {
  links: DiscordLinkRepository;
  planFor: (userId: string) => Promise<{ id: PlanId; name: string }>;
  picks: () => Promise<PickForDiscord[]>;
  siteUrl: string;
  api?: DiscordApi;
  fetchImpl?: typeof fetch;
}

/** Slash commands, registered on the server each time the bot starts. */
export const COMMANDS = [
  { name: "picks", description: "Today's Daily Picks: Shorts blowing up on small channels" },
  { name: "plan", description: "Your Outlier plan" },
  { name: "link", description: "Link your Outlier account to get your Pro or Expert role" },
  { name: "sync", description: "Fix your Pro or Expert role if it's wrong" },
  { name: "outlier", description: "What Outlier is, with a link to try it" },
] as const;

// Manage Roles, Send Messages, Embed Links, View Channel and Create Invite (needed to add people with "Connect Discord").
const BOT_PERMISSIONS = (1 << 28) + (1 << 11) + (1 << 14) + (1 << 10) + 1;

export interface Interaction {
  id: string;
  token: string;
  type: number;
  data?: { name?: string };
  member?: { user?: { id: string } };
  user?: { id: string };
}

export class DiscordService {
  private readonly log: Logger = createLogger({ module: "services.discord" });
  private readonly api: DiscordApi | null;

  constructor(
    private readonly config: DiscordConfig | null,
    private readonly deps: DiscordDeps,
  ) {
    this.api = config ? (deps.api ?? new DiscordApi(config.botToken, deps.fetchImpl)) : null;
  }

  get enabled(): boolean {
    return this.config !== null;
  }

  /** Where the Daily Picks go by default. */
  get picksChannelId(): string | null {
    return this.config?.picksChannelId ?? null;
  }

  /** Where "Connect Discord" sends people: Discord's sign-in, asking to see who they are and add them to the server. */
  authorizeUrl(state: string, redirectUri: string): string | null {
    if (!this.config) return null;
    const params = new URLSearchParams({ client_id: this.config.clientId, response_type: "code", redirect_uri: redirectUri, scope: "identify guilds.join", state, prompt: "none" });
    return `https://discord.com/oauth2/authorize?${params}`;
  }

  /** The link that adds the bot to a server with the permissions it needs. */
  botInviteUrl(): string | null {
    if (!this.config) return null;
    const params = new URLSearchParams({ client_id: this.config.clientId, scope: "bot applications.commands", permissions: String(BOT_PERMISSIONS), guild_id: this.config.guildId });
    return `https://discord.com/oauth2/authorize?${params}`;
  }

  link(userId: string) {
    return this.deps.links.forUser(userId);
  }

  /** Back from Discord's sign-in: save who they are, add them to the server with their role, and say who they are. */
  async completeLink(userId: string, code: string, redirectUri: string): Promise<{ username: string }> {
    const config = this.require();
    const token = await DiscordApi.exchangeCode({ clientId: config.clientId, clientSecret: config.clientSecret, code, redirectUri }, this.deps.fetchImpl);
    const me = await DiscordApi.me(token, this.deps.fetchImpl);
    const username = me.global_name ? `${me.global_name} (@${me.username})` : `@${me.username}`;
    await this.deps.links.link(userId, me.id, username);
    const plan = await this.deps.planFor(userId);
    try {
      // Joins them to the server if they aren't in it, already holding their role.
      await this.api!.addMember(config.guildId, me.id, token, rolesFor(plan.id, config.roles).give);
    } catch (error) {
      this.log.warn("couldn't add linked member to the server", { userId, error: error instanceof Error ? error.message : String(error) });
    }
    await this.syncUser(userId);
    return { username };
  }

  /** Take their paid roles and forget the link. */
  async unlink(userId: string): Promise<void> {
    const link = await this.deps.links.forUser(userId);
    if (!link) return;
    if (this.config) {
      for (const role of rolesFor("free", this.config.roles).take) {
        await this.api!.removeRole(this.config.guildId, link.discord_id, role).catch(() => {});
      }
    }
    await this.deps.links.unlink(userId);
  }

  /**
   * Make someone's roles match their plan. Quiet when they aren't linked or
   * aren't in the server; returns what changed.
   */
  async syncUser(userId: string): Promise<{ added: number; removed: number } | null> {
    if (!this.config) return null;
    const link = await this.deps.links.forUser(userId);
    if (!link) return null;
    const plan = await this.deps.planFor(userId);
    const has = await this.api!.memberRoles(this.config.guildId, link.discord_id);
    if (has === null) return null;
    const { give, take } = rolesFor(plan.id, this.config.roles);
    let added = 0;
    let removed = 0;
    for (const role of give.filter((r) => !has.includes(r))) {
      await this.api!.addRole(this.config.guildId, link.discord_id, role);
      added++;
    }
    for (const role of take.filter((r) => has.includes(r))) {
      await this.api!.removeRole(this.config.guildId, link.discord_id, role);
      removed++;
    }
    await this.deps.links.markSynced(userId, plan.id);
    if (added || removed) this.log.info("discord roles synced", { userId, plan: plan.id, added, removed });
    return { added, removed };
  }

  /** Everyone linked, one at a time (Discord rate-limits role changes). For the daily job and the admin button. */
  async syncAll(): Promise<{ checked: number; changed: number; failed: number }> {
    if (!this.config) return { checked: 0, changed: 0, failed: 0 };
    let changed = 0;
    let failed = 0;
    const links = await this.deps.links.list();
    for (const link of links) {
      try {
        const result = await this.syncUser(link.user_id);
        if (result && (result.added || result.removed)) changed++;
      } catch (error) {
        failed++;
        this.log.warn("discord role sync failed", { userId: link.user_id, error: error instanceof Error ? error.message : String(error) });
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { checked: links.length, changed, failed };
  }

  /** Post as the bot. */
  async post(channelId: string, message: DiscordMessage): Promise<void> {
    this.require();
    await this.api!.sendMessage(channelId, message);
  }

  /** Today's Daily Picks to the picks channel, when one is set. */
  async postPicks(channelId = this.config?.picksChannelId ?? null): Promise<{ posted: number } | { skipped: string }> {
    if (!this.config) return { skipped: "discord_off" };
    if (!channelId) return { skipped: "no_picks_channel" };
    const picks = await this.deps.picks();
    if (picks.length === 0) return { skipped: "no_picks" };
    await this.api!.sendMessage(channelId, picksMessage(picks, new Date(), this.deps.siteUrl));
    return { posted: picks.length };
  }

  channels() {
    const config = this.require();
    return this.api!.textChannels(config.guildId);
  }

  registerCommands(): Promise<unknown> {
    const config = this.require();
    return this.api!.registerCommands(config.clientId, config.guildId, COMMANDS);
  }

  /** Answer a slash command (the bot process calls this for each one it hears). */
  async handleInteraction(interaction: Interaction): Promise<void> {
    if (!this.api) return;
    // 2 = slash command. Anything else (pings, buttons) needs no answer here.
    if (interaction.type !== 2) return;
    const discordId = interaction.member?.user?.id ?? interaction.user?.id ?? "";
    let reply: DiscordMessage;
    try {
      reply = await this.replyTo(interaction.data?.name ?? "", discordId);
    } catch (error) {
      this.log.error("discord command failed", { command: interaction.data?.name, error: error instanceof Error ? error.message : String(error) });
      reply = { content: "Something went wrong there. Try again in a minute.", flags: EPHEMERAL };
    }
    await this.api.respond(interaction.id, interaction.token, { type: 4, data: reply });
  }

  private async replyTo(command: string, discordId: string): Promise<DiscordMessage> {
    const site = this.deps.siteUrl;
    const connect = `${site}/billing#discord`;
    switch (command) {
      case "picks": {
        const picks = await this.deps.picks();
        return picksMessage(picks, new Date(), site);
      }
      case "outlier":
        return {
          embeds: [
            {
              title: "Outlier",
              url: site,
              color: BRAND_COLOR,
              description:
                "Find the YouTube videos and niches blowing up right now, before everyone else does.\n\n" +
                "• **Daily Picks**: breakout Shorts from small channels, every day\n" +
                "• **Niche Finder**: niches with room to grow, gaming first\n" +
                "• **Outlier videos**: what's beating its channel's usual views\n" +
                "• **Scripts**: turn an outlier into your own video",
            },
          ],
          components: [linkButtons([{ label: "Try Outlier", url: site }])],
          allowed_mentions: { parse: [] },
        };
      case "plan":
      case "link":
      case "sync": {
        const link = discordId ? await this.deps.links.forDiscordId(discordId) : null;
        if (!link) {
          return {
            content: "Your Discord isn't linked to an Outlier account yet. Link it from Billing and your Pro or Expert role shows up on its own.",
            components: [linkButtons([{ label: "Link my account", url: connect }])],
            flags: EPHEMERAL,
          };
        }
        const plan = await this.deps.planFor(link.user_id);
        if (command === "sync") {
          const result = await this.syncUser(link.user_id);
          const changed = result && (result.added || result.removed);
          return { content: changed ? `Done: your roles now match your ${plan.name} plan.` : `Your roles already match your ${plan.name} plan.`, flags: EPHEMERAL };
        }
        return {
          content:
            plan.id === "free"
              ? "You're linked, on the Free plan. Upgrade and your role shows up here straight away."
              : `You're linked, on **${plan.name}**. Your ${plan.name} role comes and goes with your plan.`,
          components: [linkButtons([{ label: plan.id === "free" ? "See plans" : "Manage plan", url: `${site}/billing` }])],
          flags: EPHEMERAL,
        };
      }
      default:
        return { content: "I don't know that one.", flags: EPHEMERAL };
    }
  }

  private require(): DiscordConfig {
    if (!this.config) throw new Error("Discord isn't set up: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID are needed.");
    return this.config;
  }
}

/** The bot's settings from the environment, or null when any of the four it can't run without is missing. */
export function discordConfigFrom(env: {
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_ROLE_PRO?: string;
  DISCORD_ROLE_EXPERT?: string;
  DISCORD_PICKS_CHANNEL_ID?: string;
}): DiscordConfig | null {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) return null;
  return {
    clientId: env.DISCORD_CLIENT_ID,
    clientSecret: env.DISCORD_CLIENT_SECRET,
    botToken: env.DISCORD_BOT_TOKEN,
    guildId: env.DISCORD_GUILD_ID,
    roles: { pro: env.DISCORD_ROLE_PRO ?? null, expert: env.DISCORD_ROLE_EXPERT ?? null },
    picksChannelId: env.DISCORD_PICKS_CHANNEL_ID ?? null,
  };
}
