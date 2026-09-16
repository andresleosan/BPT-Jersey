import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ClassesServicesPlaceholder } from "./classes-services-placeholder";

describe("Classes / Services placeholder", () => {
  afterEach(() => cleanup());

  it("takes its heading from the tab it stands in for", () => {
    render(<ClassesServicesPlaceholder href="/admin/classes-services/drop-ins" />);
    expect(screen.getByRole("heading", { name: "Drop-ins", level: 2 })).toBeVisible();
    expect(screen.getByText("Coming in the next release.")).toBeVisible();
  });

  it("uses the tab label verbatim, ampersands included", () => {
    render(<ClassesServicesPlaceholder href="/admin/classes-services/reports" />);
    expect(screen.getByRole("heading", { name: "Listings & Reports", level: 2 })).toBeVisible();
  });

  it("refuses an href that is not a tab", () => {
    expect(() =>
      render(<ClassesServicesPlaceholder href="/admin/classes-services/nowhere" />),
    ).toThrow(/nowhere/u);
  });
});
