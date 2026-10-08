import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { REFERRAL_COOKIE } from "@/lib/referrals/links";
import { CREATOR_CODE_COOKIE, discountLabel, displayCode, normalizeCreatorCode } from "@/lib/creator-codes/codes";
import { getServices } from "@/lib/services";
import { normalizeReferralCode } from "@/lib/services/referral-service";
import { getCurrentUser } from "@/lib/auth/session";
import { Paywall } from "@/components/paywall";
import { paidFeaturesLocked } from "@/lib/billing/feature-gate";
import { PAID_FEATURES } from "@/lib/billing/features";
import { DashboardView } from "./dashboard-view";
import { LandingPage } from "./landing/landing-page";

export const dynamic = "force-dynamic";

/** Signed-in, approved users get the dashboard; everyone else sees the public landing page. */
export default async function HomePage({ searchParams }: { searchParams: Promise<{ ref?: string; code?: string }> }) {
  const current = await getCurrentUser();
  const params = await searchParams;
  const jar = await cookies();
  const referralCode = normalizeReferralCode(params.ref) ?? normalizeReferralCode(jar.get(REFERRAL_COOKIE)?.value);
  if (current && !current.approved) redirect("/not-approved");
  if (current && !current.onboardingCompleted) redirect("/onboarding");
  if (!current) {
    const creatorCode = await creatorCodeFor(normalizeCreatorCode(params.code) ?? normalizeCreatorCode(jar.get(CREATOR_CODE_COOKIE)?.value));
    // Someone sent here by a creator or a friend already heard the pitch: show the offer and the plans.
    const focused = Boolean(creatorCode || normalizeReferralCode(params.ref));
    return <LandingPage referralCode={referralCode} creatorCode={creatorCode} focused={focused} />;
  }
  // Free is Shorts Channels only: the dashboard is a paywall there.
  if (await paidFeaturesLocked(current)) return <Paywall feature={PAID_FEATURES.dashboard} />;
  return <DashboardView current={current} />;
}

/** The live creator code to show a visitor, if they came in with one. */
async function creatorCodeFor(code: string | null) {
  if (!code) return null;
  const row = await getServices().repositories.creatorCodes.find(code).catch(() => null);
  return row?.active
    ? { code: displayCode(row.code), creatorName: row.creator_name, offer: discountLabel(row), percent: row.discount_percent, months: row.discount_months }
    : null;
}
