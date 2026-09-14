"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ComponentType } from "react";
import {
  BookmarkIcon,
  BrandMark,
  ChartIcon,
  CompassIcon,
  FlameIcon,
  GridIcon,
  ShortsIcon,
  TrendingIcon,
  UsersIcon,
  VideoIcon,
  ZapIcon,
} from "@/components/icons";
import {
  addCompetitor,
  addNiche,
  EMPTY_DRAFT,
  progressFor,
  QUESTION_STEPS,
  SKIPPABLE,
  STEP_IDS,
  stepError,
  stepForField,
  toggleBothFormats,
  toggleValue,
  toSubmission,
  type OnboardingDraft,
  type StepId,
} from "@/lib/onboarding/flow";
import { CONTENT_FORMATS, GOALS, MAX_COMPETITORS, MAX_NICHES, NICHE_SUGGESTIONS, type GoalValue } from "@/lib/onboarding/schema";
import { completeOnboarding } from "./actions";
import { Confetti, OptionCard, RippleButton, TagInput } from "./onboarding-controls";

const GOAL_ICONS: Record<GoalValue, ComponentType<{ size?: number }>> = {
  grow_channel: TrendingIcon,
  find_viral_videos: FlameIcon,
  research_competitors: UsersIcon,
  find_niches: CompassIcon,
  content_ideas: ZapIcon,
  analyze_videos: ChartIcon,
};

function ArrowRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function ArrowLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  );
}

