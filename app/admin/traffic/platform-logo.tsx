import type { CSSProperties } from "react";
import {
  siBaidu,
  siBrave,
  siClaude,
  siDeepseek,
  siDiscord,
  siDuckduckgo,
  siEcosia,
  siFacebook,
  siGoogle,
  siGooglegemini,
  siInstagram,
  siKick,
  siPerplexity,
  siPinterest,
  siReddit,
  siSnapchat,
  siThreads,
  siTiktok,
  siTwitch,
  siVimeo,
  siX,
  siYoutube,
  type SimpleIcon,
} from "simple-icons";

/**
 * The logo for a "Came from" source: the platform's own mark (from Simple
 * Icons) where there is one, a link or arrow for Outlier's own links and
 * direct visits, else the first letter on the brand's colour.
 */

// Names as lib/analytics/site.ts gives them.
const LOGOS: Record<string, SimpleIcon> = {
  YouTube: siYoutube,
  TikTok: siTiktok,
  Discord: siDiscord,
  Google: siGoogle,
  "X (Twitter)": siX,
  Instagram: siInstagram,
  Reddit: siReddit,
  Facebook: siFacebook,
  Claude: siClaude,
  DeepSeek: siDeepseek,
  Gemini: siGooglegemini,
  Perplexity: siPerplexity,
  Baidu: siBaidu,
  "Brave Search": siBrave,
  DuckDuckGo: siDuckduckgo,
  Ecosia: siEcosia,
  Kick: siKick,
  Pinterest: siPinterest,
  Snapchat: siSnapchat,
  Threads: siThreads,
  Twitch: siTwitch,
  Vimeo: siVimeo,
};

// Simple Icons has no mark for these; they get a letter on their colour.
const COLORS: Record<string, string> = {
  ChatGPT: "#10a37f",
  Copilot: "#2f7cf6",
  Grok: "#e7e7ea",
  Bing: "#2f7cf6",
  Yahoo: "#7e1fff",
  Yandex: "#fc3f1d",
  LinkedIn: "#0a66c2",
};

/** Near-black marks (TikTok, X, Threads) are drawn light so they show on the dark page. */
function visible(hex: string): string {
  const n = parseInt(hex, 16);
  const luminance = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luminance < 0.25 ? "#f5f5f7" : `#${hex}`;
}

const GLYPHS: Record<string, string> = {
  // A chain link: a creator's or friend's link.
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  // An arrow into a box: typed in or a bookmark.
  direct: "M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5M14 3h7v7M21 3l-9 9",
  email: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 7l9 6 9-6",
};

function glyphFor(name: string): string | null {
  if (/ link$/i.test(name)) return "link";
  if (name === "Direct") return "direct";
  if (name === "Email") return "email";
  return null;
}

export function PlatformLogo({ name }: { name: string }) {
  const icon = LOGOS[name];
  const glyph = glyphFor(name);
  const color = icon ? visible(icon.hex) : glyph === "link" ? "#a78bfa" : glyph ? "#adadb8" : (COLORS[name] ?? "#a78bfa");
  return (
    <span className="traffic-avatar" style={{ "--brand": color } as CSSProperties} aria-hidden="true">
      {icon ? (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
          <path d={icon.path} />
        </svg>
      ) : glyph ? (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d={GLYPHS[glyph]} />
        </svg>
      ) : (
        name.replace(/^www\./, "").charAt(0).toUpperCase()
      )}
    </span>
  );
}
