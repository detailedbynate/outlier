import Link from "next/link";
import { FlameIcon, GridIcon, SearchIcon } from "@/components/icons";

export const metadata = { title: "Page not found · Outlier" };

/** Any URL that isn't a page: say so plainly and offer the places people usually mean. */
export default function NotFound() {
  return (
    <section className="not-found">
      <span className="not-found-code" aria-hidden="true">
        404
      </span>
      <h1>This page doesn&apos;t exist</h1>
      <p className="subtitle">The link may be old, or the page has moved. These are where most people are headed:</p>
      <nav className="not-found-links" aria-label="Pages">
        <Link href="/">
          <GridIcon size={16} />
          Dashboard
        </Link>
        <Link href="/viral">
          <FlameIcon size={16} />
          Viral Videos
        </Link>
        <Link href="/research/shorts-channels">
          <SearchIcon size={16} />
          Shorts Channels
        </Link>
      </nav>
    </section>
  );
}
