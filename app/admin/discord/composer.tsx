"use client";
/* eslint-disable @next/next/no-img-element -- the preview shows whatever image address was typed, as Discord will */

import { useActionState, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { postMessage, type DiscordFormState } from "./actions";

const initial: DiscordFormState = { status: "idle", message: null, sent: 0 };

interface Draft {
  channelId: string;
  content: string;
  title: string;
  description: string;
  color: string;
  url: string;
  imageUrl: string;
  thumbnailUrl: string;
  footer: string;
  buttonLabel: string;
  buttonUrl: string;
  ping: boolean;
}

const EMPTY: Omit<Draft, "channelId"> = {
  content: "",
  title: "",
  description: "",
  color: "#8b5cf6",
  url: "",
  imageUrl: "",
  thumbnailUrl: "",
  footer: "",
  buttonLabel: "",
  buttonUrl: "",
  ping: false,
};

const SWATCHES = ["#8b5cf6", "#ec4899", "#38bdf8", "#34d399", "#fbbf24", "#f87171", "#f5f5f7"];

/** Starting points, so a good-looking post is one click and a few words away. */
function presets(site: string): { label: string; draft: Partial<Draft> }[] {
  return [
    {
      label: "Announcement",
      draft: {
        content: "",
        title: "📣 Big news",
        description: "Write what's new here.\n\n**What it means for you:**\n- First thing\n- Second thing",
        color: "#8b5cf6",
        footer: "Outlier",
        buttonLabel: "Open Outlier",
        buttonUrl: site,
      },
    },
    {
      label: "New feature",
      draft: {
        title: "✨ New in Outlier: ",
        description: "What it does, in one or two lines.\n\n**How to use it:** Open the app and…",
        color: "#38bdf8",
        footer: "Live now",
        buttonLabel: "Try it",
        buttonUrl: site,
      },
    },
    {
      label: "Deal",
      draft: {
        title: "🔥 Limited-time deal",
        description: "**Pro is $10/month** for a limited time.\n\nFind outliers before everyone else.",
        color: "#ec4899",
        footer: "Ends soon",
        buttonLabel: "Get Pro",
        buttonUrl: `${site}/#pricing`,
      },
    },
    { label: "Blank", draft: { ...EMPTY } },
  ];
}

/** Discord's markdown, enough to preview a post: headings, lists, bold, italic, underline, strike, code and links. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|~~[^~]+~~|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/\S+)/g;
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    if (match.index > last) out.push(text.slice(last, match.index));
    const k = `${key}-${i++}`;
    if (token.startsWith("**")) out.push(<strong key={k}>{inline(token.slice(2, -2), k)}</strong>);
    else if (token.startsWith("__")) out.push(<u key={k}>{inline(token.slice(2, -2), k)}</u>);
    else if (token.startsWith("~~")) out.push(<s key={k}>{inline(token.slice(2, -2), k)}</s>);
    else if (token.startsWith("`")) out.push(<code key={k}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("[")) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token) ?? [];
      out.push(
        <a key={k} href={href} target="_blank" rel="noreferrer">
          {label}
        </a>,
      );
    } else if (token.startsWith("http")) {
      out.push(
        <a key={k} href={token} target="_blank" rel="noreferrer">
          {token}
        </a>,
      );
    } else out.push(<em key={k}>{inline(token.slice(1, -1), k)}</em>);
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => {
        const key = `l${i}`;
        const heading = /^(#{1,3}) (.*)$/.exec(line);
        if (heading) {
          const level = heading[1]!.length;
          return (
            <div key={key} className={`dc-h dc-h${level}`}>
              {inline(heading[2]!, key)}
            </div>
          );
        }
        const bullet = /^\s*[-*] (.*)$/.exec(line);
        if (bullet) {
          return (
            <div key={key} className="dc-li">
              <span aria-hidden="true">•</span>
              <span>{inline(bullet[1]!, key)}</span>
            </div>
          );
        }
        const quote = /^> (.*)$/.exec(line);
        if (quote) {
          return (
            <div key={key} className="dc-quote">
              {inline(quote[1]!, key)}
            </div>
          );
        }
        return (
          <div key={key} className="dc-line">
            {line ? inline(line, key) : " "}
          </div>
        );
      })}
    </>
  );
}

export function DiscordComposer({ channels, siteUrl, defaultChannel }: { channels: { id: string; name: string; parent: string | null }[]; siteUrl: string; defaultChannel: string | null }) {
  const [state, action, pending] = useActionState(postMessage, initial);
  const [draft, setDraft] = useState<Draft>({ channelId: defaultChannel ?? channels[0]?.id ?? "", ...EMPTY });
  const [sentSeen, setSentSeen] = useState(0);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  // A post went out: start the next one fresh in the same channel.
  if (state.sent !== sentSeen) {
    setSentSeen(state.sent);
    setDraft((d) => ({ channelId: d.channelId, ...EMPTY }));
  }

  const hasEmbed = Boolean(draft.title.trim() || draft.description.trim() || draft.imageUrl.trim());
  const channelName = channels.find((c) => c.id === draft.channelId)?.name ?? "channel";
  const [now, setNow] = useState("");
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  const groups = new Map<string, typeof channels>();
  for (const c of channels) groups.set(c.parent ?? "", [...(groups.get(c.parent ?? "") ?? []), c]);

  return (
    <div className="dc-composer">
      <form action={action} className="card dc-form">
        <div className="dc-form-head">
          <h2 className="traffic-card-title">Write a post</h2>
          <div className="dc-presets" role="group" aria-label="Start from">
            {presets(siteUrl).map((p) => (
              <button key={p.label} type="button" className="chip" onClick={() => setDraft((d) => ({ ...d, ...EMPTY, ...p.draft }))}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>Channel</span>
          <select name="channelId" value={draft.channelId} onChange={(e) => set("channelId", e.target.value)} required>
            {channels.length === 0 ? <option value="">No channels the bot can see</option> : null}
            {[...groups.entries()].map(([group, list]) =>
              group ? (
                <optgroup key={group} label={group}>
                  {list.map((c) => (
                    <option key={c.id} value={c.id}>
                      # {c.name}
                    </option>
                  ))}
                </optgroup>
              ) : (
                list.map((c) => (
                  <option key={c.id} value={c.id}>
                    # {c.name}
                  </option>
                ))
              ),
            )}
          </select>
        </label>

        <label className="field">
          <span>Message</span>
          <textarea name="content" rows={3} maxLength={2000} value={draft.content} onChange={(e) => set("content", e.target.value)} placeholder="Plain text above the card. **bold**, *italic*, # Heading, - list all work." />
        </label>

        <fieldset className="dc-card-fields">
          <legend>Card</legend>
          <div className="dc-row">
            <label className="field">
              <span>Title</span>
              <input name="title" maxLength={256} value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="Big news" />
            </label>
            <label className="field dc-color">
              <span>Colour</span>
              <div className="dc-swatches">
                {SWATCHES.map((c) => (
                  <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={draft.color.toLowerCase() === c} style={{ "--swatch": c } as CSSProperties} onClick={() => set("color", c)} />
                ))}
                <input type="color" aria-label="Any colour" value={/^#[0-9a-f]{6}$/i.test(draft.color) ? draft.color : "#8b5cf6"} onChange={(e) => set("color", e.target.value)} />
              </div>
              <input type="hidden" name="color" value={draft.color} />
            </label>
          </div>
          <label className="field">
            <span>Text</span>
            <textarea name="description" rows={5} maxLength={4096} value={draft.description} onChange={(e) => set("description", e.target.value)} placeholder="The body of the card" />
          </label>
          <div className="dc-row">
            <label className="field">
              <span>Big image</span>
              <input name="imageUrl" type="url" value={draft.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} placeholder="https://…png" />
            </label>
            <label className="field">
              <span>Small image (top right)</span>
              <input name="thumbnailUrl" type="url" value={draft.thumbnailUrl} onChange={(e) => set("thumbnailUrl", e.target.value)} placeholder="https://…png" />
            </label>
          </div>
          <div className="dc-row">
            <label className="field">
              <span>Title links to</span>
              <input name="url" type="url" value={draft.url} onChange={(e) => set("url", e.target.value)} placeholder="Optional" />
            </label>
            <label className="field">
              <span>Footer</span>
              <input name="footer" maxLength={200} value={draft.footer} onChange={(e) => set("footer", e.target.value)} placeholder="Small text at the bottom" />
            </label>
          </div>
        </fieldset>

        <div className="dc-row">
          <label className="field">
            <span>Button text</span>
            <input name="buttonLabel" maxLength={80} value={draft.buttonLabel} onChange={(e) => set("buttonLabel", e.target.value)} placeholder="Open Outlier" />
          </label>
          <label className="field">
            <span>Button link</span>
            <input name="buttonUrl" type="url" value={draft.buttonUrl} onChange={(e) => set("buttonUrl", e.target.value)} placeholder={siteUrl} />
          </label>
        </div>

        <label className="dc-check">
          <input type="checkbox" name="ping" checked={draft.ping} onChange={(e) => set("ping", e.target.checked)} />
          <span>Let @everyone and role mentions ping people</span>
        </label>

        <div className="dc-actions">
          {state.message ? (
            <p className={state.status === "error" ? "form-error" : "dc-sent"} role="status">
              {state.message}
            </p>
          ) : (
            <span />
          )}
          <button type="submit" disabled={pending || !draft.channelId}>
            {pending ? "Posting…" : `Post in #${channelName}`}
          </button>
        </div>
      </form>

      <div className="dc-preview-wrap">
        <div className="dc-preview-label stat-note">Preview</div>
        <div className="dc-preview" aria-label="How the post will look in Discord">
          <div className="dc-channel"># {channelName}</div>
          <div className="dc-msg">
            <div className="dc-avatar" aria-hidden="true">
              <img src="/brand/logo-128.png" alt="" />
            </div>
            <div className="dc-body">
              <div className="dc-meta">
                <span className="dc-name">Outlier</span>
                <span className="dc-bot">APP</span>
                <span className="dc-time">Today at {now}</span>
              </div>
              {draft.content.trim() ? (
                <div className="dc-content">
                  <Markdown text={draft.content} />
                </div>
              ) : null}
              {hasEmbed ? (
                <div className="dc-embed" style={{ "--embed": /^#[0-9a-f]{6}$/i.test(draft.color) ? draft.color : "#8b5cf6" } as CSSProperties}>
                  <div className="dc-embed-main">
                    {draft.title.trim() ? <div className={draft.url.trim() ? "dc-embed-title dc-link" : "dc-embed-title"}>{draft.title}</div> : null}
                    {draft.description.trim() ? (
                      <div className="dc-embed-text">
                        <Markdown text={draft.description} />
                      </div>
                    ) : null}
                    {draft.imageUrl.trim() ? <img className="dc-embed-image" src={draft.imageUrl} alt="" /> : null}
                    {draft.footer.trim() ? <div className="dc-embed-footer">{draft.footer}</div> : null}
                  </div>
                  {draft.thumbnailUrl.trim() ? <img className="dc-embed-thumb" src={draft.thumbnailUrl} alt="" /> : null}
                </div>
              ) : null}
              {draft.buttonUrl.trim() ? (
                <div className="dc-buttons">
                  <span className="dc-button">
                    {draft.buttonLabel.trim() || "Open"}
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M14 3h7v7M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
                    </svg>
                  </span>
                </div>
              ) : null}
              {!draft.content.trim() && !hasEmbed ? <div className="dc-empty">Start typing, or pick a starting point above.</div> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
