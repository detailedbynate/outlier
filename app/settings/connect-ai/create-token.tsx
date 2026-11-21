"use client";

import { useActionState, useState, type CSSProperties } from "react";
import { CheckIcon } from "@/components/icons";
import { createMcpToken, type CreateTokenState } from "./actions";

const initial: CreateTokenState = { token: null, error: null };

const CLIENTS = [
  { key: "claude-code", label: "Claude Code" },
  { key: "json", label: "Cursor, VS Code & others" },
] as const;

type ClientKey = (typeof CLIENTS)[number]["key"];

/**
 * Setup as three steps: make a token (shown exactly once), paste the ready
 * command or config for your assistant, then ask it something. The snippets
 * carry the real token as soon as there is one.
 */
export function CreateToken({ endpoint, prompts }: { endpoint: string; prompts: readonly string[] }) {
  const [state, action, pending] = useActionState(createMcpToken, initial);
  const [copied, setCopied] = useState<string | null>(null);
  const [client, setClient] = useState<ClientKey>("claude-code");
  const token = state.token;

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1800);
    } catch {
      // Clipboard blocked: the text is on screen to copy by hand.
    }
  };

  const shown = token ?? "otl_mcp_…";
  const snippets: Record<ClientKey, string> = {
    "claude-code": `claude mcp add --transport http outlier ${endpoint} --header "Authorization: Bearer ${shown}"`,
    json: JSON.stringify({ mcpServers: { outlier: { type: "http", url: endpoint, headers: { Authorization: `Bearer ${shown}` } } } }, null, 2),
  };
  const index = CLIENTS.findIndex((c) => c.key === client);

  return (
    <ol className="ca-steps">
      <li className="ca-step" data-done={token ? "" : undefined}>
        <span className="ca-step-num" aria-hidden="true">
          {token ? <CheckIcon size={14} /> : 1}
        </span>
        <div className="ca-step-body">
          <h3>Make a token</h3>
          <p>Name it after where you&apos;ll use it, so you know which one to revoke later.</p>
          <form action={action} className="ca-create">
            <label className="sr-only" htmlFor="ca-label">
              Token name
            </label>
            <input id="ca-label" name="label" placeholder="e.g. Claude Code on my laptop" maxLength={40} />
            <button type="submit" disabled={pending}>
              {pending ? "Making…" : token ? "Make another" : "Make a token"}
            </button>
          </form>
          {state.error ? (
            <p className="form-error" role="alert">
              {state.error}
            </p>
          ) : null}
          {token ? (
            <div className="ca-token" role="status">
              <strong>Copy it now: it won&apos;t be shown again.</strong>
              <div className="ca-code">
                <code>{token}</code>
                <CopyButton done={copied === "token"} onClick={() => copy("token", token)} />
              </div>
            </div>
          ) : null}
        </div>
      </li>

      <li className="ca-step">
        <span className="ca-step-num" aria-hidden="true">
          2
        </span>
        <div className="ca-step-body">
          <h3>Add Outlier to your assistant</h3>
          <p>{token ? "Your token is already in these." : "These fill in with your token once you make one."}</p>
          <div className="vv-seg ca-clients" role="tablist" aria-label="Assistant" style={{ "--n": CLIENTS.length, "--i": index } as CSSProperties}>
            <span className="vv-seg-ink" aria-hidden="true" />
            {CLIENTS.map((c) => (
              <button key={c.key} type="button" role="tab" aria-selected={c.key === client} aria-current={c.key === client ? "true" : undefined} className="vv-seg-opt" onClick={() => setClient(c.key)}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="ca-code ca-snippet" key={client}>
            <pre>{snippets[client]}</pre>
            <CopyButton done={copied === client} onClick={() => copy(client, snippets[client])} />
          </div>
          <p className="ca-note">
            {client === "claude-code" ? "Run it in a terminal, then start a new Claude Code session." : "Paste it into the client's MCP settings file, then restart it."} Server address:{" "}
            <code>{endpoint}</code>
          </p>
        </div>
      </li>

      <li className="ca-step">
        <span className="ca-step-num" aria-hidden="true">
          3
        </span>
        <div className="ca-step-body">
          <h3>Ask it something</h3>
          <p>It searches your Outlier library and answers with real channels and numbers.</p>
          <ul className="ca-prompts">
            {prompts.map((prompt, i) => (
              <li key={prompt} style={{ "--i": i } as CSSProperties}>
                <span>&ldquo;{prompt}&rdquo;</span>
                <CopyButton done={copied === `p${i}`} onClick={() => copy(`p${i}`, prompt)} />
              </li>
            ))}
          </ul>
        </div>
      </li>
    </ol>
  );
}

function CopyButton({ done, onClick }: { done: boolean; onClick: () => void }) {
  return (
    <button type="button" className="ca-copy" data-done={done ? "" : undefined} onClick={onClick} aria-live="polite">
      {done ? (
        <>
          <CheckIcon size={13} /> Copied
        </>
      ) : (
        "Copy"
      )}
    </button>
  );
}
