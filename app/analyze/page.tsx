import { ChartIcon, LinkIcon } from "@/components/icons";
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
      <PageHeader icon={ChartIcon} title="Analyze Video" subtitle="Paste any YouTube video or Short to see how it did against its own channel · 2 credits" />

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
  { title: "A fair verdict", body: "How it did against a typical upload on its own channel. New uploads get an early read instead of a ranking." },
  { title: "Against its uploads", body: "Every recent upload on one chart, so you can see where this one landed." },
  { title: "Takeaways", body: "The few things that stand out: reach past subscribers, likes, comments, length." },
  { title: "What works there", body: "The channel's best uploads, posting day, length and title styles, when you want the detail." },
];

function WhatYouGet() {
  return (
    <ol className="av-empty" aria-label="What an analysis shows">
      {FEATURES.map(({ title, body }, i) => (
        <li key={title}>
          <span>{String(i + 1).padStart(2, "0")}</span>
          <strong>{title}</strong>
          <p>{body}</p>
        </li>
      ))}
    </ol>
  );
}
