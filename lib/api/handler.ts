import { z } from "zod";
import { AppError, serializeError, toAppError, ValidationError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { ApiErrorBody, ApiMeta, ApiSuccess } from "@/types/api";
import { runWithQuotaContext, type QuotaContext } from "@/lib/youtube/quota-context";
import { authenticateCron, authenticateRequest, type ApiPrincipal } from "./auth";

const log = createLogger({ module: "api" });

type RouteParams = Record<string, string | string[] | undefined>;

export interface RouteContext {
  params: Promise<RouteParams>;
}

export interface HandlerContext<P, Q, B> {
  request: Request;
  params: P;
  query: Q;
  body: B;
  principal: ApiPrincipal | null;
  requestId: string;
  logger: Logger;
}

export interface HandlerConfig<P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType> {
  /** "api_key" (default) requires API v1 credentials; "cron" requires CRON_SECRET; "public" skips auth (health checks). */
  auth?: "api_key" | "cron" | "public";
  params?: P;
  query?: Q;
  body?: B;
}

/** Return this from a handler to attach pagination/meta or a non-200 status. */
export class ApiResult<T> {
  constructor(
    readonly data: T,
    readonly meta: ApiMeta = {},
    readonly status = 200,
  ) {}
}

export function ok<T>(data: T, meta?: ApiMeta, status?: number): ApiResult<T> {
  return new ApiResult(data, meta, status);
}

function parseWith<T extends z.ZodType>(schema: T | undefined, input: unknown, label: string): z.infer<T> {
  if (!schema) return undefined as z.infer<T>;
  const result = schema.safeParse(input);
  if (!result.success) throw new ValidationError(`Invalid ${label}`, z.flattenError(result.error));
  return result.data;
}

export function errorResponse(error: AppError, requestId: string): Response {
  const body: ApiErrorBody = {
    error: {
      code: error.code,
      message: error.expose ? error.message : "An unexpected error occurred",
      ...(error.expose && error.details !== undefined ? { details: error.details } : {}),
      requestId,
    },
  };
  return Response.json(body, { status: error.status, headers: { "x-request-id": requestId } });
}

/** Collapse ids in paths so quota reports group by route, not by resource. */
function routePattern(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => (segment.length > 16 || /^[0-9a-f-]{16,}$/i.test(segment) || segment.startsWith("@") ? ":id" : segment))
    .join("/");
}

/**
 * Wrap a route handler with auth, input validation, a consistent response
 * envelope, request ids, and error mapping. Routes stay thin: parse -> call service -> return.
 */
export function apiHandler<
  P extends z.ZodType = z.ZodUndefined,
  Q extends z.ZodType = z.ZodUndefined,
  B extends z.ZodType = z.ZodUndefined,
>(
  config: HandlerConfig<P, Q, B>,
  handler: (ctx: HandlerContext<z.infer<P>, z.infer<Q>, z.infer<B>>) => Promise<unknown>,
): (request: Request, context: RouteContext) => Promise<Response> {
  return async (request, context) => {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    const url = new URL(request.url);
    const logger = log.child({ requestId, method: request.method, path: url.pathname });
    const startedAt = Date.now();

    try {
      let principal: ApiPrincipal | null = null;
      if (config.auth === "cron") authenticateCron(request);
      else if (config.auth !== "public") principal = authenticateRequest(request);
      const params = parseWith(config.params, await context.params, "path parameters");
      const query = parseWith(config.query, Object.fromEntries(url.searchParams), "query parameters");

      let rawBody: unknown;
      if (config.body) {
        try {
          rawBody = await request.json();
        } catch {
          throw new AppError("BAD_REQUEST", "Request body must be valid JSON");
        }
      }
      const body = parseWith(config.body, rawBody, "request body");

      // Cron calls are background work; everything else is a user-triggered request.
      const quotaContext: QuotaContext =
        config.auth === "cron"
          ? { lane: "background", operation: `cron:${url.pathname}` }
          : { lane: "user", userId: principal?.userId ?? null, operation: `api:${request.method} ${routePattern(url.pathname)}` };
      const result = await runWithQuotaContext(quotaContext, () => handler({ request, params, query, body, principal, requestId, logger }));
      if (result instanceof Response) return result;

      const { data, meta, status } = result instanceof ApiResult ? result : new ApiResult(result);
      const payload: ApiSuccess<unknown> = { data, meta: { requestId, ...meta } };
      logger.info("request completed", { status, durationMs: Date.now() - startedAt });
      return Response.json(payload, { status, headers: { "x-request-id": requestId } });
    } catch (thrown) {
      const error = toAppError(thrown);
      const level = error.status >= 500 ? "error" : "warn";
      logger[level]("request failed", {
        status: error.status,
        code: error.code,
        durationMs: Date.now() - startedAt,
        error: error.status >= 500 ? serializeError(thrown) : error.message,
      });
      return errorResponse(error, requestId);
    }
  };
}
