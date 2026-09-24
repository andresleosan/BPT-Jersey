import { EmailAuthProvider, reauthenticateWithCredential, updatePassword, verifyBeforeUpdateEmail } from "firebase/auth";
import { z } from "zod";

import { emergencyContactSchema, type EmergencyContact } from "@bpt-jersey/domain/members/directory";
import {
  ownEmergencyContactInputSchema,
  teenAccessInputSchema,
  uploadProfilePhotoInputSchema,
} from "@bpt-jersey/domain/members/engagement";

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

/* ---------- Settings: photo, visibility and teen own access (T044V2, plan task 3.4) ---------- */

/** The callable is not deployed (or not reachable here): the section that needs it hides itself. */
export class AccountSettingsUnavailableError extends Error {}

export const settingsMessages = Object.freeze({
  load: "We couldn't load your settings right now. Try again.",
  photoType: "Choose a JPEG, PNG or WebP photo.",
  photoTooLarge: "Choose a photo under 25 MB.",
  photoRejected: "Choose a single JPEG, PNG or WebP image under 2 MB.",
  photoFailed: "We couldn't save the photo. Try again.",
  removeFailed: "We couldn't remove the photo. Try again.",
  approveFailed: "We couldn't approve the photo. Try again.",
  visibilityFailed: "We couldn't change your visibility. Try again.",
  teenPassword: "Choose a password of at least 10 characters.",
  teenPasswordLong: "Choose a password of 128 characters or fewer.",
  teenEmail: "Enter a valid email address.",
  createFailed: "Own access could not be set up. Try again.",
  revokeFailed: "Own access could not be removed. Try again.",
});

/** Server messages that are fixed UK-English copy and safe to show as they are; anything else is replaced. */
const knownServerMessages = new Set([
  "Own access is available from 12 to 17.",
  "We couldn't create access with that email. Try a different one.",
  "This member already has their own access.",
  "Add a phone number to your profile first.",
  "Choose a password of at least 10 characters.",
  "This account now belongs to the member.",
  "This member has no own access to remove.",
  "There is no proposed photo to approve.",
  "Ask your guardian to change this.",
  settingsMessages.photoRejected,
]);

async function call<T>(name: string, data: unknown, schema: z.ZodType<T>, error: string): Promise<T> {
  try {
    const response = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), name)(data);
    const parsed = schema.safeParse(response.data);
    if (parsed.success) return parsed.data;
  } catch (cause) {
    const code = authCode(cause);
    if (code.endsWith("not-found") && name === "getMySettings") throw new AccountSettingsUnavailableError(error);
    if (code.endsWith("unimplemented")) throw new AccountSettingsUnavailableError(error);
    const message = cause instanceof Error ? cause.message : "";
    if (knownServerMessages.has(message)) throw new Error(message);
    /* fixed message below */
  }
  throw new Error(error);
}

const signedUrl = z.url({ protocol: /^https?$/u }).nullable();
const mySettingsSchema = z.object({
  photoUrl: signedUrl,
  pendingPhotoUrl: signedUrl,
  showToMembers: z.boolean(),
  canManage: z.boolean(),
  teenAccess: z.object({ email: z.string(), active: z.boolean() }).nullable(),
});
export type MySettings = z.infer<typeof mySettingsSchema>;
const empty = z.object({});

export const getMySettings = (studentId: string) =>
  call("getMySettings", { studentId }, mySettingsSchema, settingsMessages.load);

export function uploadProfilePhoto(input: Readonly<{ studentId: string; base64: string; mime: "image/jpeg" | "image/png" | "image/webp" }>) {
  const parsed = uploadProfilePhotoInputSchema.safeParse({ ...input, consent: true });
  if (!parsed.success) return Promise.reject(new Error(settingsMessages.photoRejected));
  return call("uploadProfilePhoto", parsed.data, z.object({ photoUrl: signedUrl, pending: z.boolean() }), settingsMessages.photoFailed);
}

export const removeProfilePhoto = (studentId: string) =>
  call("removeProfilePhoto", { studentId }, empty, settingsMessages.removeFailed).then(() => undefined);

export const approveProposedPhoto = (studentId: string) =>
  call("approveProposedPhoto", { studentId }, z.object({ photoUrl: signedUrl }), settingsMessages.approveFailed);

export const setMemberVisibility = (studentId: string, showToMembers: boolean) =>
  call("setMemberVisibility", { studentId, showToMembers }, empty, settingsMessages.visibilityFailed).then(() => undefined);

export function createTeenAccess(input: Readonly<{ studentId: string; email: string; password: string }>) {
  if (input.password.length < 10) return Promise.reject(new Error(settingsMessages.teenPassword));
  if (input.password.length > 128) return Promise.reject(new Error(settingsMessages.teenPasswordLong));
  const parsed = teenAccessInputSchema.safeParse({ ...input, email: input.email.trim() });
  if (!parsed.success) return Promise.reject(new Error(settingsMessages.teenEmail));
  return call("createTeenAccess", parsed.data, z.object({ email: z.string() }), settingsMessages.createFailed);
}

export const revokeTeenAccess = (studentId: string) =>
  call("revokeTeenAccess", { studentId }, empty, settingsMessages.revokeFailed).then(() => undefined);

