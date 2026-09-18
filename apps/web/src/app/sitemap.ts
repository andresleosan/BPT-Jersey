import type { MetadataRoute } from "next";

import { SITE_URL } from "./site-metadata";

// This site is `output: "export"`; without this the route is treated as dynamic and the build fails.
export const dynamic = "force-static";

/**
 * The three public pages, spelled with the canonical host. Everything else in the export sits
 * behind a sign-in. No lastModified: it would be the build date, not the date the page changed,
 * and a date that moves on every deploy is a claim search engines learn to discount.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/enrol`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/shop`, changeFrequency: "monthly", priority: 0.8 },
  ];
}
