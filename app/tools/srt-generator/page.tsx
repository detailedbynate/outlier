import type { Metadata } from "next";
import Link from "next/link";
import { Transcriber } from "@/app/transcribe/transcriber";
import { outlierFacts } from "@/app/vs/outlier-facts";
import { FREE_TRANSCRIBE_MAX_SECONDS } from "@/lib/services/transcribe-service";
import { TRANSCRIBE_LANGUAGES } from "@/lib/transcribe/languages";

const title = "Free SRT caption generator for Shorts and TikTok · Outlier";
const description = "Drop in a voiceover (MP3, WAV or M4A) and get word-by-word SRT or VTT captions with exact timings. Free, no sign-up.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/tools/srt-generator" },
  openGraph: { title, description, url: "/tools/srt-generator" },
};

/** The free, signed-out version of Transcribe: one-minute clips, a few a day. */
export default function SrtGeneratorPage() {
  const { price } = outlierFacts();
  return (
    <div className="seo-tool">
      <header className="seo-tool-head">
        <h1>Free SRT caption generator</h1>
        <p>Drop in a voiceover and get captions with exact word timings: word by word, short or full lines. Download SRT for CapCut, Premiere, DaVinci or YouTube. No sign-up.</p>
      </header>

      <Transcriber languages={TRANSCRIBE_LANGUAGES.map(([code, name]) => ({ code, name }))} maxSeconds={FREE_TRANSCRIBE_MAX_SECONDS} allowance={null} used={0} endpoint="/api/tools/captions" />

      <div className="seo-cta">
        <strong>Need longer files, or ideas worth captioning?</strong>
        <span>
          Outlier members get 20+ minutes of captions a day, plus viral Shorts research, a niche finder, a script writer and voiceovers. {price}/month.
        </span>
        <Link href="/#pricing" className="seo-button">
          See Outlier
        </Link>
      </div>

      <section className="seo-tool-faq">
        <h2>How do I add the captions in CapCut?</h2>
        <p>Download the SRT, then in CapCut go to Text → Import captions (or Captions → Import) and pick the file. The timings line up with your original audio.</p>
        <h2>Is it really free?</h2>
        <p>Yes: up to 3 clips a day, {FREE_TRANSCRIBE_MAX_SECONDS} seconds each. Your audio is turned into text on our server and isn&apos;t kept.</p>
        <h2>Which languages work?</h2>
        <p>{TRANSCRIBE_LANGUAGES.map(([, name]) => name).join(", ")}.</p>
        <p className="seo-small" style={{ marginTop: 20 }}>
          Comparing tools? See <Link href="/vs">Outlier vs vidIQ, 1of10, NexLev and more</Link>.
        </p>
      </section>
    </div>
  );
}
