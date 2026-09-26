export type LoginAudience = "member" | "staff";

export type MemberDestination =
  | "/account"
  | "/account/profile"
  | "/account/guardian-profile"
  | "/account/family"
  | "/account/billing"
  | "/account/membership"
  | "/account/waiver"
  | "/account/progress"
  | "/account/competitors"
  | "/account/settings"
  | "/account/waitlist"
  | "/account/private-lessons"
  | "/shop"
  | "/enrol"
  | "/checkout";

/** The member gates and account pages keep their prop type under the historical name. */
export type AuthDestination = MemberDestination;

/** A staff destination is always an internal path under the two staff surfaces. */
export type StaffDestination = `/admin${string}` | `/coach${string}`;

export const memberLoginPath = "/login";
export const staffLoginPath = "/staff/login";
export const notStaffAccountMessage =
  "This account is not a staff account. Members sign in from the home page.";

const memberDestinations = new Set<MemberDestination>([
  "/account",
  "/account/profile",
  "/account/guardian-profile",
  "/account/family",
  "/account/billing",
  "/account/membership",
  "/account/waiver",
  "/account/progress",
  "/account/competitors",
  "/account/settings",
  "/account/waitlist",
  "/account/private-lessons",
  "/shop",
  "/enrol",
  "/checkout",
]);

// Exact segments only: no query, no hash, no dot segments, no protocol-relative form.
const staffDestinationPattern = /^\/(?:admin|coach)(?:\/[a-z0-9-]+)*$/u;
const coachAdminPrefixes = [
  "/admin/attendance",
  "/admin/classes",
  "/admin/classes-services",
  "/admin/waitlists",
] as const;

// Retired pages whose old links still arrive as return paths, and where they now land.
const retiredMemberDestinations: ReadonlyMap<string, MemberDestination> = new Map([
  ["/account/classes", "/account"],
]);

export function sanitizeReturnPath(value: string | null): MemberDestination | undefined {
  const retired = value ? retiredMemberDestinations.get(value) : undefined;
  if (retired) return retired;
  if (!value || !memberDestinations.has(value as MemberDestination)) {
    return undefined;
  }

  return value as MemberDestination;
}

export function memberDestination(returnPath?: MemberDestination): MemberDestination {
  return returnPath ?? "/account";
}

export function sanitizeStaffReturnPath(value: string | null): StaffDestination | undefined {
  if (!value || value.length > 80 || !staffDestinationPattern.test(value)) {
    return undefined;
  }

  return value as StaffDestination;
}

export type StaffClaims = Readonly<{ role?: unknown; academyId?: unknown }>;

function coachCanReach(path: StaffDestination): boolean {
  return (
    path === "/coach" ||
    path === "/coach/access" ||
    coachAdminPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  );
}

/**
 * Where a staff sign-in lands, decided by the ID token claims and never by the form: office roles
 * run the academy from /admin, coaches work from /coach. Anything else is not a staff account.
 */
export function resolveStaffDestination(
  claims: StaffClaims,
  returnPath?: StaffDestination,
): StaffDestination | undefined {
  const academyId = typeof claims.academyId === "string" ? claims.academyId.trim() : "";
  if (!academyId) {
    return undefined;
  }

  const role = claims.role;
  if (role === "owner" || role === "administrator") {
    return returnPath ?? "/admin";
  }
  if (role === "headCoach" || role === "coach") {
    return returnPath && coachCanReach(returnPath) ? returnPath : "/coach";
  }

  return undefined;
}

export type ClientSessionRequirement = Readonly<{
  status: "required";
  loginPath: string;
  returnPath: MemberDestination;
}>;

export function requireClientSession(returnTo: string | null = null): ClientSessionRequirement {
  const returnPath = sanitizeReturnPath(returnTo) ?? "/account";

  return {
    status: "required",
    loginPath: `${memberLoginPath}?returnTo=${encodeURIComponent(returnPath)}`,
    returnPath,
  };
}

export type StaffSessionRequirement = Readonly<{
  status: "required";
  loginPath: string;
  returnPath: StaffDestination;
}>;

export function requireStaffSession(returnTo: string | null = null): StaffSessionRequirement {
  const returnPath = sanitizeStaffReturnPath(returnTo) ?? "/admin";

  return {
    status: "required",
    loginPath: `${staffLoginPath}?returnTo=${encodeURIComponent(returnPath)}`,
    returnPath,
  };
}

/** Full-page navigation after sign-in, isolated so tests can observe it. */
export function navigateTo(destination: MemberDestination | StaffDestination): void {
  window.location.assign(destination);
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
    case "auth/email-already-in-use":
      return "An account already uses this email. Sign in or reset your password.";
    case "auth/weak-password":
    case "auth/password-does-not-meet-requirements":
      return "Choose a stronger password with at least 6 characters, uppercase and lowercase letters, a number and a symbol.";
    case "auth/invalid-credential":
    case "auth/invalid-email":
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "functions/unauthenticated":
      return "We couldn't sign you in. Check your details and try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "The Google sign-in window was closed. Try again or use email and password.";
    case "auth/network-request-failed":
      return "We couldn't connect. Check your connection and try again.";
    case "auth/too-many-requests":
    case "functions/resource-exhausted":
      return "There have been too many attempts. Wait a moment and try again.";
    default:
      return "We couldn't complete sign-in. Please try again.";
  }
}
