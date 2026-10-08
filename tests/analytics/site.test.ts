import { describe, expect, it } from "vitest";
import {
  channelOf,
  cleanPath,
  conversion,
  cookieFrom,
  deviceOf,
  fillDays,
  isBot,
  parseClientEvent,
  persistentVisitorId,
  platformOf,
  sourceOf,
  referrerHost,
  visitorId,
} from "@/lib/analytics/site";

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

describe("visitors and where they came from", () => {
  const id = "3f2b8c1e-9d4a-4b7e-8c2f-1a2b3c4d5e6f";

  it("keeps a returning visitor's id, and never stores the raw one", () => {
    const first = persistentVisitorId(id, "s");
    expect(first).toHaveLength(20);
    expect(persistentVisitorId(id.toUpperCase(), "s")).toBe(first);
    expect(persistentVisitorId(id, "other")).not.toBe(first);
    expect(first).not.toContain(id.slice(0, 8));
    expect(persistentVisitorId("not-a-uuid", "s")).toBeNull();
    expect(persistentVisitorId(null, "s")).toBeNull();
  });

  it("reads one cookie out of the header", () => {
    expect(cookieFrom(`a=1; outlier_vid=${id}; b=2`, "outlier_vid")).toBe(id);
    expect(cookieFrom("a=1", "outlier_vid")).toBeNull();
    expect(cookieFrom(null, "outlier_vid")).toBeNull();
  });

  it("names the platform from the link tag, then the referrer, then the in-app browser", () => {
    const none = { referrerHost: null, utmSource: null, userAgent: chrome };
    expect(platformOf({ ...none, utmSource: "YT" })).toBe("YouTube");
    expect(platformOf({ ...none, utmSource: "my-newsletter" })).toBe("my-newsletter");
    expect(platformOf({ ...none, referrerHost: "m.youtube.com" })).toBe("YouTube");
    expect(platformOf({ ...none, referrerHost: "youtu.be" })).toBe("YouTube");
    expect(platformOf({ ...none, referrerHost: "l.instagram.com" })).toBe("Instagram");
    expect(platformOf({ ...none, referrerHost: "t.co" })).toBe("X (Twitter)");
    expect(platformOf({ ...none, referrerHost: "google.co.uk" })).toBe("Google");
    expect(platformOf({ ...none, referrerHost: "gemini.google.com" })).toBe("Gemini");
    expect(platformOf({ ...none, referrerHost: "mail.google.com" })).toBe("Email");
    expect(platformOf({ ...none, referrerHost: "chatgpt.com" })).toBe("ChatGPT");
    expect(platformOf({ ...none, referrerHost: "m.someblog.com" })).toBe("someblog.com");
    expect(platformOf({ ...none, userAgent: `${iphone} Instagram 300.0` })).toBe("Instagram");
    expect(platformOf({ ...none, userAgent: `${iphone} musical_ly_33.0` })).toBe("TikTok");
    expect(platformOf(none)).toBeNull();
  });

  it("puts each visit in a GA4-style channel, first rule that matches", () => {
    const visit = { platform: null, utmMedium: null, creatorCode: null, refCode: null };
    expect(channelOf(visit)).toBeNull();
    expect(channelOf({ ...visit, platform: "YouTube", creatorCode: "sktl" })).toBe("Creator codes");
    expect(channelOf({ ...visit, refCode: "abc123" })).toBe("Referral links");
    expect(channelOf({ ...visit, platform: "Google", utmMedium: "cpc" })).toBe("Paid search");
    expect(channelOf({ ...visit, platform: "TikTok", utmMedium: "paid_social" })).toBe("Paid social");
    expect(channelOf({ ...visit, platform: "YouTube", utmMedium: "paid" })).toBe("Paid video");
    expect(channelOf({ ...visit, platform: "YouTube" })).toBe("Organic video");
    expect(channelOf({ ...visit, platform: "TikTok" })).toBe("Organic social");
    expect(channelOf({ ...visit, platform: "someblog.com", utmMedium: "social" })).toBe("Organic social");
    expect(channelOf({ ...visit, platform: "Bing" })).toBe("Organic search");
    expect(channelOf({ ...visit, platform: "Perplexity" })).toBe("AI assistants");
    expect(channelOf({ ...visit, platform: "Email" })).toBe("Email");
    expect(channelOf({ ...visit, platform: "partner", utmMedium: "affiliate" })).toBe("Affiliates");
    expect(channelOf({ ...visit, platform: "someblog.com" })).toBe("Referral");
  });

  it("takes engagement pings and ?source= tags", () => {
    expect(parseClientEvent({ kind: "pageview", path: "/", source: "TikTok" })?.utmSource).toBe("tiktok");
    expect(parseClientEvent({ kind: "pageview", path: "/", utmSource: "yt", source: "tiktok" })?.utmSource).toBe("yt");
    const ping = parseClientEvent({ kind: "engagement", path: "/", engagedMs: 12_345.6, scroll: 140 });
    expect(ping).toMatchObject({ kind: "engagement", engagedMs: 12_346, scrollPercent: 100 });
    expect(parseClientEvent({ kind: "engagement", path: "/", engagedMs: 99 * 60 * 60_000 })?.engagedMs).toBe(30 * 60_000);
    expect(parseClientEvent({ kind: "engagement", path: "/", engagedMs: 0, scroll: 50 })).toBeNull();
    expect(parseClientEvent({ kind: "pageview", path: "/", engagedMs: 5000 })?.engagedMs).toBeNull();
  });
});

describe("sourceOf", () => {
  const base = { referrerHost: null, utmSource: null, userAgent: "Mozilla/5.0", creatorCode: null, refCode: null };

  it("names the platform when the browser says where the visit came from", () => {
    expect(sourceOf({ ...base, referrerHost: "youtube.com", creatorCode: "sktl" })).toBe("YouTube");
  });

  it("falls back to the creator's link or a referral link when nothing says", () => {
    expect(sourceOf({ ...base, creatorCode: "sktl" })).toBe("SKTL link");
    expect(sourceOf({ ...base, refCode: "abc123" })).toBe("Referral link");
  });

  it("is direct with no referrer, tag, app or link", () => {
    expect(sourceOf(base)).toBeNull();
  });
});