/* ---------- Settings: email, password and emergency contact (25 September batch, lane C) ---------- */

export const accountMessages = Object.freeze({
  invalidEmail: "Enter a valid email address.",
  sameEmail: "That is already your email address.",
  currentPassword: "Enter your current password.",
  shortPassword: "Choose a new password of at least 12 characters.",
  longPassword: "Choose a new password of 128 characters or fewer.",
  passwordMismatch: "The new passwords do not match.",
  samePassword: "Choose a new password that is different from the current one.",
  wrongPassword: "That password is not right.",
  tooMany: "Too many attempts. Wait a few minutes and try again.",
  emailInUse: "That email is already used by another account.",
  recentLogin: "Please sign in again, then retry.",
  failed: "We couldn't update your account. Try again later.",
  contactLoad: "We couldn't load the emergency contact. Try again.",
  contactFailed: "We couldn't save the emergency contact. Try again.",
});

export type AccountResult<T extends object = object> = ({ ok: true } & T) | { ok: false; message: string };

function accountErrorMessage(cause: unknown): string {
  switch (authCode(cause)) {
    case "auth/wrong-password":
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
      return accountMessages.wrongPassword;
    case "auth/too-many-requests":
      return accountMessages.tooMany;
    case "auth/email-already-in-use":
      return accountMessages.emailInUse;
    case "auth/requires-recent-login":
      return accountMessages.recentLogin;
    case "auth/invalid-email":
      return accountMessages.invalidEmail;
    default:
      return accountMessages.failed;
  }
}

const emailChangeSchema = z.object({
  newEmail: z.string().trim().toLowerCase().pipe(z.email(accountMessages.invalidEmail).max(254, accountMessages.invalidEmail)),
  currentPassword: z.string().min(1, accountMessages.currentPassword),
});
const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, accountMessages.currentPassword),
    newPassword: z.string().min(12, accountMessages.shortPassword).max(128, accountMessages.longPassword),
    confirmPassword: z.string(),
  })
  .refine((input) => input.newPassword === input.confirmPassword, { message: accountMessages.passwordMismatch })
  .refine((input) => input.newPassword !== input.currentPassword, { message: accountMessages.samePassword });

const firstMessage = (error: z.ZodError) => error.issues[0]?.message ?? accountMessages.failed;

/** Re-authenticates, then asks Firebase to send a link: the email only changes once the link is opened. */
export async function requestEmailChange(
  input: Readonly<{ currentPassword: string; newEmail: string }>,
): Promise<AccountResult<{ sentTo: string }>> {
  const parsed = emailChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstMessage(parsed.error) };
  const { newEmail, currentPassword } = parsed.data;
  const user = getFirebaseAuth().currentUser;
  if (!user?.email) return { ok: false, message: accountMessages.recentLogin };
  if (user.email.toLowerCase() === newEmail) return { ok: false, message: accountMessages.sameEmail };
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
    await verifyBeforeUpdateEmail(user, newEmail);
    return { ok: true, sentTo: newEmail };
  } catch (cause) {
    return { ok: false, message: accountErrorMessage(cause) };
  }
}

/** Same sequence as the adult hand-over: re-authenticate, update, then sign in again with the new password. */
export async function changePassword(
  input: Readonly<{ currentPassword: string; newPassword: string; confirmPassword: string }>,
): Promise<AccountResult> {
  const parsed = passwordChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstMessage(parsed.error) };
  const user = getFirebaseAuth().currentUser;
  if (!user?.email) return { ok: false, message: accountMessages.recentLogin };
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, input.currentPassword));
    await updatePassword(user, input.newPassword);
  } catch (cause) {
    return { ok: false, message: accountErrorMessage(cause) };
  }
  try {
    // The change ends older sessions; a fresh sign-in keeps this one accepted by the member door.
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, input.newPassword));
  } catch {
    /* The password is already changed; the next sign-in uses it. */
  }
  return { ok: true };
}

/** Copies a verified sign-in email to the profile. Silent: nothing to show when it fails or nothing changed. */
export async function syncOwnAccountEmail(): Promise<void> {
  try {
    await httpsCallable<unknown, unknown>(getFirebaseFunctions(), "syncOwnAccountEmail")({});
  } catch {
    /* retried on the next visit */
  }
}

const ownContactSchema = z.object({ contact: emergencyContactSchema.nullable() });

export async function getOwnEmergencyContact(studentId: string): Promise<EmergencyContact | null> {
  return (await call("getOwnEmergencyContact", { studentId }, ownContactSchema, accountMessages.contactLoad)).contact;
}

export async function saveOwnEmergencyContact(studentId: string, contact: EmergencyContact): Promise<AccountResult> {
  const parsed = ownEmergencyContactInputSchema.safeParse({ studentId, contact, requestId: globalThis.crypto.randomUUID() });
  if (!parsed.success) return { ok: false, message: accountMessages.contactFailed };
  try {
    await call("saveOwnEmergencyContact", parsed.data, z.object({ saved: z.literal(true) }), accountMessages.contactFailed);
    return { ok: true };
  } catch {
    return { ok: false, message: accountMessages.contactFailed };
  }
}
