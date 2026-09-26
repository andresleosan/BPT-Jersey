// Same pattern the domain enforces on a type's colour; checked again here because the value
// ends up inside a style attribute.
const hexPattern = /^#[0-9a-fA-F]{6}$/u;

/** The type's timetable colour when it is a plain `#RRGGBB` hex, otherwise `null` (no rule). */
export function safeTypeColour(value: unknown): string | null {
  return typeof value === "string" && hexPattern.test(value) ? value : null;
}

function luminance(rgb: readonly number[]): number {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

// Mat Ink (#1A1A18), the text colour on a week card.
const inkLuminance = luminance([0x1a, 0x1a, 0x18]);

/**
 * The week card fill for a type: the validated colour itself when Mat Ink text on it reaches WCAG
 * AA (4.5:1), otherwise that colour mixed towards white in 10% steps until it does. `null` for
 * anything that is not a plain hex.
 */
export function readableTypeFill(value: unknown): string | null {
  const hex = safeTypeColour(value);
  if (hex === null) return null;
  const rgb = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  for (let step = 0; step <= 10; step += 1) {
    const mixed = rgb.map((channel) => Math.round(channel + ((255 - channel) * step) / 10));
    if ((luminance(mixed) + 0.05) / (inkLuminance + 0.05) >= 4.5)
      return step === 0
        ? hex
        : `#${mixed
            .map((channel) => channel.toString(16).padStart(2, "0"))
            .join("")
            .toUpperCase()}`;
  }
  return "#FFFFFF";
}
