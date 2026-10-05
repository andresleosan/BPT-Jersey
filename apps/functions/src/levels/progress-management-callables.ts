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
  adjustedDaysAtLevel,
  countClassesAtLevel,
  daysAtLevel,
  editLevelHistoryInputSchema,
  importedBaselineSchema,
  jerseyDateOf,
  manualProgressError,
  manualProgressLimits,
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
import {
  buildLevelHistory,
  countedAttendance,
  createLevelCatalogStore,
  promotionRestoreOf,
  storedDaysOffset,
} from "./level-service.js";
import { countedClassInstants, openMatSessionIds, readDocuments } from "./progress-adjustments.js";

/** Owner or administrator, named for the change log. */
async function requireOffice(request: CallableRequest<unknown>) {
  const actor = await requireActiveOfficeActor(request);
  const token = request.auth?.token;
  const name = String(token?.name ?? token?.email ?? actor.userId).slice(0, 200);
  return { userId: actor.userId, academyId: actor.academyId, name, role: actor.role };
}

/** D1: owner only. */
async function requireOwner(request: CallableRequest<unknown>) {
  const office = await requireOffice(request);
  if (office.role !== "owner") {
    throw new HttpsError("permission-denied", "Only an owner can manage progress.");
  }
  return office;
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

const roleLabels: Record<string, string> = {
  owner: "Owner",
  administrator: "Administrator",
  headCoach: "Head coach",
};

/** Stored free text can be longer than the response schema allows (voidPromotion takes 500). */
function clip(value: unknown, max: number): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}

