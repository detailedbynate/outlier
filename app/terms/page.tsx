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
        You must be at least {MIN_AGE} years old to use Outlier, or older if the country you live in sets a higher age for
        agreeing to online services on your own. If you&apos;re under the age of majority where you live, you need a parent or
        guardian&apos;s permission to subscribe, and they agree to these terms together with you and are responsible for the
        payments on the account.
      </p>
      <p>
        One account is for one person or one business; keep your login details private, because you&apos;re responsible for what
        happens on your account. Tell us right away if you think someone else has got into it. If you&apos;re signing up for a
        company, you&apos;re confirming you&apos;re allowed to agree to these terms on its behalf.
      </p>

      <h2>2. Plans, credits, and what you get</h2>
      <p>
        The Free plan includes Shorts Channels only. Every other tool, including the Shorts Script Writer, is on the paid plans,
        which differ mainly in how many credits you get each month. What each plan includes is shown on the pricing page. Credits are spent on the expensive work — discovering channels, deep searches,
        analysing videos, niche research, writing scripts — and what each action costs is shown in the app before you spend it.
      </p>
      <p>
        Your monthly credits are an allowance, not a balance. They reset on the 1st (UTC), don&apos;t carry over, have no cash
        value, and can&apos;t be transferred or sold. Credits you buy as a top-up are separate: those don&apos;t expire and stay
        with your account. We may change what actions cost as the underlying data costs change, and we&apos;ll tell you before a
        change makes your plan buy meaningfully less.
      </p>

      <h2>3. Billing and renewal</h2>
      <p>
        Outlier is a paid subscription. The price is shown before you buy and charged to your payment method immediately (or
        when your free trial ends, below), then{" "}
        <strong>automatically every month on the same date until you cancel</strong>. Prices are in US dollars. Stripe processes
        payments and acts as the seller of record; any applicable sales tax or VAT is handled at checkout and shown in your
        receipt.
      </p>
      <p>
        <strong>Free trials.</strong> We sometimes offer a free trial of a plan, of the length shown with the offer (currently
        3 days), once per person, and not together with a discount or creator code. You give a payment method when the trial
        starts. When it ends, the plan&apos;s price is
        charged to that payment method and the subscription renews monthly from then on, unless you cancel before the trial
        ends — in which case you aren&apos;t charged at all. You can cancel from Plans &amp; credits → Manage plan.
      </p>
      <p>
        <strong>Price changes.</strong> The advertised price of a plan can change, including at the end of a launch sale. If
        you&apos;re already subscribed, the price you signed up at keeps applying to your subscription unless we tell you
        otherwise at least 30 days before a renewal, so you have time to cancel first. Promotional prices and discount codes
        apply as described when you redeem them and can&apos;t be applied retroactively.
      </p>
      <p>
        <strong>Discount and creator codes.</strong> A code takes the discount shown with it (for example, a percentage off for
        a set number of months) off the plan&apos;s full price, and is applied at checkout, where you see exactly what
        you&apos;ll pay. One code per subscription; it can&apos;t be combined with a launch price, a free trial or another offer.{" "}
        <strong>When the discount period ends, your subscription renews at the plan&apos;s full monthly price</strong>, shown at
        checkout, until you cancel. Codes have no cash value, can&apos;t be exchanged or transferred, and can be withdrawn for new
        signups at any time; that doesn&apos;t change a discount you already have. The creator who shared a code may earn a
        commission on what you pay — it never changes your price.
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

      <h2>6. Data, insights, and AI-written content</h2>
      <p>
        Statistics, scores, estimated earnings (RPM), and recommendations are estimates built from public data and may be
        incomplete, delayed, or wrong. They&apos;re for research only and are not a guarantee of results or income. We don&apos;t
        promise that any channel, niche, or idea Outlier surfaces will perform. Decisions you make using Outlier are your own.
      </p>
      <p>
        Scripts and other text from the Script Writer and similar tools are written by AI models. They can contain mistakes or
        made-up details and may resemble text written for other people. Check them before you publish: you&apos;re responsible
        for what you post, including that it&apos;s accurate and follows YouTube&apos;s policies. As between you and Outlier, the
        scripts you generate are yours to use.
      </p>

      <h2>7. Our content and yours</h2>
      <p>
        Outlier&apos;s software, design, and branding belong to Outlier. Channel names, videos, and thumbnails belong to their
        respective owners and are shown for reference. What you put into Outlier — your channels, notes, and answers — stays
        yours; you give us only the permission we need to store it and run the service for you.
      </p>

      <h2>8. Referrals and creator codes</h2>
      <p>
        <strong>Referral links.</strong> Rewards for inviting people (such as bonus credits or earlier access) are described
        where you get your link. They have no cash value. Referring yourself, creating fake or duplicate accounts, or spamming
        your link doesn&apos;t count, and we may withhold or remove rewards earned that way. We can change or end the referral
        program at any time; rewards you&apos;ve already earned fairly are kept.
      </p>
      <p>
        <strong>If you share a creator code.</strong> Creator codes are by invitation. Your commission rate and how long it
        lasts are what we agreed with you and are shown on your referrals page. Commission is earned on payments that customers
        actually make with your code, is paid out by us manually, and doesn&apos;t apply to payments that are refunded or
        disputed. Whenever you share your code you must clearly say that you earn a commission or have a relationship with
        Outlier, as advertising and endorsement rules require (in the US the FTC&apos;s Endorsement Guides, in Canada the
        Competition Act). Don&apos;t make claims about Outlier that aren&apos;t true, don&apos;t spam, and don&apos;t use your own
        code. You&apos;re an independent creator, not our employee or agent, and you&apos;re responsible for any tax on what you
        earn. We can change or end a code; commission already earned on payments made before then is still paid, unless the code
        was used in breach of these terms.
      </p>

      <h2>9. Availability and changes to the service</h2>
      <p>
        Outlier is a young product and still changing. Features may be added, altered, or removed, and there will sometimes be
        downtime for maintenance or because something upstream broke. We don&apos;t promise a particular level of uptime. If we
        discontinue Outlier entirely, we&apos;ll give notice and refund the unused part of any subscription you&apos;ve paid for.
      </p>

      <h2>10. Ending access</h2>
      <p>
        You can cancel or stop using Outlier at any time. We may suspend or end your access if you break these terms or misuse
        the service; if we do that without cause, we&apos;ll refund the unused part of your current month.
      </p>

      <h2>11. Disclaimers and liability</h2>
      <p>
        Outlier is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind. To the fullest
        extent allowed by law, Outlier isn&apos;t liable for indirect, incidental, or consequential damages, or for lost profits,
        revenue, or data, arising from your use of the service. Where liability can&apos;t be excluded, it&apos;s limited to what
        you paid us in the twelve months before the claim. Nothing here limits rights you have under consumer law that
        can&apos;t be waived.
      </p>

      <h2>12. Governing law</h2>
      <p>
        These terms are governed by the laws of {JURISDICTION}, and the courts there have exclusive jurisdiction over any
        dispute, without affecting consumer-protection rights you have where you live. Before going to court, please email us —
        most things are fixable in a message.
      </p>

      <h2>13. Changes to these terms</h2>
      <p>
        We may update these terms. If we make significant changes we&apos;ll let you know, by email or in the app, at least 30
        days before they affect a renewal. Continuing to use Outlier after changes take effect means you accept the updated
        terms.
      </p>

      <h2>14. Contact</h2>
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
