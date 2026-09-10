import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

type SyntheticUser = {
  uid: string;
  email: string;
  displayName: string;
  getIdTokenResult: () => Promise<{ claims: Record<string, unknown> }>;
};

const firebaseBoundary = vi.hoisted(() => {
  let tokenListener: ((user: SyntheticUser | null) => void) | undefined;

  return {
    subscribeToIdTokenChanges: vi.fn((listener: (user: SyntheticUser | null) => void) => {
      tokenListener = listener;
      return vi.fn();
    }),
    signInWithGoogle: vi.fn(),
    signOutFromAuth: vi.fn(),
    refreshAuthToken: vi.fn((user: { getIdTokenResult: () => Promise<unknown> }) =>
      user.getIdTokenResult(),
    ),
    emitUser(user: SyntheticUser | null) {
      tokenListener?.(user);
    },
  };
});

vi.mock("./auth-client", () => firebaseBoundary);

import { AdminAuthProvider, useAdminSession } from "./admin-auth";

function SessionProbe() {
  const { session, signIn, signOut, status } = useAdminSession();

  return (
    <>
      <output data-testid="auth-status">{status}</output>
      <button type="button" onClick={() => void signIn()}>
        Sign in
      </button>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
      {session ? <output data-testid="academy-id">{session.academyId}</output> : null}
      {status === "authorized" ? <div data-testid="admin-content">Admin content</div> : null}
    </>
  );
}

function syntheticUser(role: string): SyntheticUser {
  return {
    uid: "synthetic-owner-uid",
    email: "owner@example.test",
    displayName: "Synthetic Owner",
    getIdTokenResult: async () => ({
      claims: {
        academyId: "academy-synthetic",
        role,
        firebase: { sign_in_second_factor: "totp" },
      },
    }),
  };
}

function renderSessionProbe() {
  return render(
    <AdminAuthProvider>
      <SessionProbe />
    </AdminAuthProvider>,
  );
}

describe("AdminAuthProvider", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not render admin content for a signed-out user", async () => {
    renderSessionProbe();

    firebaseBoundary.emitUser(null);

    await waitFor(() => expect(screen.getByTestId("auth-status")).toHaveTextContent("signed-out"));
    expect(screen.queryByTestId("admin-content")).not.toBeInTheDocument();
  });

  it("authorizes an owner claim with its academy scope", async () => {
    renderSessionProbe();

    firebaseBoundary.emitUser(syntheticUser("owner"));

    await waitFor(() => expect(screen.getByTestId("auth-status")).toHaveTextContent("authorized"));
    expect(screen.getByTestId("admin-content")).toBeVisible();
    expect(screen.getByTestId("academy-id")).toHaveTextContent("academy-synthetic");
  });

  it("authorizes an administrative first factor without TOTP enrollment", async () => {
    renderSessionProbe();

    firebaseBoundary.emitUser(syntheticUser("owner"));

    await waitFor(() => expect(screen.getByTestId("auth-status")).toHaveTextContent("authorized"));
    expect(screen.getByTestId("admin-content")).toBeVisible();
  });

  it("authorizes without a Firebase second-factor claim", async () => {
    const user = syntheticUser("owner");
    user.getIdTokenResult = async () => ({
      claims: { academyId: "academy-synthetic", role: "owner", firebase: {} },
    });
    renderSessionProbe();

    firebaseBoundary.emitUser(user);

    await waitFor(() => expect(screen.getByTestId("auth-status")).toHaveTextContent("authorized"));
    expect(screen.getByTestId("admin-content")).toBeVisible();
  });

  it("denies a non-administrative role", async () => {
    renderSessionProbe();

    firebaseBoundary.emitUser(syntheticUser("coach"));

    await waitFor(() => expect(screen.getByTestId("auth-status")).toHaveTextContent("denied"));
    expect(screen.queryByTestId("admin-content")).not.toBeInTheDocument();
  });

  it("does not apply a stale token result after Firebase reports sign-out", async () => {
    let resolveTokenResult!: (result: { claims: Record<string, unknown> }) => void;
    const tokenResult = new Promise<{ claims: Record<string, unknown> }>((resolve) => {
      resolveTokenResult = resolve;
    });
    const user: SyntheticUser = {
      ...syntheticUser("owner"),
      getIdTokenResult: () => tokenResult,
    };

    renderSessionProbe();
    firebaseBoundary.emitUser(user);
    firebaseBoundary.emitUser(null);

    await waitFor(() => expect(screen.getByTestId("auth-status")).toHaveTextContent("signed-out"));

    await act(async () => {
      resolveTokenResult({ claims: { academyId: "academy-synthetic", role: "owner" } });
      await tokenResult;
    });

    expect(screen.getByTestId("auth-status")).toHaveTextContent("signed-out");
    expect(screen.queryByTestId("admin-content")).not.toBeInTheDocument();
  });

  it("delegates sign-in to the Firebase client boundary", async () => {
    const user = userEvent.setup();
    renderSessionProbe();

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(firebaseBoundary.signInWithGoogle).toHaveBeenCalledOnce();
  });

  it("delegates sign-out to the Firebase client boundary", async () => {
    const user = userEvent.setup();
    renderSessionProbe();

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(firebaseBoundary.signOutFromAuth).toHaveBeenCalledOnce();
  });
});
