import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireApprovedUser } from "@/lib/auth/session";
import { OnboardingFlow } from "./onboarding-flow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Welcome · Outlier" };

export default async function OnboardingPage() {
  const current = await requireApprovedUser({ allowIncompleteOnboarding: true });
  if (current.onboardingCompleted) redirect("/");

  const name = (current.user.user_metadata?.full_name as string | undefined)?.split(" ")[0] ?? null;
  return <OnboardingFlow firstName={name} />;
}
