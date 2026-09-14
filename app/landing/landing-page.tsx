/* eslint-disable @next/next/no-img-element -- YouTube images are already CDN-optimized */
import Link from "next/link";
import type { ComponentType } from "react";
import {
  BookmarkIcon,
  ChartIcon,
  CompassIcon,
  EyeIcon,
  FlameIcon,
  SearchIcon,
  ShortsIcon,
  TrendingIcon,
  UsersIcon,
  ZapIcon,
} from "@/components/icons";
import { logger } from "@/lib/core/logger";
import { formatCompact } from "@/lib/format";
import { getServices } from "@/lib/services";
import { WaitlistForm } from "./waitlist-form";

const FEATURES: { icon: ComponentType<{ size?: number }>; title: string; body: string }[] = [
  { icon: ShortsIcon, title: "Shorts Channels finder", body: "Search any niche and filter channels by size, average views, age, and how often they post." },
  { icon: ZapIcon, title: "Realtime growth", body: "Sort by views and subscribers gained in the last 24 and 48 hours to catch channels mid-breakout." },
  { icon: FlameIcon, title: "Trending today", body: "Every day, fresh breakout channels across rotating niches, picked for you automatically." },
  { icon: TrendingIcon, title: "Outlier videos", body: "See which uploads beat their channel's normal views by 5×, 10×, or more." },
  { icon: ChartIcon, title: "Video analyzer", body: "Paste any video to see views per day, engagement, and how it stacks up against its channel." },
  { icon: BookmarkIcon, title: "Track channels", body: "Bookmark competitors and inspiration. Their stats refresh daily so you can watch them grow." },
];

const STEPS = [
  { icon: SearchIcon, title: "Search a niche", body: "Type a topic like “cooking, recipes” or pick one of today’s trending niches." },
  { icon: CompassIcon, title: "Spot the outliers", body: "Filter for small channels with big views, new channels, or the fastest growth right now." },
  { icon: BookmarkIcon, title: "Track and act", body: "Save the channels worth studying and see what formats and ideas are working." },
];

/** Hide small numbers rather than advertising an empty waitlist. */
const SHOW_WAITLIST_COUNT_FROM = 25;

async function loadLandingData() {
  try {
    const { trending, research, repositories } = getServices();
    const [picks, waitlistCount] = await Promise.all([trending.latestPicks(), repositories.waitlist.count()]);
    const channels = picks ? (await research.trendingToday(picks.picks, 0)).slice(0, 3) : [];
    const topVideoByChannel = new Map(picks?.picks.map((p) => [p.youtubeChannelId, p]) ?? []);
    return { channels, topVideoByChannel, waitlistCount };
  } catch (error) {
    // The landing page must render even if the database is unavailable.
    logger.warn("landing data unavailable", { error });
    return { channels: [], topVideoByChannel: new Map(), waitlistCount: 0 };
  }
}

export async function LandingPage() {
  const { channels, topVideoByChannel, waitlistCount } = await loadLandingData();

  return (
    <div className="landing">
      <section className="hero">
        <span className="eyebrow">
          <span className="eyebrow-dot" aria-hidden="true" />
          Early access · invite only
        </span>
        <h1 className="hero-title">
          Find the Shorts channels blowing up <span className="gradient-text">before everyone else</span>
        </h1>
        <p className="hero-subtitle">
          Outlier tracks breakout YouTube channels and videos in real time, so you can spot winning niches, formats, and ideas while
          they&apos;re still early.
        </p>
        <div className="hero-actions">
          <a href="#waitlist" className="button-link button-lg">
            Join the waitlist
          </a>
          <Link href="/login" className="button-link button-secondary button-lg">
            Sign in
          </Link>
        </div>
        {waitlistCount >= SHOW_WAITLIST_COUNT_FROM ? (
          <p className="stat-note">{waitlistCount.toLocaleString()} creators already on the waitlist</p>
        ) : null}
      </section>

      {channels.length > 0 ? (
        <section className="preview glass" aria-labelledby="preview-title">
          <div className="preview-head">
            <span className="section-icon">
              <FlameIcon size={16} />
            </span>
            <div>
              <h2 id="preview-title">Trending today</h2>
              <p className="stat-note">Live picks from Outlier · updated daily</p>
            </div>
            <span className="live-pill">
              <span className="live-dot" aria-hidden="true" />
              Live
            </span>
          </div>
          <div className="preview-grid">
            {channels.map((channel) => {
              const top = topVideoByChannel.get(channel.youtube_channel_id);
              return (
                <article key={channel.channel_id} className="preview-card">
                  {top ? (
                    <div className="preview-thumb">
                      <img src={`https://i.ytimg.com/vi/${top.videoId}/hqdefault.jpg`} alt="" loading="lazy" />
                      <span className="short-views">
                        <EyeIcon size={12} />
                        {formatCompact(top.videoViews)}
                      </span>
                    </div>
                  ) : null}
                  <div className="preview-body">
                    <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
                      {channel.thumbnail_url ? <img className="avatar" src={channel.thumbnail_url} alt="" loading="lazy" /> : null}
                      <div style={{ minWidth: 0 }}>
                        <strong className="preview-name">{channel.title}</strong>
                        <div className="channel-meta">
                          <UsersIcon size={12} />
                          {channel.hidden_subscriber_count ? "Hidden" : formatCompact(channel.subscriber_count)} subs
                        </div>
                      </div>
                    </div>
                    <span className="niche-badge">{channel.niche}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="landing-section" aria-labelledby="features-title">
        <h2 id="features-title" className="section-heading">
          Everything you need to find what&apos;s working
        </h2>
        <div className="feature-grid">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <article key={title} className="feature-card glass">
              <span className="feature-icon">
                <Icon size={20} />
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section" aria-labelledby="how-title">
        <h2 id="how-title" className="section-heading">
          How it works
        </h2>
        <ol className="steps">
          {STEPS.map(({ icon: Icon, title, body }, index) => (
            <li key={title} className="step glass">
              <span className="step-number">{index + 1}</span>
              <span className="feature-icon">
                <Icon size={18} />
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="waitlist" className="waitlist-section glass" aria-labelledby="waitlist-title">
        <div className="waitlist-copy">
          <h2 id="waitlist-title" className="section-heading">
            Get early access
          </h2>
          <p className="subtitle">
            We&apos;re letting people in in small batches. Join the waitlist and we&apos;ll email your invite as soon as your spot opens.
          </p>
          <ul className="perk-list">
            <li>First access to every research tool</li>
            <li>Help shape what we build next</li>
            <li>Early members hear about launch pricing first</li>
          </ul>
        </div>
        <WaitlistForm />
      </section>

      <footer className="landing-footer">
        <span>© {new Date().getFullYear()} Outlier</span>
        <Link href="/privacy">Privacy</Link>
        <span className="muted">Not affiliated with YouTube or Google.</span>
      </footer>
    </div>
  );
}
