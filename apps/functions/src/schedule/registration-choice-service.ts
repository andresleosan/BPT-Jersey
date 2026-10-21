import { HttpsError } from "firebase-functions/v2/https";
import type { RegistrationChoice } from "@bpt-jersey/domain/memberships/admin";
import {
  parseMembershipRecord,
  type MembershipRecord,
} from "@bpt-jersey/domain/memberships/lifecycle";
import { trialStatusAt } from "@bpt-jersey/domain/memberships/trial-access";

import { readTrialAccess } from "../memberships/trial-access-service.js";
import {
  bookingIdentityIds,
  membershipCoversSession,
  type BookingFirestore,
  type BookingTransaction,
} from "./booking-transaction-service.js";

/**
 * What the office would book one student into one class with (2026-10-20). Read per student: the
 * global membership list stops at 100, misses memberships held under an earlier id and knows no
 * Free Trial. Identity, plan dates and the trial follow the booking's own rules, but this is a
 * preview, not a promise: the booking re-checks everything (payment, capacity, age, centre,
 * allowance, waiver, cutoff) in its own transaction.
 */
export async function readRegistrationChoice(
  input: Readonly<{
    firestore: BookingFirestore;
    transaction: BookingTransaction;
    academyId: string;
    sessionId: string;
    studentId: string;
    now: string;
  }>,
): Promise<RegistrationChoice> {
  const { firestore, transaction, academyId } = input;
  const ids = await bookingIdentityIds(input);
  const studentId = ids[0]!;
  const [session, trial, ...pages] = await Promise.all([
    transaction.get(firestore.doc(`academies/${academyId}/sessions/${input.sessionId}`)),
    readTrialAccess({ get: (path) => transaction.get(firestore.doc(path)) }, academyId, studentId),
    ...ids.map((id) =>
      transaction.get(
        firestore
          .collection(`academies/${academyId}/memberships`)
          .where("studentId", "==", id)
          .limit(101),
      ),
    ),
  ]);
  const stored = session.data();
  const sessionStartAt = stored?.startAt;
  if (
    !session.exists ||
    stored?.academyId !== academyId ||
    stored.sessionId !== input.sessionId ||
    typeof sessionStartAt !== "string"
  ) {
    // Not `not-found`: the web client retries that in another region.
    throw new HttpsError("failed-precondition", "Class is not available.");
  }
  if (pages.some((page) => page.docs.length > 100)) {
    throw new HttpsError("failed-precondition", "Membership history requires office review.");
  }
  const history = pages.flatMap((page) => page.docs);
  const live: MembershipRecord[] = [];
  for (const doc of history) {
    const parsed = parseMembershipRecord(doc.data());
    // Unreadable or foreign rows stay history (an intro would be refused) but are never offered.
    if (
      parsed.ok &&
      parsed.value.academyId === academyId &&
      parsed.value.membershipId === doc.id &&
      ids.includes(parsed.value.studentId) &&
      (parsed.value.status === "active" || parsed.value.status === "trial")
    ) {
      live.push(parsed.value);
    }
  }
  // Lowest id first, as the panel and group registration have always picked.
  const covering = live
    .filter((membership) =>
      membershipCoversSession(membership.startsAt, membership.endsAt, sessionStartAt),
    )
    .sort((left, right) => left.membershipId.localeCompare(right.membershipId))[0];
  if (covering) {
    const choice = { kind: "membership", membershipId: covering.membershipId } as const;
    return { studentId, choice, reason: null };
  }
  if (live.length > 0) return { studentId, choice: null, reason: "plan-dates" };
  // The intro booking refuses anyone with membership history, so only a clean trial is offered.
  const site = stored?.locationId === "town" ? "Town" : "West";
  const usableTrial =
    trial !== undefined && trialStatusAt(trial, input.now) === "active" && trial.site === site;
  if (history.length === 0 && usableTrial) {
    return { studentId, choice: { kind: "intro" }, reason: null };
  }
  return {
    studentId,
    choice: null,
    reason: history.length === 0 && trial ? "trial-unavailable" : "no-plan",
  };
}
