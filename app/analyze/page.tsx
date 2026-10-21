import { CalendarIcon, ChartIcon, ClockIcon, LinkIcon, PenIcon, TargetIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { isAppError } from "@/lib/core/errors";
import { requireApprovedUser } from "@/lib/auth/session";
import { Paywall } from "@/components/paywall";
import { paidFeaturesLocked } from "@/lib/billing/feature-gate";
import { PAID_FEATURES } from "@/lib/billing/features";
import { getServices } from "@/lib/services";
import { parseVideoId } from "@/lib/youtube/parse";
import { asUser } from "@/lib/youtube/quota-context";
import type { VideoAnalysis } from "@/lib/services/video-service";
import { AnalysisResult } from "./result";

export const dynamic = "force-dynamic";
// A transcript read can take a few seconds on top of the YouTube calls.
export const maxDuration = 30;

export default async function AnalyzePage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const current = await requireApprovedUser();
  const { user } = current;
  // Free is Shorts Channels only: show the paywall before loading anything.
  if (await paidFeaturesLocked(current)) return <Paywall feature={PAID_FEATURES["analyze"]} />;
  const { v } = await searchParams;
  const input = v?.trim() ?? "";

  let analysis: VideoAnalysis | null = null;
  let error: string | null = null;
  if (input) {
    const { credits, videos } = getServices();
    try {
      const videoId = parseVideoId(input);
      if (!(await credits.alreadyPaid(user.id, "analyze_video", videoId))) await credits.assertAvailable(user.id, "analyze_video");
      analysis = await asUser(user.id, "page:analyze_video", () => videos.analyzeVideo(videoId));
      // Re-opening the same video today is free.
      await credits.charge(user.id, "analyze_video", videoId);
    } catch (e) {
      error = isAppError(e) && e.expose ? e.message : "Could not analyze that video.";
    }
  }

  return (
    <div className="stack dash az">
      <PageHeader icon={ChartIcon} title="Analyze Video" subtitle="Paste any YouTube video or Short to see how it did against its own channel, and what stands out · 2 credits" />

      <form className="card av-form" method="get">
        <div className="av-form-row">
          <label htmlFor="v" className="sr-only">
            Video URL or ID
          </label>
          <span className="av-form-field">
            <LinkIcon size={16} />
            <input id="v" name="v" type="text" defaultValue={input} placeholder="Paste a YouTube video or Short link" required autoComplete="off" spellCheck={false} />
          </span>
          <button type="submit">Analyze</button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </form>

      {analysis ? <AnalysisResult analysis={analysis} /> : error ? null : <WhatYouGet />}
    </div>
  );
}

const FEATURES = [
  { icon: TargetIcon, title: "Breakout score", body: "How many times the channel's typical views it got, and how many of its recent uploads it beat." },
  { icon: ChartIcon, title: "Full breakdown", body: "Views, daily pace, like and comment rates, each next to the channel's usual." },
  { icon: CalendarIcon, title: "What works there", body: "The channel's best posting day and video length, from its own recent uploads." },
  { icon: PenIcon, title: "Title and hook", body: "Which title styles pay off on the channel, and what the video says in its first 3 seconds." },
  { icon: ClockIcon, title: "Momentum", body: "Views gained in the last day and week, when Outlier has been checking the video." },
];

function WhatYouGet() {
  return (
    <section className="av-empty" aria-label="What an analysis shows">
      {FEATURES.map(({ icon: Icon, title, body }) => (
        <div key={title} className="av-empty-item">
          <span className="av-empty-icon">
            <Icon size={16} />
          </span>
          <strong>{title}</strong>
          <p>{body}</p>
        </div>
      ))}
    </section>
  );
}
