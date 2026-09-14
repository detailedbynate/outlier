import type { ReactNode, SVGProps } from "react";

/** Minimal stroke icons (24px grid, currentColor). */
function Icon({ children, size = 16, ...props }: SVGProps<SVGSVGElement> & { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

type P = SVGProps<SVGSVGElement> & { size?: number };

export const SearchIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);
export const ChevronDownIcon = (p: P) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
export const SlidersIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Icon>
);
export const SortIcon = (p: P) => (
  <Icon {...p}>
    <path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" />
  </Icon>
);
export const ZapIcon = (p: P) => (
  <Icon {...p}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
  </Icon>
);
export const EyeIcon = (p: P) => (
  <Icon {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
export const TrendingIcon = (p: P) => (
  <Icon {...p}>
    <path d="m3 17 6-6 4 4 8-8" />
    <path d="M15 7h6v6" />
  </Icon>
);
export const FilmIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m10 9 5 3-5 3z" />
  </Icon>
);
export const CalendarIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M16 3v4M8 3v4M3 11h18" />
  </Icon>
);
export const BookmarkIcon = ({ filled, ...p }: P & { filled?: boolean }) => (
  <Icon {...p} fill={filled ? "currentColor" : "none"}>
    <path d="M6 3h12v18l-6-4-6 4z" />
  </Icon>
);
export const MoreIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="5" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="19" r="1" fill="currentColor" />
  </Icon>
);
export const ExternalIcon = (p: P) => (
  <Icon {...p}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Icon>
);
export const UsersIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14a6 6 0 0 1 3 6" />
  </Icon>
);
export const PlayCircleIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m10 8.5 5 3.5-5 3.5z" />
  </Icon>
);
export const VideoOffIcon = (p: P) => (
  <Icon {...p}>
    <path d="M10.5 5H15a2 2 0 0 1 2 2v3.5l4-2.5v8M17 17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2M3 3l18 18" />
  </Icon>
);
export const VideoIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="m16 10.5 5-3v9l-5-3" />
  </Icon>
);
export const GridIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
  </Icon>
);
/** Shorts-style mark: two rounded, offset lobes with a play triangle. */
export const ShortsIcon = (p: P) => (
  <Icon {...p}>
    <path d="M14.4 2.9 7.9 6.4a4.1 4.1 0 0 0 .2 7.3l.9.4-1 .6a4.1 4.1 0 0 0 3.8 7.3l6.5-3.5a4.1 4.1 0 0 0-.2-7.3l-.9-.4 1-.6a4.1 4.1 0 0 0-3.8-7.3Z" />
    <path d="m10.6 9.4 4 2.6-4 2.6z" fill="currentColor" stroke="none" />
  </Icon>
);
export const FlameIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 22c4 0 7-2.8 7-6.8 0-3.4-2.2-5.6-3.6-7.2-.5 1.9-1.6 3-2.9 3.4.5-3.4-1-6.5-3.9-8.4.2 3.1-1.4 5-3 6.8C4.3 11.3 5 13.3 5 15.2 5 19.2 8 22 12 22Z" />
  </Icon>
);
export const ChartIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 3v18h18" />
    <path d="m7 15 4-4 3 3 5-6" />
  </Icon>
);
export const CoinsIcon = (p: P) => (
  <Icon {...p}>
    <ellipse cx="9" cy="7" rx="6" ry="3" />
    <path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7" />
    <path d="M9 18c0 1.7 2.7 3 6 3s6-1.3 6-3v-5c0-1.6-2.4-2.9-5.5-3" />
  </Icon>
);
export const LogOutIcon = (p: P) => (
  <Icon {...p}>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3" />
  </Icon>
);
/** Brand mark: the Outlier logo (public/brand). Decorative; pair it with the "Outlier" wordmark. */
export function BrandMark({ size = 28 }: { size?: number }) {
  const src = size <= 64 ? "/brand/logo-128.png" : "/brand/logo-256.png";
  // eslint-disable-next-line @next/next/no-img-element -- tiny static asset; next/image adds nothing here
  return <img src={src} width={size} height={size} alt="" aria-hidden="true" className="brand-mark" draggable={false} />;
}export const CompassIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.5 8.5-2 5-5 2 2-5z" />
  </Icon>
);
