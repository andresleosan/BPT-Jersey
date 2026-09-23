import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  session: undefined as
    { email: string; displayName: string; uid: string; role?: string } | undefined,
  status: "signed-out" as "signed-in" | "signed-out",
  signOut: vi.fn(),
}));

vi.mock("../../lib/client-auth", async () => {
  const { requireClientSession } =
    await vi.importActual<typeof import("../../lib/login-flow")>("../../lib/login-flow");

  return {
    ClientAuthGate: ({
      children,
      returnPath,
    }: {
      children: React.ReactNode;
      returnPath: "/account";
    }) =>
      authState.status === "signed-in" ? (
        children
      ) : (
        <a href={requireClientSession(returnPath).loginPath}>Sign in</a>
      ),
    ClientAuthProvider: ({ children }: { children: React.ReactNode }) => children,
    useClientSession: () => authState,
  };
});

vi.mock("./calendar/member-calendar", () => ({
  MemberCalendar: ({ session }: { session: { role: string; displayName: string } }) => (
    <main data-testid="member-calendar">{`${session.role}:${session.displayName}`}</main>
  ),
}));

// D12 gate: nothing pending, so the calendar opens once the waiver check resolves.
vi.mock("../../lib/enrolment-waiver-client", () => ({
  getEnrolmentWaiverStatus: vi.fn(async () => ({ version: "2026-09", pending: [] })),
  acceptEnrolmentWaiver: vi.fn(),
}));

import AccountPage from "./page";

describe("account home", () => {
  afterEach(() => {
    cleanup();
    authState.status = "signed-out";
    authState.session = undefined;
    vi.clearAllMocks();
  });

  it("requires a client session before showing the calendar", () => {
    render(<AccountPage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Faccount",
    );
    expect(screen.queryByTestId("member-calendar")).not.toBeInTheDocument();
  });

  it("mounts the member calendar for a signed-in teen", async () => {
    authState.status = "signed-in";
    authState.session = {
      email: "teen@bpt.test",
      displayName: "Sam Demo",
      uid: "u1",
      role: "teenStudent",
    };
    render(<AccountPage />);
    expect(await screen.findByTestId("member-calendar")).toHaveTextContent("teenStudent:Sam Demo");
  });

  it("has no links to the legacy account pages", () => {
    authState.status = "signed-in";
    authState.session = {
      email: "a@bpt.test",
      displayName: "Alex",
      uid: "u2",
      role: "adultStudent",
    };
    render(<AccountPage />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
