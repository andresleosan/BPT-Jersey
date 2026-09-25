import { describe, expect, it } from "vitest";

import { metadata as homeMetadata } from "./page";
import { metadata as enrolMetadata } from "./enrol/layout";
import { metadata as shopMetadata } from "./shop/layout";
import robots from "./robots";
import { SITE_URL, rootMetadata } from "./site-metadata";
import sitemap from "./sitemap";

/**
 * Cloudflare answers on the apex and bptjersey.pages.dev too, but both redirect to www, so www is the
 * one host spelled into the metadata.
 */
describe("canonical host", () => {
  it("is www, without a trailing slash to double up on", () => {
    expect(SITE_URL).toBe("https://www.bptjersey.com");
  });

  it("anchors every relative metadata URL to that host", () => {
    expect(String(rootMetadata.metadataBase)).toBe(`${SITE_URL}/`);
  });

  it("never declares a canonical for every route at once", () => {
    // One in the root metadata is inherited by every page, telling search engines that /shop and
    // /enrol are duplicates of the home page.
    expect(rootMetadata.alternates?.canonical).toBeUndefined();
  });

  it.each([
    ["home", homeMetadata, "/"],
    ["enrol", enrolMetadata, "/enrol"],
    ["shop", shopMetadata, "/shop"],
  ])("gives the %s page a canonical of its own", (_name, pageMetadata, path) => {
    expect(pageMetadata.alternates?.canonical).toBe(path);
  });
});

describe("robots", () => {
  const rules = robots().rules as { allow?: string; disallow?: string[] };

  it("keeps every signed-in surface out of the index", () => {
    expect(rules.disallow).toEqual(["/account", "/admin", "/coach", "/login", "/staff"]);
  });

  it("still allows the marketing surface", () => {
    expect(rules.allow).toBe("/");
  });

  it("points at the sitemap on the canonical host", () => {
    expect(robots().sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });
});

describe("sitemap", () => {
  it("lists the public pages, each on the canonical host", () => {
    expect(sitemap().map((entry) => entry.url)).toEqual([
      `${SITE_URL}/`,
      `${SITE_URL}/enrol`,
      `${SITE_URL}/shop`,
    ]);
  });

  it("claims no last-modified date it cannot stand behind", () => {
    for (const entry of sitemap()) expect(entry.lastModified).toBeUndefined();
  });

  it("lists no page that robots.txt disallows", () => {
    const disallowed = (robots().rules as { disallow?: string[] }).disallow ?? [];
    for (const entry of sitemap()) {
      const path = new URL(entry.url).pathname;
      expect(disallowed.some((prefix) => path.startsWith(prefix))).toBe(false);
    }
  });
});
