import type { PlanId } from "@/lib/billing/plans";
import type { DiscordMessage } from "./api";

/** Checked on the way back from Discord's sign-in, so a link can't be finished by someone else's. */
export const DISCORD_STATE_COOKIE = "outlier_discord_state";

/** Outlier purple, for embeds. */
export const BRAND_COLOR = 0x8b5cf6;
/** Ephemeral: only the person who used the command sees the reply. */
export const EPHEMERAL = 64;

export interface RoleConfig {
  pro: string | null;
  expert: string | null;
}

/** Which paid roles someone should have on a plan, and which they shouldn't. Expert gets the Expert role only. */
export function rolesFor(plan: PlanId, roles: RoleConfig): { give: string[]; take: string[] } {
  const want = plan === "expert" ? roles.expert : plan === "pro" ? roles.pro : null;
  const all = [roles.pro, roles.expert].filter((r): r is string => Boolean(r));
  return { give: want ? [want] : [], take: all.filter((r) => r !== want) };
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const compact = (n: number) => Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export interface PickForDiscord {
  niche: string;
  channel_title: string;
  channel_thumbnail_url: string | null;
  youtube_channel_id: string;
  subscriber_count: number | null;
  youtube_video_id: string;
  video_title: string;
  video_views: number;
  outlier_multiplier: number | null;
}

function nicheName(niche: string): string {
  const name = niche.replace(/[_-]+/g, " ").trim();
  // Short ones are acronyms: GTA, FPS.
  return name.length <= 3 ? name.toUpperCase() : name.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Today's Daily Picks as one message: a header, then a card per Short (Discord allows 10). */
export function picksMessage(picks: PickForDiscord[], date: Date, siteUrl: string): DiscordMessage {
  const day = date.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric" });
  if (picks.length === 0) return { content: `No Daily Picks yet for ${day}. Check back later.`, allowed_mentions: { parse: [] } };
  return {
    content: `## 🔥 Daily Picks · ${day}\nShorts blowing up on small channels today.`,
    embeds: picks.slice(0, 10).map((pick) => ({
      title: clip(pick.video_title, 256),
      url: `https://www.youtube.com/shorts/${pick.youtube_video_id}`,
      color: BRAND_COLOR,
      author: {
        name: clip(pick.channel_title, 256),
        url: `https://www.youtube.com/channel/${pick.youtube_channel_id}`,
        ...(pick.channel_thumbnail_url ? { icon_url: pick.channel_thumbnail_url } : {}),
      },
      thumbnail: { url: `https://i.ytimg.com/vi/${pick.youtube_video_id}/hqdefault.jpg` },
      fields: [
        { name: "Views", value: compact(pick.video_views), inline: true },
        { name: "Outlier", value: pick.outlier_multiplier ? `${pick.outlier_multiplier.toFixed(1)}× usual` : "–", inline: true },
        { name: "Subscribers", value: pick.subscriber_count === null ? "Hidden" : compact(pick.subscriber_count), inline: true },
      ],
      footer: { text: nicheName(pick.niche) },
    })),
    components: [linkButtons([{ label: "See more on Outlier", url: siteUrl }])],
    allowed_mentions: { parse: [] },
  };
}

/** A row of link buttons (style 5 opens a URL). */
export function linkButtons(buttons: { label: string; url: string }[]): Record<string, unknown> {
  return { type: 1, components: buttons.slice(0, 5).map((b) => ({ type: 2, style: 5, label: clip(b.label, 80), url: b.url })) };
}

export interface ComposedPost {
  content: string;
  title: string;
  description: string;
  color: string;
  url: string;
  imageUrl: string;
  thumbnailUrl: string;
  footer: string;
  buttonLabel: string;
  buttonUrl: string;
  /** Let @everyone, @here and role mentions in the text actually ping. */
  ping: boolean;
}

const isHttpUrl = (value: string) => /^https?:\/\/\S+$/i.test(value);

/** What the admin wrote in the composer, as a Discord message; an error when it can't be sent. */
export function composeMessage(post: ComposedPost): DiscordMessage | { error: string } {
  const content = post.content.trim();
  const hasEmbed = Boolean(post.title.trim() || post.description.trim() || post.imageUrl.trim());
  if (!content && !hasEmbed) return { error: "Write a message or fill in the card." };
  if (content.length > 2000) return { error: "The message is over Discord's 2,000 characters." };
  if (post.description.length > 4096) return { error: "The card text is over Discord's 4,096 characters." };
  for (const [label, value] of [
    ["Link", post.url],
    ["Image", post.imageUrl],
    ["Thumbnail", post.thumbnailUrl],
    ["Button link", post.buttonUrl],
  ] as const) {
    if (value.trim() && !isHttpUrl(value.trim())) return { error: `${label} has to be a full https:// address.` };
  }
  if (post.buttonLabel.trim() && !post.buttonUrl.trim()) return { error: "The button needs a link." };
  const color = /^#?[0-9a-f]{6}$/i.test(post.color.trim()) ? parseInt(post.color.trim().replace("#", ""), 16) : BRAND_COLOR;
  const embed = hasEmbed
    ? {
        color,
        ...(post.title.trim() ? { title: clip(post.title.trim(), 256) } : {}),
        ...(post.description.trim() ? { description: post.description.trim() } : {}),
        ...(post.url.trim() && post.title.trim() ? { url: post.url.trim() } : {}),
        ...(post.imageUrl.trim() ? { image: { url: post.imageUrl.trim() } } : {}),
        ...(post.thumbnailUrl.trim() ? { thumbnail: { url: post.thumbnailUrl.trim() } } : {}),
        ...(post.footer.trim() ? { footer: { text: clip(post.footer.trim(), 2048) } } : {}),
      }
    : null;
  return {
    ...(content ? { content } : {}),
    ...(embed ? { embeds: [embed] } : {}),
    ...(post.buttonUrl.trim() ? { components: [linkButtons([{ label: post.buttonLabel.trim() || "Open", url: post.buttonUrl.trim() }])] } : {}),
    allowed_mentions: { parse: post.ping ? ["everyone", "roles", "users"] : ["users"] },
  };
}
