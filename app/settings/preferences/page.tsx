import type { Metadata } from "next";
import { SlidersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { requireApprovedUser } from "@/lib/auth/session";
import { EMPTY_DRAFT, type OnboardingDraft } from "@/lib/onboarding/flow";
import { getServices } from "@/lib/services";
import { ChangePasswordForm } from "./password-form";
import { PreferencesForm } from "./preferences-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Preferences · Outlier" };

export default async function PreferencesPage() {
  const { user } = await requireApprovedUser();
  const preferences = await getServices().onboarding.getPreferences(user.id);
  const initial: OnboardingDraft = preferences
    ? {
        goals: preferences.goals as OnboardingDraft["goals"],
        contentFormats: preferences.contentFormats as OnboardingDraft["contentFormats"],
        niches: preferences.niches,
        hasChannel: preferences.hasChannel,
        channel: preferences.channel ?? "",
        competitors: preferences.competitors,
      }
    : EMPTY_DRAFT;

  return (
    <div className="research-page">
      <PageHeader icon={SlidersIcon} title="Preferences" subtitle="What you research, the formats you make, who you follow, and your password." />
      <PreferencesForm initial={initial} />
      <ChangePasswordForm />
    </div>
  );
}
