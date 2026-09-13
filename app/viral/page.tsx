import Link from "next/link";
import { VideoCard } from "@/components/video-card";
import { daysAgo } from "@/lib/format";
import { requireApprovedUser } from "@/lib/auth/session";
import { getServices } from "@/lib/services";
import type { VideoFormat } from "@/types/database";

export const dynamic = "force-dynamic";

const RANGES = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "all", label: "All time" },
] as const;

const FORMATS = [
  { key: "all", label: "All" },
  { key: "long_form", label: "Videos" },
  { key: "short", label: "Shorts" },
] as const;

const SORTS = [
  { key: "outlier_score", label: "Outlier score" },
  { key: "views_per_day", label: "Views / day" },
  { key: "view_count", label: "Total views" },
] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pick<T extends readonly { key: string }[]>(options: T, value: unknown, fallback: T[number]["key"]): T[number]["key"] {
  return options.some((o) => o.key === value) ? (value as T[number]["key"]) : fallback;
}

export default async function ViralPage({ searchParams }: { searchParams: SearchParams }) {
  await requireApprovedUser();
  const params = await searchParams;
  const range = pick(RANGES, params.range, "30");
  const format = pick(FORMATS, params.format, "all");
  const sort = pick(SORTS, params.sort, "outlier_score");

  const videos = await getServices().repositories.videos.feed({
    orderBy: sort,
    limit: 60,
    publishedAfter: range === "all" ? undefined : daysAgo(Number(range)),
    format: format === "all" ? undefined : (format as VideoFormat),
  });

  const href = (overrides: Record<string, string>) => {
    const next = new URLSearchParams({ range, format, sort, ...overrides });
    return `/viral?${next.toString()}`;
  };

  return (
    <div className="stack">
      <div>
        <h1>Viral videos</h1>
        <p className="subtitle">
          Videos from tracked channels, ranked by how far they beat their channel&apos;s typical views.
        </p>
      </div>

      <div className="row" style={{ gap: 20 }}>
        <div className="chips" aria-label="Published within">
          {RANGES.map((o) => (
            <Link key={o.key} href={href({ range: o.key })} className="chip" aria-current={o.key === range}>
              {o.label}
            </Link>
          ))}
        </div>
        <div className="chips" aria-label="Format">
          {FORMATS.map((o) => (
            <Link key={o.key} href={href({ format: o.key })} className="chip" aria-current={o.key === format}>
              {o.label}
            </Link>
          ))}
        </div>
        <div className="chips" aria-label="Sort by">
          {SORTS.map((o) => (
            <Link key={o.key} href={href({ sort: o.key })} className="chip" aria-current={o.key === sort}>
              {o.label}
            </Link>
          ))}
        </div>
      </div>

      {videos.length === 0 ? (
        <div className="card empty">
          No videos match. <Link href="/channels">Track more channels</Link> or widen the date range.
        </div>
      ) : (
        <div className="video-grid">
          {videos.map((video) => (
            <VideoCard key={video.video_id} video={video} />
          ))}
        </div>
      )}
    </div>
  );
}
