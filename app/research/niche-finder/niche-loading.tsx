"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * What a report is doing while it builds. The server doesn't stream progress,
 * so the steps follow the usual timings: a cached report skips straight past
 * them, and a fresh one spends most of its time on the middle steps.
 */
const STEPS = [
  { label: "Finding channels in this niche", after: 0 },
  { label: "Reading their recent uploads", after: 1_500 },
  { label: "Spotting breakouts", after: 4_000 },
  { label: "Splitting it into sub-niches", after: 7_000 },
  { label: "Working out the scores", after: 11_000 },
  { label: "Almost there, big niches take a little longer", after: 20_000 },
];

/** The report steps only while a topic is being researched; just opening the page needs no explaining. */
export function NicheLoading() {
  const researching = Boolean(useSearchParams().get("topic")?.trim());
  return researching ? <ReportSteps /> : null;
}

function ReportSteps() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - start), 250);
    return () => clearInterval(timer);
  }, []);

  const current = STEPS.reduce((at, step, i) => (elapsed >= step.after ? i : at), 0);

  return (
    <section className="niche-loading" aria-live="polite" aria-busy="true">
      <h2>Building the report</h2>
      <ol>
        {STEPS.map((step, i) => (
          <li key={step.label} data-state={i < current ? "done" : i === current ? "now" : "next"}>
            <span className="niche-loading-dot" aria-hidden="true" />
            {step.label}
          </li>
        ))}
      </ol>
    </section>
  );
}
