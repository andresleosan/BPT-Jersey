import { describe, expect, it } from "vitest";

import { createCanonicalClientStudentScopeResolver } from "./canonical-client-student-scope";

const timestamp = "2026-09-03T12:00:00.000Z";

function audit() {
  return {
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: timestamp,
    createdBy: "owner-1",
    updatedAt: timestamp,
    updatedBy: "owner-1",
  };
}

describe("canonical client student scope", () => {
  it("resolves an adult by unique students.userId and a guardian by the active family chain", async () => {
    const documents = new Map<string, Record<string, unknown>>([
      [
        "academies/academy-1/students/student-opaque-1",
        {
          studentId: "student-opaque-1",
          academyId: "academy-1",
          userId: "adult-user-1",
          fullName: "Synthetic Adult",
          dateOfBirth: "1990-01-01",
          trainingCenter: "Town",
          trainingTimePreferences: ["evening"],
          participantType: "adult",
          ...audit(),
        },
      ],
      [
        "academies/academy-1/students/minor-1",
        {
          studentId: "minor-1",
          academyId: "academy-1",
          familyId: "family-1",
          fullName: "Synthetic Minor",
          dateOfBirth: "2015-01-01",
          trainingCenter: "Town",
          trainingTimePreferences: ["afternoon"],
          participantType: "minor",
          ...audit(),
        },
      ],
      [
        "academies/academy-1/families/family-1",
        {
          familyId: "family-1",
          academyId: "academy-1",
          primaryContactUserId: "guardian-1",
          billingContactUserId: "guardian-1",
          ...audit(),
        },
      ],
      [
        "academies/academy-1/relationships/relation-1",
        {
          relationshipId: "relation-1",
          academyId: "academy-1",
          familyId: "family-1",
          studentId: "minor-1",
          adultUserId: "guardian-1",
          relationshipType: "guardian",
          permissions: ["readProfile"],
          validFrom: "2026-01-01T00:00:00.000Z",
          ...audit(),
        },
      ],
    ]);
    const resolver = createCanonicalClientStudentScopeResolver({
      now: () => timestamp,
      getDocument: async (path) => ({
        id: path.split("/").at(-1) ?? "",
        exists: documents.has(path),
        data: documents.get(path),
      }),
      queryDocuments: async (path, field, value, limit) =>
        [...documents.entries()]
          .filter(([documentPath, data]) => {
            const suffix = documentPath.slice(path.length + 1);
            return (
              documentPath.startsWith(path + "/") && !suffix.includes("/") && data[field] === value
            );
          })
          .slice(0, limit)
          .map(([documentPath, data]) => ({
            id: documentPath.split("/").at(-1) ?? "",
            exists: true,
            data,
          })),
    });

    await expect(
      resolver({
        academyId: "academy-1",
        actorUserId: "adult-user-1",
        actorRole: "adultStudent",
        requestedStudentId: "student-opaque-1",
      }),
    ).resolves.toBe(true);
    await expect(
      resolver({
        academyId: "academy-1",
        actorUserId: "adult-user-1",
        actorRole: "adultStudent",
        requestedStudentId: "adult-user-1",
      }),
    ).resolves.toBe(false);
    await expect(
      resolver({
        academyId: "academy-1",
        actorUserId: "guardian-1",
        actorRole: "guardian",
        requestedStudentId: "minor-1",
      }),
    ).resolves.toBe(true);
    await expect(
      resolver({
        academyId: "academy-2",
        actorUserId: "guardian-1",
        actorRole: "guardian",
        requestedStudentId: "minor-1",
      }),
    ).resolves.toBe(false);
  });
});
