"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "firebase/auth";

import { parseAdminClaims, type AdminRole } from "@bpt-jersey/domain";

import {
  signInWithGoogle,
  signOutFromAuth,
  subscribeToIdTokenChanges,
  refreshAuthToken,
} from "./auth-client";

export type AdminSession = Readonly<{
  uid: string;
  email: string;
  displayName: string;
  academyId: string;
  role: AdminRole;
}>;

export type AdminSessionStatus =
  | "loading"
  | "signed-out"
  | "authorized"
  | "denied";

type AdminSessionContextValue = {
  status: AdminSessionStatus;
  session?: AdminSession;
  user?: User;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

type AdminSessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "denied" }
  | { status: "authorized"; session: AdminSession; user: User };

const AdminSessionContext = createContext<AdminSessionContextValue | undefined>(undefined);

async function sessionFromUser(user: User): Promise<AdminSessionState> {
  try {
    const tokenResult = await refreshAuthToken(user);
    const claims = parseAdminClaims({
      academyId: tokenResult.claims.academyId,
      role: tokenResult.claims.role,
    });

    if (!claims.ok || user.uid.trim().length === 0 || !user.email?.trim()) {
      return { status: "denied" };
    }

    return {
      status: "authorized",
      user,
      session: Object.freeze({
        uid: user.uid,
        email: user.email.trim(),
        displayName: user.displayName?.trim() ?? "",
        academyId: claims.value.academyId,
        role: claims.value.role,
      }),
    };
  } catch {
    return { status: "denied" };
  }
}

export function AdminAuthProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [state, setState] = useState<AdminSessionState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    let eventVersion = 0;
    let unsubscribe: (() => void) | undefined;

    const handleUser = async (user: User | null) => {
      const currentVersion = ++eventVersion;
      const nextState = user ? await sessionFromUser(user) : { status: "signed-out" as const };

      if (active && currentVersion === eventVersion) {
        setState(nextState);
      }
    };

    try {
      unsubscribe = subscribeToIdTokenChanges((user) => {
        void handleUser(user);
      });
    } catch {
      queueMicrotask(() => {
        if (active) {
          setState({ status: "denied" });
        }
      });
    }

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const value: AdminSessionContextValue = {
    ...state,
    signIn: async () => {
      await signInWithGoogle();
    },
    signOut: async () => {
      await signOutFromAuth();
    },
    refreshSession: async () => {
      if (!("user" in state)) {
        return;
      }

      setState(await sessionFromUser(state.user));
    },
  };

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession(): AdminSessionContextValue {
  const context = useContext(AdminSessionContext);

  if (!context) {
    throw new Error("useAdminSession must be used within AdminAuthProvider.");
  }

  return context;
}
