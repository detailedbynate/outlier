import { CountUp, Typewriter } from "./motion";

/**
 * Product previews for the landing page. The daily picks and video analysis use
 * real picks when there are some; otherwise, and in the other previews, skeleton
 * bars stand in for channels and the numbers are examples.
 */

/** A real daily pick, trimmed to what the previews show. */
export interface ShowcasePick {
  videoId: string;
  title: string;
  niche: string;
  views: number;
  medianViews: number;
  multiplier: number;
  viewsPerDay: number;
  /** Likes plus comments over views, 0–1; null when YouTube hides the counts. */
  engagement: number | null;
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Split a count into what CountUp animates: 214_000 → 214 "K", 2_930_000 → 2.9 "M". */
function units(n: number): { value: number; suffix: string; decimals: number } {
  if (n >= 1_000_000) return { value: n / 1_000_000, suffix: "M", decimals: 1 };
  if (n >= 10_000) return { value: n / 1_000, suffix: "K", decimals: 0 };
  if (n >= 1_000) return { value: n / 1_000, suffix: "K", decimals: 1 };
  return { value: n, suffix: "", decimals: 0 };
}

function SearchGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function ResearchMock() {
  return (
    <div className="mock">
      <div className="mock-search">
        <SearchGlyph />
        <span>
          &ldquo;
          <Typewriter phrases={["cooking hacks", "minecraft builds", "personal finance", "satisfying clips"]} />
          &rdquo;
        </span>
      </div>
      <div className="mock-chips">
        <span className="mock-chip">subs &lt; 10K</span>
        <span className="mock-chip">avg views &gt; 100K</span>
        <span className="mock-chip is-active">age &lt; 90d</span>
      </div>
      <div className="mock-rows">
        {["12.4×", "8.7×", "5.2×"].map((growth, i) => (
          <div key={growth} className="mock-row" style={{ animationDelay: `${i * 140}ms` }}>
            <span className="mock-avatar" />
            <span className="mock-lines">
              <span className="mock-line" style={{ width: `${78 - i * 6}%` }} />
              <span className="mock-line mock-line-sm" style={{ width: `${46 - i * 4}%` }} />
            </span>
            <span className="mock-growth">↑ {growth}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GrowthMock() {
  return (
    <div className="mock">
      <div className="mock-head">
        <span className="mock-avatar mock-avatar-lg" />
        <span className="mock-lines">
          <span className="mock-line" style={{ width: "54%" }} />
          <span className="mock-line mock-line-sm" style={{ width: "32%" }} />
        </span>
        <span className="mock-live">
          <span className="live-dot" aria-hidden="true" />
          Live
        </span>
      </div>
      <svg className="mock-chart" viewBox="0 0 320 120" preserveAspectRatio="none" aria-hidden="true">
        {[30, 60, 90].map((y) => (
          <line key={y} x1="0" x2="320" y1={y} y2={y} className="mock-grid" />
        ))}
        <path className="mock-area" d="M0 104 C40 100 60 96 90 90 S150 84 180 70 S240 30 270 22 S310 10 320 8 V120 H0 Z" fill="#8b5cf6" fillOpacity="0.14" />
        <path className="mock-path" d="M0 104 C40 100 60 96 90 90 S150 84 180 70 S240 30 270 22 S310 10 320 8" stroke="#8b5cf6" />
        <circle className="mock-dot" cx="320" cy="8" r="5" />
      </svg>
      <div className="mock-stats">
        <div>
          <strong className="mock-up">
            <CountUp value={1.2} prefix="+" suffix="M" decimals={1} />
          </strong>
          <span>views · 24h</span>
        </div>
        <div>
          <strong className="mock-up">
            <CountUp value={18.4} prefix="+" suffix="K" decimals={1} />
          </strong>
          <span>subs · 48h</span>
        </div>
      </div>
    </div>
  );
}

export function PicksMock({ picks: real = [] }: { picks?: ShowcasePick[] }) {
  if (real.length >= 3) {
    return (
      <div className="mock mock-picks">
        <div className="picks-stack">
          {real.slice(0, 3).map((pick) => (
            <div key={pick.videoId} className="pick-card">
              {/* eslint-disable-next-line @next/next/no-img-element -- YouTube's own thumbnail CDN */}
              <img className="pick-thumb" src={`https://i.ytimg.com/vi/${pick.videoId}/hqdefault.jpg`} alt="" loading="lazy" />
              <span className="mock-lines">
                <span className="pick-badge">{pick.niche}</span>
                <span className="pick-title">{pick.title}</span>
              </span>
              <span className="mock-growth">{compact.format(pick.views)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const picks = [
    { niche: "comedy", views: "3.4M" },
    { niche: "pets", views: "2.5M" },
    { niche: "tech", views: "5.9M" },
  ];
  return (
    <div className="mock mock-picks">
      <div className="picks-stack">
        {picks.map((pick, i) => (
          <div key={pick.niche} className="pick-card" style={{ animationDelay: `${i * -2}s` }}>
            <span className="pick-thumb" />
            <span className="mock-lines">
              <span className="pick-badge">{pick.niche}</span>
              <span className="mock-line" style={{ width: "70%" }} />
              <span className="mock-line mock-line-sm" style={{ width: "40%" }} />
            </span>
            <span className="mock-growth">{pick.views}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AnalyzeMock({ pick }: { pick?: ShowcasePick | null }) {
  const score = pick ? { value: pick.multiplier, suffix: "×", decimals: pick.multiplier >= 100 ? 0 : 1 } : { value: 8.4, suffix: "×", decimals: 1 };
  const perDay = pick ? units(pick.viewsPerDay) : { value: 214, suffix: "K", decimals: 0 };
  const engagement = pick ? (pick.engagement === null ? null : pick.engagement * 100) : 6.8;
  const median = pick ? units(pick.medianViews) : { value: 31, suffix: "K", decimals: 0 };
  return (
    <div className="mock mock-analyze">
      <div className="gauge">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="50" className="gauge-track" />
          <circle cx="60" cy="60" r="50" className="gauge-fill" stroke="#8b5cf6" />
        </svg>
        <div className="gauge-value">
          <strong>
            <CountUp {...score} />
          </strong>
          <span>outlier score</span>
        </div>
      </div>
      <div className="mock-kv">
        <div>
          <span>Views / day</span>
          <strong>
            <CountUp {...perDay} />
          </strong>
        </div>
        <div>
          <span>Engagement</span>
          <strong>{engagement === null ? "—" : <CountUp value={engagement} suffix="%" decimals={1} />}</strong>
        </div>
        <div>
          <span>Channel median</span>
          <strong>
            <CountUp {...median} />
          </strong>
        </div>
      </div>
      {pick ? <p className="mock-caption">Real numbers from a recent daily pick: {pick.title}</p> : null}
    </div>
  );
}
