import { Skeleton } from "@/components/skeleton";

/** Only the results wait: the header and filters live in the layout and stay put. */
export default function Loading() {
  return (
    <div className="vv-loading" role="status" aria-label="Loading videos">
      <Skeleton className="skeleton-card" style={{ height: 196 }} />
      <div className="video-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="skeleton-card" style={{ height: 290 }} />
        ))}
      </div>
    </div>
  );
}
