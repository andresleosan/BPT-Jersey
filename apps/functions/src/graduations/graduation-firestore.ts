import type { Firestore } from "firebase-admin/firestore";
import { warn as logWarn } from "firebase-functions/logger";
import type { GraduationReview } from "@bpt-jersey/domain/graduations";
import type { SessionRecord } from "@bpt-jersey/domain/schedule";

import { countedAttendance, storedImportedBaseline } from "../levels/level-service.js";
import { countedClassInstants, type CountedClass } from "../levels/progress-adjustments.js";
import { readCanonicalMemberHistoryDocuments } from "../members/member-identity-firestore.js";

const dayMs = 86_400_000;
// ponytail: mirrors the private MAX_LEVEL_RECORDS (400) in level-service.ts, so a member counts
// here exactly as on their progress bars (countedAttendance refuses more than 400 anyway).
const maxAttendanceRecords = 400;

/** The engine compares instants as strings, so every instant it sees is `toISOString()` form. */
export function isoInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export type Head = Readonly<{
  studentId: string;
  systemId: string;
  currentDefinitionKey: string;
  currentLevelStartedAt: string;
  importedBaseline: ReturnType<typeof storedImportedBaseline>;
  lastApprovedPromotionId: string | null;
}>;
export type StudentName = Readonly<{ fullName: string; active: boolean }>;

