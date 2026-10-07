import Link from "next/link";
import type { CSSProperties } from "react";
import { formatCompact, formatPercent } from "@/lib/format";
import type { NicheMetrics } from "@/lib/niches/analysis";
import type { NicheFit } from "@/lib/niches/fit";
import type { NichePatterns, ScorePartKey, TitleTraitKey, WeekBucket } from "@/lib/niches/insights";
import type { SavedNiche } from "@/lib/niches/saved";
import type { GameAlert } from "@/lib/niches/alerts";
import { toggleSavedNiche } from "./actions";

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Weak, middling, strong: the same three colours every bar here uses. */
function tone(share: number): "low" | "mid" | "high" {
  return share >= 0.66 ? "high" : share >= 0.4 ? "mid" : "low";
}

/* ---------------------------------------------------------------------------
   Score breakdown
--------------------------------------------------------------------------- */

const PART_LABEL: Record<ScorePartKey, string> = {
  demand: "Demand",
  growth: "Momentum",
  viral: "Breakouts",
  small: "Room for small channels",
  competition: "Spread-out competition",
};

function partDetail(key: ScorePartKey, m: NicheMetrics): string {
  switch (key) {
    case "demand":
      return `${formatCompact(m.medianViewsPerDay)} views a day for a typical recent upload`;
    case "growth":
      return m.growth === null ? "Not enough history yet, so it counts as neutral" : `Newest uploads get ${m.growth >= 0 ? "+" : ""}${Math.round(m.growth * 100)}% views a day vs older ones`;
    case "viral":
      return `${formatPercent(m.viralRate, 0)} of uploads hit 3× their channel's usual views`;
    case "small":
      return m.smallChannelShare === null ? "No breakouts yet, so it counts as neutral" : `${formatPercent(m.smallChannelShare, 0)} of breakouts come from channels under 100K`;
    case "competition":
      return `The top 3 channels take ${formatPercent(m.concentration, 0)} of the views`;
  }
}

