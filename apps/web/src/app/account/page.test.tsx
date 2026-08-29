import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  session: undefined as { email: string; displayName: string; uid: string } | undefined,
  status: "signed-out" as "signed-in" | "signed-out",
  signOut: vi.fn(),
}));

vi.mock("./guardian-notices", () => ({
  GuardianNoticesPanel: () => <section aria-label="Family notices" />,
}));
vi.mock("./client-reminders", () => ({
  ClientRemindersPanel: () => <section aria-label="Account reminders" />,
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

import AccountPage from "./page";

describe("account destination", () => {
  afterEach(() => {
    cleanup();
    authState.status = "signed-out";
    authState.session = undefined;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("requires a client session before showing account content", () => {
    render(<AccountPage />);

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?role=client&returnTo=%2Faccount",
    );
    expect(screen.queryByRole("heading", { name: "Your account" })).not.toBeInTheDocument();
  });

  it("shows safe identity fields and logout for a signed-in client", async () => {
    authState.status = "signed-in";
    authState.session = {
      displayName: "Client Name",
      email: "client@example.test",
      uid: "safe-uid",
    };
    const user = userEvent.setup();
    const locationAssign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign: locationAssign });
    render(<AccountPage />);

    expect(screen.getByRole("heading", { name: "Your account" })).toBeVisible();
    expect(screen.getByText("Client Name")).toBeVisible();
    expect(screen.getByText("client@example.test")).toBeVisible();
    expect(screen.getByRole("link", { name: "Review your waiver" })).toHaveAttribute(
      "href",
      "/account/waiver",
    );
    expect(screen.getByRole("link", { name: "Manage class waitlists" })).toHaveAttribute(
      "href",
      "/account/waitlist",
    );
    expect(screen.queryByText(/safe-uid|academy|claim|ip address/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(authState.signOut).toHaveBeenCalledOnce();
    expect(locationAssign).toHaveBeenCalledWith("/login?role=client&returnTo=%2Faccount");
  });
});
