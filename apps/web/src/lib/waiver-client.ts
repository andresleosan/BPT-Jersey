import { httpsCallable } from "firebase/functions";

import {
  consentProjectionSchema,
  parseConsentIdInput,
  parseWaiverAcceptanceInput,
  parseWaiverEvidenceDownload,
  parseWaiverPublicationInput,
  parseWaiverRegistrationProjection,
  parseWaiverVersionIdInput,
  waiverVersionProjectionSchema,
  type ConsentProjection,
  type WaiverAcceptanceInput,
  type WaiverEvidenceDownload,
  type WaiverPublicationInput,
  type WaiverRegistrationProjection,
  type WaiverVersionProjection,
} from "@bpt-jersey/domain/consents";
import { getFirebaseFunctions } from "./firebase-client";

const loadError = "Unable to load waiver registration.";
const updateError = "Unable to update waiver registration.";
const evidenceError = "Unable to open waiver evidence.";
const adminError = "Unable to update waiver version.";

function version(value: unknown, message: string): WaiverVersionProjection {
  const parsed = waiverVersionProjectionSchema.safeParse(value);
  if (!parsed.success) throw new Error(message);
  return parsed.data;
}
function consent(value: unknown, message: string): ConsentProjection {
  const parsed = consentProjectionSchema.safeParse(value);
  if (!parsed.success) throw new Error(message);
  return parsed.data;
}

export async function getWaiverRegistration(): Promise<WaiverRegistrationProjection> {
  try {
    const callable = httpsCallable<null, unknown>(getFirebaseFunctions(), "getWaiverRegistration");
    const result = await callable(null);
    const parsed = parseWaiverRegistrationProjection(result.data);
    if (!parsed.ok) throw new Error(loadError);
    return parsed.value;
  } catch {
    throw new Error(loadError);
  }
}

export async function acceptWaiver(input: WaiverAcceptanceInput): Promise<ConsentProjection> {
  try {
    const parsed = parseWaiverAcceptanceInput(input);
    if (!parsed.ok) throw new Error(updateError);
    const callable = httpsCallable<WaiverAcceptanceInput, unknown>(getFirebaseFunctions(), "acceptWaiver");
    return consent((await callable(parsed.value)).data, updateError);
  } catch {
    throw new Error(updateError);
  }
}

export async function revokeWaiverConsent(consentId: string): Promise<ConsentProjection> {
  try {
    const parsed = parseConsentIdInput({ consentId });
    if (!parsed.ok) throw new Error(updateError);
    const callable = httpsCallable<{ consentId: string }, unknown>(getFirebaseFunctions(), "revokeWaiverConsent");
    return consent((await callable(parsed.value)).data, updateError);
  } catch {
    throw new Error(updateError);
  }
}

export async function getWaiverEvidenceDownload(consentId: string): Promise<WaiverEvidenceDownload> {
  try {
    const parsedInput = parseConsentIdInput({ consentId });
    if (!parsedInput.ok) throw new Error(evidenceError);
    const callable = httpsCallable<{ consentId: string }, unknown>(getFirebaseFunctions(), "getWaiverEvidenceDownload");
    const result = parseWaiverEvidenceDownload((await callable(parsedInput.value)).data);
    if (!result.ok || Date.parse(result.value.expiresAt) <= Date.now()) throw new Error(evidenceError);
    return result.value;
  } catch {
    throw new Error(evidenceError);
  }
}

export async function getCurrentWaiverAdmin(): Promise<WaiverVersionProjection | null> {
  try {
    const callable = httpsCallable<null, unknown>(getFirebaseFunctions(), "getCurrentWaiverAdmin");
    const data = (await callable(null)).data;
    return data === null ? null : version(data, adminError);
  } catch {
    throw new Error(adminError);
  }
}

export async function publishWaiverVersion(input: WaiverPublicationInput): Promise<WaiverVersionProjection> {
  try {
    const parsed = parseWaiverPublicationInput(input);
    if (!parsed.ok) throw new Error(adminError);
    const callable = httpsCallable<WaiverPublicationInput, unknown>(getFirebaseFunctions(), "publishWaiverVersion");
    return version((await callable(parsed.value)).data, adminError);
  } catch {
    throw new Error(adminError);
  }
}

export async function withdrawCurrentWaiver(waiverVersionId: string): Promise<WaiverVersionProjection> {
  try {
    const parsed = parseWaiverVersionIdInput({ waiverVersionId });
    if (!parsed.ok) throw new Error(adminError);
    const callable = httpsCallable<{ waiverVersionId: string }, unknown>(getFirebaseFunctions(), "withdrawCurrentWaiver");
    return version((await callable(parsed.value)).data, adminError);
  } catch {
    throw new Error(adminError);
  }
}
