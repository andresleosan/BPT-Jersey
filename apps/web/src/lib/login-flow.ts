export type LoginRole = "administrator" | "client";
export type AuthDestination =
  | "/admin"
  | "/account"
  | "/account/profile"
  | "/account/family"
  | "/account/waiver"
  | "/account/progress"
  | "/shop"
  | "/checkout";

const allowlistedDestinations = new Set<AuthDestination>([
  "/admin",
  "/account",
  "/account/profile",
  "/account/family",
  "/account/waiver",
  "/account/progress",
  "/shop",
  "/checkout",
]);

export function sanitizeReturnPath(value: string | null): AuthDestination | undefined {
  if (!value || !allowlistedDestinations.has(value as AuthDestination)) {
    return undefined;
  }

  return value as AuthDestination;
}

export function defaultDestination(
  role: LoginRole,
  returnPath?: AuthDestination,
): AuthDestination {
  if (role === "administrator") {
    return "/admin";
  }

  return returnPath && returnPath !== "/admin" ? returnPath : "/account";
}

export type ClientSessionRequirement = Readonly<{
  status: "required";
  loginPath: string;
  returnPath: "/account" | "/account/profile" | "/account/family" | "/account/waiver" | "/account/progress" | "/shop" | "/checkout";
}>;

export function requireClientSession(returnTo: string | null = null): ClientSessionRequirement {
  const sanitizedReturnPath = sanitizeReturnPath(returnTo);
  const returnPath =
    sanitizedReturnPath && sanitizedReturnPath !== "/admin" ? sanitizedReturnPath : "/account";

  return {
    status: "required",
    loginPath: `/login?role=client&returnTo=${encodeURIComponent(returnPath)}`,
    returnPath,
  };
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

export function toAuthMessage(error: unknown): string {
  switch (errorCode(error)) {
    case "auth/invalid-credential":
    case "auth/invalid-email":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "We couldn't sign you in. Check your details and try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "The Google sign-in window was closed. Try again or use email and password.";
    case "auth/network-request-failed":
      return "We couldn't connect. Check your connection and try again.";
    case "auth/too-many-requests":
      return "There have been too many attempts. Wait a moment and try again.";
    default:
      return "We couldn't complete sign-in. Please try again.";
  }
}
