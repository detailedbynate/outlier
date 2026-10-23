import type { Metadata } from "next";
import Link from "next/link";
import { COMPETITORS } from "./competitors";
import { outlierFacts } from "./outlier-facts";

export const metadata: Metadata = {
  title: "Outlier vs vidIQ, 1of10, NexLev, TubeLab and more · Outlier",
  description: "How Outlier compares with other YouTube research tools for Shorts creators, with prices and who each one is for.",
  alternates: { canonical: "/vs" },
};

export default function VsIndexPage() {
  const outlier = outlierFacts();
  return (
    <article className="card prose-card seo-page">
      <h1>Outlier compared</h1>
      <p className="subtitle">
        Outlier is Shorts research for gaming and faceless creators, {outlier.price}/month. Here&apos;s how it stacks up, honestly.
      </p>
      <ul className="seo-list">
        {COMPETITORS.map((c) => (
          <li key={c.slug}>
            <Link href={`/vs/${c.slug}`}>Outlier vs {c.name}</Link>
            <small>{c.about}</small>
          </li>
        ))}
      </ul>
      <p className="seo-small">
        Also free: the <Link href="/tools/srt-generator">SRT caption generator</Link>.
      </p>
    </article>
  );
}
