import { describe, expect, it } from "vitest";
import { cleanGameName, fetchRisingGames, gameSearchPhrase, shortName } from "@/lib/radar/games";

describe("rising games", () => {
  it("cleans store names into searches", () => {
    expect(cleanGameName("[🎃] Adopt Me!")).toBe("Adopt Me");
    expect(cleanGameName("DOORS 🚨")).toBe("DOORS");
    expect(shortName("The Elder Scrolls V: Skyrim Special Edition")).toBe("Skyrim");
    expect(shortName("Warhammer 40 000: Space Marine 2")).toBe("Space Marine 2");
    expect(shortName("ACE COMBAT 8: WINGS OF THEVE")).toBe("ACE COMBAT 8");
    expect(gameSearchPhrase({ platform: "roblox", name: "Huss Valley" })).toBe("huss valley roblox");
    expect(gameSearchPhrase({ platform: "roblox", name: "Roblox Bedwars" })).toBe("roblox bedwars");
    expect(gameSearchPhrase({ platform: "steam", name: "AION 2" })).toBe("aion 2");
  });

  it("keeps Steam's newcomers and climbers, and Roblox's rising sorts", async () => {
    const fake = (async (url: string) => {
      const body = url.includes("GetMostPlayedGames")
        ? { response: { ranks: [
            { rank: 1, appid: 730, last_week_rank: 1, peak_in_game: 1_000_000 },
            { rank: 5, appid: 1, last_week_rank: -1, peak_in_game: 300_000 },
            { rank: 20, appid: 2, last_week_rank: 45, peak_in_game: 40_000 },
          ] } }
        : url.includes("GetItems")
          ? { response: { store_items: [{ appid: 1, name: "AION 2", type: 0 }, { appid: 2, name: "Ready or Not", type: 0 }] } }
          : { sorts: [
              { sortId: "top-trending", games: [{ name: "[🎃] Adopt Me!", rootPlaceId: 9, playerCount: 200_000 }, { name: "Huss Valley", rootPlaceId: 8, playerCount: 88_000 }] },
              { sortId: "up-and-coming", games: [{ name: "Huss Valley", rootPlaceId: 8, playerCount: 88_000 }, { name: "Ad", rootPlaceId: 7, isSponsored: true }] },
              { sortId: "fun-with-friends", games: [{ name: "Other", rootPlaceId: 6 }] },
            ] };
      return new Response(JSON.stringify(body));
    }) as typeof fetch;
    const games = await fetchRisingGames({ fetch: fake });
    expect(games.map((g) => [g.platform, g.name, g.reason])).toEqual([
      ["steam", "AION 2", "new"],
      ["steam", "Ready or Not", "climbing"],
      ["roblox", "Adopt Me", "trending"],
      ["roblox", "Huss Valley", "up-and-coming"],
    ]);
  });
});
