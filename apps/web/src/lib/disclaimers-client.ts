import { httpsCallable } from "firebase/functions";

import {
  disclaimerAudiences,
  disclaimerStatuses,
  type Disclaimer,
  type DisclaimerAcceptance,
  type DisclaimerAcceptanceInput,
  type DisclaimerPublicationInput,
  type OutstandingDisclaimer,
} from "@bpt-jersey/domain/consents/disclaimers";

import { getFirebaseFunctions } from "./firebase-client";

/**
 * T117: disclaimers for office and for the participant.
 *
 * The acceptance call carries the hash of the text that was actually rendered, so if office
 * republishes between the page loading and the participant pressing accept, the backend refuses
 * rather than recording consent to wording nobody saw. That refusal arrives as `aborted` and gets
 * its own message: the participant is asked to read again, not told something went wrong.
 */
const safeOutstandingError = "Unable to load your disclaimers. Please try again.";
const safeAcceptError = "Unable to record that acceptance. Please try again.";
const safeWithdrawError = "Unable to withdraw that acceptance. Please try again.";
const safeAdminError = "Unable to load disclaimers. Please try again.";
const safePublishError = "Unable to publish that disclaimer. Please try again.";
export const disclaimerChangedError =
  "This disclaimer was updated while you were reading it. Please read the new version.";

export type DisclaimerAdoption = Readonly<{ disclaimer: Disclaimer; acceptedCount: number }>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOutstanding(value: unknown): value is OutstandingDisclaimer {
  if (!isPlainRecord(value) || typeof value.studentId !== "string") return false;
  const disclaimer = value.disclaimer;
  return (
    isPlainRecord(disclaimer) &&
    typeof disclaimer.disclaimerId === "string" &&
    typeof disclaimer.key === "string" &&
    typeof disclaimer.versionLabel === "string" &&
    typeof disclaimer.title === "string" &&
    typeof disclaimer.body === "string" &&
    typeof disclaimer.required === "boolean" &&
    typeof disclaimer.contentHash === "string" &&
    typeof disclaimer.effectiveAt === "string" &&
    (value.previouslyAcceptedVersionLabel === null ||
      typeof value.previouslyAcceptedVersionLabel === "string")
  );
}

function isAdoption(value: unknown): value is DisclaimerAdoption {
  if (!isPlainRecord(value) || !Number.isSafeInteger(value.acceptedCount)) return false;
  const disclaimer = value.disclaimer;
  return (
    isPlainRecord(disclaimer) &&
    typeof disclaimer.disclaimerId === "string" &&
    typeof disclaimer.key === "string" &&
    typeof disclaimer.versionLabel === "string" &&
    typeof disclaimer.title === "string" &&
    typeof disclaimer.required === "boolean" &&
    typeof disclaimer.audience === "string" &&
    disclaimerAudiences.includes(disclaimer.audience as (typeof disclaimerAudiences)[number]) &&
    typeof disclaimer.status === "string" &&
    disclaimerStatuses.includes(disclaimer.status as (typeof disclaimerStatuses)[number])
  );
}

function isAcceptance(value: unknown): value is DisclaimerAcceptance {
  return (
    isPlainRecord(value) &&
    typeof value.acceptanceId === "string" &&
    typeof value.disclaimerId === "string" &&
    typeof value.studentId === "string" &&
    (value.status === "accepted" || value.status === "withdrawn")
  );
}

function isAbortedCallable(error: unknown): boolean {
  return isPlainRecord(error) && error.code === "functions/aborted";
}

export async function getOutstandingDisclaimers(
  studentId: string,
): Promise<readonly OutstandingDisclaimer[]> {
  try {
    const callable = httpsCallable<{ studentId: string }, unknown>(
      getFirebaseFunctions(),
      "getOutstandingDisclaimers",
    );
    const result = await callable({ studentId });
    const data = result.data;
    if (!isPlainRecord(data) || !Array.isArray(data.outstanding)) {
      throw new Error(safeOutstandingError);
    }
    if (!data.outstanding.every(isOutstanding)) throw new Error(safeOutstandingError);
    return Object.freeze([...data.outstanding]);
  } catch {
    throw new Error(safeOutstandingError);
  }
}

export async function acceptDisclaimer(
  input: DisclaimerAcceptanceInput,
): Promise<DisclaimerAcceptance> {
  try {
    const callable = httpsCallable<DisclaimerAcceptanceInput, unknown>(
      getFirebaseFunctions(),
      "acceptDisclaimer",
    );
    const result = await callable(input);
    const data = result.data;
    if (!isPlainRecord(data) || !isAcceptance(data.acceptance)) throw new Error(safeAcceptError);
    return data.acceptance;
  } catch (error) {
    // The one failure worth naming: the text changed, so re-reading is the actual next step.
    if (isAbortedCallable(error)) throw new Error(disclaimerChangedError);
    throw new Error(safeAcceptError);
  }
}

export async function withdrawDisclaimerAcceptance(
  acceptanceId: string,
): Promise<DisclaimerAcceptance> {
  try {
    const callable = httpsCallable<{ acceptanceId: string }, unknown>(
      getFirebaseFunctions(),
      "withdrawDisclaimerAcceptance",
    );
    const result = await callable({ acceptanceId });
    const data = result.data;
    if (!isPlainRecord(data) || !isAcceptance(data.acceptance)) throw new Error(safeWithdrawError);
    return data.acceptance;
  } catch {
    throw new Error(safeWithdrawError);
  }
}

export async function listDisclaimers(): Promise<readonly DisclaimerAdoption[]> {
  try {
    const callable = httpsCallable<null, unknown>(getFirebaseFunctions(), "listDisclaimers");
    const result = await callable(null);
    const data = result.data;
    if (!isPlainRecord(data) || !Array.isArray(data.disclaimers)) throw new Error(safeAdminError);
    if (!data.disclaimers.every(isAdoption)) throw new Error(safeAdminError);
    return Object.freeze([...data.disclaimers]);
  } catch {
    throw new Error(safeAdminError);
  }
}

export async function publishDisclaimer(
  input: DisclaimerPublicationInput,
): Promise<DisclaimerAdoption["disclaimer"]> {
  try {
    const callable = httpsCallable<DisclaimerPublicationInput, unknown>(
      getFirebaseFunctions(),
      "publishDisclaimer",
    );
    const result = await callable(input);
    const data = result.data;
    if (!isPlainRecord(data) || !isPlainRecord(data.disclaimer)) throw new Error(safePublishError);
    return data.disclaimer as unknown as DisclaimerAdoption["disclaimer"];
  } catch {
    throw new Error(safePublishError);
  }
}

export async function withdrawDisclaimer(disclaimerId: string): Promise<void> {
  try {
    const callable = httpsCallable<{ disclaimerId: string }, unknown>(
      getFirebaseFunctions(),
      "withdrawDisclaimer",
    );
    await callable({ disclaimerId });
  } catch {
    throw new Error(safePublishError);
  }
}

/** What the office row says about reach, without naming anybody. */
export function disclaimerAudienceLabel(audience: string): string {
  if (audience === "adult") return "Adults";
  if (audience === "minor") return "Minors";
  return "Everyone";
}
