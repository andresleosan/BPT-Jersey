import { describe, expect, it } from "vitest";

import { formatMemberPdfTextItems } from "./member-pdf-text.js";

describe("member PDF text layout", () => {
  it("rebuilds aligned columns and preserves empty cells", () => {
    const result = formatMemberPdfTextItems([
      { str: "Member Nº", x: 34.5, y: 755 },
      { str: "Name", x: 73.7, y: 755 },
      { str: "ID Card Nº", x: 304.4, y: 755 },
      { str: "Birthdate", x: 377.7, y: 755 },
      { str: "VAT Number", x: 443.3, y: 755 },
      { str: "Mobile nº", x: 519, y: 755 },
      { str: "M-001", x: 47.3, y: 740 },
      { str: "Layout Member A", x: 73.7, y: 740 },
      { str: "01 Jan 2000", x: 367.7, y: 740 },
      { str: "+4470001001", x: 519, y: 740 },
    ]);

    expect(result).toBe(
      "Member Nº | Name | ID Card Nº | Birthdate | VAT Number | Mobile nº\n" +
        "M-001 | Layout Member A |  | 01 Jan 2000 |  | +4470001001",
    );
  });
});
