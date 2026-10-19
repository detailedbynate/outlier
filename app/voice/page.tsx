import type { Metadata } from "next";
import { MicIcon } from "@/components/icons";
import { requireApprovedUser } from "@/lib/auth/session";
import { writerOpenTo, writerTerms } from "@/lib/scripts/access";
import { scriptText } from "@/lib/scripts/schema";
import { getServices } from "@/lib/services";
import { CREDIT_COSTS } from "@/lib/services/credits-service";
import { RATE_LIMITS } from "@/lib/services/rate-limit-service";
import { VOICE_MAX_CHARACTERS } from "@/lib/services/voice-service";
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

  const [voices, saved] = canUse
    ? await Promise.all([services.voice.enabled ? services.voice.voices() : [], services.repositories.savedScripts.listForUser(current.user.id, 30)])
    : [[], []];

  const scripts: ScriptOption[] = saved.map((row) => {
    const text = scriptText(row.script);
    const hook = /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? row.idea;
    return { id: row.id, label: hook.length > 70 ? `${hook.slice(0, 67)}…` : hook, text };
  });
  // "Voice it" from the Script Writer lands here with that script already in.
  const initialText = (script && scripts.find((s) => s.id === script)?.text) || "";

  const terms = writerTerms(plan?.plan.id, current.isOwner);
  const limitNote = terms?.voiceLimit ? `${RATE_LIMITS[terms.voiceLimit].maxHits} a day` : null;

  return (
    <div className="dash vs-page">
      <header className="dash-hero">
        <div className="dash-hero-text">
          <span className="dash-eyebrow">
            <MicIcon size={13} /> Creation tool
          </span>
          <h1>Voice Studio</h1>
          <p>Turn your script into a voiceover in seconds. Pick from 20+ natural voices, tune how they read it, and download an MP3 ready for your edit.</p>
        </div>
      </header>

      {!canUse ? (
        <ComingSoonLock mode={onFreePlan ? "upgrade" : "soon"}>
          <LockedPreview />
        </ComingSoonLock>
      ) : voices.length === 0 ? (
        <div className="dash-empty">Voice Studio can&apos;t reach its voices right now. Try again in a minute.</div>
      ) : (
        <Studio voices={voices} scripts={scripts} initialText={initialText} maxCharacters={VOICE_MAX_CHARACTERS} cost={CREDIT_COSTS.voiceover} limitNote={limitNote} model={modelLabel(services.voice.model ?? "")} />
      )}
    </div>
  );
}

/** What Free sees behind the blur: the studio's shape with an example in it. Static, nothing to submit. */
function LockedPreview() {
  return (
    <div className="vs">
      <section className="vs-editor">
        <div className="vs-text vs-text-static">
          What is the rarest monster in the game that nobody owns? You&apos;d think it&apos;s some legendary event monster, right? It&apos;s
          actually one from way back that got vaulted before most players even started.
        </div>
        <div className="vs-editor-bar">
          <span className="vs-count">168 / 1,000</span>
          <span className="btn btn-primary vs-go">Generate speech</span>
        </div>
      </section>
      <aside className="vs-side">
        <div className="vs-panel">
          <span className="vs-label">Voice</span>
          <div className="vs-voice-current">
            <span className="vs-orb" style={orbStyle("preview-roger")} />
            <span className="vs-voice-text">
              <strong>Roger</strong>
              <small>american · male · classy</small>
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
}
