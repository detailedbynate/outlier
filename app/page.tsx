import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { DashboardView } from "./dashboard-view";
import { LandingPage } from "./landing/landing-page";

export const dynamic = "force-dynamic";

/** Signed-in, approved users get the dashboard; everyone else sees the public landing page. */
export default async function HomePage() {
  const current = await getCurrentUser();
  if (current && !current.approved) redirect("/not-approved");
  return current ? <DashboardView /> : <LandingPage />;
}
