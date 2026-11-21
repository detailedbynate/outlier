import type { Metadata } from "next";
import { headers } from "next/headers";
import type { CSSProperties } from "react";
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
  { name: "Search Shorts channels", note: "By niche, size, faceless or on camera." },
  { name: "Find similar channels", note: "For any @handle or channel link, with a match %." },
  { name: "What's working for similar channels", note: "Shorts beating their channel's usual views right now." },
  { name: "Viral Shorts", note: "Outliers across the whole library." },
  { name: "Removed channels", note: "Channels YouTube took down, with what they had." },
] as const;

const PROMPTS = [
  "Find faceless gaming Shorts channels under 50K subscribers that grew this month",
  "Which channels are most like @MrBeast, and what are their best Shorts lately?",
  "What hooks are the viral Shorts in cooking using this week?",
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
    <div className="stack ca">
      <header className="dash-hero ca-hero">
        <div className="dash-hero-text">
          <h1>Connect AI</h1>
          <p>Ask Claude, Cursor or any MCP assistant about channels and Shorts, and it answers from your Outlier library. It only reads, so it uses no credits; each token allows 300 calls an hour.</p>
        </div>
      </header>

      <section aria-labelledby="ca-tools-title">
        <h2 id="ca-tools-title" className="ca-title">
          What your assistant can do
        </h2>
        <ul className="ca-tools">
          {TOOLS.map((tool, i) => (
            <li key={tool.name} style={{ "--i": i } as CSSProperties}>
              <strong>{tool.name}</strong>
              <span>{tool.note}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="ca-card" aria-labelledby="ca-setup-title">
        <h2 id="ca-setup-title" className="ca-title">
          Set it up
        </h2>
        <CreateToken endpoint={endpoint} prompts={PROMPTS} />
      </section>

      <section className="ca-card" aria-labelledby="ca-tokens-title">
        <h2 id="ca-tokens-title" className="ca-title">
          Your tokens
        </h2>
        {tokens.length === 0 ? (
          <p className="ca-empty">None yet. Make one above; it shows up here with when it was last used.</p>
        ) : (
          <ul className="ca-tokens">
            {tokens.map((t) => (
              <li key={t.id}>
                <span className="ca-token-dot" data-live={t.last_used_at ? "" : undefined} aria-hidden="true" />
                <div>
                  <strong>{t.label}</strong>
                  <span>
                    <code>{t.prefix}…</code> · made {timeAgo(t.created_at)} · {t.last_used_at ? `last used ${timeAgo(t.last_used_at)}` : "not used yet"}
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
