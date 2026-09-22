import type { Metadata } from "next";
import Link from "next/link";
import { PenIcon } from "@/components/icons";
import { requireApprovedUser } from "@/lib/auth/session";
import { CREDIT_COSTS } from "@/lib/services/credits-service";
import { ComingSoonLock } from "./coming-soon";
import { ScriptForm } from "./script-form";

export const dynamic = "force-dynamic";
// Reading the niche and generating a script both take time; a Short script is the slowest thing here.
export const maxDuration = 60;
export const metadata: Metadata = { title: "Script Writer · Outlier" };

export default async function ScriptwriterPage() {
  const current = await requireApprovedUser();
  const cost = CREDIT_COSTS.write_script;

  return (
    <div className="dash sw">
      <header className="dash-hero">
        <div className="dash-hero-text">
          <span className="dash-eyebrow">
            <PenIcon size={13} /> Writing tool
          </span>
          <h1>Shorts Script Writer</h1>
          <p>
            Give it your niche and an idea. It studies the videos in that niche that beat their own channel — including how they
            open — and writes a Short from what they actually do: hook, beats, shots, titles.{" "}
            <Link href="/research/niche-finder" className="dash-link">
              Research a niche first
            </Link>{" "}
            for the sharpest results.
          </p>
        </div>
      </header>

      {current.isOwner ? <ScriptForm cost={cost} /> : <ComingSoonLock>{<LockedPreview cost={cost} />}</ComingSoonLock>}
    </div>
  );
}

/**
 * What members see behind the blur: the real shape of the tool, filled in with a
 * worked example. Static on purpose — no action, nothing to submit.
 */
function LockedPreview({ cost }: { cost: number }) {
  return (
    <>
      <div className="sw-form">
        <div className="sw-row">
          <label className="sw-field">
            <span>Niche</span>
            <input defaultValue="minecraft" readOnly tabIndex={-1} />
            <small>The niche to study. Its outliers are what the script learns from.</small>
          </label>
          <label className="sw-field">
            <span>Video idea or title</span>
            <input defaultValue="the redstone trick nobody uses" readOnly tabIndex={-1} />
            <small>What this Short is about. A working title is enough.</small>
          </label>
        </div>
        <label className="sw-field">
          <span>
            Your angle <em>optional</em>
          </span>
          <textarea defaultValue="I've played on the same survival world for 4 years" readOnly tabIndex={-1} rows={2} />
          <small>What you have that nobody else does. This is what stops a script coming out generic.</small>
        </label>
        <div className="sw-row">
          <label className="sw-field">
            <span>Length</span>
            <input defaultValue="30 seconds" readOnly tabIndex={-1} />
          </label>
          <label className="sw-field">
            <span>Tone</span>
            <input defaultValue="Energetic" readOnly tabIndex={-1} />
          </label>
          <div className="sw-submit">
            <span className="btn btn-primary">
              <PenIcon size={15} /> Write the script
            </span>
            <small>{cost} credits</small>
          </div>
        </div>
      </div>

      <div className="sw-result">
        <div className="sw-hook">
          <div className="sw-hook-head">
            <span className="dash-eyebrow">The hook</span>
          </div>
          <p className="sw-hook-line">&ldquo;The redstone trick nobody uses.&rdquo;</p>
          <p className="sw-hook-why">Opens on the thing itself instead of explaining what the video will be about.</p>
        </div>
        <ol className="sw-beats">
          {[
            { seconds: 2.3, say: "The redstone trick nobody uses.", onScreen: "nobody uses this", visual: "Close on a torch going on the side of a stone block." },
            { seconds: 9.1, say: "Put a torch on the side of any block, then stack a block straight on top of it.", onScreen: "", visual: "Hands place the torch, then the block above it." },
            { seconds: 5.9, say: "That gives you a constant signal with no repeaters at all.", onScreen: "no repeaters", visual: "Dust runs from the block to a lamp that stays lit." },
          ].map((beat, i) => (
            <li key={i}>
              <span className="sw-beat-time">{beat.seconds}s</span>
              <div className="sw-beat-body">
                <p className="sw-beat-say">{beat.say}</p>
                {beat.onScreen ? (
                  <p className="sw-beat-meta">
                    <strong>On screen</strong> {beat.onScreen}
                  </p>
                ) : null}
                <p className="sw-beat-meta">
                  <strong>Shot</strong> {beat.visual}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <div className="sw-panels">
          <section className="sw-panel">
            <h3>Titles</h3>
            <ul className="sw-titles">
              <li>The redstone trick nobody uses</li>
              <li>Why does nobody build it this way?</li>
            </ul>
          </section>
          <section className="sw-panel">
            <h3>Why this should work</h3>
            <p>Every outlier it studied opened on a claim instead of a greeting, and kept one question open to the last second.</p>
          </section>
        </div>
      </div>
    </>
  );
}