export function ScoreBreakdown({ metrics }: { metrics: NicheMetrics }) {
  const parts = metrics.scoreParts;
  if (!parts?.length) return null;
  return (
    <section className="niche-panel niche-breakdown" aria-label="How the score is made">
      <header className="niche-panel-head">
        <h3>Why it scores {metrics.opportunity}</h3>
        <p>Five things make up the opportunity score. Each bar shows how the niche does on it.</p>
      </header>
      <ul className="niche-parts">
        {parts.map((p) => {
          const points = Math.round(p.score * p.weight * 100);
          return (
            <li key={p.key}>
              <div className="niche-part-top">
                <strong>{PART_LABEL[p.key]}</strong>
                <span className="niche-part-points">
                  {points}
                  <em> / {Math.round(p.weight * 100)}</em>
                </span>
              </div>
              <span className="niche-bar" data-tone={tone(p.score)} aria-hidden="true">
                <span style={{ width: `${Math.max(p.score * 100, 2)}%` }} />
              </span>
              <span className="niche-part-detail">{partDetail(p.key, metrics)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------------------
   Weekly trend
--------------------------------------------------------------------------- */

/** The two newest weeks are still collecting views, so they're drawn lighter. */
const SETTLING_WEEKS = 2;
/** A median of fewer uploads than this is one or two videos, not a trend. */
const MIN_WEEK_UPLOADS = 5;

/**
 * Typical views for each week's uploads. No verdict on top: older uploads have
 * had longer to collect views, and upload counts grow as Outlier tracks more
 * channels, so a single "up/down" number would mostly measure those instead.
 */
export function TrendChart({ weekly }: { weekly: WeekBucket[] | undefined }) {
  if (!weekly || weekly.filter((w) => w.uploads >= MIN_WEEK_UPLOADS).length < 4) return null;
  const solid = (w: WeekBucket) => w.uploads >= MIN_WEEK_UPLOADS;
  const max = Math.max(...weekly.filter(solid).map((w) => w.medianViews), 1);

  return (
    <section className="niche-panel niche-trend" aria-label="Uploads by week">
      <header className="niche-panel-head">
        <h3>Week by week</h3>
        <p>Typical views for the uploads from each week. Older weeks have had longer to collect views, so compare weeks that sit close together.</p>
      </header>
      <div className="niche-trend-bars">
        {weekly.map((w, i) => {
          const settling = i >= weekly.length - SETTLING_WEEKS;
          const thin = !solid(w);
          return (
            <div
              key={w.weekStart}
              className="niche-trend-col"
              data-settling={settling || undefined}
              data-thin={thin || undefined}
              title={`${w.uploads} uploads · ${formatCompact(w.medianViews)} typical views`}
            >
              <span className="niche-trend-value">{thin ? "few" : formatCompact(w.medianViews)}</span>
              <span className="niche-trend-track">
                <span className="niche-trend-fill" style={{ height: `${thin ? 3 : Math.min(Math.max((w.medianViews / max) * 100, 3), 100)}%` }} />
              </span>
              <span className="niche-trend-date">{shortDate.format(new Date(w.weekStart))}</span>
              <span className="niche-trend-uploads">{w.uploads}</span>
            </div>
          );
        })}
      </div>
      <p className="niche-panel-note">
        Bottom numbers are uploads that week in Outlier&apos;s data. The dashed bars are the last two weeks, which are still picking up views; &ldquo;few&rdquo; means
        under {MIN_WEEK_UPLOADS} uploads, too few to call.
      </p>
    </section>
  );
}

/* ---------------------------------------------------------------------------
   What breakouts have in common
--------------------------------------------------------------------------- */

const TRAIT_LABEL: Record<TitleTraitKey, string> = {
  number: "Has a number",
  question: "Asks a question",
  caps: "A word in CAPS",
  you: 'Talks to "you"',
  emoji: "Uses an emoji",
};

function duration(seconds: number): string {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : `${seconds}s`;
}

export function Patterns({ patterns, topic }: { patterns: NichePatterns | undefined; topic: string }) {
  if (!patterns) return null;
  const traits = patterns.traits.filter((t) => t.breakout >= 0.05 || t.all >= 0.05);
  const dayTotal = patterns.days.reduce((s, d) => s + d.uploads, 0);
  const days = dayTotal >= 30 ? patterns.days : null;
  const bestDay = days ? days.reduce((best, d) => (d.uploads >= 3 && d.breakoutRate > best.breakoutRate ? d : best), days[0]!) : null;
  const maxRate = days ? Math.max(...days.map((d) => d.breakoutRate), 0.01) : 1;

  return (
    <section className="niche-panel niche-patterns" aria-label={`What works in ${topic}`}>
      <header className="niche-panel-head">
        <h3>What the breakouts have in common</h3>
        <p>From {patterns.breakouts} uploads that got 3× their channel&apos;s usual views, compared with everything else in {topic}.</p>
      </header>

      <div className="niche-pattern-grid">
        {patterns.words.length > 0 ? (
          <div className="niche-pattern">
            <h4>Words in breakout titles</h4>
            <div className="niche-words">
              {patterns.words.map((w) => (
                <span key={w.word} className="niche-word" title={`In ${w.breakouts} breakout titles`}>
                  {w.word} <em>{w.lift}×</em>
                </span>
              ))}
            </div>
            <p className="niche-panel-note">How much more often each word shows up in breakouts than in the niche overall.</p>
          </div>
        ) : null}

        {traits.length > 0 ? (
          <div className="niche-pattern">
            <h4>Title habits</h4>
            <ul className="niche-traits">
              {traits.map((t) => (
                <li key={t.key}>
                  <span className="niche-trait-label">{TRAIT_LABEL[t.key]}</span>
                  <span className="niche-trait-bars" aria-hidden="true">
                    <span className="niche-trait-bar" data-kind="breakout" style={{ width: `${t.breakout * 100}%` }} />
                    <span className="niche-trait-bar" data-kind="all" style={{ width: `${t.all * 100}%` }} />
                  </span>
                  <span className="niche-trait-value">
                    {formatPercent(t.breakout, 0)} <em>vs {formatPercent(t.all, 0)}</em>
                  </span>
                </li>
              ))}
            </ul>
            <p className="niche-panel-note">
              <span className="niche-key" data-kind="breakout" /> breakouts <span className="niche-key" data-kind="all" /> everything.
              Breakout titles run {patterns.titleLength.breakout} words, the rest {patterns.titleLength.all}.
              {patterns.length.breakout !== null && patterns.length.all !== null
                ? ` Breakouts are ${duration(patterns.length.breakout)} long, the rest ${duration(patterns.length.all)}.`
                : ""}
            </p>
          </div>
        ) : null}

        {days ? (
          <div className="niche-pattern">
            <h4>Breakouts by upload day</h4>
            <div className="niche-days">
              {days.map((d) => (
                <div key={d.day} className="niche-day" data-best={bestDay?.day === d.day || undefined} title={`${d.uploads} uploads, ${formatPercent(d.breakoutRate, 0)} broke out`}>
                  <span className="niche-day-track">
                    <span style={{ height: `${Math.max((d.breakoutRate / maxRate) * 100, 3)}%` }} />
                  </span>
                  <span className="niche-day-name">{DAY_NAMES[d.day]}</span>
                </div>
              ))}
            </div>
            <p className="niche-panel-note">
              {bestDay && bestDay.breakoutRate > 0
                ? `${DAY_NAMES[bestDay.day]} uploads broke out most often (${formatPercent(bestDay.breakoutRate, 0)}). Days are in UTC.`
                : "Days are in UTC."}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
   How you'd fit
--------------------------------------------------------------------------- */

export function FitPanel({ fit, channelTitle, hasChannel }: { fit: NicheFit | null; channelTitle: string | null; hasChannel: boolean }) {
  if (!hasChannel) {
    return (
      <section className="niche-panel niche-fit" data-verdict="none" aria-label="How you'd fit">
        <header className="niche-panel-head">
          <h3>How you&apos;d fit</h3>
          <p>
            Add your channel in <Link href="/settings/preferences">Preferences</Link> to see how it compares with channels in this niche.
          </p>
        </header>
      </section>
    );
  }
  if (!fit || !channelTitle) return null;
  return (
    <section className="niche-panel niche-fit" data-verdict={fit.verdict} aria-label="How you'd fit">
      <header className="niche-panel-head">
        <h3>How {channelTitle} would fit</h3>
        <p>{fit.headline}</p>
      </header>
      <ul className="niche-fit-rows">
        {fit.rows.map((r) => {
          const top = Math.max(r.you, r.them, 1);
          return (
            <li key={r.key}>
              <span className="niche-fit-label">{r.label}</span>
              <span className="niche-fit-pair">
                <span className="niche-fit-bar" data-kind="you" style={{ width: `${Math.max((r.you / top) * 100, 2)}%` } as CSSProperties} />
                <span className="niche-fit-bar" data-kind="them" style={{ width: `${Math.max((r.them / top) * 100, 2)}%` } as CSSProperties} />
              </span>
              <span className="niche-fit-values">
                <strong>{formatCompact(r.you)}</strong> you
                <em>
                  {formatCompact(r.them)} {r.themLabel}
                </em>
              </span>
            </li>
          );
        })}
      </ul>
      {fit.sizeNote ? <p className="niche-panel-note">{fit.sizeNote}</p> : null}
    </section>
  );
}

/* ---------------------------------------------------------------------------
   Save and compare
--------------------------------------------------------------------------- */

export function SaveNicheButton({ topic, score, saved }: { topic: string; score: number; saved: boolean }) {
  return (
    <form action={toggleSavedNiche} className="niche-save">
      <input type="hidden" name="topic" value={topic} />
      <input type="hidden" name="score" value={score} />
      <input type="hidden" name="save" value={saved ? "0" : "1"} />
      <button type="submit" className="niche-save-button" data-saved={saved || undefined} title={saved ? "Remove from your saved niches" : "Keep an eye on this niche"}>
        <span aria-hidden="true">{saved ? "★" : "☆"}</span> {saved ? "Saved" : "Save niche"}
      </button>
    </form>
  );
}

export function CompareBox({ topic }: { topic: string }) {
  return (
    <form method="get" action="/research/niche-finder/compare" className="niche-compare-box">
      <input type="hidden" name="a" value={topic} />
      <label htmlFor="compare-b" className="sr-only">
        Compare {topic} with
      </label>
      <input id="compare-b" name="b" placeholder="Compare with another niche…" maxLength={60} required autoComplete="off" />
      <button type="submit">Compare</button>
    </form>
  );
}

export function SavedNiches({ niches }: { niches: (SavedNiche & { current: number | null; alert?: GameAlert | null })[] }) {
  if (niches.length === 0) return null;
  const heating = niches.filter((n) => n.alert?.tone === "up").length;
  return (
    <section className="niche-panel niche-saved" aria-label="Your saved niches">
      <header className="niche-panel-head">
        <h3>Your saved niches</h3>
        <p>
          Scores now, and how they&apos;ve moved since you saved them.
          {heating > 0 ? <strong className="niche-saved-heating"> {heating === 1 ? "1 is heating up." : `${heating} are heating up.`}</strong> : null}
        </p>
      </header>
      <ul className="niche-saved-list">
        {niches.map((n) => {
          const now = n.current ?? n.score;
          const delta = n.current === null ? 0 : n.current - n.score;
          return (
            <li key={n.key}>
              <Link href={`/research/niche-finder?topic=${encodeURIComponent(n.topic)}`} className="niche-saved-item">
                <span className="niche-saved-name">{n.topic}</span>
                <span className="niche-saved-score" data-band={now >= 65 ? "high" : now >= 45 ? "mid" : "low"}>
                  {now}
                </span>
                <span className="niche-saved-delta" data-dir={delta > 0 ? "up" : delta < 0 ? "down" : "flat"}>
                  {delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${-delta}` : "No change"}
                </span>
                {n.alert ? (
                  <span className="niche-saved-alert" data-dir={n.alert.tone}>
                    {n.alert.text}
                  </span>
                ) : null}
              </Link>
              <form action={toggleSavedNiche}>
                <input type="hidden" name="topic" value={n.topic} />
                <input type="hidden" name="save" value="0" />
                <button type="submit" className="niche-saved-remove" aria-label={`Remove ${n.topic}`} title="Remove">
                  ×
                </button>
              </form>
            </li>
          );
        })}
      </ul>
      {niches.length >= 2 ? (
        <form method="get" action="/research/niche-finder/compare" className="niche-saved-compare">
          <span>Compare</span>
          <select name="a" defaultValue={niches[0]!.topic} aria-label="First niche">
            {niches.map((n) => (
              <option key={n.key} value={n.topic}>
                {n.topic}
              </option>
            ))}
          </select>
          <span>with</span>
          <select name="b" defaultValue={niches[1]!.topic} aria-label="Second niche">
            {niches.map((n) => (
              <option key={n.key} value={n.topic}>
                {n.topic}
              </option>
            ))}
          </select>
          <button type="submit">Compare</button>
        </form>
      ) : null}
    </section>
  );
}
