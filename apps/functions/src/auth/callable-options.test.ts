import { describe, expect, it } from "vitest";

import { browserAdminCallableOptions } from "./callable-options.js";

describe("browser admin callable transport", () => {
  it("allows only the published admin origin at the HTTP transport", () => {
    expect(browserAdminCallableOptions).toEqual({
      cors: ["https://bptjersey.pages.dev"],
      invoker: "public",
    });
  });
});
