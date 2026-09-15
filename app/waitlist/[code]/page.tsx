import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandMark } from "@/components/icons";
import { ReferralShare } from "@/components/referral-share";
import { referralLinks } from "@/lib/referrals/links";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your referrals · Outlier", robots: { index: false } };

/** Public referral progress for a waitlist code. Shows counts only, never who signed up. */
export default async function WaitlistStatusPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const status = await getServices().referrals.publicStatus(code);
  if (!status) notFound();
  const links = await referralLinks(status.code);

  return (
    <main className="referral-page">
      <Link href="/" className="brand referral-brand">
        <BrandMark size={32} />
        <span>Outlier</span>
      </Link>
      <section className="referral-card">
        <h1>{status.priority ? "You're a priority invite" : "Skip the waitlist"}</h1>
        <p>
          {status.signups === 0
            ? `Share your link. When ${status.threshold} friends join, you move to the front of the line.`
            : `${status.signups} ${status.signups === 1 ? "friend has" : "friends have"} joined with your link.`}{" "}
          Friends who join get bonus credits, and so do you when they create their account.
        </p>
        <ReferralShare
          link={links.share}
          count={status.signups}
          target={status.threshold}
          unlocks="priority access"
          reached="Priority access unlocked — keep sharing to earn bonus credits"
        />
      </section>
    </main>
  );
}