import type { Metadata } from "next";

/**
 * The one host this site is allowed to rank as: www.bptjersey.com. Cloudflare redirects the apex and
 * bptjersey.pages.dev to it, and a static export cannot tell hosts apart at request time, so the
 * winner is spelled out here and inherited by every URL in the metadata.
 */
export const SITE_URL = "https://www.bptjersey.com";

/**
 * Lives apart from the root layout so that reading it does not pull in the Google font loader,
 * which only runs inside the Next build.
 *
 * Deliberately carries no `alternates.canonical`: one declared here is inherited by every route,
 * which would tell search engines that /shop and /enrol are duplicates of the home page. Each
 * public page declares its own.
 */
export const rootMetadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "BPT Jersey | Brazilian Jiu-Jitsu Academy",
    template: "%s | BPT Jersey",
  },
  description:
    "Train Brazilian Jiu-Jitsu with Brazilian Power Team Jersey and manage every academy touchpoint in one clear place.",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
};
