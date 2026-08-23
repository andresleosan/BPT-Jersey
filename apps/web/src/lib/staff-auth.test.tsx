import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StaffAuthGate, StaffAuthProvider } from "./staff-auth";

let mockUser: any = null;

vi.mock("./auth-client", () => ({
  subscribeToIdTokenChanges: (callback: (user: any) => void) => {
    callback(mockUser);
    return () => {};
  },
  signOutFromAuth: vi.fn(),
}));

describe("Staff Auth Context and Gate", () => {
  it("renders sign in requirement when signed out", () => {
    mockUser = null;

    render(
      <StaffAuthProvider>
        <StaffAuthGate returnPath="/coach/levels">
          <div>Protected Coach Content</div>
        </StaffAuthGate>
      </StaffAuthProvider>,
    );

    expect(screen.getByRole("heading", { name: "Staff Access Required" })).toBeDefined();
    expect(screen.queryByText("Protected Coach Content")).toBeNull();
  });

  it("renders protected content when user has headCoach role", async () => {
    mockUser = {
      uid: "coach-1",
      email: "coach@example.test",
      displayName: "Head Coach",
      getIdTokenResult: async () => ({
        claims: {
          academyId: "demo-academy",
          role: "headCoach",
        },
      }),
    };

    render(
      <StaffAuthProvider>
        <StaffAuthGate returnPath="/coach/levels">
          <div>Protected Coach Content</div>
        </StaffAuthGate>
      </StaffAuthProvider>,
    );

    expect(await screen.findByText("Protected Coach Content")).toBeDefined();
  });
});
