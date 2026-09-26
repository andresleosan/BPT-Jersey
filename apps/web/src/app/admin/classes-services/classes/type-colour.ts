// Same pattern the domain enforces on a type's colour; checked again here because the value
// ends up inside a style attribute.
const hexPattern = /^#[0-9a-fA-F]{6}$/u;

/** The type's timetable colour when it is a plain `#RRGGBB` hex, otherwise `null` (no rule). */
export function safeTypeColour(value: unknown): string | null {
  return typeof value === "string" && hexPattern.test(value) ? value : null;
}
