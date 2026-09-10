import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import HomePage from "./page";

describe("public home branding", () => {
  afterEach(() => {
    cleanup();
  });

  it("offers the staff sign-in from the footer and never from the primary navigation", () => {
    render(<HomePage />);

    const staffLink = screen.getByRole("link", { name: "Staff sign-in" });
    expect(staffLink).toHaveAttribute("href", "/staff/login");
    expect(staffLink.closest("footer")).not.toBeNull();
    expect(
      screen
        .getByRole("navigation", { name: "Primary navigation" })
        .querySelector('a[href^="/staff"]'),
    ).toBeNull();
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
