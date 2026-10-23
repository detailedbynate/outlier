import type { MetadataRoute } from "next";
import { COMPETITORS } from "./vs/competitors";

const SITE = process.env.SITE_URL ?? "https://www.useoutlier.online";

/** The public pages search engines should find. Everything else is behind sign-in. */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["/", "/tools/srt-generator", "/vs", ...COMPETITORS.map((c) => `/vs/${c.slug}`), "/terms", "/privacy", "/refunds"];
  return pages.map((path) => ({ url: `${SITE}${path === "/" ? "" : path}`, changeFrequency: "weekly", priority: path === "/" ? 1 : 0.7 }));
}
