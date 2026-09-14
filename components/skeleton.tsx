/** Loading placeholders shown instantly while a page's data loads (used by loading.tsx files). */

export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}

function Shell({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="skeleton-page" role="status" aria-live="polite">
      <div className="route-progress" />
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function HeaderSkeleton() {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <Skeleton style={{ width: 220, height: 30 }} />
      <Skeleton style={{ width: 360, maxWidth: "80%", height: 16 }} />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <Shell label="Loading dashboard">
      <HeaderSkeleton />
      <div className="grid grid-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="skeleton-card" style={{ height: 124 }} />
        ))}
      </div>
      <Skeleton className="skeleton-card" style={{ height: 110 }} />
      <div className="video-grid">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="skeleton-card" style={{ height: 280 }} />
        ))}
      </div>
    </Shell>
  );
}

export function ChannelListSkeleton() {
  return (
    <Shell label="Loading channels">
      <Skeleton className="skeleton-card" style={{ height: 52, borderRadius: 14 }} />
      <div className="row" style={{ gap: 8 }}>
        {[70, 64, 84, 70, 90, 66].map((w, i) => (
          <Skeleton key={i} style={{ width: w, height: 24, borderRadius: 999 }} />
        ))}
      </div>
      <div className="spread">
        <div className="row" style={{ gap: 10 }}>
          <Skeleton style={{ width: 150, height: 40, borderRadius: 10 }} />
          <Skeleton style={{ width: 190, height: 40, borderRadius: 10 }} />
        </div>
        <div className="row" style={{ gap: 10 }}>
          <Skeleton style={{ width: 170, height: 40, borderRadius: 10 }} />
          <Skeleton style={{ width: 130, height: 40, borderRadius: 10 }} />
        </div>
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton-card channel-skeleton">
          <div className="row" style={{ gap: 12 }}>
            <Skeleton style={{ width: 44, height: 44, borderRadius: "50%" }} />
            <div className="stack" style={{ gap: 6 }}>
              <Skeleton style={{ width: 160, height: 14 }} />
              <Skeleton style={{ width: 100, height: 12 }} />
            </div>
          </div>
          <div className="shorts-strip">
            {Array.from({ length: 6 }, (_, j) => (
              <Skeleton key={j} style={{ aspectRatio: "9 / 16", borderRadius: 10 }} />
            ))}
          </div>
        </div>
      ))}
    </Shell>
  );
}

export function VideoGridSkeleton() {
  return (
    <Shell label="Loading videos">
      <HeaderSkeleton />
      <div className="row" style={{ gap: 8 }}>
        {[64, 64, 64, 70, 50, 60, 60].map((w, i) => (
          <Skeleton key={i} style={{ width: w, height: 28, borderRadius: 999 }} />
        ))}
      </div>
      <div className="video-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="skeleton-card" style={{ height: 290 }} />
        ))}
      </div>
    </Shell>
  );
}

export function TableSkeleton() {
  return (
    <Shell label="Loading">
      <HeaderSkeleton />
      <Skeleton className="skeleton-card" style={{ height: 110 }} />
      <div className="skeleton-card" style={{ padding: 20 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="row" style={{ gap: 12, padding: "10px 0" }}>
            <Skeleton style={{ width: 32, height: 32, borderRadius: "50%" }} />
            <Skeleton style={{ flex: 1, height: 14 }} />
            <Skeleton style={{ width: 80, height: 14 }} />
          </div>
        ))}
      </div>
    </Shell>
  );
}

export function DetailSkeleton() {
  return (
    <Shell label="Loading">
      <div className="row" style={{ gap: 16 }}>
        <Skeleton style={{ width: 72, height: 72, borderRadius: "50%" }} />
        <div className="stack" style={{ gap: 8 }}>
          <Skeleton style={{ width: 220, height: 26 }} />
          <Skeleton style={{ width: 260, height: 14 }} />
        </div>
      </div>
      <div className="grid grid-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="skeleton-card" style={{ height: 110 }} />
        ))}
      </div>
      <Skeleton className="skeleton-card" style={{ height: 300 }} />
    </Shell>
  );
}
