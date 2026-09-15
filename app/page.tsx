import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { REFERRAL_COOKIE } from "@/lib/referrals/links";
import { normalizeReferralCode } from "@/lib/services/referral-service";
import { getCurrentUser } from "@/lib/auth/session";
import { DashboardView } from "./dashboard-view";
import { LandingPage } from "./landing/landing-page";

export const dynamic = "force-dynamic";

/** Signed-in, approved users get the dashboard; everyone else sees the public landing page. */
export default async function HomePage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const current = await getCurrentUser();
  const referralCode = normalizeReferralCode((await searchParams).ref) ?? normalizeReferralCode((await cookies()).get(REFERRAL_COOKIE)?.value);
  if (current && !current.approved) redirect("/not-approved");
  if (current && !current.onboardingCompleted) redirect("/onboarding");
  return current ? <DashboardView current={current} /> : <LandingPage referralCode={referralCode} />;
}
