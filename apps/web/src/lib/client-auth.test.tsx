import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

type SyntheticUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
};

const authBoundary = vi.hoisted(() => {
  let tokenListener: ((user: SyntheticUser | null) => void) | undefined;

  return {
    signOutFromAuth: vi.fn().mockResolvedValue(undefined),
    subscribeToIdTokenChanges: vi.fn((listener: (user: SyntheticUser | null) => void) => {
      tokenListener = listener;
      return vi.fn();
    }),
    emitUser(user: SyntheticUser | null) {
      tokenListener?.(user);
    },
  };
});

vi.mock("./auth-client", () => authBoundary);

import {
  ClientAuthGate,
  ClientAuthProvider,
  useClientSession,
} from "./client-auth";

function SessionProbe() {
  const { session, signOut, status } = useClientSession();

  return (
    <>
      <output data-testid="auth-status">{status}</output>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
      {session ? <output data-testid="email">{session.email}</output> : null}
      {status === "signed-in" ? <div data-testid="client-content">Client content</div> : null}
    </>
  );
}

function syntheticUser(overrides: Partial<SyntheticUser> = {}): SyntheticUser {
  return {
    uid: "client-uid",
    email: "client@example.test",
    displayName: "Client Name",
    ...overrides,
  };
}

describe("ClientAuthProvider", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("starts loading and becomes signed out when Firebase reports no user", async () => {
    render(
      <ClientAuthProvider>
        <SessionProbe />
      </ClientAuthProvider>,
    );

    expect(screen.getByTestId("auth-status")).toHaveTextContent("loading");
    authBoundary.emitUser(null);

    await waitFor(() => expect(screen.getByTestId("auth-status")).toHaveTextContent("signed-out"));
    expect(screen.queryByTestId("client-content")).not.toBeInTheDocument();
  });

  it("exposes only safe identity fields for a signed-in user", async () => {
    render(
      <ClientAuthProvider>
        <SessionProbe />
      </ClientAuthProvider>,
    );

    authBoundary.emitUser(syntheticUser());

    await waitFor(() => expect(screen.getByTestId("auth-status")).toHaveTextContent("signed-in"));
    expect(screen.getByTestId("email")).toHaveTextContent("client@example.test");
    expect(screen.getByTestId("client-content")).toBeVisible();
  });

  it("treats a user without an email as signed out", async () => {
    render(
      <ClientAuthProvider>
        <SessionProbe />
      </ClientAuthProvider>,
    );

    authBoundary.emitUser(syntheticUser({ email: null }));

    await waitFor(() => expect(screen.getByTestId("auth-status")).toHaveTextContent("signed-out"));
    expect(screen.queryByTestId("email")).not.toBeInTheDocument();
  });

  it("does not apply a stale user event after sign-out", async () => {
    render(
      <ClientAuthProvider>
        <SessionProbe />
      </ClientAuthProvider>,
    );

    authBoundary.emitUser(syntheticUser());
    authBoundary.emitUser(null);

    await waitFor(() => expect(screen.getByTestId("auth-status")).toHaveTextContent("signed-out"));
    expect(screen.queryByTestId("client-content")).not.toBeInTheDocument();
  });

  it("delegates sign-out to the shared auth boundary", async () => {
    const user = userEvent.setup();
    render(
      <ClientAuthProvider>
        <SessionProbe />
      </ClientAuthProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(authBoundary.signOutFromAuth).toHaveBeenCalledOnce();
  });

  it("fails closed when the auth subscription cannot be created", async () => {
    authBoundary.subscribeToIdTokenChanges.mockImplementationOnce(() => {
      throw new Error("not available");
    });

    render(
      <ClientAuthProvider>
        <SessionProbe />
      </ClientAuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("auth-status")).toHaveTextContent("signed-out"));
  });
});

describe("ClientAuthGate", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("links signed-out users to the client login context", async () => {
    render(
      <ClientAuthProvider>
        <ClientAuthGate returnPath="/shop">
          <p>Protected shop</p>
        </ClientAuthGate>
      </ClientAuthProvider>,
    );

    authBoundary.emitUser(null);

    await waitFor(() => expect(screen.getByRole("link", { name: /sign in/i })).toBeVisible());
    expect(screen.queryByText("Protected shop")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/login?role=client&returnTo=%2Fshop",
    );
  });

  it("renders protected children for a signed-in user", async () => {
    render(
      <ClientAuthProvider>
        <ClientAuthGate returnPath="/account">
          <p>Protected account</p>
        </ClientAuthGate>
      </ClientAuthProvider>,
    );

    await act(async () => {
      authBoundary.emitUser(syntheticUser());
    });

    await waitFor(() => expect(screen.getByText("Protected account")).toBeVisible());
  });
});
