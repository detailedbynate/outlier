/**
 * Games blowing up before YouTube catches up. A Roblox experience on the
 * Up-and-Coming sort, or a Steam game that just entered the most-played chart,
 * has players searching for guides, tier lists and secrets within days; the
 * first channels covering it get those views with almost no competition.
 *
 * All keyless: Steam's most-played chart and store lookup (one request each),
 * and Roblox's explore sorts (one request). A sweep is three requests.
 */

import { normalizeKeyword } from "./suggest";

export interface RisingGame {
  platform: "steam" | "roblox";
  name: string;
  url: string;
  /** Players right now (Roblox) or the day's peak (Steam). */
  players: number;
  /** Why it's here: new to Steam's chart, climbing it, or on a Roblox sort. */
  reason: "new" | "climbing" | "up-and-coming" | "trending";
  /** Chart rank and last week's (Steam only; null when new). */
  rank: number | null;
  lastWeekRank: number | null;
}

interface SteamRank {
  rank: number;
  appid: number;
  last_week_rank: number;
  peak_in_game: number;
}

interface RobloxGame {
  name?: string;
  rootPlaceId?: number;
  playerCount?: number;
  isSponsored?: boolean;
}

/** "[🎃] Adopt Me!", "DOORS 🚨", "[SKY ASSASSIN] Jujutsu Shenanigans" -> the name people search for. */
export function cleanGameName(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, " ")
    .replace(/[^\p{L}\p{N}\s'&:.-]/gu, " ")
    .replace(/\s*[-:|]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Climbing means up at least this many places in a week. */
const CLIMB = 10;

export async function fetchRisingGames(options: { fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<RisingGame[]> {
  const get = options.fetch ?? fetch;
  const signal = options.signal ?? AbortSignal.timeout(20_000);
  const [steam, roblox] = await Promise.allSettled([risingOnSteam(get, signal), risingOnRoblox(get, signal)]);
  return [...(steam.status === "fulfilled" ? steam.value : []), ...(roblox.status === "fulfilled" ? roblox.value : [])];
}

async function risingOnSteam(get: typeof fetch, signal: AbortSignal): Promise<RisingGame[]> {
  const chart = (await (await get("https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/", { signal })).json()) as { response?: { ranks?: SteamRank[] } };
  // New to the chart (last_week_rank -1), or up ten places or more.
  const moving = (chart.response?.ranks ?? []).filter((r) => r.last_week_rank < 0 || r.last_week_rank - r.rank >= CLIMB);
  if (moving.length === 0) return [];
  const input = { ids: moving.map((r) => ({ appid: r.appid })), context: { language: "english", country_code: "US" }, data_request: { include_basic_info: false } };
  const items = (await (
    await get(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`, { signal })
  ).json()) as { response?: { store_items?: { appid?: number; name?: string; type?: number }[] } };
  const names = new Map((items.response?.store_items ?? []).filter((i) => i.appid && i.name && (i.type ?? 0) === 0).map((i) => [i.appid!, i.name!]));
  return moving.flatMap((r): RisingGame[] => {
    const name = names.get(r.appid);
    if (!name) return [];
    return [
      {
        platform: "steam",
        name: cleanGameName(name),
        url: `https://store.steampowered.com/app/${r.appid}`,
        players: r.peak_in_game,
        reason: r.last_week_rank < 0 ? "new" : "climbing",
        rank: r.rank,
        lastWeekRank: r.last_week_rank < 0 ? null : r.last_week_rank,
      },
    ];
  });
}

async function risingOnRoblox(get: typeof fetch, signal: AbortSignal): Promise<RisingGame[]> {
  const body = (await (
    await get("https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=00000000-0000-0000-0000-000000000000&device=computer&country=all", { signal })
  ).json()) as { sorts?: { sortId?: string; games?: RobloxGame[] }[] };
  const out = new Map<string, RisingGame>();
  for (const sort of body.sorts ?? []) {
    const reason = sort.sortId === "up-and-coming" ? "up-and-coming" : sort.sortId === "top-trending" ? "trending" : null;
    if (!reason) continue;
    for (const game of sort.games ?? []) {
      if (!game.name || !game.rootPlaceId || game.isSponsored) continue;
      const name = cleanGameName(game.name);
      const key = normalizeKeyword(name);
      // Up-and-Coming is the rarer signal, so it wins when a game is on both sorts.
      if (key.length < 3 || (out.has(key) && reason === "trending")) continue;
      out.set(key, { platform: "roblox", name, url: `https://www.roblox.com/games/${game.rootPlaceId}`, players: game.playerCount ?? 0, reason, rank: null, lastWeekRank: null });
    }
  }
  return [...out.values()];
}

const EDITION = /\s+(special|definitive|anniversary|ultimate|deluxe|complete|enhanced|game of the year|goty)( edition)?$|\s+(remastered|remake)$/i;

/**
 * Store names are longer than searches. "The Elder Scrolls V: Skyrim Special
 * Edition" is searched as "skyrim", "Warhammer 40,000: Space Marine 2" as
 * "space marine 2", "ACE COMBAT 8: WINGS OF THEVE" as "ace combat 8": of the two
 * halves of a long title, the one with the sequel number, else the subtitle.
 */
export function shortName(name: string): string {
  let short = name.trim();
  const words = short.split(/\s+/).length;
  const colon = short.indexOf(":");
  if (words > 4 && colon > 0) {
    const [before, after] = [short.slice(0, colon).trim(), short.slice(colon + 1).trim()];
    short = /\d/.test(after) || !/\d/.test(before) ? after : before;
  }
  return short.replace(EDITION, "").trim() || name.trim();
}

/**
 * The phrase people type on YouTube. Roblox games are searched with the platform
 * ("grow a garden roblox"), unless the name already says it.
 */
export function gameSearchPhrase(game: Pick<RisingGame, "platform" | "name">): string {
  const phrase = normalizeKeyword(shortName(game.name));
  return game.platform === "roblox" && !/\broblox\b/.test(phrase) ? `${phrase} roblox` : phrase;
}
