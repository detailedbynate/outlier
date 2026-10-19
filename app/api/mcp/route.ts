import { extractBearerToken } from "@/lib/api/auth";
import { opensPaidFeatures } from "@/lib/billing/features";
import { env } from "@/lib/core/env";
import { isAppError } from "@/lib/core/errors";
import { createLogger } from "@/lib/core/logger";
import { qualityConfigFrom } from "@/lib/research/quality";
import { handleMcpMessage } from "@/lib/mcp/server";
import { hashMcpToken, TOKEN_PREFIX } from "@/lib/mcp/tokens";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

const log = createLogger({ module: "api.mcp" });
/** last_used_at is a hint, not an audit log: write it at most this often. */
const TOUCH_EVERY_MS = 10 * 60_000;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const rpcError = (status: number, message: string, headers: Record<string, string> = {}) =>
  json({ jsonrpc: "2.0", id: null, error: { code: -32001, message } }, status, headers);

/**
 * The Outlier MCP server (Streamable HTTP, stateless). Members connect with a
 * personal token made in Settings → Connect AI: `Authorization: Bearer otl_mcp_…`.
 */
export async function POST(request: Request): Promise<Response> {
  const token = extractBearerToken(request);
  if (!token?.startsWith(TOKEN_PREFIX)) {
    return rpcError(401, "Add your Outlier MCP token as a Bearer token (make one in Outlier → Connect AI).", { "WWW-Authenticate": 'Bearer realm="outlier"' });
  }
  const services = getServices();
  const row = await services.repositories.mcpTokens.findActiveByHash(await hashMcpToken(token));
  if (!row) return rpcError(401, "That MCP token isn't valid any more. Make a new one in Outlier → Connect AI.", { "WWW-Authenticate": 'Bearer realm="outlier", error="invalid_token"' });

  if (!row.staff) {
    const paid = await services.subscriptions
      .stateFor(row.user_id)
      .then(({ plan }) => opensPaidFeatures(plan.priceCents, false))
      .catch(() => false);
    if (!paid) return rpcError(403, "The Outlier MCP server is on the paid plans.");
  }

  try {
    await services.rateLimits.enforce("mcpToken", row.id);
  } catch (error) {
    if (isAppError(error) && error.code === "RATE_LIMITED") return rpcError(429, error.message);
    throw error;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }

  const now = new Date();
  if (!row.last_used_at || now.getTime() - Date.parse(row.last_used_at) > TOUCH_EVERY_MS) {
    void services.repositories.mcpTokens.touch(row.id, now).catch((error: unknown) => log.warn("mcp token touch failed", { error }));
  }

  const config = env();
  const deps = {
    research: services.research,
    videos: services.repositories.videos,
    targetCountries: qualityConfigFrom(config).countries,
    siteUrl: (config.SITE_URL ?? new URL(request.url).origin).replace(/\/$/, ""),
  };
  // Older clients may batch; newer ones send one message per request.
  const messages = Array.isArray(body) ? body : [body];
  const responses = (await Promise.all(messages.map((m) => handleMcpMessage(m, deps)))).filter((r) => r !== null);
  if (responses.length === 0) return new Response(null, { status: 202 });
  return json(Array.isArray(body) ? responses : responses[0]);
}

/** No server-initiated stream: this server only answers requests. */
export function GET(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export function DELETE(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
