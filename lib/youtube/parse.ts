import { ValidationError } from "@/lib/core/errors";
import type { ChannelIdentifier } from "@/types/youtube";

export const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;
export const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
export const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]{2,64}$/;
const HANDLE_PATTERN = /^@?([A-Za-z0-9._-]{3,30})$/;

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

function tryParseUrl(input: string): URL | null {
  const candidate = /^https?:\/\//i.test(input) ? input : /^(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(input) ? `https://${input}` : null;
  if (!candidate) return null;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

/**
 * Parse anything a user might paste to identify a channel:
 * a channel id, an @handle, or a channel URL (/channel/, /@handle, /user/, /c/).
 */
export function parseChannelIdentifier(raw: string): ChannelIdentifier {
  const input = raw.trim();
  if (!input) throw new ValidationError("Channel identifier is empty");

  if (CHANNEL_ID_PATTERN.test(input)) return { type: "id", value: input };

  const url = tryParseUrl(input);
  if (url) {
    if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
      throw new ValidationError(`Not a YouTube channel URL: ${input}`);
    }
    const [first, second] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (first?.startsWith("@")) return parseChannelIdentifier(first);
    if (first === "channel" && second && CHANNEL_ID_PATTERN.test(second)) return { type: "id", value: second };
    if (first === "user" && second) return { type: "username", value: second };
    if (first === "c" && second) return { type: "custom", value: second };
    throw new ValidationError(`Unrecognized YouTube channel URL: ${input}`);
  }

  // Bare words are treated as handles ("mkbhd" -> "@mkbhd").
  const handle = HANDLE_PATTERN.exec(input);
  if (handle?.[1]) return { type: "handle", value: `@${handle[1]}` };

  throw new ValidationError(`Invalid channel identifier: ${input}`);
}

/** Extract a video id from an id or any common YouTube video URL (watch, youtu.be, shorts, embed, live). */
export function parseVideoId(raw: string): string {
  const input = raw.trim();
  if (VIDEO_ID_PATTERN.test(input)) return input;

  const url = tryParseUrl(input);
  if (url) {
    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split("/").filter(Boolean);
    let candidate: string | undefined;
    if (host === "youtu.be") candidate = segments[0];
    else if (YOUTUBE_HOSTS.has(host)) {
      if (segments[0] === "watch") candidate = url.searchParams.get("v") ?? undefined;
      else if (["shorts", "embed", "live", "v"].includes(segments[0] ?? "")) candidate = segments[1];
    }
    if (candidate && VIDEO_ID_PATTERN.test(candidate)) return candidate;
  }
  throw new ValidationError(`Invalid YouTube video id or URL: ${input}`);
}

/** Extract a playlist id from an id or a URL containing ?list=. */
export function parsePlaylistId(raw: string): string {
  const input = raw.trim();
  const url = tryParseUrl(input);
  const candidate = url ? url.searchParams.get("list") : input;
  if (candidate && PLAYLIST_ID_PATTERN.test(candidate)) return candidate;
  throw new ValidationError(`Invalid YouTube playlist id or URL: ${input}`);
}

/**
 * Parse an ISO 8601 duration as returned by YouTube (e.g. "PT1H2M3S", "P1DT2H").
 * Returns null for unparseable or live ("P0D") placeholders.
 */
export function parseIsoDuration(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (!match || value === "P" || value.endsWith("T")) return null;
  const [, w, d, h, m, s] = match;
  const seconds =
    Number(w ?? 0) * 604_800 + Number(d ?? 0) * 86_400 + Number(h ?? 0) * 3_600 + Number(m ?? 0) * 60 + Number(s ?? 0);
  return Math.round(seconds);
}

/** YouTube returns counts as strings; convert safely, keeping "absent" distinct from zero. */
export function parseCount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Split brandingSettings.channel.keywords, which uses quotes for multi-word phrases. */
export function parseChannelKeywords(value: string | null | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const match of value.matchAll(/"([^"]+)"|(\S+)/g)) {
    const keyword = (match[1] ?? match[2] ?? "").trim();
    if (keyword) out.push(keyword);
  }
  return [...new Set(out)];
}

/** Derived playlists YouTube exposes for every channel. */
export function channelPlaylistId(channelId: string, kind: "uploads" | "shorts" | "long_form"): string {
  if (!CHANNEL_ID_PATTERN.test(channelId)) throw new ValidationError(`Invalid channel id: ${channelId}`);
  const suffix = channelId.slice(2);
  switch (kind) {
    case "uploads":
      return `UU${suffix}`;
    case "shorts":
      return `UUSH${suffix}`;
    case "long_form":
      return `UULF${suffix}`;
  }
}

/** Split an array into fixed-size chunks (YouTube list endpoints accept at most 50 ids). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
