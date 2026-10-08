import Link from "next/link";
import { CONTACT_EMAIL, EFFECTIVE_DATE, JURISDICTION, MIN_AGE } from "@/app/legal";

export const metadata = { title: "Privacy Policy · Outlier" };

export default function PrivacyPage() {
  return (
    <article className="card prose-card">
      <h1>Privacy Policy</h1>
      <p className="subtitle">Effective {EFFECTIVE_DATE}</p>

      <p>
        Outlier is run from {JURISDICTION}. This page says what we collect, why, who else touches it, and how to get rid of it.
      </p>

      <h2>What we collect</h2>
      <p>
        <strong>Account:</strong> your email address, and the password you set, stored only as a hash.{" "}
        <strong>What you tell us:</strong> your onboarding answers — goals, content types, niches, and any channels you enter.{" "}
        <strong>How you use Outlier:</strong> credits spent, searches run, channels you track and compare, reports you generate.{" "}
        <strong>Billing:</strong> your plan, subscription status, renewal date, and the Stripe customer and subscription ids that
        identify you to Stripe. <strong>Technical:</strong> request data such as browser and IP address, used for security, rate
        limiting, and error monitoring. IP addresses used for rate limiting are stored only as one-way hashes.
      </p>
      <p>
        <strong>We never see your card.</strong> Card numbers are entered on Stripe&apos;s own checkout and never reach our
        servers or our database.
      </p>
      <p>
        <strong>Waitlist:</strong> if you joined the waitlist instead of subscribing, we hold your email address and whatever else
        you chose to fill in on the form — your name, channel link, niche, what you&apos;d use Outlier for, and how you heard about
        us — plus the referral link you came through, if any.
      </p>

      <p>
        <strong>Site visits:</strong> to see how many people visit, where they came from, and how many reach pricing and
        checkout, we record each page view with the page, the site or app that linked you (for example YouTube), any campaign tag
        or creator code in the link, whether you&apos;re on a phone, tablet or computer, and how long the page was on screen and
        how far you scrolled. So that someone coming back counts as one visitor, your browser gets a first-party cookie
        (<code>outlier_vid</code>) holding a random id; we only store a scrambled version of it. If cookies are blocked, a visitor
        is counted with a code made by scrambling your IP address and browser together with the date, which changes every day
        and can&apos;t be turned back into your IP address. We never store the IP address itself for this, and these records
        aren&apos;t tied to your name or email, aren&apos;t shared with anyone, and aren&apos;t used for advertising. When you
        pay, the scrambled id goes along with the payment so we can see which site paying customers came from. Admins&apos; own
        visits aren&apos;t counted. If your browser sends a Global Privacy Control signal we don&apos;t set the cookie, and you can
        turn counting off below.
      </p>
      <p>
        <strong>Referral links and creator codes:</strong> if you arrive through someone&apos;s link, we remember the link so
        they get credit and you get any discount. If you subscribe with a creator&apos;s code, the code is recorded on your
        subscription so we can pay that creator their commission. The creator sees totals — how many people subscribed with
        their code and what it has earned — never your name or email. If you&apos;re a creator with a code, we hold your name,
        your code, the commissions it has earned, and whatever payout details you give us.
      </p>

      <h2>How we use it</h2>
      <p>
        To run your account and take payment for it, to send the emails the service depends on — your signup link, receipts, and
        notices about your plan — to personalize research and recommendations, to keep the service up and stop abuse, and to fix
        errors. <strong>We don&apos;t sell your personal information</strong> and we don&apos;t use it to train models. We
        won&apos;t send you marketing email you didn&apos;t ask for.
      </p>

      <h2>Legal basis</h2>
      <p>
        If you&apos;re in the UK or EEA: we process your account and billing data to perform our contract with you, your usage
        data under our legitimate interest in running and securing the service, and anything optional with your consent, which
        you can withdraw.
      </p>

      <h2>Who else processes it</h2>
      <p>
        We keep the list short on purpose. Each of these processes data only to provide its service to us:
      </p>
      <ul>
        <li>
          <strong>Contabo</strong> — the server Outlier runs on, including its database.
        </li>
        <li>
          <strong>Supabase</strong> — the database and authentication software, self-hosted by us on that server.
        </li>
        <li>
          <strong>Stripe</strong> — payments, subscriptions, receipts, and the billing portal. Stripe is the seller of record and
          handles card data under its own{" "}
          <a href="https://stripe.com/privacy" target="_blank" rel="noreferrer">
            privacy policy
          </a>
          .
        </li>
        <li>
          <strong>Resend</strong> — delivering the emails we send you.
        </li>
        <li>
          <strong>Anthropic (Claude), Google (Gemini) and OpenRouter</strong> — the AI models behind the Script Writer and the
          labels on niches. They receive what you type into those tools (topics, notes, sample scripts) along with public video
          data, never your email or payment details, and process it to write the response under their own API terms. Please
          don&apos;t put anything confidential into the Script Writer.
        </li>
        <li>
          <strong>Google / YouTube Data API</strong> — the public YouTube statistics Outlier shows. We send them search terms and
          channel or video ids, never anything about you.
        </li>
        <li>
          <strong>Sentry</strong> — error reports when something breaks, which can include your user id and the page you were on.
        </li>
      </ul>
      <p>Some of these operate outside your country, so your data may be processed abroad under their own safeguards.</p>

      <h2>YouTube data</h2>
      <p>
        Outlier uses YouTube API Services to display public channel and video statistics. We don&apos;t ask for access to your
        YouTube account and we can&apos;t see anything private about it. YouTube data is refreshed regularly and handled
        according to the{" "}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
          YouTube Terms of Service
        </a>{" "}
        and the{" "}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
          Google Privacy Policy
        </a>
        . You can revoke third-party access to your Google account at{" "}
        <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
          Google security settings
        </a>
        . Outlier is not affiliated with YouTube or Google.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Your account data stays while your account exists. If you cancel, it stays until you ask us to delete it, so your
        research is still there if you come back. When you ask for deletion we remove your account, onboarding answers, tracked
        channels, and research within 30 days. Two things outlive that: billing records, which we and Stripe must keep for tax
        purposes, and hashed IP records used for rate limiting, which age out on their own. Public YouTube statistics aren&apos;t
        personal data about you and stay in our cache.
      </p>

      <h2>Your rights</h2>
      <p>
        You can see and change your onboarding answers and preferences any time from your settings, and your billing details from{" "}
        <Link href="/billing">Billing</Link>. Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> to get a copy of your
        data, correct it, or delete your account and everything in it — we&apos;ll confirm within 30 days. Depending on where you
        live you may also have the right to object to processing, restrict it, or complain to your local data protection
        authority. We won&apos;t charge you or treat you differently for asking.
      </p>

      <h2>Children</h2>
      <p>
        Outlier is for people {MIN_AGE} and over — older where your country sets a higher age for consenting to online services
        on your own — and it isn&apos;t directed at younger children. We don&apos;t knowingly collect personal information from
        anyone under {MIN_AGE}, and we don&apos;t ask anyone for their age beyond their agreement to our{" "}
        <Link href="/terms">Terms</Link>. If you&apos;re a parent or guardian and your child has given us their information
        without your permission, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we&apos;ll delete the account
        and everything in it.
      </p>

      <h2>Security</h2>
      <p>
        Traffic is encrypted in transit, passwords are hashed, access to the database is restricted, and one person&apos;s
        research isn&apos;t visible to another. No service is perfectly secure, so if something does go wrong in a way that puts
        you at risk, we&apos;ll tell the people affected.
      </p>

      <h2>Cookies</h2>
      <p>
        Outlier sets only first-party cookies: ones that keep you signed in; if you arrived through a referral link or creator
        code, one that remembers that link for 30 days so the credit and the discount you came for still apply when you
        subscribe; and <code>outlier_vid</code>, which lasts a year and is used only to count unique visitors as described above.
        Your browser&apos;s local storage also remembers small things like a popup you closed. There are no advertising or
        cross-site tracking cookies, and nothing is shared with ad networks.
      </p>
      <form action="/api/track/opt-out" method="post">
        <input type="hidden" name="back" value="/privacy" />
        <p>
          Don&apos;t want your visits counted?{" "}
          <button type="submit" className="button-ghost">
            Turn off visit counting in this browser
          </button>{" "}
          This deletes <code>outlier_vid</code> and sets a cookie (<code>outlier_notrack</code>) that tells us not to count you.
        </p>
      </form>

      <h2>Changes</h2>
      <p>
        We&apos;ll update this page if our practices change and note the new effective date. If a change matters to you,
        we&apos;ll say so by email or in the app.
      </p>

      <p>
        See also our <Link href="/terms">Terms of Service</Link> and <Link href="/refunds">Refund Policy</Link>.{" "}
        <Link href="/">← Back to Outlier</Link>
      </p>
    </article>
  );
}
