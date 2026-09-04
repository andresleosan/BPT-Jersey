"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "firebase/auth";

import {
  signOutFromAuth,
  subscribeToIdTokenChanges,
} from "./auth-client";
import { requireClientSession } from "./login-flow";
import type { AuthDestination } from "./login-flow";

export type ClientSession = Readonly<{
  uid: string;
  email: string;
  displayName: string;
  role?: "guardian" | "adultStudent";
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
    const role = token.claims?.role;
    if (role !== "guardian" && role !== "adultStudent") return undefined;
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

export function ClientAuthGate({
  children,
  returnPath,
}: Readonly<{ children: React.ReactNode; returnPath: AuthDestination }>) {
  const { status } = useClientSession();

  if (status === "loading") {
    return <div className="client-auth-loading" aria-busy="true" />;
  }

  if (status === "signed-in") {
    return children;
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
