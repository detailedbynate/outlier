import type { Metadata } from "next";
import { MicIcon } from "@/components/icons";
import { requireApprovedUser } from "@/lib/auth/session";
import { writerOpenTo, writerTerms } from "@/lib/scripts/access";
import { scriptText } from "@/lib/scripts/schema";
import { getServices } from "@/lib/services";
import { VOICE_MAX_CHARACTERS, voiceResetLabel } from "@/lib/services/voice-service";
import { modelLabel } from "@/lib/voice/elevenlabs";
import { ComingSoonLock } from "../research/scriptwriter/coming-soon";
import { orbStyle } from "./orb";
import { Studio, type ScriptOption } from "./studio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata: Metadata = { title: "Voice Studio · Outlier" };

export default async function VoicePage({ searchParams }: { searchParams: Promise<{ script?: string }> }) {
  const current = await requireApprovedUser();
  const { script } = await searchParams;
  const services = getServices();
  // Same plans as the Script Writer: the two are meant to be used together.
  const plan = current.isOwner ? null : await services.subscriptions.stateFor(current.user.id).catch(() => null);
  const canUse = writerOpenTo(plan?.plan.id, current.isOwner);
  const onFreePlan = !current.isOwner && (plan?.plan.id ?? "free") === "free";

  const terms = writerTerms(plan?.plan.id, current.isOwner);
  const allowance = terms?.voiceCharacters ?? null;
  const [voices, saved, used] = canUse
    ? await Promise.all([
        services.voice.enabled ? services.voice.voices() : [],
        services.repositories.savedScripts.listForUser(current.user.id, 30),
        allowance === null ? 0 : services.voice.charactersUsed(current.user.id).catch(() => 0),
      ])
    : [[], [], 0];

  const scripts: ScriptOption[] = saved.map((row) => {
    const text = scriptText(row.script);
    const hook = /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? row.idea;
    return { id: row.id, label: hook.length > 70 ? `${hook.slice(0, 67)}…` : hook, text };
  });
  // "Voice it" from the Script Writer lands here with that script already in.
  const initialText = (script && scripts.find((s) => s.id === script)?.text) || "";

  return (
    <div className="dash vs-page vx-page">
      <header className="dash-hero">
        <div className="dash-hero-text">
          <span className="dash-eyebrow">
            <MicIcon size={13} /> Creation tool
          </span>
          <h1>Voice Studio</h1>
          <p>Turn your script into a voiceover in seconds. Pick from 40+ natural voices, tune how they read it, and download an MP3 ready for your edit.</p>
        </div>
      </header>

      {!canUse ? (
        <ComingSoonLock mode={onFreePlan ? "upgrade" : "soon"}>
          <LockedPreview />
        </ComingSoonLock>
      ) : voices.length === 0 ? (
        <div className="dash-empty">Voice Studio can&apos;t reach its voices right now. Try again in a minute.</div>
      ) : (
        <Studio voices={voices} scripts={scripts} initialText={initialText} maxCharacters={VOICE_MAX_CHARACTERS} allowance={allowance} used={used} resetsOn={voiceResetLabel(new Date())} model={modelLabel(services.voice.model ?? "")} />
      )}
    </div>
  );
}

/** What Free sees behind the blur: the studio's shape with an example in it. Static, nothing to submit. */
function LockedPreview() {
  return (
    <div className="vx">
      <section className="vx-editor">
        <div className="vx-toolbar">
          <span className="vx-pill">My scripts</span>
        </div>
        <div className="vx-canvas">
          <div className="vx-text vx-text-static">
            What is the rarest monster in the game that nobody owns? You&apos;d think it&apos;s some legendary event monster, right? It&apos;s
            actually one from way back that got vaulted before most players even started.
          </div>
        </div>
        <footer className="vx-foot">
          <span className="vx-count">
            <span className="vx-count-num">168</span> / 1,000 <em>· about 11s</em>
          </span>
          <div className="vx-generate">
            <span className="btn btn-primary vx-go">Generate speech</span>
          </div>
        </footer>
      </section>
      <aside className="vx-side">
        <div className="vx-tabs" data-tab="settings">
          <span>Settings</span>
          <span>History</span>
          <span className="vx-tab-ink" aria-hidden="true" />
        </div>
        <div className="vx-panel">
          <div className="vx-field">
            <span className="vx-label">Voice</span>
            <div className="vx-voice-current">
              <span className="vx-orb" style={orbStyle("preview-roger")} />
              <span className="vx-who-text">
                <strong>Roger</strong>
                <small>american · male · classy</small>
              </span>
            </div>
          </div>
        </div>
      </aside>
      <div className="vx-player" data-state="empty">
        <span className="vx-orb vx-orb-idle" aria-hidden="true" />
        <span className="vx-player-hint">Your audio plays here.</span>
      </div>
    </div>
  );
}
