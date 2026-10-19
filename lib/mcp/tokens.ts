import { sha256Hex } from "@/lib/services/rate-limit-service";

/** Recognisable in a config file or a leaked-secret scan. */
export const TOKEN_PREFIX = "otl_mcp_";

/** A new personal token: 32 random bytes, base64url. The token itself is shown once and never stored. */
export function generateMcpToken(): { token: string; prefix: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const body = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const token = `${TOKEN_PREFIX}${body}`;
  return { token, prefix: token.slice(0, TOKEN_PREFIX.length + 4) };
}

/** Tokens are long and random, so a plain SHA-256 is enough to store them by. */
export function hashMcpToken(token: string): Promise<string> {
  return sha256Hex(token);
}
