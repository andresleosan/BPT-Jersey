import { httpsCallable as firebaseHttpsCallable } from "firebase/functions";

import {
  noShowPenaltyStatuses,
  parseResolveNoShowPenaltyInput,
  type NoShowPenaltyRecord,
  type NoShowPenaltyStatus,
  type ResolveNoShowPenaltyInput,
} from "@bpt-jersey/domain/penalties";

import { getFirebaseFunctions } from "./firebase-client";

/**
 * These callables are deployed with `consumeAppCheckToken: true`, so their App Check token is
 * single-use and the client has to ask for a limited-use one. Sending the ordinary cached token
 * gets the call rejected, and an App Check rejection surfaces as `401` — indistinguishable from
 * "not signed in" unless you already know to look here. Observed in production 2026-09-08 against a
 * real administrator session.
 */
const penaltyCallableClientOptions = Object.freeze({ limitedUseAppCheckTokens: true });

function httpsCallable<RequestData, ResponseData>(
  functions: ReturnType<typeof getFirebaseFunctions>,
  name: string,
) {
  return firebaseHttpsCallable<RequestData, ResponseData>(
    functions,
    name,
    penaltyCallableClientOptions,
  );
}

/**
 * T111: the office queue of Town no-show penalties. Nothing is charged automatically: office either
 * charges a proposal through the manual billing cycle and links the invoice, or waives it with a
 * reason (BRIEF decision 2).
 */
const safeListError = "Unable to load no-show penalties. Please try again.";
const safeResolveError = "Unable to resolve the penalty. Please try again.";
const safeProposeError = "Unable to propose no-show penalties. Please try again.";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPenalty(value: unknown): value is NoShowPenaltyRecord {
  if (!isPlainRecord(value)) return false;
  const resolution = value.resolution;
  return (
    typeof value.penaltyId === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.studentId === "string" &&
    typeof value.locationId === "string" &&
    typeof value.sessionStartAt === "string" &&
    Number.isSafeInteger(value.amountMinor) &&
    value.currency === "GBP" &&
    typeof value.status === "string" &&
    noShowPenaltyStatuses.includes(value.status as NoShowPenaltyStatus) &&
    (resolution === null ||
      (isPlainRecord(resolution) &&
        typeof resolution.decision === "string" &&
        typeof resolution.reason === "string" &&
        typeof resolution.resolvedAt === "string"))
  );
}

export async function listNoShowPenalties(
  status?: NoShowPenaltyStatus,
): Promise<readonly NoShowPenaltyRecord[]> {
  try {
    const callable = httpsCallable<{ status?: NoShowPenaltyStatus } | null, unknown>(
      getFirebaseFunctions(),
      "listNoShowPenalties",
    );
    const result = await callable(status === undefined ? null : { status });
    const data = result.data;
    if (!isPlainRecord(data) || !Array.isArray(data.penalties)) throw new Error(safeListError);
    if (!data.penalties.every(isPenalty)) throw new Error(safeListError);
    return Object.freeze([...data.penalties]);
  } catch {
    throw new Error(safeListError);
  }
}

export async function resolveNoShowPenalty(
  input: ResolveNoShowPenaltyInput,
): Promise<NoShowPenaltyRecord> {
  const parsed = parseResolveNoShowPenaltyInput(input);
  if (!parsed.ok) throw new Error(safeResolveError);
  try {
    const callable = httpsCallable<ResolveNoShowPenaltyInput, unknown>(
      getFirebaseFunctions(),
      "resolveNoShowPenalty",
    );
    const result = await callable(parsed.value);
    const data = result.data;
    if (!isPlainRecord(data) || !isPenalty(data.penalty)) throw new Error(safeResolveError);
    return data.penalty;
  } catch {
    throw new Error(safeResolveError);
  }
}

export async function proposeNoShowPenalties(
  sessionId: string,
): Promise<Readonly<{ proposed: number; skipped: number; alreadyProposed: number }>> {
  if (!identifierPattern.test(sessionId)) throw new Error(safeProposeError);
  try {
    const callable = httpsCallable<{ sessionId: string }, unknown>(
      getFirebaseFunctions(),
      "proposeNoShowPenalties",
    );
    const result = await callable({ sessionId });
    const data = result.data;
    if (!isPlainRecord(data) || !isPlainRecord(data.result)) throw new Error(safeProposeError);
    const outcome = data.result;
    if (
      !Array.isArray(outcome.proposed) ||
      !Array.isArray(outcome.skipped) ||
      !Number.isSafeInteger(outcome.alreadyProposed)
    ) {
      throw new Error(safeProposeError);
    }
    return Object.freeze({
      proposed: outcome.proposed.length,
      skipped: outcome.skipped.length,
      alreadyProposed: outcome.alreadyProposed as number,
    });
  } catch {
    throw new Error(safeProposeError);
  }
}
