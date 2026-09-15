import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/client-auth", () => ({
  ClientAuthProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ClientAuthGate: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import AccountCompetitorsPage from "./page";

describe("Account Competitors Page", () => {
  afterEach(cleanup);

  it("renders the reserved route with its heading and the way back", () => {
    render(<AccountCompetitorsPage />);
    expect(screen.getByRole("heading", { name: "Competitors" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Back to Account" })).toHaveAttribute(
      "href",
      "/account",
    );
  });
});
