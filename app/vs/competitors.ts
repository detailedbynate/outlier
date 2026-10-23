/**
 * The tools Outlier gets compared with, for the public /vs pages. Prices were
 * checked in October 2026: from each pricing page where it lists them, and from
 * third-party listings (marked `approx`) where the page hides them behind a script.
 * Only say what's on their own site; recheck before changing a price.
 */
export interface Competitor {
  slug: string;
  name: string;
  site: string;
  /** Their cheapest paid plan, as a short line. */
  price: string;
  /** True when the price came from a third-party listing, not their page. */
  approx?: boolean;
  freePlan: boolean;
  /** What it is, in one sentence. */
  about: string;
  /** Who should pick it over Outlier. Be fair: this is what makes the page credible. */
  pickThem: string[];
  /** Who should pick Outlier. */
  pickOutlier: string[];
}

export const COMPETITORS: Competitor[] = [
  {
    slug: "vidiq",
    name: "vidIQ",
    site: "https://vidiq.com/pricing/",
    price: "Boost $19/mo ($16.58/mo yearly); MAX $49/mo",
    freePlan: true,
    about: "A browser extension and web app for keyword research, SEO scores, AI coaching and channel optimization, for every kind of YouTube channel.",
    pickThem: ["You make long-form videos and want keyword and SEO scores on every upload", "You want an AI coach and optimization checklists inside YouTube Studio"],
    pickOutlier: [
      "You make Shorts and want to see which small channels' Shorts are blowing up right now",
      "You're in gaming or faceless niches and want outliers, not keyword scores",
      "You want idea → script → voiceover → captions in one place for less",
    ],
  },
  {
    slug: "1of10",
    name: "1of10",
    site: "https://1of10.com/pricing",
    price: "Basic $19/mo ($15/mo yearly); Pro $89/mo",
    freePlan: true,
    about: "An outlier-video search across YouTube with AI tools for titles, thumbnails and ideas, aimed mostly at long-form creators.",
    pickThem: ["You make long-form videos and care most about titles and thumbnails", "You run several channels and want team seats and an API"],
    pickOutlier: [
      "You make Shorts: Outlier tracks Shorts channels every day and scores each Short against the channel's usual views",
      "You want gaming niches covered (Minecraft, Roblox, Fortnite, GTA), not just high-RPM topics",
      "You want word-by-word captions and voiceovers in the same tool",
    ],
  },
  {
    slug: "nexlev",
    name: "NexLev",
    site: "https://www.nexlev.io/pricing",
    price: "Lite (extension only) about $13/mo; Pro with Niche Finder about $42/mo",
    approx: true,
    freePlan: false,
    about: "A niche finder and Chrome extension for faceless long-form channels, with RPM estimates and a bundled course on the Pro plan.",
    pickThem: ["You're building a faceless long-form channel and want RPM predictions", "You want a course bundled with the tool"],
    pickOutlier: [
      "You make Shorts and want the Shorts that are working this week, from channels under 50K subscribers",
      "You want gaming niches, which RPM-first tools tend to skip",
      "You'd rather pay a monthly price with no course attached",
    ],
  },
  {
    slug: "tubelab",
    name: "TubeLab",
    site: "https://tubelab.net/pricing",
    price: "From about $29/mo (less billed yearly)",
    approx: true,
    freePlan: false,
    about: "A niche finder and outlier database with monetization and audience data, AI scripts and avatar videos.",
    pickThem: ["You want revenue and audience estimates on every niche", "You make long-form faceless videos with AI avatars"],
    pickOutlier: [
      "You make Shorts: viral Shorts, Shorts channels and caption tools are the core of Outlier",
      "You want gaming niches front and center",
      "You want a lower monthly price",
    ],
  },
  {
    slug: "outlierkit",
    name: "OutlierKit",
    site: "https://outlierkit.com/pricing",
    price: "Hobby $299/year; Pro $599/year",
    freePlan: false,
    about: "Outlier and keyword research with competitor analysis, deep research and an API, sold mainly on yearly plans.",
    pickThem: ["You want deep competitor research across a whole niche", "You're happy paying yearly up front"],
    pickOutlier: [
      "You want to pay month to month",
      "You make Shorts in gaming or faceless niches",
      "You want script, voiceover and caption tools included",
    ],
  },
  {
    slug: "algrow",
    name: "Algrow",
    site: "https://algrow.online",
    price: "From about $18/mo",
    approx: true,
    freePlan: false,
    about: "A niche finder for faceless channels, with AI video generation sold as extra credits.",
    pickThem: ["You want AI-generated videos from the same tool", "You're focused on faceless long-form niches"],
    pickOutlier: [
      "You make Shorts and want to see what's working this week",
      "You want gaming niches covered",
      "You want word-by-word captions from your own voiceover, included",
    ],
  },
];

export function findCompetitor(slug: string): Competitor | null {
  return COMPETITORS.find((c) => c.slug === slug) ?? null;
}
