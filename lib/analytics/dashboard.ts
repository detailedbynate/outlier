import { deltaOverWindow } from "./metrics";

/** Pure helpers for the dashboard: growth deltas, alerts, and activity labels. */

export interface ChannelGrowth {
  subs24h: number | null;
  subs7d: number | null;
  views24h: number | null;
  views7d: number | null;
}

export function channelGrowth(snapshots: readonly { captured_at: string; subscriber_count: number | null; view_count: number }[]): ChannelGrowth {
  const subs = snapshots.filter((s) => s.subscriber_count !== null).map((s) => ({ capturedAt: s.captured_at, value: s.subscriber_count! }));
  const views = snapshots.map((s) => ({ capturedAt: s.captured_at, value: s.view_count }));
  return {
    subs24h: deltaOverWindow(subs, 20),
    subs7d: deltaOverWindow(subs, 24 * 6.5),
    views24h: deltaOverWindow(views, 20),
    views7d: deltaOverWindow(views, 24 * 6.5),
  };
}

export type AlertTone = "good" | "warn" | "info";

export interface ChannelAlert {
  tone: AlertTone;
  title: string;
  detail: string;
  youtubeVideoId?: string;
}

export interface AlertVideo {
  youtube_video_id: string;
  title: string;
  published_at: string;
  outlier_score: number | null;
  view_count: number;
}

/** Things worth a look: breakouts, unusual view days, subscriber drops, upload gaps. */
export function channelAlerts(input: { growth: ChannelGrowth; videos: readonly AlertVideo[]; lastUploadAt: string | null }, now: Date = new Date()): ChannelAlert[] {
  const alerts: ChannelAlert[] = [];
  const week = now.getTime() - 7 * 86_400_000;

  const breakout = input.videos
    .filter((v) => Date.parse(v.published_at) >= week && (v.outlier_score ?? 0) >= 2)
    .sort((a, b) => (b.outlier_score ?? 0) - (a.outlier_score ?? 0))[0];
  if (breakout) {
    alerts.push({
      tone: "good",
      title: `${Number(breakout.outlier_score).toFixed(1)}× your usual views`,
      detail: breakout.title,
      youtubeVideoId: breakout.youtube_video_id,
    });
  }

  const { views24h, views7d, subs7d } = input.growth;
  if (views24h !== null && views7d !== null && views7d > 0 && views24h > (views7d / 7) * 2) {
    alerts.push({ tone: "good", title: "Unusually strong day", detail: `Views in the last 24h are ${(views24h / (views7d / 7)).toFixed(1)}× your daily average this week.` });
  }
  if (subs7d !== null && subs7d < 0) {
    alerts.push({ tone: "warn", title: "Subscribers dipped this week", detail: `${subs7d.toLocaleString("en-US")} over 7 days.` });
  }
  if (input.lastUploadAt && now.getTime() - Date.parse(input.lastUploadAt) > 14 * 86_400_000) {
    const days = Math.floor((now.getTime() - Date.parse(input.lastUploadAt)) / 86_400_000);
    alerts.push({ tone: "info", title: "No uploads in a while", detail: `Your last upload was ${days} days ago.` });
  }
  return alerts;
}

export interface ActivityItem {
  id: string;
  kind: "search" | "track" | "analyze" | "other";
  label: string;
  href: string | null;
  at: string;
}

/** Human labels for usage events shown in Recent activity. */
export function activityItem(event: { id: string; event_type: string; resource_id: string | null; occurred_at: string }): ActivityItem | null {
  const at = event.occurred_at;
  const resource = event.resource_id ?? "";
  switch (event.event_type) {
    case "research.shorts_discovery":
      return { id: event.id, kind: "search", label: `Searched “${resource}”`, href: `/research/shorts-channels?q=${encodeURIComponent(resource)}`, at };
    case "credits.track_channel":
      return { id: event.id, kind: "track", label: "Tracked a channel", href: resource ? `/channels/${resource}` : "/channels", at };
    case "credits.analyze_video":
      return { id: event.id, kind: "analyze", label: "Analyzed a video", href: resource ? `/analyze?v=${encodeURIComponent(resource)}` : "/analyze", at };
    default:
      return null;
  }
}

/** First name for the greeting: profile name, else a tidy version of the email's local part. */
export function greetingName(email: string, fullName?: string | null): string {
  const fromProfile = fullName?.trim().split(/\s+/)[0];
  if (fromProfile) return fromProfile;
  const local = email.split("@")[0]?.replace(/[._\-+]+/g, " ").replace(/\d+/g, "").trim().split(/\s+/)[0] ?? "";
  return local ? local[0]!.toUpperCase() + local.slice(1).toLowerCase() : "there";
}
