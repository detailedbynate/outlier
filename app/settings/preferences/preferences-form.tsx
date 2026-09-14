"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ComponentType } from "react";
import { BookmarkIcon, ChartIcon, CompassIcon, FlameIcon, GridIcon, ShortsIcon, TrendingIcon, UsersIcon, VideoIcon, ZapIcon } from "@/components/icons";
import {
  addCompetitor,
  addNiche,
  stepError,
  toggleBothFormats,
  toggleValue,
  toSubmission,
  type OnboardingDraft,
  type StepId,
} from "@/lib/onboarding/flow";
import { CONTENT_FORMATS, GOALS, MAX_COMPETITORS, MAX_NICHES, NICHE_SUGGESTIONS, type GoalValue } from "@/lib/onboarding/schema";
import { OptionCard, RippleButton, TagInput } from "../../onboarding/onboarding-controls";
import { updatePreferences } from "./actions";

const GOAL_ICONS: Record<GoalValue, ComponentType<{ size?: number }>> = {
  grow_channel: TrendingIcon,
  find_viral_videos: FlameIcon,
  research_competitors: UsersIcon,
  find_niches: CompassIcon,
  content_ideas: ZapIcon,
  analyze_videos: ChartIcon,
};

const VALIDATED_SECTIONS: StepId[] = ["goals", "formats", "channel"];

/** All onboarding questions on one editable page. */
export function PreferencesForm({ initial }: { initial: OnboardingDraft }) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [nicheError, setNicheError] = useState<string | null>(null);
  const [competitorInput, setCompetitorInput] = useState("");
  const [competitorError, setCompetitorError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "saved" | "error"; message: string } | null>(null);
  const [saving, startSaving] = useTransition();

  const update = (patch: Partial<OnboardingDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setStatus(null);
  };

  const addCompetitorFromInput = () => {
    const result = addCompetitor(draft.competitors, competitorInput);
    if (!result.ok) return setCompetitorError(result.error);
    setCompetitorError(null);
    setCompetitorInput("");
    update({ competitors: result.values });
  };

  const save = () => {
    const firstError = VALIDATED_SECTIONS.map((step) => stepError(step, draft)).find(Boolean);
    if (firstError) return setStatus({ kind: "error", message: firstError });
    startSaving(async () => {
      const result = await updatePreferences(toSubmission(draft));
      if (result.ok) {
        setStatus({ kind: "saved", message: "Preferences saved." });
        router.refresh();
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    });
  };

  return (
    <form
      className="prefs-form"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <section className="card prefs-section">
        <h2>Goals</h2>
        <p className="stat-note">What do you want to use Outlier for?</p>
        <div className="option-grid" role="group" aria-label="Goals">
          {GOALS.map((goal, i) => (
            <OptionCard
              key={goal.value}
              index={i}
              icon={GOAL_ICONS[goal.value]}
              label={goal.label}
              description={goal.description}
              selected={draft.goals.includes(goal.value)}
              onToggle={() => update({ goals: toggleValue(draft.goals, goal.value) })}
            />
          ))}
        </div>
      </section>

      <section className="card prefs-section">
        <h2>Content type</h2>
        <div className="option-grid option-grid-3" role="group" aria-label="Content types">
          {CONTENT_FORMATS.map((format, i) => (
            <OptionCard
              key={format.value}
              index={i}
              icon={format.value === "shorts" ? ShortsIcon : VideoIcon}
              label={format.label}
              description={format.description}
              selected={draft.contentFormats.includes(format.value)}
              onToggle={() => update({ contentFormats: toggleValue(draft.contentFormats, format.value) })}
            />
          ))}
          <OptionCard
            index={2}
            icon={GridIcon}
            label="Both"
            description="A mix of Shorts and long-form"
            selected={draft.contentFormats.length === 2}
            onToggle={() => update({ contentFormats: toggleBothFormats(draft.contentFormats) })}
          />
        </div>
      </section>

      <section className="card prefs-section">
        <h2>Niches</h2>
        <TagInput
          values={draft.niches}
          suggestions={NICHE_SUGGESTIONS}
          placeholder="Search niches, e.g. AI, Finance, Gaming"
          max={MAX_NICHES}
          error={nicheError}
          onAdd={(value) => {
            const result = addNiche(draft.niches, value);
            if (!result.ok) {
              setNicheError(result.error);
              return false;
            }
            setNicheError(null);
            update({ niches: result.values });
            return true;
          }}
          onRemove={(value) => {
            setNicheError(null);
            update({ niches: draft.niches.filter((n) => n !== value) });
          }}
        />
      </section>

      <section className="card prefs-section">
        <h2>Your channel</h2>
        <div className="option-grid option-grid-2" role="radiogroup" aria-label="Do you have a channel">
          <OptionCard
            role="radio"
            index={0}
            icon={VideoIcon}
            label="I have a channel"
            description="Add your channel link or @handle"
            selected={draft.hasChannel === true}
            onToggle={() => update({ hasChannel: true })}
          />
          <OptionCard
            role="radio"
            index={1}
            icon={CompassIcon}
            label="Not yet"
            description="I'm researching before I start"
            selected={draft.hasChannel === false}
            onToggle={() => update({ hasChannel: false, channel: "" })}
          />
        </div>
        {draft.hasChannel ? (
          <label className="ob-reveal field">
            <span>Channel link or @handle</span>
            <input
              type="text"
              value={draft.channel}
              onChange={(e) => update({ channel: e.target.value })}
              placeholder="youtube.com/@yourchannel or @handle"
              maxLength={300}
            />
          </label>
        ) : null}
      </section>

      <section className="card prefs-section">
        <h2>Channels you research</h2>
        <div className="form">
          <input
            type="text"
            value={competitorInput}
            onChange={(e) => {
              setCompetitorInput(e.target.value);
              setCompetitorError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCompetitorFromInput();
              }
            }}
            placeholder="Channel URL or @handle"
            aria-label="Competitor channel"
            disabled={draft.competitors.length >= MAX_COMPETITORS}
            maxLength={300}
          />
          <RippleButton variant="ghost" onClick={addCompetitorFromInput} disabled={!competitorInput.trim()}>
            Add
          </RippleButton>
        </div>
        {competitorError ? <p className="form-error">{competitorError}</p> : null}
        {draft.competitors.length > 0 ? (
          <ul className="competitor-list">
            {draft.competitors.map((competitor) => (
              <li key={competitor} className="competitor">
                <BookmarkIcon size={15} />
                <span>{competitor}</span>
                <button
                  type="button"
                  className="tag-remove"
                  aria-label={`Remove ${competitor}`}
                  onClick={() => update({ competitors: draft.competitors.filter((c) => c !== competitor) })}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="stat-note">
          {draft.competitors.length}/{MAX_COMPETITORS} added
        </p>
      </section>

      <div className="prefs-actions">
        {status ? (
          <span className={status.kind === "error" ? "form-error" : "prefs-saved"} role="status">
            {status.message}
          </span>
        ) : null}
        <RippleButton type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save preferences"}
        </RippleButton>
      </div>
    </form>
  );
}
