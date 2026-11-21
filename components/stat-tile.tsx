import { CountUp } from "./count-up";

export function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        <CountUp value={value} />
      </div>
      {note ? <div className="stat-note">{note}</div> : null}
    </div>
  );
}
