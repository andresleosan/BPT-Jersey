import type { MetadataRoute } from "next";

import { SITE_URL } from "./site-metadata";

// This site is `output: "export"`; without this the route is treated as dynamic and the build fails.
export const dynamic = "force-static";

/**
 * Only the marketing surface is worth crawling. Everything behind a sign-in is noise in search
 * results and is already unreachable without Firebase claims, so it is kept out of the index too.
 * "/account" also covers "/accounts" by prefix match, which is how robots.txt paths work.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/account", "/admin", "/coach", "/login", "/staff"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
