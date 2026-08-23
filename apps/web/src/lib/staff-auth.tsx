"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";

import { signOutFromAuth, subscribeToIdTokenChanges } from "./auth-client";

export type StaffRole = "headCoach" | "coach";

export type StaffSession = Readonly<{
  uid: string;
  email: string;
  displayName: string;
  academyId: string;
  role: StaffRole;
}>;

export type StaffAuthStatus = "loading" | "signed-out" | "signed-in";

type StaffSessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; session: StaffSession };

type StaffSessionContextValue = Readonly<{
  status: StaffAuthStatus;
  session?: StaffSession | undefined;
  signOut: () => Promise<void>;
}>;

const StaffSessionContext = createContext<StaffSessionContextValue | undefined>(undefined);

export function StaffAuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [state, setState] = useState<StaffSessionState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    const handleUser = async (user: User | null) => {
      if (!user) {
        if (active) setState({ status: "signed-out" });
        return;
      }

      try {
        const tokenResult = await user.getIdTokenResult();
        const claims = tokenResult.claims;
        const academyId = typeof claims["academyId"] === "string" ? claims["academyId"].trim() : "";
        const role = claims["role"];

        if (academyId && (role === "headCoach" || role === "coach")) {
          const session: StaffSession = Object.freeze({
            uid: user.uid,
            email: user.email ?? "",
            displayName: user.displayName ?? "",
            academyId,
            role: role as StaffRole,
          });
          if (active) setState({ status: "signed-in", session });
        } else {
          if (active) setState({ status: "signed-out" });
        }
      } catch {
        if (active) setState({ status: "signed-out" });
      }
    };

    try {
      unsubscribe = subscribeToIdTokenChanges((user) => {
        void handleUser(user);
      });
    } catch {
      setState({ status: "signed-out" });
    }

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  async function signOut(): Promise<void> {
    await signOutFromAuth();
    setState({ status: "signed-out" });
  }

  return (
    <StaffSessionContext.Provider
      value={{
        status: state.status,
        session: state.status === "signed-in" ? state.session : undefined,
        signOut,
      }}
    >
      {children}
    </StaffSessionContext.Provider>
  );
}

export function useStaffSession(): StaffSessionContextValue {
  const context = useContext(StaffSessionContext);
  if (!context) {
    throw new Error("useStaffSession must be used within StaffAuthProvider");
  }
  return context;
}

export function StaffAuthGate({
  children,
  returnPath = "/coach/levels",
}: Readonly<{
  children: ReactNode;
  returnPath?: string;
}>) {
  const { status, session } = useStaffSession();

  if (status === "loading") {
    return (
      <main className="loading-state" role="status" aria-label="Checking staff session">
        <p>Loading staff session...</p>
      </main>
    );
  }

  if (status === "signed-out" || !session) {
    return (
      <main className="auth-required" role="alert">
        <h2>Staff Access Required</h2>
        <p>You must be signed in as a coach to access this area.</p>
        <a className="button button-primary" href={`/login?role=administrator&returnPath=${encodeURIComponent(returnPath)}`}>
          Sign in
        </a>
      </main>
    );
  }

  return <>{children}</>;
}
