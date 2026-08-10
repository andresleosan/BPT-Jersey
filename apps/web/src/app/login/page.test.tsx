import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./login-form", () => ({
  LoginForm: () => <div data-testid="login-form-stub" />,
}));

import LoginPage from "./page";

describe("login branding", () => {
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
});
