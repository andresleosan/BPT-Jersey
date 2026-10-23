import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";

/** Notices that ask the office to act on a waiting registration. */
const ACTIONABLE = new Set(["enrolment.request.submitted", "enrolment.request.approval.failed"]);
/** Notices that only report a decision: born read and resolved. */
const INFORMATIONAL = new Set([
  "enrolment.request.approved",
  "enrolment.request.returned",
  "enrolment.request.withdrawn",
]);
/** Decisions that close the open actionable notices of their request. */
export const DECIDING_ACTIONS = new Set([...INFORMATIONAL, "enrolment.request.denied"]);

const ACTIONABLE_TITLES = new Set([
  "New registration awaiting approval",
  "Registration approval needs attention",
]);
const INFORMATIONAL_TITLES = new Set([
  "Registration approved",
  "Registration returned for changes",
  "Registration withdrawn",
]);

export function isActionableRegistrationAction(action: string): boolean {
  return ACTIONABLE.has(action);
}

export function noticeIdForAuditEvent(auditEventId: string): string {
  return `event-${createHash("sha256").update(auditEventId).digest("hex")}`;
}

export function enrolmentRequestIdOf(academyId: string, targetRef: string): string | null {
  const prefix = `academies/${academyId}/enrolmentRequests/`;
  if (!targetRef.startsWith(prefix)) return null;
  const id = targetRef.slice(prefix.length);
  return id && !id.includes("/") ? id : null;
}

export function registrationNoticeHref(
  action: string,
  academyId: string,
  targetRef: string,
  fallback: string,
): string {
  const requestId = ACTIONABLE.has(action) ? enrolmentRequestIdOf(academyId, targetRef) : null;
  return requestId ? `/admin/members/requests?request=${encodeURIComponent(requestId)}` : fallback;
}

export function requestStillWaiting(status: unknown): boolean {
  return status === "submitted" || status === "approving" || status === "approval-failed";
}

/** `requestWaiting` is null for non-registration actions. */
export function initialNoticeState(input: {
  action: string;
  createdAt: string;
  requestWaiting: boolean | null;
}): { readAt: string | null; resolvedAt: string | null } {
  const closed =
    INFORMATIONAL.has(input.action) ||
    (ACTIONABLE.has(input.action) && input.requestWaiting === false);
  return closed
    ? { readAt: input.createdAt, resolvedAt: input.createdAt }
    : { readAt: null, resolvedAt: null };
}

/** Closes the open actionable notices of a decided request; returns how many it resolved. */
export async function resolveRegistrationNotices(
  db: Firestore,
  input: { academyId: string; targetRef: string; at: string },
): Promise<number> {
  const events = await db
    .collection(`academies/${input.academyId}/auditEvents`)
    .where("targetRef", "==", input.targetRef)
    .orderBy("occurredAt", "desc")
    .limit(100)
    .get();
  let resolved = 0;
  for (const event of events.docs) {
    const action: unknown = event.get("action");
    if (typeof action !== "string" || !ACTIONABLE.has(action)) continue;
    const ref = db.doc(
      `academies/${input.academyId}/adminNotifications/${noticeIdForAuditEvent(event.id)}`,
    );
    const changed = await db.runTransaction(async (transaction) => {
      const notice = await transaction.get(ref);
      if (!notice.exists || notice.get("resolvedAt") !== null) return false;
      const readAt: unknown = notice.get("readAt");
      transaction.update(ref, {
        resolvedAt: input.at,
        readAt: typeof readAt === "string" ? readAt : input.at,
      });
      return true;
    });
    if (changed) resolved += 1;
  }
  return resolved;
}

export function classifyRegistrationNotice(input: {
  title: string;
  resolvedAt: string | null;
  requestWaiting: boolean | null;
}): "resolve" | "keep" | "close-informational" | "ignore" {
  if (input.resolvedAt !== null) return "ignore";
  if (ACTIONABLE_TITLES.has(input.title))
    return input.requestWaiting === false ? "resolve" : "keep";
  return INFORMATIONAL_TITLES.has(input.title) ? "close-informational" : "ignore";
}
