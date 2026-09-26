import { describe, expect, it } from "vitest";
import { readableTypeFill, safeTypeColour } from "./type-colour";

describe("safeTypeColour", () => {
  it.each(["#1A2B3C", "#ffffff"])("keeps %s", (hex) => expect(safeTypeColour(hex)).toBe(hex));
  it.each(["red;background:url(x)", "", "#FFF", "#GGGGGG", "#1A2B3C;", null, 42])(
    "drops %s",
    (value) => expect(safeTypeColour(value)).toBeNull(),
  );
});

describe("readableTypeFill", () => {
  it("keeps a pastel that Mat Ink already reads on", () =>
    expect(readableTypeFill("#FDEBC8")).toBe("#FDEBC8"));
  it.each([
    ["#1A7F4B", "#48996F"],
    ["#000000", "#999999"],
  ])("lightens %s to %s so Mat Ink reaches 4.5:1", (hex, fill) =>
    expect(readableTypeFill(hex)).toBe(fill),
  );
  it.each(["red;background:url(x)", "", null])("gives no fill for %j", (value) =>
    expect(readableTypeFill(value)).toBeNull(),
  );
});
