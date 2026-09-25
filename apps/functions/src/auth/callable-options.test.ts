import { describe, expect, it } from "vitest";

import { browserAdminCallableOptions, browserOrigins } from "./callable-options.js";
import { upcomingBirthdayCallableOptions } from "../birthdays/upcoming-birthday-callables.js";
import { permissionGrantCallableOptions } from "../staff/permission-grant-callables.js";

describe("browser origins", () => {
  it("admits www first, plus the two hosts that now redirect to it, and nothing else", () => {
    // Leaving the canonical host out is not a cosmetic bug: the pages load from the static export
    // and every callable then fails CORS, as happened on 2026-09-18 when the apex went live.
    expect(browserOrigins).toEqual([
      "https://www.bptjersey.com",
      "https://bptjersey.com",
      "https://bptjersey.pages.dev",
    ]);
  });
});

describe("browser admin callable transport", () => {
  it("allows only the published origins at the HTTP transport", () => {
    expect(browserAdminCallableOptions).toEqual({
      cors: browserOrigins,
      invoker: "public",
      enforceAppCheck: true,
    });
  });
});

describe("every restricted callable option set", () => {
  // Four option sets used to carry their own copy of the origin list. One updated and the others
  // forgotten is a failure nothing catches until a user hits that one feature in the browser.
  it.each([
    ["permission grant", permissionGrantCallableOptions],
    ["upcoming birthday", upcomingBirthdayCallableOptions],
  ])("shares the one origin list (%s)", (_name, options) => {
    expect(options.cors).toBe(browserOrigins);
  });
});
