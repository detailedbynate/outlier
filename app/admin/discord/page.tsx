import { headers } from "next/headers";
import { MessageIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth/session";
import { env } from "@/lib/core/env";
import { getServices } from "@/lib/services";
import { DiscordComposer } from "./composer";
import { PicksButton, SyncButton } from "./tools";

export const dynamic = "force-dynamic";

async function origin(): Promise<string> {
  const configured = env().SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
}

export default async function AdminDiscordPage() {
  await requireAdmin();
  const services = getServices();
  const discord = services.discord;
  const site = await origin();
  const config = env();

  const settings = [
    { key: "DISCORD_CLIENT_ID", set: Boolean(config.DISCORD_CLIENT_ID), need: true },
    { key: "DISCORD_CLIENT_SECRET", set: Boolean(config.DISCORD_CLIENT_SECRET), need: true },
    { key: "DISCORD_BOT_TOKEN", set: Boolean(config.DISCORD_BOT_TOKEN), need: true },
    { key: "DISCORD_GUILD_ID", set: Boolean(config.DISCORD_GUILD_ID), need: true },
    { key: "DISCORD_ROLE_PRO", set: Boolean(config.DISCORD_ROLE_PRO), need: false },
    { key: "DISCORD_ROLE_EXPERT", set: Boolean(config.DISCORD_ROLE_EXPERT), need: false },
    { key: "DISCORD_PICKS_CHANNEL_ID", set: Boolean(config.DISCORD_PICKS_CHANNEL_ID), need: false },
  ];

  if (!discord.enabled) {
    return (
      <div className="stack dc-page">
        <PageHeader icon={MessageIcon} title="Discord" subtitle="Post to your server as the Outlier bot, and keep Pro and Expert roles in sync." />
        <section className="card dc-setup">
          <h2 className="traffic-card-title">Set up the bot</h2>
          <ol className="dc-steps">
            <li>
              Make an app at <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">discord.com/developers</a>, and under <strong>Bot</strong> reset and copy the token.
            </li>
            <li>
              Under <strong>OAuth2</strong>, copy the client ID and secret, and add this redirect: <code>{site}/api/discord/callback</code>
            </li>
            <li>In Discord, turn on Developer Mode, then right-click your server, the Pro and Expert roles, and the picks channel to copy their IDs.</li>
            <li>Put them in the server&apos;s .env.production and restart Outlier.</li>
          </ol>
          <SettingList settings={settings} />
        </section>
      </div>
    );
  }

  let channels: { id: string; name: string; parent: string | null }[] = [];
  let channelError: string | null = null;
  try {
    channels = await discord.channels();
  } catch (error) {
    channelError = error instanceof Error ? error.message : String(error);
  }
  const linked = (await services.repositories.discordLinks.list()).length;
  const invite = discord.botInviteUrl();

  return (
    <div className="stack dc-page">
      <PageHeader icon={MessageIcon} title="Discord" subtitle="Post to your server as the Outlier bot, and keep Pro and Expert roles in sync." />

      <div className="dc-status">
        <div className="card dc-stat">
          <span className="stat-note">Linked members</span>
          <strong>{linked.toLocaleString("en-US")}</strong>
        </div>
        <div className="card dc-stat">
          <span className="stat-note">Channels the bot can post in</span>
          <strong>{channels.length}</strong>
        </div>
        <div className="card dc-stat dc-stat-wide">
          <span className="stat-note">Bot not in the server, or missing permissions?</span>
          {invite ? (
            <a className="button-ghost" href={invite} target="_blank" rel="noreferrer">
              Invite the bot
            </a>
          ) : null}
        </div>
      </div>

      {channelError ? (
        <div className="billing-notice" data-tone="bad" role="status">
          Couldn&apos;t list the server&apos;s channels. Is the bot in the server? ({channelError})
        </div>
      ) : null}

      <DiscordComposer channels={channels} siteUrl={site} defaultChannel={null} />

      <section className="card dc-tools">
        <PicksButton channels={channels} defaultChannel={discord.picksChannelId} />
        <SyncButton />
      </section>

      <details className="card dc-setup">
        <summary>Settings</summary>
        <p className="stat-note">
          Login redirect for the Discord app: <code>{site}/api/discord/callback</code>. Put the bot&apos;s role above Pro and Expert in Server Settings → Roles, or it can&apos;t hand them out.
        </p>
        <SettingList settings={settings} />
      </details>
    </div>
  );
}

function SettingList({ settings }: { settings: { key: string; set: boolean; need: boolean }[] }) {
  return (
    <ul className="dc-settings">
      {settings.map((s) => (
        <li key={s.key} data-set={s.set}>
          <span className="dc-dot" aria-hidden="true" />
          <code>{s.key}</code>
          <span className="stat-note">{s.set ? "Set" : s.need ? "Needed" : "Optional"}</span>
        </li>
      ))}
    </ul>
  );
}
