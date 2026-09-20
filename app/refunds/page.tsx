import Link from "next/link";
import { CONTACT_EMAIL, EFFECTIVE_DATE } from "@/app/legal";

export const metadata = { title: "Refund & Cancellation Policy · Outlier" };

export default function RefundsPage() {
  return (
    <article className="card prose-card">
      <h1>Refunds &amp; Cancellation</h1>
      <p className="subtitle">Effective {EFFECTIVE_DATE}</p>

      <p>
        Short version: you can cancel whenever you like, you keep what you paid for until the month runs out, and if Outlier
        wasn&apos;t what you expected in your first week, ask and we&apos;ll refund you.
      </p>

      <h2>Cancelling</h2>
      <p>
        Cancel any time from <Link href="/billing">Billing</Link>, which opens Stripe&apos;s billing portal. Cancelling stops the
        next payment — it doesn&apos;t cut you off. You keep your plan and its credits until the end of the period you already
        paid for, and then the account drops to Free. Nothing is deleted when you cancel.
      </p>

      <h2>Refunds on subscriptions</h2>
      <p>
        If you&apos;re unhappy with Outlier, email us within <strong>7 days</strong> of your first payment and we&apos;ll refund
        it in full, so long as you haven&apos;t spent most of that month&apos;s credits. After the first week, and on renewals,
        we don&apos;t refund part-used months — cancel instead and you won&apos;t be charged again.
      </p>
      <p>
        We&apos;ll always refund a charge that shouldn&apos;t have happened: a duplicate payment, a charge after you cancelled,
        or a month where Outlier was broken for you and we couldn&apos;t fix it. Just tell us.
      </p>

      <h2>Credit top-ups</h2>
      <p>
        Credit packs are a one-off purchase and the credits never expire. Unspent credits from a pack can be refunded within 7
        days of purchase; credits you&apos;ve already spent can&apos;t, because the research they paid for has already run.
      </p>

      <h2>Monthly credits</h2>
      <p>
        Your plan&apos;s monthly credits are an allowance, not a balance. They reset on the 1st (UTC) and unused ones don&apos;t
        carry over, aren&apos;t worth cash, and aren&apos;t refunded when you cancel. Credits you bought as a top-up are separate
        and stay with your account.
      </p>

      <h2>How to ask</h2>
      <p>
        Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the address on your account, or reply to any email
        from Outlier. Refunds go back to the card you paid with and usually land within 5–10 business days, depending on your
        bank.
      </p>

      <h2>Who you paid</h2>
      <p>
        Payments are processed by Stripe, which acts as the seller of record for Outlier subscriptions. Refunds are issued
        through Stripe, so your statement and receipts come from them.
      </p>

      <p>
        See also our <Link href="/terms">Terms of Service</Link> and <Link href="/privacy">Privacy Policy</Link>.{" "}
        <Link href="/">← Back to Outlier</Link>
      </p>
    </article>
  );
}
