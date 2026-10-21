import type { Metadata } from "next";
import Link from "next/link";
import { UsersIcon } from "@/components/icons";
import { SORT_OPTIONS, type SortKey } from "@/lib/competitors/intel";
import { requireApprovedUser } from "@/lib/auth/session";
import { Paywall } from "@/components/paywall";
import { paidFeaturesLocked } from "@/lib/billing/feature-gate";
import { PAID_FEATURES } from "@/lib/billing/features";
import { MAX_COMPETITORS } from "@/lib/onboarding/schema";
import { getServices } from "@/lib/services";
import { syncCompetitors } from "./actions";
import { SyncButton } from "./sync-button";
import { AlertsTab, ContentTab, Glance, GrowthTab, InsightsTab, OverviewTab, TABS, type TabKey } from "./tabs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata: Metadata = { title: "Competitors · Outlier" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const STATUS_TEXT: Record<string, { tone: "good" | "warn"; text: string }> = {
  synced: { tone: "good", text: "Up to date." },
  rate_limited: { tone: "warn", text: "You've refreshed a lot this hour. Showing saved data." },
  quota: { tone: "warn", text: "YouTube data is at today's limit. Showing saved data, which may be older." },
  error: { tone: "warn", text: "Couldn't refresh some channels. Showing saved data." },
};

export default async function CompetitorsPage({ searchParams }: { searchParams: SearchParams }) {
  const current = await requireApprovedUser();
  const { user } = current;
  // Free is Shorts Channels only: show the paywall before loading anything.
  if (await paidFeaturesLocked(current)) return <Paywall feature={PAID_FEATURES["competitors"]} />;
  const params = await searchParams;
  const services = getServices();
  const preferences = await services.onboarding.getPreferences(user.id);

  const fromUrl = params.you !== undefined || params.c !== undefined;
  const you = (fromUrl ? String(params.you ?? "") : (preferences?.channel ?? "")).trim();
  const competitorInputs = (fromUrl ? (Array.isArray(params.c) ? params.c : params.c ? [params.c] : []).map(String) : (preferences?.competitors ?? []))
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, MAX_COMPETITORS);
  const sort = (SORT_OPTIONS.find((o) => o.key === params.sort)?.key ?? "growth") as SortKey;
  const tab = (TABS.find((t) => t.key === params.view)?.key ?? "overview") as TabKey;
  const status = typeof params.status === "string" ? (params.status.startsWith("failed") ? "error" : params.status) : null;

  const hasChannels = competitorInputs.length > 0;
  const ws = hasChannels ? await services.competitors.workspace({ you: you || null, competitors: competitorInputs, userId: user.id, sort }) : null;

  const href = (overrides: { view?: TabKey; sort?: SortKey }) => {
    const q = new URLSearchParams();
    if (fromUrl) {
      if (you) q.set("you", you);
      for (const c of competitorInputs) q.append("c", c);
    }
    const nextSort = overrides.sort ?? sort;
    if (nextSort !== "growth") q.set("sort", nextSort);
    const nextView = overrides.view ?? tab;
    if (nextView !== "overview") q.set("view", nextView);
    const qs = q.toString();
    return `/compare${qs ? `?${qs}` : ""}`;
  };

  const slots = [...competitorInputs, ...Array(MAX_COMPETITORS).fill("")].slice(0, Math.max(5, competitorInputs.length + 1));
  const channelForm = (
    <form action={syncCompetitors} className="intel-form">
      <label className="field">
        <span>Your channel</span>
        <input name="you" defaultValue={you} placeholder="@yourchannel or channel link" maxLength={300} />
      </label>
      <div className="intel-form-competitors">
        {slots.map((value, i) => (
          <label key={i} className="field">
            <span>Competitor {i + 1}</span>
            <input name="c" defaultValue={value} placeholder="@handle or link" maxLength={300} />
          </label>
        ))}
      </div>
      <div className="intel-form-actions">
        <label className="checkbox-field">
          <input type="checkbox" name="save" defaultChecked />
          <span>Save as my competitors</span>
        </label>
        <SyncButton label={hasChannels ? "Update & refresh" : "Start tracking"} />
      </div>
    </form>
  );

  return (
    <div className="dash intel">
      <header className="intel-top">
        <div className="intel-title">
          <span className="dash-icon" data-tone="violet">
            <UsersIcon size={16} />
          </span>
          <div>
            <h1>Competitors</h1>
            <p>
              {ws
                ? `${ws.competitors.length} competitor${ws.competitors.length === 1 ? "" : "s"}${ws.you ? ` vs ${ws.you.channel.title}` : ""}`
                : "How you stack up, who's growing, and what's working"}
            </p>
          </div>
        </div>
        {hasChannels ? (
          <details className="intel-edit">
            <summary>Edit channels</summary>
            {channelForm}
          </details>
        ) : null}
      </header>

      {status && STATUS_TEXT[status] ? (
        <div className="intel-status" data-tone={STATUS_TEXT[status]!.tone} role="status">
          {STATUS_TEXT[status]!.text}
        </div>
      ) : null}

      {!hasChannels ? (
        <section className="intel-card">
          <div className="dash-empty">
            <strong>Track your competitors</strong>
            <p>Add your channel and up to {MAX_COMPETITORS} competitors. Outlier keeps them refreshed and shows growth, breakouts, what&apos;s working, and gaps you can fill.</p>
          </div>
          {channelForm}
        </section>
      ) : ws ? (
        <>
          {ws.missing.length > 0 || ws.youPending ? (
            <div className="intel-status" data-tone="warn">
              Not loaded yet: {[...(ws.youPending ? [ws.youPending] : []), ...ws.missing].join(", ")}. Open Edit channels and click Update &amp; refresh.
            </div>
          ) : null}

          {ws.competitors.length === 0 ? (
            <div className="dash-empty">
              <strong>No competitor data yet</strong>
              <p>Open Edit channels and click Update &amp; refresh to load them.</p>
            </div>
          ) : (
            <>
              <Glance ws={ws} href={href} />

              <nav className="intel-tabs" aria-label="Competitor sections">
                {TABS.map((t) => {
                  const count = t.key === "alerts" ? ws.alerts.length : t.key === "insights" ? ws.opportunities.length : t.key === "content" ? ws.breakouts.length : 0;
                  return (
                    <Link key={t.key} href={href({ view: t.key })} className="intel-tab" aria-current={t.key === tab ? "page" : undefined} scroll={false}>
                      {t.label}
                      {count > 0 ? <span className="intel-tab-count">{count}</span> : null}
                    </Link>
                  );
                })}
              </nav>

              {tab === "overview" ? <OverviewTab ws={ws} sort={sort} href={href} /> : null}
              {tab === "growth" ? <GrowthTab ws={ws} /> : null}
              {tab === "content" ? <ContentTab ws={ws} /> : null}
              {tab === "insights" ? <InsightsTab ws={ws} /> : null}
              {tab === "alerts" ? <AlertsTab ws={ws} /> : null}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
