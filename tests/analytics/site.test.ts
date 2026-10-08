import { describe, expect, it } from "vitest";
import { cleanPath, conversion, deviceOf, fillDays, isBot, parseClientEvent, referrerHost, visitorId } from "@/lib/analytics/site";

const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

describe("site traffic", () => {
  it("gives the same person the same id all day, and a new one tomorrow", () => {
    const base = { ip: "1.2.3.4", userAgent: chrome, salt: "s" };
    const morning = visitorId({ ...base, now: new Date("2026-10-08T01:00:00Z") });
    expect(visitorId({ ...base, now: new Date("2026-10-08T23:00:00Z") })).toBe(morning);
    expect(visitorId({ ...base, now: new Date("2026-10-09T01:00:00Z") })).not.toBe(morning);
    expect(visitorId({ ...base, ip: "1.2.3.5", now: new Date("2026-10-08T01:00:00Z") })).not.toBe(morning);
    expect(morning).not.toContain("1.2.3.4");
  });

  it("skips bots and tells phones from desktops", () => {
    expect(isBot("Googlebot/2.1 (+http://www.google.com/bot.html)")).toBe(true);
    expect(isBot("Mozilla/5.0 HeadlessChrome/140.0")).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(isBot(chrome)).toBe(false);
    expect(deviceOf(chrome)).toBe("desktop");
    expect(deviceOf(iphone)).toBe("mobile");
  });

  it("keeps where people came from, but not our own pages", () => {
    expect(referrerHost("https://www.youtube.com/watch?v=abc", "outlier.example")).toBe("youtube.com");
    expect(referrerHost("https://outlier.example/billing", "outlier.example")).toBeNull();
    expect(referrerHost("https://www.outlier.example/", "outlier.example:443")).toBeNull();
    expect(referrerHost("not a url", null)).toBeNull();
    expect(referrerHost("", null)).toBeNull();
  });

  it("counts pages without query strings or ids", () => {
    expect(cleanPath("/?code=nate")).toBe("/");
    expect(cleanPath("/channels/UCabc123/videos")).toBe("/channels/[id]/videos");
    expect(cleanPath("/waitlist/abc123")).toBe("/waitlist/[code]");
    expect(cleanPath("/api/track")).toBeNull();
    expect(cleanPath("https://evil.example/")).toBeNull();
  });

  it("only takes page views and pricing views from the browser", () => {
    expect(parseClientEvent({ kind: "pageview", path: "/", code: "NATE", signedIn: true })).toMatchObject({ kind: "pageview", path: "/", creatorCode: "nate", signedIn: true });
    expect(parseClientEvent({ kind: "subscribed", path: "/" })).toBeNull();
    expect(parseClientEvent({ kind: "pageview" })).toBeNull();
    expect(parseClientEvent("pageview")).toBeNull();
  });

  it("works out conversion and fills quiet days", () => {
    expect(conversion(200, 13)).toBe(6.5);
    expect(conversion(0, 5)).toBeNull();
    const days = fillDays([{ day: "2026-10-07", visitors: 4, pageviews: 9, checkouts: 1, paid: 0 }], new Date("2026-10-05T12:00:00Z"), new Date("2026-10-08T12:00:00Z"));
    expect(days.map((d) => [d.day, d.visitors])).toEqual([
      ["2026-10-05", 0],
      ["2026-10-06", 0],
      ["2026-10-07", 4],
      ["2026-10-08", 0],
    ]);
  });
});
