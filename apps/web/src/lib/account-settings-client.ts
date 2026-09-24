import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { z } from "zod";

import { httpsCallable } from "./callable";
import { getFirebaseAuth, getFirebaseFunctions } from "./firebase-client";

const adultClaimStatusSchema = z.object({ required: z.boolean(), studentId: z.string().nullable() });
export type AdultClaimStatus = z.infer<typeof adultClaimStatusSchema>;

/** Any failure (network, not deployed, not found) means "nothing to claim": the block hides itself. */
export async function getAdultClaimStatus(): Promise<AdultClaimStatus> {
  try {
    const response = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), "getAdultClaimStatus")({});
    const parsed = adultClaimStatusSchema.safeParse(response.data);
    if (parsed.success) return parsed.data;
  } catch {
    /* hidden below */
  }
  return { required: false, studentId: null };
}

export const adultClaimMessages = Object.freeze({
  shortPassword: "Choose a new password of at least 10 characters.",
  samePassword: "Choose a new password that is different from the current one.",
  wrongPassword: "That current password is not right. Try again.",
  failed: "We couldn't hand the account over. Try again.",
});

function authCode(cause: unknown): string {
  return typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : "";
}

/**
 * Q4 hand-over at 18: re-authenticate (the server wants a sign-in from the last five minutes), set the
 * new password, then record the claim. Throws only the fixed messages above.
 */
export async function claimAdultAccount(input: Readonly<{ studentId: string; currentPassword: string; newPassword: string }>): Promise<void> {
  if (input.newPassword.length < 10) throw new Error(adultClaimMessages.shortPassword);
  if (input.newPassword === input.currentPassword) throw new Error(adultClaimMessages.samePassword);
  const user = getFirebaseAuth().currentUser;
  if (!user?.email) throw new Error(adultClaimMessages.failed);
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, input.currentPassword));
  } catch (cause) {
    const code = authCode(cause);
    if (code === "auth/wrong-password" || code === "auth/invalid-credential" || code === "auth/invalid-login-credentials") {
      throw new Error(adultClaimMessages.wrongPassword);
    }
    throw new Error(adultClaimMessages.failed);
  }
  try {
    await updatePassword(user, input.newPassword);
  } catch (cause) {
    throw new Error(authCode(cause) === "auth/weak-password" ? adultClaimMessages.shortPassword : adultClaimMessages.failed);
  }
  try {
    // The password change ends older sessions; sign in again with the new one so the claim carries a
    // sign-in time the member door (tokensValidAfterTime) and the five-minute window both accept.
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, input.newPassword));
    await httpsCallable<unknown, unknown>(getFirebaseFunctions(), "claimAdultAccount")({ studentId: input.studentId });
  } catch {
    throw new Error(adultClaimMessages.failed);
  }
}
