import { env } from "@/lib/core/env";
import { AppError, UnauthorizedError } from "@/lib/core/errors";

/**
 * Who is calling the API. Today only the internal key exists; per-workspace
 * API keys (hashed in the database) and Supabase user sessions will add
 * `workspaceId` / `userId` so services can scope data and meter usage.
 */
export interface ApiPrincipal {
  kind: "internal" | "anonymous_dev";
  workspaceId: string | null;
  userId: string | null;
}

/** Constant-time string comparison using only web-standard APIs (runs on Node, Vercel, and Cloudflare Workers). */
export function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bytesA = encoder.encode(a);
  const bytesB = encoder.encode(b);
  let diff = bytesA.length ^ bytesB.length;
  const length = Math.max(bytesA.length, bytesB.length);
  for (let i = 0; i < length; i++) diff |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0);
  return diff === 0;
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim() || null;
  return request.headers.get("x-api-key");
}

/** Scheduled callers (GitHub Actions) authenticate with CRON_SECRET. Refuses everything when it isn't configured. */
export function authenticateCron(request: Request): void {
  const { CRON_SECRET } = env();
  if (!CRON_SECRET) throw new AppError("CONFIG_ERROR", "CRON_SECRET is not configured", { expose: false });
  const token = extractBearerToken(request);
  if (!token || !safeEqual(token, CRON_SECRET)) throw new UnauthorizedError("Invalid or missing cron secret");
}

export function authenticateRequest(request: Request): ApiPrincipal {
  const { INTERNAL_API_KEY, NODE_ENV } = env();

  if (!INTERNAL_API_KEY) {
    if (NODE_ENV === "production") {
      throw new AppError("CONFIG_ERROR", "INTERNAL_API_KEY must be set in production", { expose: false });
    }
    return { kind: "anonymous_dev", workspaceId: null, userId: null };
  }

  const token = extractBearerToken(request);
  if (!token || !safeEqual(token, INTERNAL_API_KEY)) throw new UnauthorizedError("Invalid or missing API key");
  return { kind: "internal", workspaceId: null, userId: null };
}
