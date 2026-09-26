import { cleanup, render, screen, within } from "@testing-library/react";
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
    // Desktop (and the page without its script) keeps the logo as the plain link home.
    const home = screen.getByRole("link", { name: "BPT Jersey home" });
    expect(home).toHaveAttribute("href", "#top");
    expect(within(home).getByText("BPT", { exact: true })).toBeVisible();
    expect(within(home).getByText("Jersey", { exact: true })).toBeVisible();
    // On phones the same logo, as a button, is the menu toggle.
    expect(screen.getByRole("button", { name: "Open BPT Jersey menu" })).toHaveAttribute(
      "aria-controls",
      "primary-nav-links",
    );
  });

  it("uses plain British section names and anchors", () => {
    render(<HomePage />);

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(nav).getByRole("link", { name: "Programmes" })).toHaveAttribute(
      "href",
      "#programmes",
    );
    expect(document.getElementById("programmes")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Who the classes are for" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Memberships and prices" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Club shop" })).toBeVisible();
    expect(screen.getByRole("table", { name: "Weekly timetable" })).toBeVisible();
    expect(screen.getByText("Timetable checked 26 September 2026.")).toBeVisible();
  });

  it("lists the addresses once and keeps the contact section to the free class", () => {
    render(<HomePage />);

    expect(screen.getAllByText("Office 9, 13 Library Place")).toHaveLength(1);
    const contact = document.getElementById("contact");
    expect(contact).not.toBeNull();
    expect(within(contact!).queryByRole("list")).toBeNull();
    expect(
      within(contact!).getByText(
        "Book a free class and a coach will help you pick the right class to start with.",
      ),
    ).toBeVisible();
  });
});
