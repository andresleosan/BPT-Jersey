import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import HomePage from "./page";

describe("public home branding", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the official logo asset in the public header", () => {
    render(<HomePage />);

    expect(screen.getByRole("img", { name: "BPT Jersey logo" }).getAttribute("src")).toContain(
      "bpt-jersey-logo.png",
    );
    expect(screen.getByText("BPT", { exact: true })).toBeVisible();
    expect(screen.getByText("Jersey", { exact: true })).toBeVisible();
  });
});
