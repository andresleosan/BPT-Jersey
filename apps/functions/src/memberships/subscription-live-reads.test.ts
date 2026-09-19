import { expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";
import { listMemberSubscriptionRecords } from "./subscription-admin-service.js";
import { createMemberProfileFirestoreStore } from "../members/member-profile-firestore.js";
const at = "2026-01-01T00:00:00.000Z";
const membership = {
  membershipId: "live",
  academyId: "a",
  studentId: "s",
  familyId: "f",
  planId: PLAN_CATALOG[0]!.planId,
  status: "active",
  startsAt: at,
  endsAt: null,
  nextBillingAt: null,
  schemaVersion: "1",
  createdAt: at,
  updatedAt: at,
  createdBy: "u",
  updatedBy: "u",
};
function harness(records: Record<string, unknown>[], missing = false) {
  const snap = (data: Record<string, unknown>) => ({
    id: data.membershipId,
    data: () => data,
    get: (key: string) => data[key],
  });
  const student = {
    academyId: "a",
    studentId: "s",
    fullName: "Fixture",
    dateOfBirth: "1990-01-01",
    participantType: "adult",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: at,
    updatedAt: at,
    createdBy: "u",
    updatedBy: "u",
  };
  const collection = (name: string): object => {
    const query = {
      where: () => query,
      limit: () => query,
      get: async () => ({ docs: name === "plans" ? [] : records.map(snap), size: records.length }),
      doc: () => ({
        collection,
        get: async () => ({ data: () => (missing ? undefined : student) }),
      }),
    };
    return query;
  };
  return { doc: () => ({ collection }), collection } as unknown as Firestore;
}
it("both Plan and Profile ignore raw imported memberships before domain parsing", async () => {
  const db = harness([
    membership,
    { membershipId: "import", studentId: "s", source: "legacy-import" },
  ]);
  expect(
    (await listMemberSubscriptionRecords(db, "a", "s")).memberships.map((m) => m.membershipId),
  ).toEqual(["live"]);
  expect(
    (await createMemberProfileFirestoreStore(db).listStudentMemberships("a", "s")).map(
      (m) => m.membershipId,
    ),
  ).toEqual(["live"]);
});
it.each(["source", "student", "malformed", "cap"])(
  "rejects %s instead of silently presenting a partial Plan history",
  async (kind) => {
    const records =
      kind === "cap"
        ? Array.from({ length: 101 }, () => membership)
        : [
            {
              ...membership,
              ...(kind === "source"
                ? { source: "other" }
                : kind === "student"
                  ? { studentId: "sibling" }
                  : { startsAt: "invalid" }),
            },
          ];
    await expect(listMemberSubscriptionRecords(harness(records), "a", "s")).rejects.toMatchObject({
      code: "failed-precondition",
    });
  },
);

it("Plan reader reports a deleted canonical member as not-found rather than failed-precondition", async () => {
  const db = harness([membership], true);
  await expect(listMemberSubscriptionRecords(db, "a", "s")).rejects.toMatchObject({
    code: "not-found",
  });
});
