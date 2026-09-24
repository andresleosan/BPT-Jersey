import { describe, expect, it } from "vitest";

import { browserAdminCallableOptions, browserOrigins } from "./callable-options.js";
import { upcomingBirthdayCallableOptions } from "../birthdays/upcoming-birthday-callables.js";
import { permissionGrantCallableOptions } from "../staff/permission-grant-callables.js";

describe("browser origins", () => {
  it("admits the apex and the Pages domain, and nothing else", () => {
    // Leaving the apex out is not a cosmetic bug: the pages load from the static export and every
    // callable then fails CORS, which is exactly what happened between the domain going live and
    // this list being updated.
    expect(browserOrigins).toEqual(["https://bptjersey.com", "https://bptjersey.pages.dev"]);
  });

  it("does not list www, which never reaches the browser as an origin", () => {
    // A zone Redirect Rule answers www with a 301 to the apex.
    expect(browserOrigins).not.toContain("https://www.bptjersey.com");
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
