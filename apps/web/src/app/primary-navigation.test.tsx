import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { PrimaryNavigation } from "./primary-navigation";

const globalsCss = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "globals.css"),
  "utf8",
);

describe("PrimaryNavigation", () => {
  afterEach(() => {
    cleanup();
  });

  it("starts closed and keeps Sign in outside the collapsible list", () => {
    render(<PrimaryNavigation />);

    const button = screen.getByRole("button", { name: "Menu" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    const list = document.getElementById(button.getAttribute("aria-controls") ?? "");
    expect(list).not.toBeNull();
    expect(list).toHaveAttribute("data-open", "false");
    expect(within(list!).getByRole("link", { name: "Classes" })).toHaveAttribute(
      "href",
      "#classes",
    );
    const signIn = screen.getByRole("link", { name: "Sign in" });
    expect(signIn).toHaveAttribute("href", "/login");
    expect(list!.contains(signIn)).toBe(false);
  });

  it("opens with the button, closes with Escape and returns focus to the button", () => {
    render(<PrimaryNavigation />);

    const button = screen.getByRole("button", { name: "Menu" });
    const list = document.getElementById(button.getAttribute("aria-controls")!)!;
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(list).toHaveAttribute("data-open", "true");

    const classes = within(list).getByRole("link", { name: "Classes" });
    classes.focus();
    fireEvent.keyDown(classes, { key: "Escape" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();
  });

  it("closes after following a link", () => {
    render(<PrimaryNavigation />);

    const button = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("link", { name: "Programmes" }));
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("collapses the links behind the button below 58rem instead of hiding them", () => {
    expect(globalsCss).not.toMatch(/\.primary-nav > a:not\(\.nav-cta\)/u);
    const phone = globalsCss.slice(globalsCss.indexOf("@media (max-width: 57.99rem)"));
    expect(phone).toMatch(/\.nav-menu-button\s*\{[^}]*display: inline-flex;/u);
    expect(phone).toMatch(/\.primary-nav-links\[data-open="false"\]\s*\{[^}]*display: none;/u);
    expect(globalsCss).toMatch(/\.nav-menu-button\s*\{[^}]*min-height: 2\.75rem;/u);
  });
});
