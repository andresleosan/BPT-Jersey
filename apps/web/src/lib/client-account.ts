import { httpsCallable } from "firebase/functions";

import { getFirebaseFunctions } from "./firebase-client";

/**
 * Self-service client registration. Signing in with Google leaves an account with no role claim,
 * and every callable needs one, so without this a new visitor would stay locked out for ever. The
 * backend decides what to grant: a buyer-only `shopper` when the account has no role, and the role
 * the academy already granted otherwise. Nothing here can ask for a particular role.
 */
export type ClientAccountRole = "guardian" | "adultStudent" | "shopper";

const clientRoles: readonly string[] = ["guardian", "adultStudent", "shopper"];

export async function registerShopperAccount(): Promise<ClientAccountRole | undefined> {
  try {
    const callable = httpsCallable<null, unknown>(
      getFirebaseFunctions(),
      "registerShopperAccount",
    );
    const result = (await callable(null)).data;
    if (typeof result !== "object" || result === null) return undefined;
    const role = (result as { role?: unknown }).role;
    return typeof role === "string" && clientRoles.includes(role)
      ? (role as ClientAccountRole)
      : undefined;
  } catch {
    return undefined;
  }
}
