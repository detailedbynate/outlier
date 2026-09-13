import { formatBytes } from "@/lib/format";
import type { StorageStatus } from "@/lib/services/storage-budget-service";

const LEVEL_LABEL: Record<StorageStatus["level"], string> = {
  ok: "Healthy",
  warning: "Nearing budget",
  over_budget: "Budget reached — syncing paused",
};

export function StorageMeter({ status }: { status: StorageStatus }) {
  const pct = Math.min(status.budgetUsed, 1) * 100;
  return (
    <div className="card">
      <div className="spread">
        <span className="stat-label">Database storage</span>
        <span className="status" data-level={status.level}>
          {LEVEL_LABEL[status.level]}
        </span>
      </div>
      <div className="stat-value">{formatBytes(status.usedBytes)}</div>
      <div
        className="meter"
        data-level={status.level}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={status.budgetBytes}
        aria-valuenow={status.usedBytes}
        aria-label="Database storage used of budget"
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="stat-note">
        {Math.round(status.budgetUsed * 100)}% of {formatBytes(status.budgetBytes)} budget · plan limit{" "}
        {formatBytes(status.planLimitBytes)}
      </div>
    </div>
  );
}