export function createGraduationFirestore(db: Firestore, academyId: string) {
  const base = `academies/${academyId}`;
  const headOf = (id: string, data: Record<string, unknown>): Head | null => {
    const startedAt = isoInstant(data.currentLevelStartedAt);
    return data.state === "initialized" &&
      typeof data.currentDefinitionKey === "string" &&
      startedAt !== null
      ? {
          studentId: id,
          systemId: String(data.systemId ?? ""),
          currentDefinitionKey: data.currentDefinitionKey,
          currentLevelStartedAt: startedAt,
          importedBaseline: storedImportedBaseline(data.importedBaseline),
          lastApprovedPromotionId:
            typeof data.lastApprovedPromotionId === "string" ? data.lastApprovedPromotionId : null,
        }
      : null;
  };
  const sessionOf = (id: string, data: Record<string, unknown>): SessionRecord | null => {
    const startAt = isoInstant(data.startAt);
    const endAt = isoInstant(data.endAt);
    if (startAt === null || endAt === null) return null;
    return { ...data, sessionId: id, startAt, endAt } as SessionRecord;
  };
  return {
    async heads(studentId?: string): Promise<Head[]> {
      if (studentId !== undefined) {
        const doc = await db.doc(`${base}/studentLevelProgress/${studentId}`).get();
        const head = doc.exists ? headOf(doc.id, doc.data()!) : null;
        return head ? [head] : [];
      }
      const snap = await db.collection(`${base}/studentLevelProgress`).get();
      return snap.docs.flatMap((doc) => {
        try {
          return headOf(doc.id, doc.data()) ?? [];
        } catch (error) {
          // One unreadable head (e.g. a refused imported baseline) must not hide the whole board.
          logWarn("Graduation board skipped a progress head", { studentId: doc.id, error });
          return [];
        }
      });
    },
    async students(ids: readonly string[]): Promise<Map<string, StudentName>> {
      const out = new Map<string, StudentName>();
      for (let i = 0; i < ids.length; i += 300) {
        const refs = ids.slice(i, i + 300).map((id) => db.doc(`${base}/students/${id}`));
        for (const doc of refs.length ? await db.getAll(...refs) : []) {
          const data = doc.data();
          if (!data) continue;
          out.set(doc.id, {
            fullName: String(data.fullName ?? "").trim(),
            active: data.active === true && data.status === "active",
          });
        }
      }
      return out;
    },
    /** Window used by the engine: 56 days back (habit) to 21 days ahead (next likely class). */
    async sessions(now: string): Promise<SessionRecord[]> {
      const from = new Date(Date.parse(now) - 56 * dayMs).toISOString();
      const to = new Date(Date.parse(now) + 21 * dayMs).toISOString();
      const snap = await db
        .collection(`${base}/sessions`)
        .where("startAt", ">=", from)
        .where("startAt", "<=", to)
        .get();
      return snap.docs.flatMap((doc) => sessionOf(doc.id, doc.data()) ?? []);
    },
    async session(sessionId: string): Promise<SessionRecord | null> {
      const doc = await db.doc(`${base}/sessions/${sessionId}`).get();
      return doc.exists ? sessionOf(doc.id, doc.data()!) : null;
    },
    /** studentId → confirmed booking session ids, among the given sessions. */
    async bookings(sessionIds: readonly string[]): Promise<Map<string, Set<string>>> {
      const out = new Map<string, Set<string>>();
      for (let i = 0; i < sessionIds.length; i += 30) {
        const chunk = sessionIds.slice(i, i + 30);
        if (chunk.length === 0) continue;
        const snap = await db.collection(`${base}/bookings`).where("sessionId", "in", chunk).get();
        for (const doc of snap.docs) {
          const data = doc.data();
          if (data.status !== "confirmed" || typeof data.studentId !== "string") continue;
          const set = out.get(data.studentId) ?? new Set<string>();
          set.add(String(data.sessionId));
          out.set(data.studentId, set);
        }
      }
      return out;
    },
    /** The same counting rule as the progress bars (spec §A). */
    async counted(studentId: string): Promise<CountedClass[]> {
      const snapshot = await readCanonicalMemberHistoryDocuments(
        db,
        academyId,
        studentId,
        "attendance",
        maxAttendanceRecords,
      );
      const counted = await countedClassInstants(
        db,
        academyId,
        studentId,
        countedAttendance(snapshot, academyId, studentId, snapshot.ids),
      );
      return counted.flatMap((entry) => {
        const occurredAt = isoInstant(entry.occurredAt);
        return occurredAt === null ? [] : [{ ...entry, occurredAt }];
      });
    },
    async reviews(studentId?: string): Promise<Map<string, GraduationReview[]>> {
      const collection = db.collection(`${base}/graduationReviews`);
      const snap = await (
        studentId ? collection.where("studentId", "==", studentId) : collection
      ).get();
      const out = new Map<string, GraduationReview[]>();
      for (const doc of snap.docs) {
        const d = doc.data();
        const decidedAt = isoInstant(d.decidedAt);
        if (decidedAt === null) continue;
        const list = out.get(String(d.studentId)) ?? [];
        list.push({
          sessionId: String(d.sessionId),
          definitionKey: String(d.definitionKey),
          decidedAt,
          note: typeof d.note === "string" ? d.note : null,
        });
        out.set(String(d.studentId), list);
      }
      return out;
    },
    async writeNotYet(input: {
      studentId: string;
      sessionId: string;
      definitionKey: string;
      note: string | null;
      decidedBy: string;
      decidedAt: string;
    }): Promise<void> {
      await db
        .doc(`${base}/graduationReviews/${input.studentId}__${input.sessionId}`)
        .create({ academyId, decision: "not-yet", ...input });
    },
    async latestPromotion(promotionId: string): Promise<Record<string, unknown> | null> {
      const doc = await db.doc(`${base}/levelPromotions/${promotionId}`).get();
      return doc.exists ? (doc.data() ?? null) : null;
    },
    async writeLevelNotice(input: {
      id: string;
      title: string;
      message: string;
      studentId: string;
      at: string;
      who: string;
    }): Promise<void> {
      await db.doc(`${base}/adminNotifications/${input.id}`).create({
        notificationId: input.id,
        kind: "level",
        title: input.title,
        message: input.message,
        href: `/admin/members/profile?id=${input.studentId}`,
        createdAt: input.at,
        readAt: null,
        resolvedAt: null,
        membershipId: null,
        studentId: input.studentId,
        endsAt: null,
        details: { from: input.who, amount: null, facts: [] },
      });
    },
  };
}
export type GraduationFirestore = ReturnType<typeof createGraduationFirestore>;
