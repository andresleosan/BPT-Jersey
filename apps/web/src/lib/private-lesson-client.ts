import { z } from "zod";
import {
  myPrivateLessonsSchema,
  privateLessonProofUrlSchema,
  privateLessonPurchaseRowSchema,
  privateLessonPurchaseSchema,
  type MyPrivateLessons,
  type PrivateLessonOptionId,
  type PrivateLessonProofUrl,
  type PrivateLessonPurchase,
  type PrivateLessonPurchaseRow,
  type PrivateLessonPurchaseStatus,
} from "@bpt-jersey/domain/private-lessons";

import { httpsCallable } from "./callable";
import { getFirebaseFunctions } from "./firebase-client";

const saveError = "We could not save the private lesson request. Try again.";
const loadError = "Private lessons are unavailable. Try again.";
const officeError = "We could not update the private lesson. Try again.";
const proofError = "Payment evidence is unavailable. Try again.";

/** Refusals the server writes for people; anything else is shown as the generic message. */
const knownMessages = new Set([
  "Private lessons are for members aged 16 or over.",
  "This member already has an active monthly private lesson plan.",
  "This purchase has already been reviewed.",
  "Register the member's billing account first.",
  "No private lesson credit available.",
  "This session is not a private lesson.",
  "This private lesson is already booked.",
  "This private lesson has already started.",
  "This private lesson is not scheduled.",
  "This member is already booked on this session.",
  "This booking is not a private lesson.",
]);

function safeError(error: unknown, fallback: string): Error {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
  const message = error instanceof Error ? error.message : "";
  return new Error(
    code === "functions/failed-precondition" && knownMessages.has(message) ? message : fallback,
  );
}

async function call<T>(name: string, payload: unknown, schema: z.ZodType<T>, fallback: string): Promise<T> {
  try {
    const response = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), name, {
      limitedUseAppCheckTokens: true,
    })(payload);
    return schema.parse(response.data);
  } catch (error) {
    throw safeError(error, fallback);
  }
}

const purchaseResponse = z.strictObject({ purchase: privateLessonPurchaseSchema });

export function submitPrivateLessonPurchase(input: {
  requestId: string;
  studentId: string;
  optionId: PrivateLessonOptionId;
  proofId: string;
  bankReference: string;
}): Promise<PrivateLessonPurchase> {
  return call("submitPrivateLessonPurchase", input, purchaseResponse, saveError).then(
    (value) => value.purchase,
  );
}

export function listMyPrivateLessons(studentId: string): Promise<MyPrivateLessons> {
  return call("listMyPrivateLessons", { studentId }, myPrivateLessonsSchema, loadError);
}

export function listPrivateLessonPurchases(
  status: PrivateLessonPurchaseStatus,
): Promise<PrivateLessonPurchaseRow[]> {
  return call(
    "listPrivateLessonPurchases",
    { status },
    z.strictObject({ purchases: z.array(privateLessonPurchaseRowSchema).max(200) }),
    loadError,
  ).then((value) => value.purchases);
}

export function reviewPrivateLessonPurchase(input: {
  purchaseId: string;
  decision: "approve" | "reject";
  reason: string | null;
}): Promise<PrivateLessonPurchase> {
  return call("reviewPrivateLessonPurchase", input, purchaseResponse, officeError).then(
    (value) => value.purchase,
  );
}

/** Office only: a short-lived link to the member's transfer proof for one purchase. */
export function getPrivateLessonProofUrl(purchaseId: string): Promise<PrivateLessonProofUrl> {
  return call("getPrivateLessonProofUrl", { purchaseId }, privateLessonProofUrlSchema, proofError);
}

export function recordPrivateLessonPurchase(input: {
  studentId: string;
  requestId: string;
  optionId: PrivateLessonOptionId;
  method: "bank_transfer" | "cash" | "other";
  reference: string | null;
}): Promise<PrivateLessonPurchase> {
  return call("recordPrivateLessonPurchase", input, purchaseResponse, officeError).then(
    (value) => value.purchase,
  );
}

const bookingSchema = z.looseObject({
  bookingId: z.string().min(1),
  sessionId: z.string().min(1),
  studentId: z.string().min(1),
  status: z.enum(["requested", "confirmed", "cancelled"]),
  schemaVersion: z.literal("4"),
});

export function bookPrivateLesson(input: { sessionId: string; studentId: string }) {
  return call(
    "bookPrivateLesson",
    input,
    z.looseObject({ booking: bookingSchema }),
    officeError,
  ).then((value) => value.booking);
}

export function cancelPrivateLessonBooking(input: { bookingId: string; reason: string }) {
  return call(
    "cancelPrivateLessonBooking",
    input,
    z.looseObject({ booking: bookingSchema, creditRestored: z.boolean() }),
    officeError,
  );
}
