import type { Metadata } from "next";
import { UsersIcon } from "@/components/icons";
import { ReferralShare } from "@/components/referral-share";
import { requireApprovedUser } from "@/lib/auth/session";
import { formatNumber } from "@/lib/format";
import { referralLinks } from "@/lib/referrals/links";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Refer friends · Outlier" };

export default async function ReferralsPage() {
  const { user, email } = await requireApprovedUser();
  const summary = await getServices().referrals.summary(user.id, email || null);
  const links = await referralLinks(summary.code);

  const stats = [
    { label: "Friends who joined the waitlist", value: formatNumber(summary.signups) },
    { label: "Friends with an account", value: formatNumber(summary.accounts) },
    { label: "Bonus credits earned", value: formatNumber(summary.creditsEarned) },
  ];

  return (
    <div className="dash">
      <header className="intel-top">
        <div className="intel-title">
          <span className="dash-icon" data-tone="pink">
            <UsersIcon size={16} />
          </span>
          <div>
            <h1>Refer friends</h1>
            <p>Give friends early access and earn bonus credits.</p>
          </div>
        </div>
      </header>

      <section className="intel-card">
        <ReferralShare link={links.share} signups={summary.signups} threshold={summary.threshold} compact />
      </section>

      <div className="intel-glance referral-stats">
        {stats.map((s) => (
          <div key={s.label} className="intel-glance-item">
            <span className="intel-glance-label">{s.label}</span>
            <span className="intel-glance-value">{s.value}</span>
          </div>
        ))}
      </div>

      <section className="intel-card">
        <header className="intel-card-head">
          <div>
            <h2>How it works</h2>
          </div>
        </header>
        <ol className="referral-steps">
          <li>
            <strong>Share your link.</strong> Friends who open it and join the waitlist are credited to you.
          </li>
          <li>
            <strong>They get in faster.</strong> Every {summary.threshold} friends who join moves you up for priority access, and they&apos;re flagged as your referrals.
          </li>
          <li>
            <strong>You both get credits.</strong> When a friend creates their account, they get <strong>{summary.referredCredits}</strong> bonus credits and you get{" "}
            <strong>{summary.referrerCredits}</strong>, added to that month&apos;s allowance.
          </li>
        </ol>
        {summary.pendingRewards > 0 ? <p className="intel-muted">{summary.pendingRewards} reward(s) pending.</p> : null}
      </section>
    </div>
  );
}