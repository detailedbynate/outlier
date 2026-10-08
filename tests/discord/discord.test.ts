import { describe, expect, it } from "vitest";
import type { PlanId } from "@/lib/billing/plans";
import type { DiscordLinkRepository } from "@/lib/database/repositories/discord-links";
import { composeMessage, picksMessage, rolesFor, type ComposedPost, type PickForDiscord } from "@/lib/discord/messages";
import { DiscordService, discordConfigFrom, type DiscordConfig } from "@/lib/services/discord-service";

const roles = { pro: "111", expert: "222" };

describe("rolesFor", () => {
  it("gives the plan's role and takes the other", () => {
    expect(rolesFor("pro", roles)).toEqual({ give: ["111"], take: ["222"] });
    expect(rolesFor("expert", roles)).toEqual({ give: ["222"], take: ["111"] });
  });

  it("takes both on Free", () => {
    expect(rolesFor("free", roles)).toEqual({ give: [], take: ["111", "222"] });
  });

  it("skips roles that aren't set", () => {
    expect(rolesFor("pro", { pro: null, expert: "222" })).toEqual({ give: [], take: ["222"] });
  });
});

const post = (over: Partial<ComposedPost> = {}): ComposedPost => ({
  content: "",
  title: "",
  description: "",
  color: "",
  url: "",
  imageUrl: "",
  thumbnailUrl: "",
  footer: "",
  buttonLabel: "",
  buttonUrl: "",
  ping: false,
  ...over,
});

describe("composeMessage", () => {
  it("needs something to send", () => {
    expect(composeMessage(post())).toEqual({ error: expect.any(String) });
  });

  it("builds a card with colour, image, footer and a button", () => {
    const message = composeMessage(
      post({ title: " Big news ", description: "Hi", color: "#ec4899", url: "https://x.test", imageUrl: "https://x.test/a.png", footer: "Outlier", buttonLabel: "Go", buttonUrl: "https://x.test/go" }),
    );
    expect(message).toEqual({
      embeds: [{ color: 0xec4899, title: "Big news", description: "Hi", url: "https://x.test", image: { url: "https://x.test/a.png" }, footer: { text: "Outlier" } }],
      components: [{ type: 1, components: [{ type: 2, style: 5, label: "Go", url: "https://x.test/go" }] }],
      allowed_mentions: { parse: ["users"] },
    });
  });

  it("only lets @everyone ping when asked", () => {
    expect(composeMessage(post({ content: "@everyone hi", ping: true }))).toMatchObject({ content: "@everyone hi", allowed_mentions: { parse: ["everyone", "roles", "users"] } });
    expect(composeMessage(post({ content: "@everyone hi" }))).toMatchObject({ allowed_mentions: { parse: ["users"] } });
  });

  it("falls back to brand purple and rejects bad links", () => {
    expect(composeMessage(post({ title: "x", color: "nope" }))).toMatchObject({ embeds: [{ color: 0x8b5cf6 }] });
    expect(composeMessage(post({ title: "x", imageUrl: "not a url" }))).toEqual({ error: expect.stringContaining("Image") });
    expect(composeMessage(post({ title: "x", buttonLabel: "Go" }))).toEqual({ error: expect.stringContaining("button") });
    expect(composeMessage(post({ content: "a".repeat(2001) }))).toEqual({ error: expect.stringContaining("2,000") });
  });
});

const pick = (over: Partial<PickForDiscord> = {}): PickForDiscord => ({
  niche: "gta",
  channel_title: "Small Channel",
  channel_thumbnail_url: null,
  youtube_channel_id: "UC1",
  subscriber_count: 1200,
  youtube_video_id: "vid1",
  video_title: "Wild clip",
  video_views: 250_000,
  outlier_multiplier: 12.34,
  ...over,
});

describe("picksMessage", () => {
  it("makes a card per Short, at most ten", () => {
    const message = picksMessage(Array.from({ length: 12 }, () => pick()), new Date("2026-10-08T12:00:00Z"), "https://site.test");
    expect(message.content).toContain("October 8");
    expect(message.embeds).toHaveLength(10);
    expect(message.embeds![0]).toMatchObject({
      url: "https://www.youtube.com/shorts/vid1",
      footer: { text: "GTA" },
      fields: [{ value: "250K" }, { value: "12.3× usual" }, { value: "1.2K" }],
    });
    expect(message.allowed_mentions).toEqual({ parse: [] });
  });

  it("says so when there are none", () => {
    expect(picksMessage([], new Date("2026-10-08T12:00:00Z"), "https://site.test").embeds).toBeUndefined();
  });

  it("title-cases longer niche names", () => {
    expect(picksMessage([pick({ niche: "minecraft_builds" })], new Date(), "https://s.test").embeds![0]).toMatchObject({ footer: { text: "Minecraft Builds" } });
  });
});

describe("discordConfigFrom", () => {
  it("is off until the four required settings are there", () => {
    expect(discordConfigFrom({ DISCORD_CLIENT_ID: "1", DISCORD_CLIENT_SECRET: "2", DISCORD_BOT_TOKEN: "3" })).toBeNull();
    expect(discordConfigFrom({ DISCORD_CLIENT_ID: "1", DISCORD_CLIENT_SECRET: "2", DISCORD_BOT_TOKEN: "3", DISCORD_GUILD_ID: "4", DISCORD_ROLE_PRO: "5" })).toEqual({
      clientId: "1",
      clientSecret: "2",
      botToken: "3",
      guildId: "4",
      roles: { pro: "5", expert: null },
      picksChannelId: null,
    });
  });
});

describe("DiscordService.syncUser", () => {
  const config: DiscordConfig = { clientId: "c", clientSecret: "s", botToken: "t", guildId: "999", roles, picksChannelId: null };

  function setup(plan: PlanId, has: string[] | null) {
    const calls: string[] = [];
    const synced: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const path = url.replace("https://discord.com/api/v10", "");
      calls.push(`${init?.method} ${path}`);
      if (init?.method === "GET") {
        return has === null ? new Response(JSON.stringify({ code: 10007, message: "Unknown Member" }), { status: 404 }) : new Response(JSON.stringify({ roles: has }), { status: 200 });
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const links = {
      forUser: async () => ({ user_id: "u1", discord_id: "d1", discord_username: "@d", linked_at: "", synced_plan: null, synced_at: null }),
      markSynced: async (_: string, p: string) => void synced.push(p),
    } as unknown as DiscordLinkRepository;
    const service = new DiscordService(config, { links, planFor: async () => ({ id: plan, name: plan }), picks: async () => [], siteUrl: "https://s.test", fetchImpl });
    return { service, calls, synced };
  }

  it("swaps Pro for Expert on an upgrade", async () => {
    const { service, calls, synced } = setup("expert", ["111", "333"]);
    expect(await service.syncUser("u1")).toEqual({ added: 1, removed: 1 });
    expect(calls).toEqual(["GET /guilds/999/members/d1", "PUT /guilds/999/members/d1/roles/222", "DELETE /guilds/999/members/d1/roles/111"]);
    expect(synced).toEqual(["expert"]);
  });

  it("changes nothing when the roles already match", async () => {
    const { service, calls } = setup("pro", ["111"]);
    expect(await service.syncUser("u1")).toEqual({ added: 0, removed: 0 });
    expect(calls).toHaveLength(1);
  });

  it("is quiet when they've left the server", async () => {
    const { service, synced } = setup("pro", null);
    expect(await service.syncUser("u1")).toBeNull();
    expect(synced).toEqual([]);
  });
});
