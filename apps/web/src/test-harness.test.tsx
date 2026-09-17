import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "./app/page";

describe("web test harness", () => {
  it("renders the real public academy identity and internal navigation", () => {
    render(<HomePage />);

    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
    const heroTitle = screen.getByRole("heading", {
      level: 1,
      name: "Brazilian Jiu-Jitsu, MMA & Self-Defence",
    });

    expect(heroTitle).toBeVisible();
    expect(heroTitle.querySelectorAll(".hero-title-line")).toHaveLength(3);
    expect(
      [...heroTitle.querySelectorAll(".hero-title-line")].map((line) => line.textContent),
    ).toEqual(["Brazilian Jiu-", "Jitsu, MMA", "& Self-Defence"]);
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Classes in Jersey" })).toBeVisible();
    // Both training centres appear in the hero location block and again in the contact section.
    expect(screen.getAllByText("Office 9, 13 Library Place")).toHaveLength(2);
    expect(screen.getAllByText("L'Avenue de la Reine Elizabeth II")).toHaveLength(2);
    expect(screen.getByText("£85 per month")).toBeVisible();

    const bookingLinks = screen.getAllByRole("link", { name: "Book a free class" });

    expect(bookingLinks).toHaveLength(2);
    bookingLinks.forEach((bookingLink) => {
      expect(bookingLink).toHaveAttribute("href", "/enrol");
    });
    const contactSection = screen.getByRole("region", { name: "Start with a free class" });
    expect(within(contactSection).getByRole("link", { name: "Book a free class" })).toHaveAttribute(
      "href",
      "/enrol",
    );
    expect(screen.queryByText("One academy. One clear system.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Visit BPT Jersey" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });
});
