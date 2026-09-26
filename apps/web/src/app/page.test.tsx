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
    expect(screen.getByText("BPT", { exact: true })).toBeVisible();
    expect(screen.getByText("Jersey", { exact: true })).toBeVisible();
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
    expect(screen.getByText("Timetable checked 7 August 2026.")).toBeVisible();
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
