import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { COMPETITORS, findCompetitor } from "../competitors";
import { outlierFacts } from "../outlier-facts";

export const dynamicParams = false;

export function generateStaticParams() {
  return COMPETITORS.map((c) => ({ competitor: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ competitor: string }> }): Promise<Metadata> {
  const c = findCompetitor((await params).competitor);
  if (!c) return {};
  const title = `Outlier vs ${c.name}: which is better for YouTube Shorts? · Outlier`;
  const description = `An honest comparison of Outlier and ${c.name} for Shorts creators: price, what each is built for, and who should pick which.`;
  return { title, description, alternates: { canonical: `/vs/${c.slug}` }, openGraph: { title, description, url: `/vs/${c.slug}` } };
}

export default async function VsPage({ params }: { params: Promise<{ competitor: string }> }) {
  const c = findCompetitor((await params).competitor);
  if (!c) notFound();
  const outlier = outlierFacts();

  return (
    <article className="card prose-card seo-page">
      <p className="seo-eyebrow">
        <Link href="/vs">Comparisons</Link> / {c.name}
      </p>
      <h1>Outlier vs {c.name}</h1>
      <p className="subtitle">Which one fits a Shorts creator? Prices checked October 2026.</p>

      <div className="seo-table-wrap">
        <table className="seo-table">
          <thead>
            <tr>
              <th />
              <th>Outlier</th>
              <th>{c.name}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>What it is</th>
              <td>{outlier.about}</td>
              <td>{c.about}</td>
            </tr>
            <tr>
              <th>Paid plans from</th>
              <td>{outlier.priceLine}</td>
              <td>
                {c.price}
                {c.approx ? <small className="seo-note"> (approximate: their page didn&apos;t list prices publicly when we checked)</small> : null}
              </td>
            </tr>
            <tr>
              <th>Free plan</th>
              <td>Yes, Shorts Channels search</td>
              <td>{c.freePlan ? "Yes" : "No"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Pick {c.name} if</h2>
      <ul>
        {c.pickThem.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <h2>Pick Outlier if</h2>
      <ul>
        {c.pickOutlier.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <div className="seo-cta">
        <strong>See this week&apos;s viral Shorts in your niche</strong>
        <span>Outlier finds small channels whose Shorts beat their usual views by 20× or more, every day. {outlier.price}/month.</span>
        <Link href="/#pricing" className="seo-button">
          Try Outlier
        </Link>
      </div>

      <p className="seo-small">
        Outlier isn&apos;t affiliated with {c.name}. Their prices change; see <a href={c.site} rel="nofollow noreferrer" target="_blank">their pricing page</a> for the latest. Try the free{" "}
        <Link href="/tools/srt-generator">SRT caption generator</Link>.
      </p>
    </article>
  );
}
