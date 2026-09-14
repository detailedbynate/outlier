import Link from "next/link";

export const metadata = { title: "Privacy Policy · Outlier" };

const EFFECTIVE_DATE = "September 14, 2026";

export default function PrivacyPage() {
  return (
    <article className="card prose-card">
      <h1>Privacy Policy</h1>
      <p className="subtitle">Effective {EFFECTIVE_DATE}</p>

      <h2>What we collect</h2>
      <p>
        <strong>Waitlist:</strong> your email address and your name if you add it. <strong>Account:</strong> your email, your
        onboarding answers (goals, content types, niches, and any channels you enter), and your usage of the app, such as credits
        spent and channels you track. <strong>Technical:</strong> basic request data such as IP address and browser, used for
        security, rate limiting, and error monitoring. IP addresses used for rate limiting are stored only as one-way hashes.
      </p>

      <h2>How we use it</h2>
      <p>
        To send your invite and important updates, run and secure the service, personalize research and recommendations, prevent
        abuse, and fix errors. We don&apos;t sell your personal information.
      </p>

      <h2>Service providers</h2>
      <p>
        We use trusted providers to run Outlier: Supabase (database and login), Vercel (hosting), an email delivery provider
        (invites), and Sentry (error monitoring). They process data only to provide their services to us.
      </p>

      <h2>YouTube data</h2>
      <p>
        Outlier uses YouTube API Services to display public channel and video statistics. We don&apos;t ask for access to your
        YouTube account. YouTube data is refreshed regularly and handled according to the{" "}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
          YouTube Terms of Service
        </a>{" "}
        and the{" "}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
          Google Privacy Policy
        </a>
        . Outlier is not affiliated with YouTube or Google.
      </p>

      <h2>Your choices</h2>
      <p>
        You can update your preferences anytime from the dashboard. To leave the waitlist or delete your account and data, reply
        to any email from us or ask in our Discord, and we&apos;ll take care of it.
      </p>

      <h2>Changes</h2>
      <p>We&apos;ll update this page if our practices change and note the new effective date.</p>

      <p>
        See also our <Link href="/terms">Terms of Service</Link>. <Link href="/">← Back to Outlier</Link>
      </p>
    </article>
  );
}
