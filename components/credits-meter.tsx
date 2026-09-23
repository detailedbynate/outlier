import Link from "next/link";
import type { CreditStatus } from "@/lib/services/credits-service";
import { CoinsIcon } from "./icons";

function resetsIn(resetsAt: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((Date.parse(resetsAt) - now.getTime()) / 60_000));
  const days = Math.floor(minutes / 1440);
  if (days >= 1) return `${days}d`;
  const h = Math.floor(minutes / 60);
  return h > 0 ? `${h}h ${minutes % 60}m` : `${minutes}m`;
}

/** Which plan they're on, where they'll see it every page. Free gets the way up instead. */
export type SidebarPlan = "owner" | "free" | "pro" | "expert";

const PLAN_LABEL: Record<SidebarPlan, string> = { owner: "Owner", free: "Free", pro: "Pro", expert: "Expert" };

function PlanChip({ plan }: { plan: SidebarPlan }) {
  if (plan === "free") {
    return (
      <Link href="/billing" className="plan-chip" data-plan="free">
        Upgrade
      </Link>
    );
  }
  return (
    <span className="plan-chip" data-plan={plan}>
      {PLAN_LABEL[plan]}
    </span>
  );
}

/** Sidebar widget: this month's credit usage, extra credits, and where to buy more. */
export function CreditsMeter({ status, plan }: { status: CreditStatus; plan?: SidebarPlan }) {
  // Owner accounts have an effectively unlimited allowance.
  if (status.limit >= 1_000_000) {
    return (
      <div className="credits glass" data-level="ok">
        <div className="credits-head">
          <span className="credits-icon">
            <CoinsIcon size={15} />
          </span>
          <span className="credits-title">Credits</span>
          {plan ? <PlanChip plan={plan} /> : null}
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
        <span className="credits-title">Credits</span>
        {plan ? <PlanChip plan={plan} /> : null}
      </div>
      <div className="credits-value">
        <strong>{status.remaining}</strong>
        <span> / {status.limit} left</span>
      </div>
      <div
        className="credits-bar"
        role="meter"
        aria-label="Credits used this month"
        aria-valuemin={0}
        aria-valuemax={status.limit}
        aria-valuenow={status.used}
      >
        <span style={{ width: `${Math.min(share, 1) * 100}%` }} />
      </div>
      <div className="credits-foot">
        {status.used} used · resets in {resetsIn(status.resetsAt)}
        {status.extra > 0 ? ` · ${status.extra} bought` : ""}
      </div>
      <Link href="/billing" className="credits-buy">
        Buy credits
      </Link>
    </div>
  );
}
