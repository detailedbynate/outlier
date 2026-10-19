"use client";

import { useActionState } from "react";
import { findPeerPlan, type PeerPlanState } from "./actions";

const initial: PeerPlanState = { plan: null, error: null, charged: 0 };

/** "What to make next", from what's breaking out on the channels most like this one. */
export function PeerPlan({ channelId, cost, available }: { channelId: string; cost: number; available: boolean }) {
  const [state, action, pending] = useActionState(findPeerPlan, initial);
  const plan = state.plan;
  return (
    <div className="peer-plan">
      {plan ? null : (
        <form action={action} className="peer-plan-ask">
          <input type="hidden" name="channelId" value={channelId} />
          <div>
            <strong>What to make next</strong>
            <p className="stat-note">
              {available
                ? `The topics and title formats these breakouts share, and Shorts to make from them (${cost} credits).`
                : "Topics, title formats and ideas read off these breakouts. On the Pro and Expert plans."}
            </p>
            {state.error ? (
              <p className="form-error" role="alert">
                {state.error}
              </p>
            ) : null}
          </div>
          <button type="submit" disabled={pending || !available}>
            {pending ? "Reading the breakouts…" : "Suggest what to make"}
          </button>
        </form>
      )}

      {plan ? (
        <div className="peer-plan-result">
          <section>
            <h3>Topics that are working</h3>
            <ul className="peer-list">
              {plan.topics.map((t) => (
                <li key={t.topic}>
                  <strong>{t.topic}</strong>
                  <span className="muted">{t.why}</span>
                  <span className="peer-examples">{t.examples.map((e) => `“${e}”`).join(" · ")}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3>Title formats</h3>
            <ul className="peer-list">
              {plan.formats.map((f) => (
                <li key={f.format}>
                  <strong>{f.format}</strong>
                  <span className="peer-examples">“{f.example}”</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="peer-ideas">
            <h3>Make next</h3>
            <ul className="peer-list">
              {plan.ideas.map((idea) => (
                <li key={idea.title}>
                  <strong>{idea.title}</strong>
                  <span>{idea.hook}</span>
                  <span className="muted">{idea.why}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}
