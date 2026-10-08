"use client";

import { useSyncExternalStore, type CSSProperties } from "react";

export interface HourCount {
  dow: number;
  hour: number;
  visitors: number;
  pageviews: number;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Rows of four hours, as on most activity heatmaps: 12am, 4am, 8am...
const BLOCKS = [0, 4, 8, 12, 16, 20];
const noop = () => () => {};

const hourLabel = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? "am" : "pm"}`;

/**
 * When page views happen, by weekday and time of day. Counted in UTC by the
 * database and moved to the viewer's time zone here, after hydrating (the
 * server renders UTC so the first paint matches).
 */
export function ActivityHeatmap({ hours }: { hours: HourCount[] }) {
  const offsetHours = useSyncExternalStore(noop, () => -Math.round(new Date().getTimezoneOffset() / 60), () => 0);
  // cells[day][block], Monday first.
  const cells = DAYS.map(() => BLOCKS.map(() => 0));
  for (const h of hours) {
    const local = (((h.dow * 24 + h.hour + offsetHours) % 168) + 168) % 168;
    const day = (Math.floor(local / 24) + 6) % 7;
    cells[day]![Math.floor((local % 24) / 4)]! += h.pageviews;
  }
  const peak = Math.max(0, ...cells.flat());
  let busiest: { day: number; block: number } | null = null;
  cells.forEach((row, day) =>
    row.forEach((n, block) => {
      if (n > 0 && n === peak && !busiest) busiest = { day, block };
    }),
  );
  const best = busiest as { day: number; block: number } | null;

  return (
    <div className="traffic-heat">
      <div className="traffic-heat-grid" role="table" aria-label="Page views by weekday and time of day">
        <span />
        {DAYS.map((d) => (
          <span key={d} className="traffic-heat-day" role="columnheader">
            {d}
          </span>
        ))}
        {BLOCKS.map((start, block) => (
          <div key={start} className="traffic-heat-row" role="row">
            <span className="traffic-heat-hour" role="rowheader">
              {hourLabel(start)}
            </span>
            {DAYS.map((d, day) => {
              const n = cells[day]![block]!;
              return (
                <span
                  key={d}
                  role="cell"
                  className="traffic-heat-cell"
                  data-empty={n === 0 || undefined}
                  title={`${d} ${hourLabel(start)}–${hourLabel((start + 4) % 24)}: ${n.toLocaleString("en-US")} page view${n === 1 ? "" : "s"}`}
                  style={{ "--level": peak > 0 ? 0.18 + (n / peak) * 0.82 : 0, "--i": day + block } as CSSProperties}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="traffic-heat-foot stat-note">
        <span>{best ? `Busiest: ${DAYS[best.day]} ${hourLabel(BLOCKS[best.block]!)}–${hourLabel((BLOCKS[best.block]! + 4) % 24)}` : "No page views yet."}</span>
        <span className="traffic-heat-scale" aria-hidden="true">
          Less
          {[0.18, 0.4, 0.6, 0.8, 1].map((l) => (
            <i key={l} style={{ "--level": l } as CSSProperties} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}
