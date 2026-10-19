import type { Metadata } from "next";
import { headers } from "next/headers";
import { PlugIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Paywall } from "@/components/paywall";
import { requireApprovedUser } from "@/lib/auth/session";
import { paidFeaturesLocked } from "@/lib/billing/feature-gate";
import { PAID_FEATURES } from "@/lib/billing/features";
import { env } from "@/lib/core/env";
import { timeAgo } from "@/lib/format";
import { getServices } from "@/lib/services";
import { revokeMcpToken } from "./actions";
import { CreateToken } from "./create-token";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect AI · Outlier" };

const TOOLS = [
  ["Search Shorts channels", "by niche, size, faceless or on camera"],
  ["Find similar channels", "for any @handle or channel link, with a match %"],
  ["What's working for similar channels", "Shorts beating their channel's usual views right now"],
  ["Viral Shorts", "outliers across the library"],
  ["Removed channels", "channels YouTube took down"],
] as const;

export default async function ConnectAiPage() {
  const current = await requireApprovedUser();
  if (await paidFeaturesLocked(current)) return <Paywall feature={PAID_FEATURES["mcp"]} />;
  // Before the mcp_tokens migration is applied the list is just empty.
  const tokens = await getServices().repositories.mcpTokens.listForUser(current.user.id).catch(() => []);
  const host = (await headers()).get("host");
  const origin = (env().SITE_URL ?? (host ? `https://${host}` : "")).replace(/\/$/, "");
  const endpoint = `${origin}/api/mcp`;

  return (
    <div className="research-page">
      <PageHeader icon={PlugIcon} title="Connect AI" subtitle="Use Outlier from Claude and other AI assistants through the Outlier MCP server." />

      <section className="card stack">
        <h2>What your assistant can do</h2>
        <ul className="mcp-tools">
          {TOOLS.map(([name, note]) => (
            <li key={name}>
              <strong>{name}</strong> <span className="muted">· {note}</span>
            </li>
          ))}
        </ul>
        <p className="stat-note">It reads your Outlier library only, so it uses no credits. Up to 300 calls an hour per token.</p>
      </section>

      <section className="card stack">
        <h2>Set it up</h2>
        <p className="stat-note">
          Server address: <code>{endpoint}</code>
        </p>
        <CreateToken endpoint={endpoint} />
      </section>

      <section className="card">
        <h2>Your tokens</h2>
        {tokens.length === 0 ? (
          <div className="empty">No tokens yet.</div>
        ) : (
          <ul className="mcp-token-list">
            {tokens.map((t) => (
              <li key={t.id}>
                <div>
                  <strong>{t.label}</strong>
                  <span className="muted">
                    {t.prefix}… · made {timeAgo(t.created_at)} · {t.last_used_at ? `last used ${timeAgo(t.last_used_at)}` : "not used yet"}
                  </span>
                </div>
                <form action={revokeMcpToken}>
                  <input type="hidden" name="id" value={t.id} />
                  <button type="submit" className="button-ghost button-small">
                    Revoke
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
