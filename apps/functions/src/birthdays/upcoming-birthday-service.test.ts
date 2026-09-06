import { describe, expect, it } from "vitest";

import {
  UpcomingBirthdayError,
  createUpcomingBirthdayService,
  type BirthdayFirestore,
} from "./upcoming-birthday-service";

const academyId = "academy-1";
const today = "2026-06-15";

type Data = Record<string, unknown>;

function student(overrides: Partial<Data> & { studentId: string }): Data {
  return {
    academyId,
    fullName: "Synthetic Member",
    dateOfBirth: "1990-06-15",
    participantType: "adult",
    trainingCenter: "Town",
    active: true,
    status: "active",
    ...overrides,
  };
}

function firestoreFixture(documents: Map<string, Data>) {
  const reads: { path: string; filters: readonly Readonly<{ field: string; value: unknown }>[] }[] =
    [];
  function query(
    path: string,
    filters: readonly Readonly<{ field: string; value: unknown }>[],
  ): ReturnType<BirthdayFirestore["collection"]> {
    const self = {
      where: (field: string, _operator: "==", value: unknown) =>
        query(path, [...filters, { field, value }]),
      limit: () => self,
      get: async () => {
        reads.push({ path, filters });
        const prefix = `${path}/`;
        return {
          docs: [...documents.entries()]
            .filter(
              ([documentPath, data]) =>
                documentPath.startsWith(prefix) &&
                !documentPath.slice(prefix.length).includes("/") &&
                filters.every(({ field, value }) => data[field] === value),
            )
            .map(([documentPath, data]) => ({
              id: documentPath.split("/").at(-1) ?? "",
              data: () => data,
            })),
        };
      },
    };
    return self as unknown as ReturnType<BirthdayFirestore["collection"]>;
  }
  return {
    reads,
    firestore: { collection: (path: string) => query(path, []) } as BirthdayFirestore,
  };
}

function serviceWith(documents: Map<string, Data>) {
  const fixture = firestoreFixture(documents);
  return {
    ...fixture,
    service: createUpcomingBirthdayService({ firestore: fixture.firestore, now: () => today }),
  };
}

describe("createUpcomingBirthdayService", () => {
  it("returns the birthdays of the active students, nearest first, with no date of birth", async () => {
    const documents = new Map<string, Data>([
      [
        `academies/${academyId}/students/s-1`,
        student({ studentId: "s-1", fullName: "Ana Coelho", dateOfBirth: "1991-06-17" }),
      ],
      [
        `academies/${academyId}/students/s-2`,
        student({
          studentId: "s-2",
          fullName: "Bruno Le Sueur",
          dateOfBirth: "2016-06-15",
          participantType: "minor",
        }),
      ],
    ]);
    const { service } = serviceWith(documents);

    const result = await service.listUpcomingBirthdays({ academyId, query: { windowDays: 7 } });

    expect(result).toEqual([
      {
        studentId: "s-2",
        displayName: "Bruno Le Sueur",
        daysAway: 0,
        participantType: "minor",
        trainingCenter: "Town",
      },
      {
        studentId: "s-1",
        displayName: "Ana Coelho",
        daysAway: 2,
        participantType: "adult",
        trainingCenter: "Town",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("1991");
    expect(JSON.stringify(result)).not.toContain("2016");
  });

  it("asks Firestore only for the active students of the academy", async () => {
    const { service, reads } = serviceWith(new Map());
    await service.listUpcomingBirthdays({ academyId, query: { windowDays: 7 } });
    expect(reads).toEqual([
      { path: `academies/${academyId}/students`, filters: [{ field: "active", value: true }] },
    ]);
  });

  it("keeps the site filter of the coach panel", async () => {
    const documents = new Map<string, Data>([
      [`academies/${academyId}/students/s-town`, student({ studentId: "s-town" })],
      [
        `academies/${academyId}/students/s-west`,
        student({ studentId: "s-west", trainingCenter: "West" }),
      ],
    ]);
    const { service } = serviceWith(documents);
    const result = await service.listUpcomingBirthdays({
      academyId,
      query: { windowDays: 7, trainingCenter: "West" },
    });
    expect(result.map((entry) => entry.studentId)).toEqual(["s-west"]);
  });

  it("ignores a student of another tenant and a document whose id does not match", async () => {
    const documents = new Map<string, Data>([
      [
        `academies/${academyId}/students/s-other`,
        student({ studentId: "s-other", academyId: "academy-2" }),
      ],
      [`academies/${academyId}/students/s-mismatch`, student({ studentId: "s-elsewhere" })],
      [`academies/${academyId}/students/s-good`, student({ studentId: "s-good" })],
    ]);
    const { service } = serviceWith(documents);
    const result = await service.listUpcomingBirthdays({ academyId, query: { windowDays: 7 } });
    expect(result.map((entry) => entry.studentId)).toEqual(["s-good"]);
  });

  it("skips a student whose record is not usable instead of failing the panel", async () => {
    const documents = new Map<string, Data>([
      [
        `academies/${academyId}/students/s-broken`,
        student({ studentId: "s-broken", dateOfBirth: 19_900_615 }),
      ],
      [`academies/${academyId}/students/s-good`, student({ studentId: "s-good" })],
    ]);
    const { service } = serviceWith(documents);
    const result = await service.listUpcomingBirthdays({ academyId, query: { windowDays: 7 } });
    expect(result.map((entry) => entry.studentId)).toEqual(["s-good"]);
  });

  it("refuses rather than showing a partial list above the page size", async () => {
    const documents = new Map<string, Data>();
    for (let index = 0; index <= 2_000; index += 1) {
      documents.set(
        `academies/${academyId}/students/s-${index}`,
        student({ studentId: `s-${index}` }),
      );
    }
    const { service } = serviceWith(documents);
    await expect(
      service.listUpcomingBirthdays({ academyId, query: { windowDays: 7 } }),
    ).rejects.toThrow(UpcomingBirthdayError);
  });

  it("refuses an invalid academy or day", async () => {
    const { service } = serviceWith(new Map());
    await expect(
      service.listUpcomingBirthdays({ academyId: "../escape", query: { windowDays: 7 } }),
    ).rejects.toThrow(UpcomingBirthdayError);
    await expect(
      service.listUpcomingBirthdays({ academyId, query: { windowDays: 7 }, today: "2026-6-15" }),
    ).rejects.toThrow(UpcomingBirthdayError);
  });

  it("uses the injected clock, so a birthday is relative to the academy day", async () => {
    const documents = new Map<string, Data>([
      [
        `academies/${academyId}/students/s-1`,
        student({ studentId: "s-1", dateOfBirth: "1990-12-31" }),
      ],
    ]);
    const { service } = serviceWith(documents);
    expect(
      await service.listUpcomingBirthdays({ academyId, query: { windowDays: 7 } }),
    ).toHaveLength(0);
    expect(
      await service.listUpcomingBirthdays({
        academyId,
        query: { windowDays: 7 },
        today: "2026-12-28",
      }),
    ).toHaveLength(1);
  });
});
