import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ status: "signed-out" as "signed-in" | "signed-out" }));

vi.mock("../../lib/client-auth", async () => {
  const { requireClientSession } =
    await vi.importActual<typeof import("../../lib/login-flow")>("../../lib/login-flow");

  return {
    ClientAuthGate: ({
      children,
      returnPath,
    }: {
      children: React.ReactNode;
      returnPath: "/shop";
    }) =>
      authState.status === "signed-in" ? (
        children
      ) : (
        <a href={requireClientSession(returnPath).loginPath}>Sign in</a>
      ),
    ClientAuthProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

import ShopPage from "./page";

describe("shop destination", () => {
  afterEach(() => {
    cleanup();
    authState.status = "signed-out";
  });

  it("requires a client session without exposing commerce data", () => {
    render(<ShopPage />);

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?role=client&returnTo=%2Fshop",
    );
    expect(screen.queryByText(/product|cart|order|payment/i)).not.toBeInTheDocument();
  });

  it("shows the protected future shop boundary for a signed-in client", () => {
    authState.status = "signed-in";
    render(<ShopPage />);

    expect(screen.getByRole("heading", { name: "Client shop access" })).toBeVisible();
    expect(screen.getByText(/authenticated client area/i)).toBeVisible();
    expect(screen.getByText(/catalog and cart features are planned/i)).toBeVisible();
  });
});
