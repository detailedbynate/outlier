import Link from "next/link";
import { CONTACT_EMAIL, EFFECTIVE_DATE, JURISDICTION, MIN_AGE } from "@/app/legal";

export const metadata = { title: "Terms of Service · Outlier" };

export default function TermsPage() {
  return (
    <article className="card prose-card">
      <h1>Terms of Service</h1>
      <p className="subtitle">Effective {EFFECTIVE_DATE}</p>

      <p>
        These terms cover your use of Outlier (useoutlier.online), including the website, the app, and any related services. By
        subscribing to or using Outlier you agree to them. If you don&apos;t agree, please don&apos;t use Outlier.
      </p>

      <h2>1. Your account</h2>
      <p>
        You must be at least {MIN_AGE} years old to use Outlier. One account is for one person or one business; keep your login
        details private, because you&apos;re responsible for what happens on your account. Tell us right away if you think
        someone else has got into it. If you&apos;re signing up for a company, you&apos;re confirming you&apos;re allowed to
        agree to these terms on its behalf.
      </p>

      <h2>2. Plans, credits, and what you get</h2>
      <p>
        Every plan reaches every feature. Plans differ in one thing: how many credits you get each month. Credits are spent on
        the expensive work — discovering channels, deep searches, analysing videos, niche research — and what each action costs
        is shown in the app before you spend it.
      </p>
      <p>
        Your monthly credits are an allowance, not a balance. They reset on the 1st (UTC), don&apos;t carry over, have no cash
        value, and can&apos;t be transferred or sold. Credits you buy as a top-up are separate: those don&apos;t expire and stay
        with your account. We may change what actions cost as the underlying data costs change, and we&apos;ll tell you before a
        change makes your plan buy meaningfully less.
      </p>

      <h2>3. Billing and renewal</h2>
      <p>
        Outlier is a paid subscription. The price is shown before you buy and charged to your payment method immediately, then{" "}
        <strong>automatically every month on the same date until you cancel</strong>. Prices are in US dollars. Stripe processes
        payments and acts as the seller of record; any applicable sales tax or VAT is handled at checkout and shown in your
        receipt.
      </p>
      <p>
        <strong>Price changes.</strong> The advertised price of a plan can change, including at the end of a launch sale. If
        you&apos;re already subscribed, the price you signed up at keeps applying to your subscription unless we tell you
        otherwise at least 30 days before a renewal, so you have time to cancel first. Promotional prices and discount codes
        apply as described when you redeem them and can&apos;t be applied retroactively.
      </p>
      <p>
        <strong>Failed payments.</strong> If a payment fails we&apos;ll retry it and email you. If it keeps failing your
        subscription ends and the account drops to the Free plan — your data isn&apos;t deleted.
      </p>
      <p>
        <strong>Cancelling and refunds</strong> are covered in our <Link href="/refunds">Refund &amp; Cancellation Policy</Link>,
        which is part of these terms. In short: cancel any time, keep the month you paid for, and ask us if something went wrong.
      </p>

      <h2>4. YouTube API Services</h2>
      <p>
        Outlier uses YouTube API Services to show public channel and video information. By using Outlier, you also agree to be
        bound by the{" "}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
          YouTube Terms of Service
        </a>
        . Google&apos;s handling of data is described in the{" "}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
          Google Privacy Policy
        </a>
        . Outlier is not affiliated with, endorsed by, or sponsored by YouTube or Google.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>scrape, copy, resell, or redistribute Outlier data or features in bulk, or build a competing product from them;</li>
        <li>share one account between people, or resell access to it;</li>
        <li>use bots or automation to access Outlier, or try to get around credits, rate limits, or other restrictions;</li>
        <li>attempt to break, overload, or gain unauthorized access to Outlier or other users&apos; accounts;</li>
        <li>use Outlier to harass creators, infringe anyone&apos;s rights, or break the law or YouTube&apos;s policies.</li>
      </ul>

      <h2>6. Data and insights</h2>
      <p>
        Statistics, scores, and recommendations are estimates built from public data and may be incomplete, delayed, or wrong.
        They&apos;re for research only and are not a guarantee of results. We don&apos;t promise that any channel, niche, or idea
        Outlier surfaces will perform. Decisions you make using Outlier are your own.
      </p>

      <h2>7. Our content and yours</h2>
      <p>
        Outlier&apos;s software, design, and branding belong to Outlier. Channel names, videos, and thumbnails belong to their
        respective owners and are shown for reference. What you put into Outlier — your channels, notes, and answers — stays
        yours; you give us only the permission we need to store it and run the service for you.
      </p>

      <h2>8. Availability and changes to the service</h2>
      <p>
        Outlier is a young product and still changing. Features may be added, altered, or removed, and there will sometimes be
        downtime for maintenance or because something upstream broke. We don&apos;t promise a particular level of uptime. If we
        discontinue Outlier entirely, we&apos;ll give notice and refund the unused part of any subscription you&apos;ve paid for.
      </p>

      <h2>9. Ending access</h2>
      <p>
        You can cancel or stop using Outlier at any time. We may suspend or end your access if you break these terms or misuse
        the service; if we do that without cause, we&apos;ll refund the unused part of your current month.
      </p>

      <h2>10. Disclaimers and liability</h2>
      <p>
        Outlier is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind. To the fullest
        extent allowed by law, Outlier isn&apos;t liable for indirect, incidental, or consequential damages, or for lost profits,
        revenue, or data, arising from your use of the service. Where liability can&apos;t be excluded, it&apos;s limited to what
        you paid us in the twelve months before the claim. Nothing here limits rights you have under consumer law that
        can&apos;t be waived.
      </p>

      <h2>11. Governing law</h2>
      <p>
        These terms are governed by the laws of {JURISDICTION}, and the courts there have exclusive jurisdiction over any
        dispute, without affecting consumer-protection rights you have where you live. Before going to court, please email us —
        most things are fixable in a message.
      </p>

      <h2>12. Changes to these terms</h2>
      <p>
        We may update these terms. If we make significant changes we&apos;ll let you know, by email or in the app, at least 30
        days before they affect a renewal. Continuing to use Outlier after changes take effect means you accept the updated
        terms.
      </p>

      <h2>13. Contact</h2>
      <p>
        Questions about these terms? Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>, reply to any email from
        Outlier, or reach us in our Discord.
      </p>

      <p>
        See also our <Link href="/privacy">Privacy Policy</Link> and <Link href="/refunds">Refund Policy</Link>.{" "}
        <Link href="/">← Back to Outlier</Link>
      </p>
    </article>
  );
}
