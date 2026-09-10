import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./login-form", () => ({
  LoginForm: ({ audience }: { audience: string }) => (
    <div data-testid="login-form-stub" data-audience={audience} />
  ),
}));

import LoginPage, { metadata } from "./page";

describe("member login page", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the official logo and a route back to Home", () => {
    render(<LoginPage />);

    expect(screen.getByRole("img", { name: "BPT Jersey logo" }).getAttribute("src")).toContain(
      "bpt-jersey-logo.png",
    );
    expect(screen.getByText("BPT / Jersey", { exact: true })).toBeVisible();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
  });

  it("is the member surface only and never mentions the staff entrance", () => {
    render(<LoginPage />);

    expect(screen.getByTestId("login-form-stub")).toHaveAttribute("data-audience", "member");
    expect(document.body.textContent).not.toMatch(/administrator|staff|coach/i);
    expect(document.querySelector('a[href^="/staff"]')).toBeNull();
    expect(metadata.title).toBe("Member sign-in");
    expect(metadata.description).not.toMatch(/administrator/i);
  });
});
