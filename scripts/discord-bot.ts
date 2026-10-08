/**
 * The Outlier Discord bot: keeps it online and answers its slash commands.
 * Runs beside the site as its own small service (deploy/outlier-discord.service).
 * Roles, posts and the Daily Picks go out from the site itself over Discord's
 * REST API, so they work even while this is restarting.
 *
 * Usage: npm run discord-bot
 */
import { env } from "@/lib/core/env";
import { createLogger } from "@/lib/core/logger";
import { DiscordGateway, INTENTS } from "@/lib/discord/gateway";
import { getServices } from "@/lib/services";
import type { Interaction } from "@/lib/services/discord-service";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // On the server systemd passes the environment; these files are for running it locally.
  }
}

const log = createLogger({ module: "discord.bot" });

function main(): void {
  const discord = getServices().discord;
  const token = env().DISCORD_BOT_TOKEN;
  if (!discord.enabled || !token) {
    // Not set up yet: stay idle (no restart loop) until the settings are added and the service restarted.
    log.warn("Discord isn't set up (DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID); idle");
    setInterval(() => {}, 1 << 30);
    return;
  }

  const gateway = new DiscordGateway({
    token,
    intents: INTENTS.GUILDS,
    presence: { status: "online", activity: { type: 3, name: "for outliers" } },
    log,
    onFatal: (reason) => {
      log.error(`Discord refused the bot: ${reason}. Fix the setting, then restart outlier-discord.`);
      // Exit cleanly so systemd doesn't hammer Discord with a token it already refused.
      process.exit(0);
    },
    onDispatch: (event, data) => {
      if (event === "READY") {
        discord.registerCommands().then(
          () => log.info("slash commands registered"),
          (error: unknown) => log.error("registering slash commands failed", { error: error instanceof Error ? error.message : String(error) }),
        );
      }
      if (event === "INTERACTION_CREATE") {
        discord.handleInteraction(data as Interaction).catch((error: unknown) => log.error("answering a command failed", { error: error instanceof Error ? error.message : String(error) }));
      }
    },
  });
  gateway.start();

  const shutdown = () => {
    gateway.stop();
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main();
