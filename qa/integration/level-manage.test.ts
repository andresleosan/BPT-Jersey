import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import { createLevelCatalogStore } from "../../apps/functions/src/levels/level-service";
import { loadApprovedLevelCatalog } from "../../apps/functions/src/levels/level-seed";

const runId = `level-manage-${process.pid}-${randomUUID().slice(0, 8)}`;
const academyId = `${runId}-academy`;
const host = process.env.FIRESTORE_EMULATOR_HOST?.trim() ?? "";
const useEmulator = /^(127\.0\.0\.1|localhost):\d{2,5}$/u.test(host);
if (!useEmulator) {
  console.warn(
    "SKIP level manage emulator integration: FIRESTORE_EMULATOR_HOST must be a local emulator host",
  );
}
const app = useEmulator ? initializeApp({ projectId: "demo-bpt-jersey" }, runId) : undefined;
const firestore = app ? getFirestore(app) : undefined;
const store = firestore
  ? createLevelCatalogStore({
      firestore: firestore as unknown as Parameters<typeof createLevelCatalogStore>[0]["firestore"],
    })
  : undefined;
const created = "2026-06-01T00:00:00.000Z";

afterAll(async () => {
  // Emulator data is throwaway; rollback is refused once promotions reference the catalogue.
  if (app) await deleteApp(app);
});

async function put(path: string, data: Record<string, unknown>): Promise<void> {
  await firestore!.doc(`academies/${academyId}/${path}`).set(data);
}

describe("level manage on the Firestore emulator (T051V2)", () => {
  it.skipIf(!useEmulator)(
    "opens, counts the baseline, assigns with a note, voids and lists history",
    async () => {
      if (!store) throw new Error("store required");
      await store.seed({
        academyId,
        normalized: loadApprovedLevelCatalog({ systemId: "ibjjf-v2" }),
      });
      await put("users/head-user-1", {
        userId: "head-user-1",
        academyId,
        accountType: "staff",
        active: true,
        status: "active",
      });
      await put("staff/staff-head-1", {
        staffId: "staff-head-1",
        academyId,
        userId: "head-user-1",
        role: "headCoach",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: created,
        createdBy: "owner",
        updatedAt: created,
        updatedBy: "owner",
      });
      await put("students/student-1", {
        studentId: "student-1",
        academyId,
        fullName: "Synthetic Adult",
        dateOfBirth: "1990-01-01",
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
        participantType: "adult",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: created,
        createdBy: "owner",
        updatedAt: created,
        updatedBy: "owner",
      });
      await put("sessions/session-1", {
        sessionId: "session-1",
        academyId,
        startAt: "2026-09-02T18:00:00.000Z",
        endAt: "2026-09-02T19:00:00.000Z",
      });
      for (const [id, occurredAt] of [
        ["att-1", "2026-08-20T18:00:00.000Z"],
        ["att-2", "2026-09-02T18:00:00.000Z"],
        ["att-3", "2026-09-05T18:00:00.000Z"],
      ] as const) {
        await put(`attendance/${id}`, {
          attendanceId: id,
          academyId,
          studentId: "student-1",
          sessionId: "session-1",
          state: "attended",
          correctionOf: null,
          occurredAt,
        });
      }

      const actor = {
        openedBy: "head-user-1",
        openedByStaffId: "staff-head-1",
        openedByRole: "headCoach" as const,
      };
      await store.openStudentLevel({
        academyId,
        input: {
          studentId: "student-1",
          definitionKey: "white-belt",
          decisionNotes: "Holds a white belt from Regyfit.",
          startedOn: "2026-07-01",
        },
        ...actor,
        openedAt: "2026-09-10T12:00:00.000Z",
      });
      // Plan D writes the baseline on import; here it is added directly to prove the count.
      await firestore!.doc(`academies/${academyId}/studentLevelProgress/student-1`).update({
        importedBaseline: { classes: 9, cutoff: "2026-09-01", source: "regyfit-import" },
      });

      const progress = await store.getStudentProgressSummary(academyId, "student-1");
      if (progress.state !== "initialized") throw new Error("expected initialized");
      // v2 white-1st-stripe: 25 classes, 75 days. Two BPT classes on or after the cutoff
      // (2026-09-02 and 2026-09-05) plus the 9 imported; 2026-08-20 is inside the baseline window
      // and must NOT be counted twice.
      expect(progress.criteria.classes).toEqual({
        required: 25,
        completed: 11,
        imported: 9,
        met: false,
      });

      const decision = {
        decidedBy: "head-user-1",
        decidedByStaffId: "staff-head-1",
        decidedByRole: "headCoach" as const,
        decidedAt: "2026-09-10T12:00:00.000Z",
      };
      // Below criteria with no note: refused outright, before anything is written.
      await expect(
        store.assignLevel({
          academyId,
          input: {
            studentId: "student-1",
            fromDefinitionKey: "white-belt",
            toDefinitionKey: "white-2nd-stripe",
            promotedOn: "2026-09-10",
          },
          ...decision,
        }),
      ).rejects.toMatchObject({ code: "invalid" });
      const assigned = await store.assignLevel({
        academyId,
        input: {
          studentId: "student-1",
          fromDefinitionKey: "white-belt",
          toDefinitionKey: "white-2nd-stripe",
          promotedOn: "2026-09-10",
          note: "Competition result justifies it.",
        },
        ...decision,
      });
      expect(assigned.gaps).toEqual([
        "Skips 1 stripe",
        "Classes 11/25 not met",
        "Days 71/75 not met",
      ]);

      const voided = await store.voidPromotion({
        academyId,
        input: {
          studentId: "student-1",
          promotionId: assigned.promotionId,
          reason: "Assigned to the wrong member by mistake.",
        },
        ...decision,
        decidedAt: "2026-09-11T09:00:00.000Z",
      });
      expect(voided.restoredDefinitionKey).toBe("white-belt");
      const head = (
        await firestore!.doc(`academies/${academyId}/studentLevelProgress/student-1`).get()
      ).data();
      expect(head).toMatchObject({
        currentDefinitionKey: "white-belt",
        importedBaseline: { classes: 9 },
      });

      const history = await store.getStudentLevelHistory(academyId, "student-1");
      expect(
        history.entries.map((entry) => [
          entry.kind,
          entry.definitionKey,
          entry.voided?.reason ?? null,
        ]),
      ).toEqual([
        ["promotion", "white-2nd-stripe", "Assigned to the wrong member by mistake."],
        ["opening", "white-belt", null],
      ]);
    },
  );
});
