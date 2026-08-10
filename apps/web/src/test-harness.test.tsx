import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "./app/page";

describe("web test harness", () => {
  it("renders the real public academy identity and internal navigation", () => {
    render(<HomePage />);

    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /Brazilian Jiu-Jitsu, MMA & Self-Defence/i,
      }),
    ).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Classes in Jersey" })).toBeVisible();
    expect(screen.getByText("Office 9, 13 Library Place")).toBeVisible();
    expect(screen.getByText("£85")).toBeVisible();

    const bookingLinks = screen.getAllByRole("link", { name: "Book a free class" });

    expect(bookingLinks).toHaveLength(2);
    bookingLinks.forEach((bookingLink) => {
      expect(bookingLink).toHaveAttribute("href", "#contact");
    });
    const contactSection = screen.getByRole("region", { name: "Start with a free class" });
    expect(within(contactSection).getByRole("link", { name: "Book a free class" })).toHaveAttribute(
      "href",
      "#contact",
    );
    expect(screen.queryByRole("link", { name: "Visit BPT Jersey" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });
});
