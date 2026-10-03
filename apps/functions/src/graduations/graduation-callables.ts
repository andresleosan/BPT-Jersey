import { createHash } from "node:crypto";

import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  decideGraduationInputSchema,
  graduationBoardSchema,
  graduationNoticesSchema,
} from "@bpt-jersey/domain/graduations";
import { promotionNoteSchema } from "@bpt-jersey/domain/levels";

import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { levelCallableOptions } from "../levels/level-callables.js";
import { createFirebaseLevelAuthorization } from "../levels/level-authorization.js";
import { createLevelCatalogStore, LevelStoreError } from "../levels/level-service.js";
import { requireMemberAccountActor } from "../members/member-access-callables.js";
import { createFirestoreMemberAccessService } from "../members/member-access-service.js";
import { createMemberDirectoryReadTransaction } from "../members/member-directory-firestore.js";
import { resolveCanonicalStudentIdInTransaction } from "../members/member-identity-resolution.js";
import { createGraduationFirestore } from "./graduation-firestore.js";
import { assessStudent, buildBoard, buildNotices } from "./graduation-service.js";

const store = () => createLevelCatalogStore({ firestore: getFirestore() as never });
const noLongerPending = () =>
  new HttpsError("failed-precondition", "This graduation is no longer pending.");

/** Spec D7: the board is for the office (owner, administrator). */
export const listGraduationBoard = onCall(levelCallableOptions, async (request) => {
  const actor = await createFirebaseLevelAuthorization().requireActor(request);
  if (actor.role !== "owner" && actor.role !== "administrator")
    throw new HttpsError("permission-denied", "The office reviews graduations.");
  const now = new Date().toISOString();
  const catalog = await store().listPublished(actor.academyId);
  const board = await buildBoard(
    createGraduationFirestore(getFirestore(), actor.academyId),
    catalog,
    now,
    actor.role === "owner",
  );
  return graduationBoardSchema.parse(board);
});

/** Spec D8: only the owner decides. Re-assessed here, so a stale board cannot promote twice. */
export const decideGraduation = onCall(levelCallableOptions, async (request) => {
  const actor = await createFirebaseLevelAuthorization().requireActor(request);
  if (actor.role !== "owner")
    throw new HttpsError("permission-denied", "Only the owner decides graduations.");
  const parsed = decideGraduationInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid graduation decision.");
  const input = parsed.data;
  // A promotion note is recorded on the promotion itself, which needs 10–500 characters.
  if (
    input.decision === "promote" &&
    input.note !== undefined &&
    !promotionNoteSchema.safeParse(input.note).success
  )
    throw new HttpsError("invalid-argument", "A promotion note needs at least 10 characters.");
  const now = new Date().toISOString();
  const levels = store();
  const catalog = await levels.listPublished(actor.academyId);
  const db = createGraduationFirestore(getFirestore(), actor.academyId);
  const [head] = await db.heads(input.studentId);
  if (!head) throw noLongerPending();
  const [sessions, reviews] = await Promise.all([db.sessions(now), db.reviews(input.studentId)]);
  const result = await assessStudent(db, catalog, head, {
    sessions,
    booked: new Map(),
    reviews,
    now,
  });
  const pending = result?.assessment.graduationClass;
  if (
    !result ||
    !pending ||
    result.target === null ||
    result.assessment.stage !== "approval" ||
    pending.sessionId !== input.sessionId
  )
    throw noLongerPending();
  if (input.decision === "not-yet") {
    try {
      await db.writeNotYet({
        studentId: input.studentId,
        sessionId: input.sessionId,
        definitionKey: result.target.definitionKey,
        note: input.note ?? null,
        decidedBy: actor.userId,
        decidedAt: now,
      });
    } catch (error) {
      // gRPC ALREADY_EXISTS: a second "Not yet" for the same class from a stale board.
      if ((error as { code?: unknown }).code === 6) throw noLongerPending();
      throw error;
    }
    return { ok: true };
  }
  const promotedOn = pending.occurredAt.slice(0, 10);
  try {
    await levels.assignLevel({
      academyId: actor.academyId,
      input: {
        studentId: input.studentId,
        fromDefinitionKey: result.current.definitionKey,
        toDefinitionKey: result.target.definitionKey,
        promotedOn,
        ...(input.note ? { note: input.note } : {}),
      },
      decidedBy: actor.userId,
      decidedByStaffId: null,
      decidedByRole: "owner",
    });
  } catch (error) {
    if (error instanceof LevelStoreError && (error.code === "conflict" || error.code === "invalid"))
      throw noLongerPending();
    throw error;
  }
  const names = await db.students([input.studentId]);
  const name = names.get(input.studentId)?.fullName || "A member";
  const noticeKey = `${input.studentId}|${result.target.definitionKey}|${promotedOn}`;
  await db
    .writeLevelNotice({
      // Hashed: definition keys may hold characters the notification id pattern refuses.
      id: `level-${createHash("sha256").update(noticeKey).digest("hex")}`,
      title: `${name} reached ${result.target.name}`,
      message: `Promoted from ${result.current.name} to ${result.target.name} on ${promotedOn}.`,
      studentId: input.studentId,
      at: now,
      who: name,
    })
    .catch(() => undefined); // the promotion is the record; a lost notice is not worth failing it
  return { ok: true };
});

const noticesRequest = z.strictObject({ studentId: z.string().min(1).max(128) });

/** The member's own (or a linked child's) graduation notices; never another member's data. */
export const getGraduationNotices = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireMemberAccountActor(request);
  const parsed = noticesRequest.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const access = await createFirestoreMemberAccessService().authorise(
    actor.academyId,
    actor.userId,
    parsed.data.studentId,
  );
  if (!access.allowed)
    throw new HttpsError("permission-denied", "This member is not available to your account.");
  const firestore = getFirestore();
  // Same resolver as the access service: a member addressed by a historical id finds their head.
  const studentId = await firestore.runTransaction((tx) =>
    resolveCanonicalStudentIdInTransaction(
      createMemberDirectoryReadTransaction(firestore, tx),
      actor.academyId,
      parsed.data.studentId,
    ),
  );
  const catalog = await store().listPublished(actor.academyId);
  const notices = await buildNotices(
    createGraduationFirestore(firestore, actor.academyId),
    catalog,
    studentId,
    new Date().toISOString(),
  );
  return notices === null ? null : graduationNoticesSchema.parse(notices);
});
