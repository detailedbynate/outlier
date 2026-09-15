/* eslint-disable @next/next/no-img-element -- YouTube images are already CDN-optimized */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { ChartIcon, FlameIcon, PlayCircleIcon, TrendingIcon, ZapIcon } from "@/components/icons";
import { requireApprovedUser } from "@/lib/auth/session";
import type { PatternStat } from "@/lib/competitors/intel";
import { formatCompact, formatPercent, timeAgo } from "@/lib/format";
import { CHANNEL_ID_PATTERN } from "@/lib/youtube/parse";
import { getServices } from "@/lib/services";
import { Delta, Multiplier, Sparkline, TrendBadge, VideoTable, WeeklyBars } from "../intel-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Competitor profile · Outlier" };

function Panel({ icon: Icon, title, subtitle, children, tone = "violet", index = 0 }: { icon: typeof ChartIcon; title: string; subtitle?: string; children: ReactNode; tone?: string; index?: number }) {
  return (
    <section className="dash-panel" style={{ "--i": index } as CSSProperties} aria-label={title}>
      <header className="dash-panel-head">
        <span className="dash-icon" data-tone={tone}>
          <Icon size={16} />
        </span>
        <div className="dash-panel-titles">
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

export default async function CompetitorProfilePage({ params }: { params: Promise<{ channelId: string }> }) {
  await requireApprovedUser();
  const { channelId } = await params;
  if (!CHANNEL_ID_PATTERN.test(channelId)) notFound();
  const detail = await getServices().competitors.detail(channelId);
  if (!detail) notFound();

  const { profile, working } = detail;
  const { channel, growth } = profile;
  const shorts = profile.videos.filter((v) => v.format === "short");
  const longs = profile.videos.filter((v) => v.format === "long_form");
  const breakouts = profile.videos.filter((v) => (v.multiplier ?? 0) >= 2 && v.ageHours <= 30 * 24).sort((a, b) => (b.multiplier ?? 0) - (a.multiplier ?? 0)).slice(0, 6);

  const stats: { label: string; value: ReactNode; note?: string }[] = [
    { label: "Subscribers", value: channel.hidden_subscriber_count ? "Hidden" : formatCompact(channel.subscriber_count), note: growth.d7.subs !== null ? undefined : "growth after a week of history" },
    { label: "Subs · 7d", value: <Delta value={growth.d7.subs} pct={growth.d7.subsPct} /> },
    { label: "Views · 7d", value: <Delta value={growth.d7.views} /> },
    { label: "Total views", value: formatCompact(channel.view_count) },
    { label: "Uploads / week", value: profile.uploadsPerWeek.toFixed(1), note: "last 4 weeks" },
    { label: "Views / upload", value: formatCompact(profile.avgViews), note: `median ${formatCompact(profile.medianViews)}` },
    { label: "Engagement", value: formatPercent(profile.engagement) },
    { label: "Outlier rate", value: formatPercent(profile.outlierRate, 0), note: "uploads at 2×+ normal" },
  ];

  return (
    <div className="dash intel">
      <header className="dash-hero">
        <Link href="/compare" className="dash-link">
          ← Competitors
        </Link>
        <div className="intel-profile-head">
          {channel.thumbnail_url ? <img className="dash-avatar intel-avatar-xl" src={channel.thumbnail_url} alt="" /> : <span className="dash-avatar intel-avatar-xl" />}
          <div>
            <h1>{channel.title}</h1>
            <p>
              {channel.handle ? `${channel.handle} · ` : ""}
              <TrendBadge label={growth.trend.label} /> · Updated {profile.lastUpdated ? timeAgo(profile.lastUpdated) : "—"} ·{" "}
              <a href={`https://www.youtube.com/channel/${channel.youtube_channel_id}`} target="_blank" rel="noreferrer" className="dash-link">
                YouTube ↗
              </a>
            </p>
          </div>
        </div>
      </header>

      <div className="intel-stats">
        {stats.map((s, i) => (
          <div key={s.label} className="dash-stat" style={{ "--i": i } as CSSProperties}>
            <span className="dash-stat-label">{s.label}</span>
            <span className="dash-stat-value intel-stat-value">{s.value}</span>
            {s.note ? <span className="dash-stat-note">{s.note}</span> : null}
          </div>
        ))}
      </div>

      <div className="dash-columns">
        <Panel icon={TrendingIcon} title="Growth" subtitle="Daily snapshots, last 30 days" tone="blue" index={0}>
          <div className="intel-growth-grid">
            <div>
              <span className="dash-stat-label">Subscribers</span>
              <Sparkline points={detail.subscribers} label="Subscribers" />
            </div>
            <div>
              <span className="dash-stat-label">Total views</span>
              <Sparkline points={detail.views} label="Total views" />
            </div>
          </div>
          <dl className="niche-metrics is-compact">
            <div><dt>Subs 24h</dt><dd><Delta value={growth.h24.subs} /></dd></div>
            <div><dt>Subs 48h</dt><dd><Delta value={growth.h48.subs} /></dd></div>
            <div><dt>Subs 30d</dt><dd>{growth.d30 ? <Delta value={growth.d30.subs} pct={growth.d30.subsPct} /> : "—"}</dd></div>
            <div><dt>Views 24h</dt><dd><Delta value={growth.h24.views} /></dd></div>
            <div><dt>Views/day recent</dt><dd>{formatCompact(growth.trend.recentDailyViews)}</dd></div>
            <div><dt>Views/day prior</dt><dd>{formatCompact(growth.trend.priorDailyViews)}</dd></div>
          </dl>
        </Panel>

        <Panel icon={ChartIcon} title="Upload frequency & formats" subtitle="Last 8 weeks · pink Shorts, blue long-form" tone="green" index={1}>
          <WeeklyBars weeks={detail.weekly} />
          <dl className="niche-metrics is-compact">
            <div><dt>Shorts sampled</dt><dd>{shorts.length}</dd></div>
            <div><dt>Avg Shorts views</dt><dd>{formatCompact(profile.avgShortViews)}</dd></div>
            <div><dt>Shorts share</dt><dd>{formatPercent(profile.shortsShare, 0)}</dd></div>
            <div><dt>Long-form sampled</dt><dd>{longs.length}</dd></div>
            <div><dt>Avg long-form views</dt><dd>{formatCompact(profile.avgLongViews)}</dd></div>
            <div><dt>Best recent</dt><dd><Multiplier value={profile.topOutlier} /></dd></div>
          </dl>
        </Panel>
      </div>

      <Panel icon={FlameIcon} title="Breakout videos" subtitle="Last 30 days at 2× or more of normal views" tone="pink" index={2}>
        <VideoTable videos={breakouts} />
      </Panel>

      <Panel icon={PlayCircleIcon} title="Recent videos" subtitle={`${profile.videos.length} stored uploads from the last 90 days`} index={3}>
        <VideoTable videos={profile.videos.slice(0, 15)} />
      </Panel>

      <Panel icon={ZapIcon} title="Content patterns" subtitle="What performs above this channel's own median" index={4}>
        {working.sampleVideos < 3 ? (
          <div className="dash-empty">
            <strong>Not enough uploads yet</strong>
          </div>
        ) : (
          <div className="intel-working">
            <Patterns title="Topics" items={working.topics} />
            <Patterns title="Formats" items={working.formats} />
            <Patterns title="Long-form length" items={working.lengths} />
            <Patterns title="Title patterns" items={working.titles} />
          </div>
        )}
      </Panel>

      <Panel icon={TrendingIcon} title="Top videos" subtitle="Most-viewed stored uploads" tone="amber" index={5}>
        <VideoTable videos={detail.topVideos} />
      </Panel>
    </div>
  );
}

function Patterns({ title, items }: { title: string; items: PatternStat[] }) {
  return (
    <div>
      <h3 className="dash-subhead">{title}</h3>
      {items.length === 0 ? (
        <p className="intel-muted">Not enough data</p>
      ) : (
        <ul className="intel-patterns">
          {items.map((p) => (
            <li key={p.label}>
              <span className="intel-pattern-label">{p.label}</span>
              <span className="intel-muted">
                {p.videos} videos · {formatCompact(p.avgViews)} avg
              </span>
              <span className="intel-lift" data-dir={p.lift === null ? "none" : p.lift >= 1.1 ? "up" : p.lift <= 0.9 ? "down" : "flat"}>
                {p.lift === null ? "—" : `${p.lift.toFixed(2)}×`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
