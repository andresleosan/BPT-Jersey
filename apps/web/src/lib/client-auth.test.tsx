import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

type SyntheticUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  getIdTokenResult?: (force?: boolean) => Promise<{ claims: Record<string, unknown> }>;
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

const accountBoundary = vi.hoisted(() => ({
  registerShopperAccount: vi.fn(async () => "shopper" as const),
}));

vi.mock("./client-account", () => accountBoundary);

/** A user whose token behaves like Firebase: claims change only after a forced refresh. */
function userWithClaims(
  uid: string,
  initial: Record<string, unknown>,
  afterRefresh: Record<string, unknown> = initial,
): SyntheticUser {
  let claims = initial;
  return {
    uid,
    email: `${uid}@example.test`,
    displayName: "Client Name",
    getIdTokenResult: async (force?: boolean) => {
      if (force === true) claims = afterRefresh;
      return { claims };
    },
  };
}

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
      {session?.role ? <output data-testid="role">{session.role}</output> : null}
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

  it("registers a brand new Google account as a buyer and keeps the session", async () => {
    render(
      <ClientAuthProvider>
        <SessionProbe />
      </ClientAuthProvider>,
    );

    await act(async () => {
      authBoundary.emitUser(userWithClaims("new-visitor", {}, { role: "shopper" }));
    });

    await waitFor(() => expect(screen.getByTestId("auth-status")).toHaveTextContent("signed-in"));
    expect(accountBoundary.registerShopperAccount).toHaveBeenCalledOnce();
    expect(screen.getByTestId("role")).toHaveTextContent("shopper");
  });

  it("stays signed out when the claim never lands, and does not retry in a loop", async () => {
    accountBoundary.registerShopperAccount.mockResolvedValue("shopper");

    render(
      <ClientAuthProvider>
        <SessionProbe />
      </ClientAuthProvider>,
    );

    await act(async () => {
      authBoundary.emitUser(userWithClaims("stuck-visitor", {}));
    });
    await waitFor(() => expect(screen.getByTestId("auth-status")).toHaveTextContent("signed-out"));

    await act(async () => {
      authBoundary.emitUser(userWithClaims("stuck-visitor", {}));
    });

    await waitFor(() => expect(screen.getByTestId("auth-status")).toHaveTextContent("signed-out"));
    expect(accountBoundary.registerShopperAccount).toHaveBeenCalledOnce();
  });

  it("never asks for a role when the academy already granted one", async () => {
    render(
      <ClientAuthProvider>
        <SessionProbe />
      </ClientAuthProvider>,
    );

    await act(async () => {
      authBoundary.emitUser(userWithClaims("student-1", { role: "adultStudent" }));
    });

    await waitFor(() => expect(screen.getByTestId("role")).toHaveTextContent("adultStudent"));
    expect(accountBoundary.registerShopperAccount).not.toHaveBeenCalled();
  });

  it("refuses a session for a role the client surfaces do not know", async () => {
    render(
      <ClientAuthProvider>
        <SessionProbe />
      </ClientAuthProvider>,
    );

    await act(async () => {
      authBoundary.emitUser(userWithClaims("staff-1", { role: "coach" }));
    });

    await waitFor(() => expect(screen.getByTestId("auth-status")).toHaveTextContent("signed-out"));
    expect(accountBoundary.registerShopperAccount).not.toHaveBeenCalled();
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
      "/login?returnTo=%2Fshop",
    );
  });

  it("tells a buyer-only account that the student area is not theirs", async () => {
    render(
      <ClientAuthProvider>
        <ClientAuthGate returnPath="/account">
          <p>Protected account</p>
        </ClientAuthGate>
      </ClientAuthProvider>,
    );

    await act(async () => {
      authBoundary.emitUser(userWithClaims("buyer-1", { role: "shopper" }));
    });

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /for academy students/i })).toBeVisible(),
    );
    expect(screen.queryByText("Protected account")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign in/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /club shop/i })).toHaveAttribute("href", "/shop");
  });

  it("admits a buyer where the surface allows one", async () => {
    render(
      <ClientAuthProvider>
        <ClientAuthGate allow={["guardian", "adultStudent", "shopper"]} returnPath="/shop">
          <p>Protected shop</p>
        </ClientAuthGate>
      </ClientAuthProvider>,
    );

    await act(async () => {
      authBoundary.emitUser(userWithClaims("buyer-2", { role: "shopper" }));
    });

    await waitFor(() => expect(screen.getByText("Protected shop")).toBeVisible());
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
