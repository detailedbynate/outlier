import type { Metadata } from "next";
import Link from "next/link";
import { CaptionsIcon, LockIcon } from "@/components/icons";
import { requireApprovedUser } from "@/lib/auth/session";
import { writerTerms } from "@/lib/scripts/access";
import { getServices } from "@/lib/services";
import { TRANSCRIBE_LANGUAGES, TRANSCRIBE_MAX_SECONDS } from "@/lib/transcribe/languages";
import { Transcriber } from "./transcriber";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Transcribe · Outlier" };

export default async function TranscribePage() {
  const current = await requireApprovedUser();
  const services = getServices();
  // Same plans as Voice Studio: a voiceover goes in, its captions come out.
  const plan = current.isOwner ? null : await services.subscriptions.stateFor(current.user.id).catch(() => null);
  const terms = writerTerms(plan?.plan.id, current.isOwner);
  const allowance = terms?.transcribeMinutes ?? null;
  const used = terms && allowance !== null ? await services.transcribe.secondsUsed(current.user.id).catch(() => 0) : 0;

  return (
    <div className="dash tx-page">
      <header className="dash-hero">
        <div className="dash-hero-text">
          <span className="dash-eyebrow">
            <CaptionsIcon size={13} /> Creation tool
          </span>
          <h1>Transcribe</h1>
          <p>Drop in a voiceover and get the words back with exact timings: captions for CapCut, Premiere or YouTube, one word at a time or full lines.</p>
        </div>
      </header>

      {terms ? (
        <Transcriber languages={TRANSCRIBE_LANGUAGES.map(([code, name]) => ({ code, name }))} maxSeconds={TRANSCRIBE_MAX_SECONDS} allowance={allowance} used={used} />
      ) : (
        <div className="tx-locked">
          <span className="sw-modal-icon">
            <LockIcon size={20} />
          </span>
          <h2>Pro and above</h2>
          <p>Transcribe turns any voiceover into timed captions in seconds. It&apos;s part of Pro, with Voice Studio and the Script Writer.</p>
          <Link href="/billing" className="btn btn-primary">
            See Pro
          </Link>
        </div>
      )}
    </div>
  );
}
