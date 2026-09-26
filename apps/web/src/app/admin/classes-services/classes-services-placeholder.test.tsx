import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ClassesServicesPlaceholder } from "./classes-services-placeholder";

describe("Classes / Services placeholder", () => {
  afterEach(() => cleanup());

  it("takes its heading from the tab it stands in for", () => {
    render(<ClassesServicesPlaceholder href="/admin/classes-services/options" />);
    expect(screen.getByRole("heading", { name: "Options", level: 2 })).toBeVisible();
    expect(screen.getByText("Coming in the next release.")).toBeVisible();
  });

  it("refuses an href that is not a tab", () => {
    expect(() =>
      render(<ClassesServicesPlaceholder href="/admin/classes-services/nowhere" />),
    ).toThrow(/nowhere/u);
  });
});
