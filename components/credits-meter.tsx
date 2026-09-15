import type { CreditStatus } from "@/lib/services/credits-service";
import { CoinsIcon } from "./icons";

function resetsIn(resetsAt: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((Date.parse(resetsAt) - now.getTime()) / 60_000));
  const h = Math.floor(minutes / 60);
  return h > 0 ? `${h}h ${minutes % 60}m` : `${minutes}m`;
}

/** Sidebar widget: today's credit usage. */
export function CreditsMeter({ status }: { status: CreditStatus }) {
  // Owner accounts have an effectively unlimited allowance.
  if (status.limit >= 1_000_000) {
    return (
      <div className="credits glass" data-level="ok">
        <div className="credits-head">
          <span className="credits-icon">
            <CoinsIcon size={15} />
          </span>
          <span className="credits-title">Daily credits</span>
        </div>
        <div className="credits-value">
          <strong>Unlimited</strong>
        </div>
      </div>
    );
  }
  const share = status.limit === 0 ? 1 : status.used / status.limit;
  const level = share >= 1 ? "empty" : share >= 0.8 ? "low" : "ok";
  return (
    <div className="credits glass" data-level={level}>
      <div className="credits-head">
        <span className="credits-icon">
          <CoinsIcon size={15} />
        </span>
        <span className="credits-title">Daily credits</span>
      </div>
      <div className="credits-value">
        <strong>{status.remaining}</strong>
        <span> / {status.limit} left</span>
      </div>
      <div
        className="credits-bar"
        role="meter"
        aria-label="Credits used today"
        aria-valuemin={0}
        aria-valuemax={status.limit}
        aria-valuenow={status.used}
      >
        <span style={{ width: `${Math.min(share, 1) * 100}%` }} />
      </div>
      <div className="credits-foot">
        {status.used} used · resets in {resetsIn(status.resetsAt)}
      </div>
    </div>
  );
}
