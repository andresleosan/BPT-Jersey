import { describe, expect, it } from "vitest";

import { classesServicesTabs } from "./classes-services-tabs";

describe("classes-services tabs", () => {
  it("no longer offers bulk operations, listings or drop-ins", () => {
    const hrefs = classesServicesTabs.map((tab) => tab.href);
    for (const gone of ["bulk", "reports", "drop-ins"]) {
      expect(hrefs).not.toContain(`/admin/classes-services/${gone}`);
    }
  });
});
