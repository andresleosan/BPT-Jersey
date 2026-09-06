import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../login/login-form", () => ({
  LoginForm: ({ audience }: { audience: string }) => (
    <div data-testid="login-form-stub" data-audience={audience} />
  ),
}));

import StaffLoginPage, { metadata } from "./page";

describe("staff login page", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the staff audience with the official logo and a route back to Home", () => {
    render(<StaffLoginPage />);

    expect(screen.getByRole("img", { name: "BPT Jersey logo" }).getAttribute("src")).toContain(
      "bpt-jersey-logo.png",
    );
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByTestId("login-form-stub")).toHaveAttribute("data-audience", "staff");
    expect(screen.getByText(/coaches and office staff/i)).toBeVisible();
  });

  it("asks search engines not to index the staff entrance", () => {
    expect(metadata.title).toBe("Staff sign-in");
    expect(metadata.robots).toEqual({ index: false, follow: false, nocache: true });
  });
});
