"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { IdTokenResult, User } from "firebase/auth";

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

// Forcing a refresh on every token event looped: each forced refresh issues a new token, which
// fires onIdTokenChanged again (2-10 refreshes before the first call, measured 2026-10-01). The
// cached token is read instead and refreshed once per account and page when it is older than five
// minutes or lacks admin claims: a role granted, a demotion or a disabled account still shows at
// the next reload, and the fresh token the refresh issues ends the round.
const forcedTokenRefreshes = new Set<string>();
const maxCachedTokenAgeMs = 5 * 60_000;

function adminClaimsOf(tokenResult: IdTokenResult) {
  return parseAdminClaims({
    academyId: tokenResult.claims.academyId,
    role: tokenResult.claims.role,
  });
}

async function sessionFromUser(user: User, forceRefresh = false): Promise<AdminSessionState> {
  try {
    const token = forceRefresh ? await refreshAuthToken(user) : await user.getIdTokenResult();
    let claims = adminClaimsOf(token);
    const old = Date.now() - Date.parse(token.issuedAtTime) > maxCachedTokenAgeMs;
    if ((old || !claims.ok) && !forceRefresh && !forcedTokenRefreshes.has(user.uid)) {
      forcedTokenRefreshes.add(user.uid);
      try {
        claims = adminClaimsOf(await refreshAuthToken(user));
      } catch (error) {
        forcedTokenRefreshes.delete(user.uid); // a network failure may be retried
        throw error;
      }
    }

    if (!claims.ok || user.uid.trim().length === 0) {
      return { status: "denied" };
    }

    return {
      status: "authorized",
      user,
      session: Object.freeze({
        uid: user.uid,
        email: user.email?.trim() ?? "",
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

      setState(await sessionFromUser(state.user, true));
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
