import type { Metadata } from "next";
import Link from "next/link";
import { billingEnabled, getStripe } from "@/lib/billing/stripe";
import { fulfillPublicSubscription } from "@/lib/billing/signup";
import { logger } from "@/lib/core/logger";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Welcome · Outlier" };

type SearchParams = Promise<{ session_id?: string }>;

/**
 * Where Stripe sends a new subscriber. The account is created here rather than
 * waiting on the webhook, so the page can tell them their link is on its way —
 * and doing it twice is harmless, since both routes end in the same upsert.
 */
export default async function WelcomePage({ searchParams }: { searchParams: SearchParams }) {
  const { session_id: sessionId } = await searchParams;
  let email: string | null = null;
  let failed = false;

  if (sessionId?.startsWith("cs_") && billingEnabled()) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(sessionId);
      email = (await fulfillPublicSubscription(session))?.email ?? session.customer_details?.email ?? null;
    } catch (error) {
      logger.error("welcome page fulfilment failed", { sessionId, error });
      failed = true;
    }
  }

  return (
    <div className="landing-root">
      <main className="welcome-wrap">
        <section className="card glass welcome-card">
          <h1>You&apos;re in.</h1>
          {failed ? (
            <>
              <p>
                Your payment went through, but we couldn&apos;t finish setting up your account just yet. It usually sorts itself out within a
                minute or two.
              </p>
              <p className="muted">If you still can&apos;t sign in after that, email us and we&apos;ll fix it by hand — you won&apos;t be charged twice.</p>
            </>
          ) : (
            <>
              <p>
                Thanks for subscribing. We&apos;ve sent a sign-in link to {email ? <strong>{email}</strong> : "your email"} — open it and
                you&apos;re straight in. No password to make up.
              </p>
              <p className="muted">
                Can&apos;t find it? Check spam. The link works for a while, and you can always ask for a new one from the sign-in page.
              </p>
            </>
          )}
          <Link href="/login" className="pill-button pill-button-primary pill-button-lg">
            Go to sign in
          </Link>
        </section>
      </main>
    </div>
  );
}
