"use client";

import { useState } from "react";

const SHARE_TEXT = "I'm on the waitlist for Outlier: it finds the YouTube videos and channels blowing up before everyone else. Join with my link:";

/** Copy/share a referral link, with progress toward the next reward. */
export function ReferralShare({
  link,
  count,
  target,
  unlocks,
  reached,
  statusLink,
  compact = false,
}: {
  link: string;
  /** Referrals so far (waitlist signups, or friends with an account). */
  count: number;
  /** Referrals needed for the next reward. */
  target: number;
  /** What the next reward is, e.g. "250 credits" or "priority access". */
  unlocks: string;
  /** Shown instead once there is nothing left to reach. */
  reached?: string;
  statusLink?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const remaining = Math.max(target - count, 0);
  const progress = target > 0 ? Math.min(count / target, 1) : 1;
  const encoded = encodeURIComponent(link);
  const text = encodeURIComponent(SHARE_TEXT);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const nativeShare = async () => {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: "Outlier", text: SHARE_TEXT, url: link });
        return;
      } catch {
        // Cancelled or unsupported: fall back to copying.
      }
    }
    await copy();
  };

  return (
    <div className={`referral-share ${compact ? "is-compact" : ""}`}>
      <div className="referral-progress" aria-label={`${count} of ${target} referrals`}>
        <div className="referral-progress-head">
          <strong>
            <span aria-hidden="true">🔥</span> {count}/{target} referrals
          </strong>
        </div>
        <div className="referral-bar">
          <span style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="referral-progress-note">
          {remaining > 0 ? `Refer ${remaining} more creator${remaining === 1 ? "" : "s"} to unlock ${unlocks}` : (reached ?? `You unlocked ${unlocks}`)}
        </p>
      </div>

      <div className="referral-link">
        <input type="text" readOnly value={link} aria-label="Your referral link" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" onClick={copy}>
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      <div className="referral-buttons">
        <a href={`https://twitter.com/intent/tweet?text=${text}&url=${encoded}`} target="_blank" rel="noreferrer" className="referral-btn">
          Share on X
        </a>
        <a href={`https://www.reddit.com/submit?url=${encoded}&title=${encodeURIComponent("Outlier: find YouTube videos blowing up early")}`} target="_blank" rel="noreferrer" className="referral-btn">
          Reddit
        </a>
        <a href={`https://wa.me/?text=${text}%20${encoded}`} target="_blank" rel="noreferrer" className="referral-btn">
          WhatsApp
        </a>
        <button type="button" className="referral-btn" onClick={nativeShare}>
          More…
        </button>
      </div>

      {statusLink ? (
        <p className="referral-note">
          Track your referrals anytime: <a href={statusLink}>{statusLink.replace(/^https?:\/\//, "")}</a>
        </p>
      ) : null}
    </div>
  );
}