export function OnboardingFlow({ firstName }: { firstName: string | null }) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [draft, setDraft] = useState<OnboardingDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [nicheError, setNicheError] = useState<string | null>(null);
  const [competitorInput, setCompetitorInput] = useState("");
  const [competitorError, setCompetitorError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const step: StepId = STEP_IDS[stepIndex]!;
  const questionNumber = QUESTION_STEPS.indexOf(step) + 1;

  // Move focus to each new step's heading for keyboard and screen reader users.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [stepIndex]);

  const update = (patch: Partial<OnboardingDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  };

  const goTo = (index: number, dir: "forward" | "back") => {
    setDirection(dir);
    setError(null);
    setStepIndex(index);
  };

  const fail = (message: string) => {
    setError(message);
    setShake((n) => n + 1);
  };

  const submit = (finalDraft: OnboardingDraft) => {
    startSaving(async () => {
      const result = await completeOnboarding(toSubmission(finalDraft));
      if (result.ok) {
        goTo(STEP_IDS.indexOf("complete"), "forward");
        return;
      }
      const target = stepForField(result.field);
      if (target) goTo(STEP_IDS.indexOf(target), "back");
      fail(result.error);
    });
  };

  const next = () => {
    const problem = stepError(step, draft);
    if (problem) return fail(problem);
    if (step === "competitors") return submit(draft);
    goTo(stepIndex + 1, "forward");
  };

  const skip = () => {
    if (step === "competitors") {
      const skipped = { ...draft, competitors: [] };
      setDraft(skipped);
      return submit(skipped);
    }
    goTo(stepIndex + 1, "forward");
  };

  const back = () => goTo(Math.max(stepIndex - 1, 0), "back");

  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (event.key !== "Enter" || target.tagName === "INPUT" || target.tagName === "BUTTON") return;
    if (step !== "complete") next();
  };

  const addCompetitorFromInput = () => {
    const result = addCompetitor(draft.competitors, competitorInput);
    if (!result.ok) {
      setCompetitorError(result.error);
      return;
    }
    update({ competitors: result.values });
    setCompetitorInput("");
    setCompetitorError(null);
  };

  const progress = progressFor(step);

  return (
    <div className="onboarding-root" onKeyDown={onKeyDown}>
      <div className="ob-backdrop" aria-hidden="true">
        <span className="ob-orb ob-orb-a" />
        <span className="ob-orb ob-orb-b" />
        <span className="ob-orb ob-orb-c" />
      </div>

      <header className="ob-top">
        <span className="ob-brand">
          <BrandMark size={28} />
          Outlier
        </span>
        {step !== "welcome" && step !== "complete" ? (
          <span className="ob-step-count" aria-live="polite">
            Step {questionNumber} of {QUESTION_STEPS.length}
          </span>
        ) : null}
      </header>

      <div
        className="ob-progress"
        role="progressbar"
        aria-label="Onboarding progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <span className="ob-progress-fill" style={{ transform: `scaleX(${progress})` }} />
      </div>

      <main className="ob-stage">
        <section key={step} className={`ob-card glass step-${direction}`} aria-labelledby="ob-heading">
          <div key={shake} className={shake > 0 && error ? "ob-shake" : undefined}>
            {step === "welcome" ? (
              <div className="ob-center">
                <div className="ob-hero-mark">
                  <span className="ob-hero-ring" />
                  <BrandMark size={72} />
                </div>
                <h1 id="ob-heading" ref={headingRef} tabIndex={-1} className="ob-title">
                  Welcome to Outlier{firstName ? `, ${firstName}` : ""} <span className="wave">👋</span>
                </h1>
                <p className="ob-subtitle">
                  Answer a few quick questions and we&apos;ll tailor your research, recommendations, and dashboard to what you
                  actually want to grow. It takes about a minute.
                </p>
              </div>
            ) : null}

            {step === "goals" ? (
              <>
                <h1 id="ob-heading" ref={headingRef} tabIndex={-1} className="ob-title">
                  What are you here to do?
                </h1>
                <p className="ob-subtitle">Pick as many as you like.</p>
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
              </>
            ) : null}

            {step === "formats" ? (
              <>
                <h1 id="ob-heading" ref={headingRef} tabIndex={-1} className="ob-title">
                  What type of content do you make?
                </h1>
                <p className="ob-subtitle">Choose all that apply. We&apos;ll prioritize research for these formats.</p>
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
              </>
            ) : null}

            {step === "niches" ? (
              <>
                <h1 id="ob-heading" ref={headingRef} tabIndex={-1} className="ob-title">
                  What niches are you interested in?
                </h1>
                <p className="ob-subtitle">Search, tap a suggestion, or type your own. You can change these later.</p>
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
              </>
            ) : null}

            {step === "channel" ? (
              <>
                <h1 id="ob-heading" ref={headingRef} tabIndex={-1} className="ob-title">
                  Do you have a YouTube channel?
                </h1>
                <p className="ob-subtitle">We&apos;ll use it to compare you with channels in your space.</p>
                <div className="option-grid option-grid-2" role="radiogroup" aria-label="Do you have a channel">
                  <OptionCard
                    role="radio"
                    index={0}
                    icon={VideoIcon}
                    label="Yes, I do"
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
                    <span>Your channel</span>
                    <input
                      type="text"
                      value={draft.channel}
                      onChange={(e) => update({ channel: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          next();
                        }
                      }}
                      placeholder="youtube.com/@yourchannel or @handle"
                      autoFocus
                      maxLength={300}
                    />
                  </label>
                ) : null}
              </>
            ) : null}

            {step === "competitors" ? (
              <>
                <h1 id="ob-heading" ref={headingRef} tabIndex={-1} className="ob-title">
                  Who do you want to research?
                </h1>
                <p className="ob-subtitle">Add competitors or channels that inspire you. This is optional.</p>
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
                ) : (
                  <p className="stat-note ob-hint">
                    {draft.competitors.length}/{MAX_COMPETITORS} added
                  </p>
                )}
              </>
            ) : null}

            {step === "complete" ? (
              <div className="ob-center">
                <Confetti />
                <h1 id="ob-heading" ref={headingRef} tabIndex={-1} className="ob-title">
                  You&apos;re all set <span className="rocket">🚀</span>
                </h1>
                <p className="ob-subtitle">
                  Outlier will use your preferences to personalize your research, recommendations, and dashboard. You can update them
                  anytime.
                </p>
                <div className="ob-summary">
                  <span>{draft.goals.length} goals</span>
                  <span>{draft.contentFormats.map((f) => (f === "shorts" ? "Shorts" : "Long-form")).join(" + ")}</span>
                  {draft.niches.length > 0 ? <span>{draft.niches.slice(0, 3).join(", ")}{draft.niches.length > 3 ? "…" : ""}</span> : null}
                </div>
              </div>
            ) : null}

            {error ? (
              <p className="form-error ob-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <footer className="ob-actions">
            {step !== "welcome" && step !== "complete" ? (
              <RippleButton variant="ghost" onClick={back} disabled={saving}>
                <ArrowLeft />
                Back
              </RippleButton>
            ) : (
              <span />
            )}
            <div className="ob-actions-right">
              {SKIPPABLE.has(step) ? (
                <button type="button" className="ob-skip" onClick={skip} disabled={saving}>
                  Skip
                </button>
              ) : null}
              {step === "complete" ? (
                <RippleButton
                  onClick={() => {
                    router.replace("/");
                    router.refresh();
                  }}
                >
                  Go to Outlier
                  <ArrowRight />
                </RippleButton>
              ) : (
                <RippleButton onClick={next} disabled={saving}>
                  {saving ? "Saving…" : step === "competitors" ? "Finish" : "Continue"}
                  {saving ? null : <ArrowRight />}
                </RippleButton>
              )}
            </div>
          </footer>
        </section>
      </main>
    </div>
  );
}