function roleLabel(role: unknown): string {
  return typeof role === "string" ? (roleLabels[role] ?? role) : "Unknown";
}

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
  const daysOffset = initialized ? storedDaysOffset(headData?.daysOffset) : 0;
  const daysAtCurrentLevel = initialized
    ? adjustedDaysAtLevel(startedAt, new Date().toISOString(), daysOffset)
    : 0;
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
      .map((document) => [document.id, clip(document.get("reason"), 300)]),
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
        reason: clip(progressVoid ? progressVoid.reason : document.get("reason"), 300),
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
      by: roleLabel(document.get("decidedByRole")).slice(0, 200),
      summary: "Level change undone",
      reason: clip(document.get("reason"), 300),
    }));
  const history = [
    ...changes.docs.map((document) => ({
      at: String(document.get("at")),
      by: String(document.get("byName") ?? document.get("by")).slice(0, 200),
      summary: String(document.get("summary")).slice(0, 300),
      reason: clip(document.get("reason"), 300),
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
    daysAtLevel: daysAtCurrentLevel,
    baselineCutoff:
      baseline.success && baseline.data.source === "owner-set" ? baseline.data.cutoff : null,
    baselineCountedThrough: baseline.success ? baseline.data.countedThrough ?? null : null,
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
  const countError = manualProgressError(manualProgressLimits(catalog.definitions, input.definitionKey), input);
  if (countError !== null) throw new HttpsError("invalid-argument", countError);
  const startedAt = `${input.startedOn}T00:00:00.000Z`;
  const days = input.days ?? daysAtLevel(startedAt, now);
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
    // Without a start date the restore snapshot is invalid and the change could never be undone.
    if (typeof headData.currentLevelStartedAt !== "string") {
      throw new HttpsError(
        "failed-precondition",
        "This member's level has no start date yet; set it from their record first.",
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
      currentLevelStartedAt: startedAt,
      daysOffset: days - daysAtLevel(startedAt, now),
      lastApprovedPromotionId: promotionId,
      importedBaseline: { classes, cutoff: tomorrowInJersey(now), countedThrough: now, source: "owner-set" },
      updatedAt: now,
      updatedBy: owner.userId,
    });
    logChange(
      transaction,
      db,
      owner,
      input.studentId,
      now,
      `Level set to ${target.name} from ${input.startedOn}, ${classes} classes, ${days} days`,
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
    "Enter whole numbers of classes and days.",
  );
  const now = new Date().toISOString();
  const db = getFirestore();
  const catalog = await createLevelCatalogStore({ firestore: db as never }).listPublished(owner.academyId);
  await assertStudent(db, owner.academyId, input.studentId);
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
    if (typeof headData.currentLevelStartedAt !== "string") {
      throw new HttpsError("failed-precondition", "This member's level has no start date.");
    }
    if (
      headData.systemId !== catalog.system.systemId ||
      !catalog.definitions.some((definition) => definition.definitionKey === headData.currentDefinitionKey) ||
      (input.definitionKey !== undefined && input.definitionKey !== headData.currentDefinitionKey)
    ) {
      throw new HttpsError("failed-precondition", "The member's level has changed. Refresh the page before editing progress.");
    }
    const countError = manualProgressError(
      manualProgressLimits(catalog.definitions, String(headData.currentDefinitionKey)), input,
    );
    if (countError !== null) throw new HttpsError("invalid-argument", countError);
    const daysOffset = input.days === undefined
      ? storedDaysOffset(headData.daysOffset)
      : input.days - daysAtLevel(headData.currentLevelStartedAt, now);
    const days = adjustedDaysAtLevel(headData.currentLevelStartedAt, now, daysOffset);
    transaction.set(headRef, {
      ...headData,
      ...(input.classes === undefined ? {} : { importedBaseline: {
        classes: input.classes,
        cutoff: tomorrowInJersey(now),
        countedThrough: now,
        source: "owner-set",
      } }),
      daysOffset,
      updatedAt: now,
      updatedBy: owner.userId,
    });
    logChange(
      transaction,
      db,
      owner,
      input.studentId,
      now,
      `${catalog.definitions.find((definition) => definition.definitionKey === headData.currentDefinitionKey)?.name}: ${[
        ...(input.classes === undefined ? [] : [`classes set to ${input.classes}`]),
        ...(input.days === undefined ? [] : [`days set to ${days}`]),
      ].join(", ")}`,
      input.reason,
    );
  });
  return { ...(input.classes === undefined ? {} : { classes: input.classes }) };
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

/** A history that will not parse is a data problem the office cannot fix from this screen. */
function historyOf(...args: Parameters<typeof buildLevelHistory>) {
  try {
    return buildLevelHistory(...args);
  } catch {
    throw new HttpsError("failed-precondition", "This member's level history cannot be read.");
  }
}

/**
 * The standing row with the latest date. On a shared day the row just edited wins (the office's
 * explicit choice), then the level already on record, so an unrelated edit never moves the head.
 */
function currentEntryOf(
  history: ReturnType<typeof buildLevelHistory>,
  headKey: unknown,
  editedEntryId: string | null,
) {
  const standing = history.entries.filter((entry) => entry.voided === null);
  const latest = standing.filter((entry) => entry.assignedOn === standing[0]?.assignedOn);
  return (
    latest.find((entry) => entry.entryId === editedEntryId) ??
    latest.find((entry) => entry.definitionKey === headKey) ??
    latest[0]
  );
}

/**
 * Level history editing (2026-10-03, operator decision): owners and administrators add, correct or
 * remove history rows, and the member's current level is always the standing row with the latest
 * date. Edits live in `levelHistoryEdits` on top of the promotions, which are never changed. When
 * the history changes, Void is retired (`lastApprovedPromotionId: null`): a promotion's `restore`
 * snapshot predates the edit, and the history itself is now how a level is undone.
 */
export const editLevelHistory = onCall(browserAdminCallableOptions, async (request) => {
  const office = await requireOffice(request);
  const input = parse(editLevelHistoryInputSchema, request.data, "Check the level and the date.");
  const now = new Date().toISOString();
  if (input.action !== "delete" && input.assignedOn > jerseyDateOf(now)) {
    throw new HttpsError("invalid-argument", "The date cannot be in the future.");
  }
  const db = getFirestore();
  const { academyId, userId } = office;
  const { studentId } = input;
  const base = `academies/${academyId}`;
  const [, catalog, identityIds] = await Promise.all([
    assertStudent(db, academyId, studentId),
    createLevelCatalogStore({ firestore: db as never }).listPublished(academyId),
    readCanonicalMemberIdentityIds(db, academyId, studentId),
  ]);
  const nameOf = (key: string) =>
    catalog.definitions.find((definition) => definition.definitionKey === key)?.name ?? key;
  if (
    input.action !== "delete" &&
    !catalog.definitions.some((definition) => definition.definitionKey === input.definitionKey)
  ) {
    throw new HttpsError("invalid-argument", "Choose a level from the published list.");
  }
  const headRef = db.doc(`${base}/studentLevelProgress/${studentId}`);
  const editsRef = db.collection(`${base}/levelHistoryEdits`);
  await db.runTransaction(async (transaction) => {
    const [head, editsSnapshot, ...promotionPages] = await Promise.all([
      transaction.get(headRef),
      transaction.get(editsRef.where("studentId", "==", studentId)),
      ...identityIds.map((id) =>
        transaction.get(db.collection(`${base}/levelPromotions`).where("studentId", "==", id)),
      ),
    ]);
    const headData = head.data();
    if (
      !head.exists ||
      headData?.academyId !== academyId ||
      headData.state !== "initialized" ||
      headData.systemId !== catalog.system.systemId
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Open this member's level first from their record, then edit the history.",
      );
    }
    const promotions = promotionPages.flatMap((page) =>
      page.docs.map((document) => document.data()),
    );
    const edits = editsSnapshot.docs.map((document) => document.data());
    const before = historyOf(studentId, headData, promotions, edits);

    let edit: Record<string, unknown>;
    let summary: string;
    if (input.action === "add") {
      const ref = editsRef.doc();
      edit = {
        editId: ref.id,
        kind: "added",
        academyId,
        studentId,
        definitionKey: input.definitionKey,
        assignedOn: input.assignedOn,
        note: input.note,
        deleted: false,
        decidedByRole: office.role,
        schemaVersion: "1",
        createdAt: now,
        createdBy: userId,
        updatedAt: now,
        updatedBy: userId,
      };
      summary = `History: added ${nameOf(input.definitionKey)} on ${input.assignedOn}`;
    } else {
      const entry = before.entries.find((candidate) => candidate.entryId === input.entryId);
      if (entry === undefined) {
        throw new HttpsError("not-found", "This history row no longer exists. Reload the page.");
      }
      const change =
        input.action === "delete"
          ? { deleted: true }
          : { definitionKey: input.definitionKey, assignedOn: input.assignedOn, deleted: false };
      const editId = entry.kind === "manual" ? entry.entryId : `edit_${entry.entryId}`;
      const existing = edits.find((candidate) => candidate.editId === editId);
      edit = {
        editId,
        kind: entry.kind === "manual" ? "added" : "override",
        academyId,
        studentId,
        ...(entry.kind === "manual" ? {} : { targetEntryId: entry.entryId }),
        definitionKey: entry.definitionKey,
        assignedOn: entry.assignedOn,
        schemaVersion: "1",
        createdAt: now,
        createdBy: userId,
        ...existing,
        ...change,
        updatedAt: now,
        updatedBy: userId,
      };
      const was = `${nameOf(entry.definitionKey)} on ${entry.assignedOn}`;
      summary =
        input.action === "delete"
          ? `History: removed ${was}`
          : `History: ${was} changed to ${nameOf(input.definitionKey)} on ${input.assignedOn}`;
    }

    const after = historyOf(studentId, headData, promotions, [
      ...edits.filter((candidate) => candidate.editId !== edit.editId),
      edit,
    ]);
    const editedEntryId =
      input.action === "delete"
        ? null
        : input.action === "add"
          ? String(edit.editId)
          : input.entryId;
    const previous = currentEntryOf(before, headData.currentDefinitionKey, null);
    const current = currentEntryOf(after, headData.currentDefinitionKey, editedEntryId);
    if (current === undefined) {
      throw new HttpsError(
        "failed-precondition",
        "A member needs at least one level in the history.",
      );
    }
    transaction.set(editsRef.doc(String(edit.editId)), edit);
    const startsSameDay =
      current.assignedOn === String(headData.currentLevelStartedAt).slice(0, 10);
    const nextHead: Record<string, unknown> = {
      ...headData,
      currentDefinitionKey: current.definitionKey,
      currentLevelStartedAt: startsSameDay
        ? headData.currentLevelStartedAt
        : `${current.assignedOn}T00:00:00.000Z`,
      lastApprovedPromotionId: null,
      updatedAt: now,
      updatedBy: userId,
    };
    // Imported classes belong to the row they were counted for: a correction to that same row
    // keeps them, a different row taking over drops them (as an assignment does).
    if (current.entryId !== previous?.entryId) {
      delete nextHead.importedBaseline;
      delete nextHead.daysOffset;
    }
    transaction.set(headRef, nextHead);
    logChange(
      transaction,
      db,
      office,
      studentId,
      now,
      summary,
      input.action === "add" ? input.note : null,
    );
  });
  return { ok: true };
});
