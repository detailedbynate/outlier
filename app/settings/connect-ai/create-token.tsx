"use client";

import { useActionState, useState } from "react";
import { createMcpToken, type CreateTokenState } from "./actions";

const initial: CreateTokenState = { token: null, error: null };

/** Make a token, and show it (with ready-to-paste setup) exactly once. */
export function CreateToken({ endpoint }: { endpoint: string }) {
  const [state, action, pending] = useActionState(createMcpToken, initial);
  const [copied, setCopied] = useState<string | null>(null);
  const token = state.token;

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      // Clipboard blocked: the text is on screen to copy by hand.
    }
  };

  const shown = token ?? "otl_mcp_…";
  const claudeCode = `claude mcp add --transport http outlier ${endpoint} --header "Authorization: Bearer ${shown}"`;
  const jsonConfig = JSON.stringify({ mcpServers: { outlier: { type: "http", url: endpoint, headers: { Authorization: `Bearer ${shown}` } } } }, null, 2);

  return (
    <div className="stack">
      <form action={action} className="mcp-create">
        <label className="field">
          <span>Name it (where you&apos;ll use it)</span>
          <input name="label" placeholder="e.g. Claude Code on my laptop" maxLength={40} />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Making…" : "Make a token"}
        </button>
      </form>
      {state.error ? (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      ) : null}

      {token ? (
        <div className="mcp-token">
          <strong>Your new token. Copy it now: it won&apos;t be shown again.</strong>
          <div className="mcp-code-row">
            <code>{token}</code>
            <button type="button" className="button-ghost button-small" onClick={() => copy("token", token)}>
              {copied === "token" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mcp-setup">
        <h3>Claude Code</h3>
        <div className="mcp-code-row">
          <pre>{claudeCode}</pre>
          <button type="button" className="button-ghost button-small" onClick={() => copy("cc", claudeCode)}>
            {copied === "cc" ? "Copied" : "Copy"}
          </button>
        </div>
        <h3>Cursor, VS Code and other MCP clients</h3>
        <div className="mcp-code-row">
          <pre>{jsonConfig}</pre>
          <button type="button" className="button-ghost button-small" onClick={() => copy("json", jsonConfig)}>
            {copied === "json" ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
