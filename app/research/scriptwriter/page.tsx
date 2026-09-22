import type { Metadata } from "next";
import { PenIcon } from "@/components/icons";
import { requireApprovedUser } from "@/lib/auth/session";
import { CREDIT_COSTS } from "@/lib/services/credits-service";
import { getServices } from "@/lib/services";
import { ComingSoonLock } from "./coming-soon";
import { SavedScripts } from "./saved-scripts";
import { StyleSamples } from "./style-samples";
import { ScriptForm } from "./script-form";

export const dynamic = "force-dynamic";
// Reading the niche and generating a script both take time; a Short script is the slowest thing here.
export const maxDuration = 60;
export const metadata: Metadata = { title: "Script Writer · Outlier" };

export default async function ScriptwriterPage() {
  const current = await requireApprovedUser();
  const cost = CREDIT_COSTS.write_script;
  // Only the owner can write one, so only the owner has any to show.
  const [saved, styles] = current.isOwner
    ? await Promise.all([
        getServices().repositories.savedScripts.listForUser(current.user.id),
        getServices().repositories.styleSamples.listForUser(current.user.id),
      ])
    : [[], []];

  return (
    <div className="dash sw">
      <header className="dash-hero">
        <div className="dash-hero-text">
          <span className="dash-eyebrow">
            <PenIcon size={13} /> Writing tool
          </span>
          <h1>Shorts Script Writer</h1>
          <p>
            Give it your niche and an idea and it writes the words — hook, turn, payoff — ready to read out. Tell it what
            you know that nobody else does and it builds the script around that instead of guessing.</p>
        </div>
      </header>

      {current.isOwner ? (
        <>
          <ScriptForm cost={cost} />
          <StyleSamples samples={styles} />
          <SavedScripts scripts={saved} />
        </>
      ) : (
        <ComingSoonLock>{<LockedPreview cost={cost} />}</ComingSoonLock>
      )}
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
        <section className="sw-script">
          <header className="sw-script-head">
            <span className="dash-eyebrow">Your script</span>
          </header>
          <p className="sw-line sw-line-hook">Your redstone doesn&apos;t need a single repeater, and most builds are full of them.</p>
          <p className="sw-line">People stack repeaters because that&apos;s what every tutorial shows, not because the circuit needs one.</p>
          <p className="sw-line">Put a torch on the side of a block, then put another block straight on top of the torch.</p>
          <p className="sw-line">That block is now powered, permanently, and it&apos;ll drive anything touching it.</p>
          <p className="sw-line">Hide it inside a wall and your door opens with nothing visible anywhere.</p>
          <p className="sw-line">Same circuit, half the parts, and nobody can see how it works.</p>
        </section>
        <section className="sw-panel">
          <h3>Titles</h3>
          <ul className="sw-titles">
            <li>The redstone trick nobody uses</li>
            <li>Stop putting repeaters in everything</li>
          </ul>
        </section>
      </div>
    </>
  );
}
