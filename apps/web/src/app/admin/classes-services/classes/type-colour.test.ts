import { describe, expect, it } from "vitest";
import { safeTypeColour } from "./type-colour";

describe("safeTypeColour", () => {
  it.each(["#1A2B3C", "#ffffff"])("keeps %s", (hex) => expect(safeTypeColour(hex)).toBe(hex));
  it.each(["red;background:url(x)", "", "#FFF", "#GGGGGG", "#1A2B3C;", null, 42])(
    "drops %s",
    (value) => expect(safeTypeColour(value)).toBeNull(),
  );
});
