import { describe, expect, it } from "vitest";
import {
  channelPlaylistId,
  chunk,
  parseChannelIdentifier,
  parseChannelKeywords,
  parseCount,
  parseIsoDuration,
  parsePlaylistId,
  parseVideoId,
} from "@/lib/youtube/parse";

const CHANNEL_ID = "UC_x5XG1OV2P6uZZ5FSM9Ttw";

describe("parseChannelIdentifier", () => {
  it.each([
    [CHANNEL_ID, { type: "id", value: CHANNEL_ID }],
    ["@GoogleDevelopers", { type: "handle", value: "@GoogleDevelopers" }],
    ["GoogleDevelopers", { type: "handle", value: "@GoogleDevelopers" }],
    [`https://www.youtube.com/channel/${CHANNEL_ID}`, { type: "id", value: CHANNEL_ID }],
    ["https://youtube.com/@mkbhd/videos", { type: "handle", value: "@mkbhd" }],
    ["youtube.com/@mkbhd", { type: "handle", value: "@mkbhd" }],
    ["https://www.youtube.com/user/GoogleDevelopers", { type: "username", value: "GoogleDevelopers" }],
    ["https://www.youtube.com/c/SomeCustomName", { type: "custom", value: "SomeCustomName" }],
  ])("parses %s", (input, expected) => {
    expect(parseChannelIdentifier(input)).toEqual(expected);
  });

  it.each(["", "  ", "https://vimeo.com/@someone", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "a b"])(
    "rejects %j",
    (input) => {
      expect(() => parseChannelIdentifier(input)).toThrow();
    },
  );
});

describe("parseVideoId", () => {
  it.each([
    "dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
    "https://youtu.be/dQw4w9WgXcQ?si=abc",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://m.youtube.com/live/dQw4w9WgXcQ",
  ])("extracts the id from %s", (input) => {
    expect(parseVideoId(input)).toBe("dQw4w9WgXcQ");
  });

  it("rejects invalid input", () => {
    expect(() => parseVideoId("too-short")).toThrow(/Invalid YouTube video/);
    expect(() => parseVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toThrow();
  });
});

describe("parsePlaylistId", () => {
  it("accepts ids and list= URLs", () => {
    expect(parsePlaylistId("PLOU2XLYxmsIIM9h1Ybw2DuRw6o2fbNMq4")).toBe("PLOU2XLYxmsIIM9h1Ybw2DuRw6o2fbNMq4");
    expect(parsePlaylistId("https://www.youtube.com/playlist?list=PLOU2XLYxmsIIM9h1Ybw2DuRw6o2fbNMq4")).toBe(
      "PLOU2XLYxmsIIM9h1Ybw2DuRw6o2fbNMq4",
    );
  });
});

describe("parseIsoDuration", () => {
  it.each([
    ["PT15S", 15],
    ["PT1M", 60],
    ["PT1H2M3S", 3723],
    ["P1DT1H", 90_000],
    ["PT0S", 0],
  ])("%s -> %d seconds", (input, seconds) => {
    expect(parseIsoDuration(input)).toBe(seconds);
  });

  it.each([null, undefined, "", "P", "PT", "garbage"])("returns null for %j", (input) => {
    expect(parseIsoDuration(input)).toBeNull();
  });
});

describe("helpers", () => {
  it("parseCount keeps absent distinct from zero", () => {
    expect(parseCount("1234")).toBe(1234);
    expect(parseCount("0")).toBe(0);
    expect(parseCount(undefined)).toBeNull();
    expect(parseCount("nope")).toBeNull();
  });

  it("parseChannelKeywords handles quoted phrases and dedupes", () => {
    expect(parseChannelKeywords('gaming "minecraft lets play" tutorials gaming')).toEqual([
      "gaming",
      "minecraft lets play",
      "tutorials",
    ]);
  });

  it("channelPlaylistId derives uploads/shorts/long-form playlists", () => {
    expect(channelPlaylistId(CHANNEL_ID, "uploads")).toBe("UU_x5XG1OV2P6uZZ5FSM9Ttw");
    expect(channelPlaylistId(CHANNEL_ID, "shorts")).toBe("UUSH_x5XG1OV2P6uZZ5FSM9Ttw");
    expect(channelPlaylistId(CHANNEL_ID, "long_form")).toBe("UULF_x5XG1OV2P6uZZ5FSM9Ttw");
    expect(() => channelPlaylistId("bad", "uploads")).toThrow();
  });

  it("chunk splits arrays", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 50)).toEqual([]);
  });
});
