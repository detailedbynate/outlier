import Link from "next/link";

export const metadata = { title: "Privacy · Outlier" };

export default function PrivacyPage() {
  return (
    <article className="card prose-card">
      <h1>Privacy</h1>
      <p className="subtitle">The short version of how Outlier handles your information.</p>

      <h2>What we collect</h2>
      <p>
        When you join the waitlist we store your email address and anything optional you choose to add (your channel link, niche,
        and what you&apos;d use Outlier for). When you have an account we store your email and your usage of the app, such as
        credits spent and channels you track.
      </p>

      <h2>How we use it</h2>
      <p>
        We use your email to send your invite and important updates about Outlier. We use the optional details to decide who to
        invite first and what to build. We don&apos;t sell your information.
      </p>

      <h2>YouTube data</h2>
      <p>
        Channel and video statistics shown in Outlier come from the YouTube Data API and are subject to YouTube&apos;s Terms of
        Service. Outlier is not affiliated with YouTube or Google.
      </p>

      <h2>Removing your data</h2>
      <p>Want off the waitlist or your account deleted? Reply to any email from us and we&apos;ll remove it.</p>

      <p>
        <Link href="/">← Back to Outlier</Link>
      </p>
    </article>
  );
}
