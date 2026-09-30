import {
  getFirestore,
  type Firestore,
  type Transaction,
  type WriteBatch,
} from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import type { z } from "zod";
import {
  addManualAttendanceInputSchema,
  countClassesAtLevel,
  importedBaselineSchema,
  jerseyDateOf,
  progressManagementSchema,
  progressStudentInputSchema,
  setAttendanceVoidInputSchema,
  setProgressClassCountInputSchema,
  setProgressLevelInputSchema,
  type ProgressManagement,
} from "@bpt-jersey/domain/levels";

import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireActiveOfficeActor } from "../auth/office-actor.js";
import {
  readCanonicalMemberHistoryDocuments,
  readCanonicalMemberIdentityIds,
} from "../members/member-identity-firestore.js";
import { countedAttendance, createLevelCatalogStore, promotionRestoreOf } from "./level-service.js";
import { countedClassInstants, openMatSessionIds, readDocuments } from "./progress-adjustments.js";

/** D1: owner only. */
async function requireOwner(request: CallableRequest<unknown>) {
  const actor = await requireActiveOfficeActor(request);
  if (actor.role !== "owner") {
    throw new HttpsError("permission-denied", "Only an owner can manage progress.");
  }
  const token = request.auth?.token;
  const name = String(token?.name ?? token?.email ?? actor.userId).slice(0, 200);
  return { userId: actor.userId, academyId: actor.academyId, name };
}

function parse<T>(schema: z.ZodType<T>, data: unknown, message: string): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpsError("invalid-argument", message);
  return result.data;
}

