"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "firebase/auth";

import {
  signOutFromAuth,
  subscribeToIdTokenChanges,
} from "./auth-client";
import { registerShopperAccount, type ClientAccountRole } from "./client-account";
import { requireClientSession } from "./login-flow";
import type { AuthDestination } from "./login-flow";

/** Roles that belong to somebody with a student record. A `shopper` is a buyer and has none. */
export const studentClientRoles: readonly ClientAccountRole[] = ["guardian", "adultStudent"];

export type ClientSession = Readonly<{
  uid: string;
  email: string;
  displayName: string;
  role?: ClientAccountRole;
}>;

export type ClientAuthStatus = "loading" | "signed-out" | "signed-in";

type ClientSessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; session: ClientSession };

type ClientSessionContextValue = Readonly<{
  status: ClientAuthStatus;
  session?: ClientSession;
  signOut: () => Promise<void>;
}>;

const ClientSessionContext = createContext<ClientSessionContextValue | undefined>(undefined);

function clientRole(value: unknown): ClientAccountRole | undefined {
  return value === "guardian" || value === "adultStudent" || value === "shopper"
    ? value
    : undefined;
}

// One attempt per account per page: if registration fails the visitor stays signed out rather than
// driving a refresh loop against a backend that is already refusing.
const registrationAttempts = new Set<string>();

async function claimedRole(
  user: User,
  tokenReader: (...args: readonly unknown[]) => unknown,
  claims: Readonly<Record<string, unknown>> | undefined,
): Promise<ClientAccountRole | undefined> {
  const existing = clientRole(claims?.role);
  if (existing) return existing;
  // Nothing at all in the token: this is a brand new sign-in that nobody has given a role to.
  if (claims?.role !== undefined || registrationAttempts.has(user.uid)) return undefined;
  registrationAttempts.add(user.uid);
  const granted = await registerShopperAccount();
  if (!granted) return undefined;
  try {
    const refreshed = (await tokenReader.call(user, true)) as Readonly<{
      claims?: Readonly<Record<string, unknown>>;
    }>;
    // The token is the only authority: a claim that did not land is not a session.
    return clientRole(refreshed.claims?.role);
  } catch {
    return undefined;
  }
}

async function sessionFromUser(user: User): Promise<ClientSession | undefined> {
  const uid = user.uid.trim();
  const email = user.email?.trim() ?? "";

  if (!uid || !email) {
    return undefined;
  }

  const baseSession = {
    uid,
    email,
    displayName: user.displayName?.trim() ?? "",
  };
  const tokenReader = Reflect.get(user, "getIdTokenResult");
  if (typeof tokenReader !== "function") {
    return Object.freeze(baseSession);
  }
  try {
    const token = (await tokenReader.call(user)) as Readonly<{
      claims?: Readonly<Record<string, unknown>>;
    }>;
    const role = await claimedRole(user, tokenReader as (...args: readonly unknown[]) => unknown, token.claims);
    if (!role) return undefined;
    return Object.freeze({ ...baseSession, role });
  } catch {
    return undefined;
  }
}

export function ClientAuthProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [state, setState] = useState<ClientSessionState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    let eventVersion = 0;
    let unsubscribe: (() => void) | undefined;

    const handleUser = async (user: User | null) => {
      const currentVersion = ++eventVersion;
      const session = user ? await sessionFromUser(user) : undefined;

      if (!active || currentVersion !== eventVersion) {
        return;
      }

      setState(session ? { status: "signed-in", session } : { status: "signed-out" });
    };

    try {
      unsubscribe = subscribeToIdTokenChanges((user) => {
        void handleUser(user);
      });
    } catch {
      queueMicrotask(() => {
        if (active) {
          setState({ status: "signed-out" });
        }
      });
    }

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const value: ClientSessionContextValue =
    state.status === "signed-in"
      ? { status: state.status, session: state.session, signOut: signOutFromAuth }
      : { status: state.status, signOut: signOutFromAuth };

  return <ClientSessionContext.Provider value={value}>{children}</ClientSessionContext.Provider>;
}

export function useClientSession(): ClientSessionContextValue {
  const context = useContext(ClientSessionContext);

  if (!context) {
    throw new Error("useClientSession must be used within ClientAuthProvider.");
  }

  return context;
}

/**
 * Gates a member surface. `allow` defaults to the student roles, so a buyer-only account gets told
 * plainly that this area belongs to students instead of being shown a sign-in form it has already
 * completed. This is presentation: every callable behind it enforces the same roles on its own.
 */
export function ClientAuthGate({
  children,
  returnPath,
  allow = studentClientRoles,
}: Readonly<{
  children: React.ReactNode;
  returnPath: AuthDestination;
  allow?: readonly ClientAccountRole[];
}>) {
  const { status, session } = useClientSession();

  if (status === "loading") {
    return <div className="client-auth-loading" aria-busy="true" />;
  }

  if (status === "signed-in") {
    const role = session?.role;
    if (role === undefined || allow.includes(role)) {
      return children;
    }

    return (
      <main className="client-auth-state" aria-labelledby="client-auth-state-title">
        <p className="account-eyebrow">BPT Jersey / Client</p>
        <h1 id="client-auth-state-title">This area is for academy students</h1>
        <p>
          Your account can buy from the club shop. Classes, progress and billing open once the
          academy registers you as a student.
        </p>
        <a className="button button-primary" href="/shop">
          Go to the club shop
        </a>
      </main>
    );
  }

  const requirement = requireClientSession(returnPath);

  return (
    <main className="client-auth-state" aria-labelledby="client-auth-state-title">
      <p className="account-eyebrow">BPT Jersey / Client</p>
      <h1 id="client-auth-state-title">Sign in to continue</h1>
      <p>Your client account is required to access this area.</p>
      <a className="button button-primary" href={requirement.loginPath}>
        Sign in
      </a>
    </main>
  );
}
