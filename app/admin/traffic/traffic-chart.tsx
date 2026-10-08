"use client";

import { useId, useState, useSyncExternalStore, type PointerEvent, type ReactNode } from "react";

export interface ChartPoint {
  /** A day (YYYY-MM-DD) or, on the 24-hour view, an hour as an ISO timestamp. */
  at: string;
  visitors: number;
  pageviews: number;
  checkouts: number;
}

const SERIES = [
  { key: "visitors", label: "Visitors" },
  { key: "pageviews", label: "Page views" },
] as const;
type SeriesKey = (typeof SERIES)[number]["key"];

const W = 1000;
const H = 260;
const noop = () => () => {};

/** Hours are shown in the viewer's time zone, but only after hydrating, so the server's render still matches. */
function useMounted(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

function niceMax(value: number): number {
  if (value <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= value) return m * step;
  return 10 * step;
}

/** A smooth line through the points that never overshoots (monotone cubic, Fritsch–Carlson). */
function smoothPath(xs: number[], ys: number[]): string {
  const n = xs.length;
  if (n === 0) return "";
  if (n === 1) return `M${xs[0]},${ys[0]}`;
  const d = xs.slice(1).map((x, i) => (ys[i + 1]! - ys[i]!) / (x - xs[i]!));
  const m = xs.map((_, i) => {
    if (i === 0) return d[0]!;
    if (i === n - 1) return d[n - 2]!;
    return d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
  });
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d[i]!;
    const b = m[i + 1]! / d[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i]!;
      m[i + 1] = t * b * d[i]!;
    }
  }
  let path = `M${xs[0]},${ys[0]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (xs[i + 1]! - xs[i]!) / 3;
    path += ` C${xs[i]! + h},${ys[i]! + m[i]! * h} ${xs[i + 1]! - h},${ys[i + 1]! - m[i + 1]! * h} ${xs[i + 1]},${ys[i + 1]}`;
  }
  return path;
}

export function TrafficChart({ points, hourly, heading }: { points: ChartPoint[]; hourly: boolean; heading: ReactNode }) {
  const [series, setSeries] = useState<SeriesKey>("visitors");
  const [hover, setHover] = useState<number | null>(null);
  const mounted = useMounted();
  const gradientId = useId();

  const label = (at: string, long = false) => {
    if (!hourly) {
      return new Date(`${at}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(long ? { weekday: "short" } : {}) });
    }
    return new Date(at).toLocaleTimeString("en-US", { timeZone: mounted ? undefined : "UTC", hour: "numeric" });
  };

  const values = points.map((p) => p[series]);
  const max = niceMax(Math.max(0, ...values));
  const step = points.length > 1 ? W / (points.length - 1) : 0;
  const xs = points.map((_, i) => (points.length > 1 ? i * step : W / 2));
  const ys = values.map((v) => H - (v / max) * H);
  const line = smoothPath(xs, ys);
  const area = line ? `${line} L${xs.at(-1)},${H} L${xs[0]},${H} Z` : "";
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => Math.round(max * f));
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setHover(points.length > 1 ? Math.round(fraction * (points.length - 1)) : 0);
  };

  const active = hover === null ? null : points[hover];
  const leftPct = (i: number) => (xs[i]! / W) * 100;
  const topPct = (i: number) => (ys[i]! / H) * 100;

  return (
    <section className="card traffic-chart-card">
      <div className="traffic-card-head">
        {heading}
        <div className="traffic-segmented" role="group" aria-label="Line shows">
          {SERIES.map((s) => (
            <button key={s.key} type="button" aria-pressed={series === s.key} onClick={() => setSeries(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="traffic-plot">
        <div className="traffic-plot-y" aria-hidden="true">
          {ticks.map((t, i) => (
            <span key={i}>{t.toLocaleString("en-US")}</span>
          ))}
        </div>
        <div
          className="traffic-plot-area"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`${SERIES.find((s) => s.key === series)!.label} ${hourly ? "an hour" : "a day"}`}
        >
          <div className="traffic-plot-grid" aria-hidden="true">
            {ticks.map((_, i) => (
              <span key={i} />
            ))}
          </div>
          <svg key={series} className="traffic-plot-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.38" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path className="traffic-plot-fill" d={area} fill={`url(#${gradientId})`} />
            <path className="traffic-plot-glow" d={line} vectorEffect="non-scaling-stroke" />
            <path className="traffic-plot-line" d={line} vectorEffect="non-scaling-stroke" />
          </svg>
          {points.map((p, i) =>
            p.checkouts > 0 ? (
              <span key={p.at} className="traffic-plot-mark" style={{ left: `${leftPct(i)}%` }} title={`${p.checkouts} checkout${p.checkouts === 1 ? "" : "s"} started`} />
            ) : null,
          )}
          {active && hover !== null ? (
            <>
              <span className="traffic-plot-guide" style={{ left: `${leftPct(hover)}%` }} />
              <span className="traffic-plot-dot" style={{ left: `${leftPct(hover)}%`, top: `${topPct(hover)}%` }} />
              <div
                className="traffic-plot-tip"
                data-side={leftPct(hover) > 70 ? "left" : "right"}
                style={{ left: `${leftPct(hover)}%`, top: `${topPct(hover)}%` }}
              >
                <div>
                  <strong>{active[series].toLocaleString("en-US")}</strong> {series === "visitors" ? "visitors" : "views"}
                </div>
                <span>
                  {label(active.at, true)}
                  {series === "visitors" ? ` · ${active.pageviews.toLocaleString("en-US")} views` : ` · ${active.visitors.toLocaleString("en-US")} visitors`}
                  {active.checkouts > 0 ? ` · ${active.checkouts} checkout${active.checkouts === 1 ? "" : "s"}` : ""}
                </span>
              </div>
            </>
          ) : null}
        </div>
        <div className="traffic-plot-x" aria-hidden="true">
          {points.map((p, i) => (
            <span key={p.at} style={{ left: `${leftPct(i)}%` }} data-show={i % labelEvery === 0 || undefined}>
              {label(p.at)}
            </span>
          ))}
        </div>
      </div>
      {hourly ? null : (
        <p className="stat-note traffic-plot-legend">
          <span className="traffic-plot-mark-key" /> a checkout started that day
        </p>
      )}
    </section>
  );
}
