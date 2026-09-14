import { CountUp, TiltCard, Typewriter } from "./motion";

/**
 * Illustrative product previews for the landing page. They show what each tool
 * looks like; skeleton bars stand in for real channels, and numbers are examples.
 */

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
    <TiltCard className="mock">
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
    </TiltCard>
  );
}

export function GrowthMock() {
  return (
    <TiltCard className="mock">
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
        <defs>
          <linearGradient id="mock-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8b5cf6" stopOpacity="0.35" />
            <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="mock-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#6366f1" />
            <stop offset="1" stopColor="#ec4899" />
          </linearGradient>
        </defs>
        {[30, 60, 90].map((y) => (
          <line key={y} x1="0" x2="320" y1={y} y2={y} className="mock-grid" />
        ))}
        <path className="mock-area" d="M0 104 C40 100 60 96 90 90 S150 84 180 70 S240 30 270 22 S310 10 320 8 V120 H0 Z" fill="url(#mock-area)" />
        <path className="mock-path" d="M0 104 C40 100 60 96 90 90 S150 84 180 70 S240 30 270 22 S310 10 320 8" stroke="url(#mock-line)" />
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
    </TiltCard>
  );
}

export function PicksMock() {
  const picks = [
    { niche: "comedy", views: "3.4M" },
    { niche: "pets", views: "2.5M" },
    { niche: "tech", views: "5.9M" },
  ];
  return (
    <TiltCard className="mock mock-picks">
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
    </TiltCard>
  );
}

export function AnalyzeMock() {
  return (
    <TiltCard className="mock mock-analyze">
      <div className="gauge">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <defs>
            <linearGradient id="gauge-stroke" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fb923c" />
              <stop offset="0.5" stopColor="#ec4899" />
              <stop offset="1" stopColor="#8b5cf6" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="50" className="gauge-track" />
          <circle cx="60" cy="60" r="50" className="gauge-fill" stroke="url(#gauge-stroke)" />
        </svg>
        <div className="gauge-value">
          <strong>
            <CountUp value={8.4} suffix="×" decimals={1} />
          </strong>
          <span>outlier score</span>
        </div>
      </div>
      <div className="mock-kv">
        <div>
          <span>Views / day</span>
          <strong>
            <CountUp value={214} suffix="K" />
          </strong>
        </div>
        <div>
          <span>Engagement</span>
          <strong>
            <CountUp value={6.8} suffix="%" decimals={1} />
          </strong>
        </div>
        <div>
          <span>Channel median</span>
          <strong>
            <CountUp value={31} suffix="K" />
          </strong>
        </div>
      </div>
    </TiltCard>
  );
}
