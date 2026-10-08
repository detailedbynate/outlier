import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { REFERRAL_COOKIE } from "@/lib/referrals/links";
import { discountLabel, displayCode, normalizeCreatorCode } from "@/lib/creator-codes/codes";
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
export default async function HomePage({ searchParams }: { searchParams: Promise<{ ref?: string; code?: string; code_error?: string }> }) {
  const current = await getCurrentUser();
  const params = await searchParams;
  const jar = await cookies();
  const referralCode = normalizeReferralCode(params.ref) ?? normalizeReferralCode(jar.get(REFERRAL_COOKIE)?.value);
  // A creator or referral link opens the offer page, signed in or not (proxy.ts tells the layout to drop the app shell).
  const landingLink = params.code !== undefined || params.ref !== undefined;
  if (current && !landingLink && !current.approved) redirect("/not-approved");
  if (current && !landingLink && !current.onboardingCompleted) redirect("/onboarding");
  if (!current || landingLink) {
    // A creator's code shows only on their link (/?code=X). Plain "/" is the normal front page with no code on it,
    // whatever was clicked before; the code box under the plans is there for anyone who has one.
    const creatorCode = await creatorCodeFor(normalizeCreatorCode(params.code));
    // Someone who just clicked a creator's or friend's link already heard the pitch: show the offer and the plans.
    const focused = Boolean(creatorCode || normalizeReferralCode(params.ref));
    return (
      <LandingPage referralCode={referralCode} creatorCode={creatorCode} focused={focused} codeError={params.code_error === "1"} signedIn={Boolean(current)} />
    );
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
