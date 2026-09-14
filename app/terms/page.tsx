import Link from "next/link";

export const metadata = { title: "Terms of Service · Outlier" };

const EFFECTIVE_DATE = "September 14, 2026";

export default function TermsPage() {
  return (
    <article className="card prose-card">
      <h1>Terms of Service</h1>
      <p className="subtitle">Effective {EFFECTIVE_DATE}</p>

      <p>
        These terms cover your use of Outlier (useoutlier.online), including the website, app, waitlist, and any related
        services. By using Outlier you agree to them. If you don&apos;t agree, please don&apos;t use Outlier.
      </p>

      <h2>1. Early access</h2>
      <p>
        Outlier is in early access. Features may change, break, or be removed, and access is by invitation. We may pause or end
        early access at any time.
      </p>

      <h2>2. Your account</h2>
      <p>
        You must be at least 16 years old to use Outlier. Keep your login details private; you&apos;re responsible for activity on
        your account. Tell us right away if you think someone else has accessed it.
      </p>

      <h2>3. YouTube API Services</h2>
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

      <h2>4. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>scrape, copy, resell, or redistribute Outlier data or features in bulk;</li>
        <li>use bots or automation to access Outlier, or try to get around credits, rate limits, or other restrictions;</li>
        <li>attempt to break, overload, or gain unauthorized access to Outlier or other users&apos; accounts;</li>
        <li>use Outlier to harass creators, infringe anyone&apos;s rights, or break the law or YouTube&apos;s policies.</li>
      </ul>

      <h2>5. Credits</h2>
      <p>
        Some features use credits. Free early-access credits reset on a schedule, have no cash value, can&apos;t be transferred,
        and may change. Any paid plans will show their pricing and terms before you buy.
      </p>

      <h2>6. Data and insights</h2>
      <p>
        Statistics, scores, and recommendations are estimates based on public data and may be incomplete, delayed, or wrong.
        They are for research only and are not a guarantee of results. Decisions you make using Outlier are your own.
      </p>

      <h2>7. Our content</h2>
      <p>
        Outlier&apos;s software, design, and branding belong to Outlier. Channel names, videos, and thumbnails belong to their
        respective owners and are shown for reference.
      </p>

      <h2>8. Ending access</h2>
      <p>
        You can stop using Outlier at any time. We may suspend or end your access if you break these terms or misuse the
        service.
      </p>

      <h2>9. Disclaimers and liability</h2>
      <p>
        Outlier is provided &ldquo;as is&rdquo; without warranties of any kind. To the fullest extent allowed by law, Outlier
        isn&apos;t liable for indirect, incidental, or consequential damages, or for lost profits, revenue, or data, arising from
        your use of the service.
      </p>

      <h2>10. Changes</h2>
      <p>
        We may update these terms. If we make significant changes we&apos;ll let you know, for example by email or in the app.
        Continuing to use Outlier after changes means you accept the updated terms.
      </p>

      <h2>11. Contact</h2>
      <p>Questions about these terms? Reply to any email from Outlier or reach us in our Discord.</p>

      <p>
        See also our <Link href="/privacy">Privacy Policy</Link>. <Link href="/">← Back to Outlier</Link>
      </p>
    </article>
  );
}
