export type MfaStatus =
  | "not-required"
  | "enrollment-required"
  | "challenge-required"
  | "verified";

export function isValidTotpCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

export function isMfaRequiredError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "auth/multi-factor-auth-required"
  );
}

export function toMfaMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;

  if (code === "auth/invalid-verification-code" || code === "auth/invalid-verification-id") {
    return "We couldn't verify that code. Check your authenticator and try again.";
  }

  if (code === "auth/network-request-failed") {
    return "We couldn't reach Firebase. Check your connection and try again.";
  }

  if (code === "auth/cancelled-popup-request" || code === "auth/popup-closed-by-user") {
    return "The MFA step was cancelled. You can try again.";
  }

  return "We couldn't complete MFA. Check your authenticator and try again.";
}
