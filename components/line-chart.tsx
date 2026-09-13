"use client";

import { useMemo, useRef, useState } from "react";

export interface LinePoint {
  /** ISO timestamp */
  t: string;
  value: number;
}

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 12, right: 16, bottom: 28, left: 56 };

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en-US");
const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.01, 1);
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(v);
  return ticks;
}

/** Single-series line chart (2px line, area wash, crosshair + tooltip on hover, table fallback). */
export function LineChart({ points, label }: { points: LinePoint[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const geometry = useMemo(() => {
    const times = points.map((p) => Date.parse(p.t));
    const values = points.map((p) => p.value);
    const ticks = niceTicks(Math.min(...values), Math.max(...values));
    const yMin = ticks[0]!;
    const yMax = ticks.at(-1)!;
    const tMin = Math.min(...times);
    const tMax = Math.max(...times);
    const x = (t: number) =>
      PAD.left + (tMax === tMin ? (WIDTH - PAD.left - PAD.right) / 2 : ((t - tMin) / (tMax - tMin)) * (WIDTH - PAD.left - PAD.right));
    const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * (HEIGHT - PAD.top - PAD.bottom);
    const coords = points.map((p, i) => ({ x: x(times[i]!), y: y(p.value) }));
    const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
    const baseY = HEIGHT - PAD.bottom;
    const area = coords.length > 1 ? `${line} L${coords.at(-1)!.x.toFixed(1)},${baseY} L${coords[0]!.x.toFixed(1)},${baseY} Z` : "";
    const xLabels = coords.length > 1 ? [0, Math.floor((coords.length - 1) / 2), coords.length - 1] : [0];
    return { ticks, y, coords, line, area, xLabels: [...new Set(xLabels)] };
  }, [points]);

  if (points.length === 0) return <p className="muted">No history yet — it builds up with each daily sync.</p>;

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((event.clientX - rect.left) / rect.width) * WIDTH;
    let best = 0;
    geometry.coords.forEach((c, i) => {
      if (Math.abs(c.x - px) < Math.abs(geometry.coords[best]!.x - px)) best = i;
    });
    setHover(best);
  };

  const active = hover === null ? null : { point: points[hover]!, coord: geometry.coords[hover]! };
  const last = geometry.coords.at(-1)!;

  return (
    <div className="chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${label} over time`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {geometry.ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={geometry.y(tick)} y2={geometry.y(tick)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 8} y={geometry.y(tick)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--text-muted)">
              {compact.format(tick)}
            </text>
          </g>
        ))}
        {geometry.xLabels.map((i) => (
          <text
            key={i}
            x={geometry.coords[i]!.x}
            y={HEIGHT - 8}
            textAnchor={geometry.xLabels.length === 1 ? "middle" : i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            fontSize={11}
            fill="var(--text-muted)"
          >
            {dateFmt.format(new Date(points[i]!.t))}
          </text>
        ))}
        {geometry.area ? <path d={geometry.area} fill="var(--accent-wash)" /> : null}
        <path d={geometry.line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={last.x} cy={last.y} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
        {active ? (
          <g>
            <line x1={active.coord.x} x2={active.coord.x} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="var(--axis)" strokeWidth={1} />
            <circle cx={active.coord.x} cy={active.coord.y} r={5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        ) : null}
      </svg>
      {active ? (
        <div
          className="chart-tooltip"
          style={{ left: `${(active.coord.x / WIDTH) * 100}%`, top: `${(active.coord.y / HEIGHT) * 100}%` }}
        >
          <div className="muted">{new Date(active.point.t).toLocaleString()}</div>
          <strong>{full.format(active.point.value)}</strong> {label.toLowerCase()}
        </div>
      ) : null}
      <details style={{ marginTop: 8 }}>
        <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>
          View as table
        </summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th className="num">{label}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.t}>
                  <td>{new Date(p.t).toLocaleString()}</td>
                  <td className="num">{full.format(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