function tomorrowInJersey(now: string): string {
  return new Date(Date.parse(`${jerseyDateOf(now)}T00:00:00.000Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
}

type Owner = Awaited<ReturnType<typeof requireOwner>>;

/** The tab's history row (spec deviation 2): who, when, what, reason. */
function logChange(
  writer: Transaction | WriteBatch,
  db: Firestore,
  owner: Owner,
  studentId: string,
  now: string,
  summary: string,
  reason: string | null,
) {
  writer.create(db.collection(`academies/${owner.academyId}/progressChanges`).doc(), {
    academyId: owner.academyId,
    studentId,
    at: now,
    by: owner.userId,
    byName: owner.name,
    summary: summary.slice(0, 300),
    reason,
    schemaVersion: "1",
  });
}

async function assertStudent(db: Firestore, academyId: string, studentId: string) {
  const student = await db.doc(`academies/${academyId}/students/${studentId}`).get();
  if (!student.exists || student.get("academyId") !== academyId) {
    throw new HttpsError("not-found", "This member no longer exists.");
  }
}

export const getProgressManagement = onCall(browserAdminCallableOptions, async (request) => {
  const owner = await requireOwner(request);
  const { studentId } = parse(progressStudentInputSchema, request.data, "Choose a member.");
  const db = getFirestore();
  const { academyId } = owner;
  const base = `academies/${academyId}`;
  await assertStudent(db, academyId, studentId);

  const [head, attendanceSnapshot, manual, voids, changes, promotions] = await Promise.all([
    db.doc(`${base}/studentLevelProgress/${studentId}`).get(),
    readCanonicalMemberHistoryDocuments(db, academyId, studentId, "attendance", 400),
    db.collection(`${base}/memberManualAttendance`).where("studentId", "==", studentId).get(),
    db.collection(`${base}/attendanceVoids`).where("studentId", "==", studentId).get(),
    db.collection(`${base}/progressChanges`).where("studentId", "==", studentId).get(),
    readCanonicalMemberHistoryDocuments(db, academyId, studentId, "levelPromotions", 400),
  ]);
  const real = countedAttendance(
    attendanceSnapshot as never,
    academyId,
    studentId,
    attendanceSnapshot.ids,
  );
  const sessionIds = real.map((record) => String(record.sessionId));
  const [counted, openMat, sessions] = await Promise.all([
    countedClassInstants(db, academyId, studentId, real),
    openMatSessionIds(db, academyId, sessionIds),
    readDocuments(
      db,
      [...new Set(sessionIds)].map((id) => `${base}/sessions/${id}`),
    ),
  ]);

  const headData = head.data();
  const initialized = head.exists && headData?.state === "initialized";
  const startedAt =
    initialized && typeof headData?.currentLevelStartedAt === "string"
      ? headData.currentLevelStartedAt
      : null;
  const baseline = importedBaselineSchema.safeParse(headData?.importedBaseline);
  const classesAtLevel = initialized
    ? countClassesAtLevel({
        attendedAt: counted.map((record) => record.occurredAt),
        currentLevelStartedAt: startedAt,
        importedBaseline: baseline.success ? baseline.data : null,
      }).total
    : 0;

  const titleOf = new Map(
    sessions.map((session) => [
      session.id,
      typeof session.get("title") === "string"
        ? String(session.get("title")).slice(0, 200)
        : "Class",
    ]),
  );
  const voidReason = new Map(
    voids.docs
      .filter((document) => document.get("voided") === true)
      .map((document) => [document.id, (document.get("reason") as string | null) ?? null]),
  );
  const attendance = [
    ...real.map((record) => ({
      id: String(record.attendanceId),
      kind: "attendance" as const,
      date: jerseyDateOf(String(record.occurredAt)),
      label: titleOf.get(String(record.sessionId)) ?? "Class",
      openMat: openMat.has(String(record.sessionId)),
      voided: voidReason.has(String(record.attendanceId)),
      reason: voidReason.get(String(record.attendanceId)) ?? null,
    })),
    ...manual.docs.map((document) => {
      const progressVoid = document.get("progressVoid") as { reason?: string | null } | null;
      return {
        id: document.id,
        kind: "manual" as const,
        date: String(document.get("date")),
        label: "Added by owner",
        openMat: false,
        voided: progressVoid !== null && progressVoid !== undefined,
        reason: (progressVoid ? progressVoid.reason : document.get("reason")) ?? null,
      };
    }),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 1000);

  const lastPromotionId =
    typeof headData?.lastApprovedPromotionId === "string" ? headData.lastApprovedPromotionId : null;
  const lastPromotion = promotions.docs.find((document) => document.id === lastPromotionId);
  const undone = promotions.docs
    .filter(
      (document) =>
        document.get("kind") === "void" &&
        String(document.get("voidsPromotionId")).startsWith("owner-set_"),
    )
    .map((document) => ({
      at: String(document.get("decidedAt")),
      by: "Owner",
      summary: "Level change undone",
      reason: (document.get("reason") as string | null) ?? null,
    }));
  const history = [
    ...changes.docs.map((document) => ({
      at: String(document.get("at")),
      by: String(document.get("byName") ?? document.get("by")),
      summary: String(document.get("summary")),
      reason: (document.get("reason") as string | null) ?? null,
    })),
    ...undone,
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 200);

  const result: ProgressManagement = {
    studentId,
    initialized,
    currentDefinitionKey: initialized ? String(headData?.currentDefinitionKey) : null,
    startedOn: startedAt === null ? null : startedAt.slice(0, 10),
    classesAtLevel,
    baselineCutoff:
      baseline.success && baseline.data.source === "owner-set" ? baseline.data.cutoff : null,
    undoPromotionId: lastPromotion?.get("kind") === "owner-set" ? lastPromotionId : null,
    attendance,
    history,
  };
  return progressManagementSchema.parse(result);
});

export const setProgressLevel = onCall(browserAdminCallableOptions, async (request) => {
  const owner = await requireOwner(request);
  const input = parse(
    setProgressLevelInputSchema,
    request.data,
    "Check the level, the start date and the class count.",
  );
  const now = new Date().toISOString();
  if (input.startedOn > jerseyDateOf(now)) {
    throw new HttpsError("invalid-argument", "The start date cannot be in the future.");
  }
  const db = getFirestore();
  const base = `academies/${owner.academyId}`;
  const catalog = await createLevelCatalogStore({ firestore: db as never }).listPublished(
    owner.academyId,
  );
  const target = catalog.definitions.find(
    (definition) => definition.definitionKey === input.definitionKey,
  );
  if (!target) throw new HttpsError("invalid-argument", "Choose a level from the published list.");
  const headRef = db.doc(`${base}/studentLevelProgress/${input.studentId}`);
  const promotionId = `owner-set_${input.studentId}_${now}`;
  const classes = input.classes ?? 0;
  await db.runTransaction(async (transaction) => {
    const head = await transaction.get(headRef);
    const headData = head.data();
    if (
      !head.exists ||
      headData?.academyId !== owner.academyId ||
      headData.state !== "initialized" ||
      headData.systemId !== catalog.system.systemId
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Open this member's level first from their record, then set it here.",
      );
    }
    // Same shape as an assignLevel promotion, so the level history shows it and voidPromotion
    // (the existing Undo) restores the head from `restore` (D8).
    transaction.create(db.doc(`${base}/levelPromotions/${promotionId}`), {
      promotionId,
      kind: "owner-set",
      academyId: owner.academyId,
      studentId: input.studentId,
      systemId: headData.systemId,
      fromDefinitionKey: headData.currentDefinitionKey,
      toDefinitionKey: target.definitionKey,
      promotedOn: input.startedOn,
      status: "approved",
      decisionStatus: "approved",
      decidedBy: owner.userId,
      decidedByRole: "owner",
      decidedAt: now,
      note: input.reason,
      gaps: [],
      restore: promotionRestoreOf(headData),
      schemaVersion: "1",
      createdAt: now,
      createdBy: owner.userId,
      updatedAt: now,
      updatedBy: owner.userId,
    });
    transaction.set(headRef, {
      ...headData,
      currentDefinitionKey: target.definitionKey,
      currentLevelStartedAt: `${input.startedOn}T00:00:00.000Z`,
      lastApprovedPromotionId: promotionId,
      // D12: the owner's count is the total up to today; attendance from tomorrow adds on top.
      importedBaseline: { classes, cutoff: tomorrowInJersey(now), source: "owner-set" },
      updatedAt: now,
      updatedBy: owner.userId,
    });
    logChange(
      transaction,
      db,
      owner,
      input.studentId,
      now,
      `Level set to ${target.name} from ${input.startedOn}, ${classes} classes`,
      input.reason,
    );
  });
  return { promotionId };
});

export const setProgressClassCount = onCall(browserAdminCallableOptions, async (request) => {
  const owner = await requireOwner(request);
  const input = parse(
    setProgressClassCountInputSchema,
    request.data,
    "Enter a whole number of classes.",
  );
  const now = new Date().toISOString();
  const db = getFirestore();
  const headRef = db.doc(`academies/${owner.academyId}/studentLevelProgress/${input.studentId}`);
  await db.runTransaction(async (transaction) => {
    const head = await transaction.get(headRef);
    const headData = head.data();
    if (
      !head.exists ||
      headData?.academyId !== owner.academyId ||
      headData.state !== "initialized"
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Open this member's level first from their record, then set it here.",
      );
    }
    transaction.set(headRef, {
      ...headData,
      importedBaseline: {
        classes: input.classes,
        cutoff: tomorrowInJersey(now),
        source: "owner-set",
      },
      updatedAt: now,
      updatedBy: owner.userId,
    });
    logChange(
      transaction,
      db,
      owner,
      input.studentId,
      now,
      `Classes at this level set to ${input.classes}`,
      input.reason,
    );
  });
  return { classes: input.classes };
});

export const addManualAttendance = onCall(browserAdminCallableOptions, async (request) => {
  const owner = await requireOwner(request);
  const input = parse(addManualAttendanceInputSchema, request.data, "Choose a valid date.");
  const now = new Date().toISOString();
  if (input.date > jerseyDateOf(now)) {
    throw new HttpsError("invalid-argument", "The date cannot be in the future.");
  }
  const db = getFirestore();
  await assertStudent(db, owner.academyId, input.studentId);
  const ref = db.collection(`academies/${owner.academyId}/memberManualAttendance`).doc();
  const batch = db.batch();
  // D5: a free date, always a class (never Open Mat).
  batch.create(ref, {
    manualAttendanceId: ref.id,
    academyId: owner.academyId,
    studentId: input.studentId,
    date: input.date,
    reason: input.reason,
    createdBy: owner.userId,
    createdAt: now,
    progressVoid: null,
    schemaVersion: "1",
  });
  logChange(
    batch,
    db,
    owner,
    input.studentId,
    now,
    `Attendance added on ${input.date}`,
    input.reason,
  );
  await batch.commit();
  return { id: ref.id };
});

export const setAttendanceVoid = onCall(browserAdminCallableOptions, async (request) => {
  const owner = await requireOwner(request);
  const input = parse(
    setAttendanceVoidInputSchema,
    request.data,
    "Choose an attendance to change.",
  );
  const now = new Date().toISOString();
  const db = getFirestore();
  const base = `academies/${owner.academyId}`;
  const identityIds =
    input.kind === "attendance"
      ? await readCanonicalMemberIdentityIds(db, owner.academyId, input.studentId)
      : [input.studentId];
  const verb = input.voided ? "removed" : "restored";
  await db.runTransaction(async (transaction) => {
    if (input.kind === "manual") {
      const ref = db.doc(`${base}/memberManualAttendance/${input.id}`);
      const record = await transaction.get(ref);
      if (
        !record.exists ||
        record.get("academyId") !== owner.academyId ||
        record.get("studentId") !== input.studentId
      ) {
        throw new HttpsError("not-found", "This attendance no longer exists.");
      }
      transaction.update(ref, {
        progressVoid: input.voided ? { at: now, by: owner.userId, reason: input.reason } : null,
      });
      logChange(
        transaction,
        db,
        owner,
        input.studentId,
        now,
        `Attendance on ${String(record.get("date"))} ${verb}`,
        input.reason,
      );
      return;
    }
    const attendance = await transaction.get(db.doc(`${base}/attendance/${input.id}`));
    if (
      !attendance.exists ||
      attendance.get("academyId") !== owner.academyId ||
      !identityIds.includes(String(attendance.get("studentId")))
    ) {
      throw new HttpsError("not-found", "This attendance no longer exists.");
    }
    // Spec deviation 1: the attendance record is never modified; the void lives beside it.
    transaction.set(db.doc(`${base}/attendanceVoids/${input.id}`), {
      attendanceId: input.id,
      academyId: owner.academyId,
      studentId: input.studentId,
      voided: input.voided,
      reason: input.reason,
      updatedAt: now,
      updatedBy: owner.userId,
      schemaVersion: "1",
    });
    logChange(
      transaction,
      db,
      owner,
      input.studentId,
      now,
      `Attendance on ${jerseyDateOf(String(attendance.get("occurredAt")))} ${verb}`,
      input.reason,
    );
  });
  return { voided: input.voided };
});
