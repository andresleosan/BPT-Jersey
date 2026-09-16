import { describe, expect, it } from "vitest";

import { locationLabel } from "./location-label";

describe("locationLabel", () => {
  it("names the two historical sites when no catalogue is loaded", () => {
    expect(locationLabel("town")).toBe("Town");
    expect(locationLabel("west")).toBe("West");
  });

  it("falls back to the id for a site the page cannot name", () => {
    expect(locationLabel("salle-ouest")).toBe("salle-ouest");
    expect(locationLabel("salle-ouest", new Map())).toBe("salle-ouest");
  });

  it("prefers the catalogue name, including for the historical sites", () => {
    const locations = new Map([
      ["salle-ouest", { name: "Salle Ouest" }],
      ["town", { name: "Town (St Helier)" }],
    ]);
    expect(locationLabel("salle-ouest", locations)).toBe("Salle Ouest");
    expect(locationLabel("town", locations)).toBe("Town (St Helier)");
  });
});
