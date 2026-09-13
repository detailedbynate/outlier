import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiHandler, ok } from "@/lib/api/handler";
import { resetEnvCache } from "@/lib/core/env";
import { NotFoundError } from "@/lib/core/errors";

const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });

describe("apiHandler", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("INTERNAL_API_KEY", "secret-key");
    resetEnvCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  const authed = (url: string, init: RequestInit = {}) =>
    new Request(url, { ...init, headers: { authorization: "Bearer secret-key", ...init.headers } });

  it("wraps results in a data envelope with a request id", async () => {
    const handler = apiHandler(
      { params: z.object({ id: z.string() }), query: z.object({ n: z.coerce.number() }) },
      async ({ params, query }) => ok({ id: params.id, n: query.n }, { nextPageToken: "abc" }),
    );
    const res = await handler(authed("http://localhost/api/v1/x/42?n=7"), ctx({ id: "42" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ id: "42", n: 7 });
    expect(body.meta.nextPageToken).toBe("abc");
    expect(body.meta.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("rejects missing or wrong API keys", async () => {
    const handler = apiHandler({}, async () => "ok");
    const missing = await handler(new Request("http://localhost/api/v1/x"), ctx());
    const wrong = await handler(new Request("http://localhost/api/v1/x", { headers: { "x-api-key": "nope" } }), ctx());
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect((await missing.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("allows public routes without a key", async () => {
    const res = await apiHandler({ auth: "public" }, async () => "ok")(new Request("http://localhost/api/health"), ctx());
    expect(res.status).toBe(200);
  });

  it("returns 422 with field details for invalid input", async () => {
    const handler = apiHandler({ query: z.object({ maxResults: z.coerce.number().max(50) }) }, async () => "ok");
    const res = await handler(authed("http://localhost/x?maxResults=999"), ctx());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.fieldErrors.maxResults).toBeDefined();
  });

  it("returns 400 for malformed JSON bodies", async () => {
    const handler = apiHandler({ body: z.object({ a: z.string() }) }, async () => "ok");
    const res = await handler(authed("http://localhost/x", { method: "POST", body: "{not json" }), ctx());
    expect(res.status).toBe(400);
  });

  it("maps AppErrors to their status and hides unexpected errors", async () => {
    const notFound = await apiHandler({}, async () => {
      throw new NotFoundError("Channel", "UC123");
    })(authed("http://localhost/x"), ctx());
    expect(notFound.status).toBe(404);
    expect((await notFound.json()).error.message).toBe("Channel not found: UC123");

    const crash = await apiHandler({}, async () => {
      throw new Error("db password is hunter2");
    })(authed("http://localhost/x"), ctx());
    expect(crash.status).toBe(500);
    const body = await crash.json();
    expect(body.error).toMatchObject({ code: "INTERNAL_ERROR", message: "An unexpected error occurred" });
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });

  it("requires INTERNAL_API_KEY in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INTERNAL_API_KEY", "");
    resetEnvCache();
    const res = await apiHandler({}, async () => "ok")(new Request("http://localhost/x"), ctx());
    expect(res.status).toBe(500);
  });
});
