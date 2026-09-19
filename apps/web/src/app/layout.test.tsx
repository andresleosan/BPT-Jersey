import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Barlow_Condensed: () => ({ variable: "--font-display" }),
  Source_Sans_3: () => ({ variable: "--font-body" }),
}));

import RootLayout from "./layout";

describe("root layout", () => {
  /**
   * `lang` decides how Chromium renders every `<input type="date">`: `en` gives the US
   * `mm/dd/yyyy`, `en-GB` the `dd/mm/yyyy` an operator in Jersey reads. One of those fields is
   * the promotion date of an audited promotion, where 9 Aug and 8 Sep are equally plausible
   * typings, so a silent revert of this one word mis-dates a graduation.
   */
  it("declares UK English so date inputs render day first", () => {
    const tree = RootLayout({ children: null }) as ReactElement<{ lang: string }>;

    expect(tree.props.lang).toBe("en-GB");
  });
});
