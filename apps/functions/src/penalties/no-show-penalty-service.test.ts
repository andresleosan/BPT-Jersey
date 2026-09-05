import { describe, expect, it } from "vitest";

import { NoShowPenaltyError, createNoShowPenaltyService } from "./no-show-penalty-service";

const academyId = "academy-1";
const sessionId = "session-1";
const now = "2026-09-10T19:30:00.000Z";
const sessionStartAt = "2026-09-10T18:00:00.000Z";

type Data = Record<string, unknown>;
type Reference = Readonly<{ id: string; path: string }>;

function collectionFixture(documents: Map<string, Data>) {
  function query(path: string, filters: readonly Readonly<{ field: string; value: unknown }>[]) {
    const self = {
      where: (field: string, _operator: "==", value: unknown) =>
        query(path, [...filters, { field, value }]),
      limit: () => self,
      get: async () => ({ docs: docsFor(path, filters) }),
      path,
      filters,
    };
    return self;
  }

  function docsFor(path: string, filters: readonly Readonly<{ field: string; value: unknown }>[]) {
    const prefix = path + "/";
    return [...documents.entries()]
      .filter(
        ([documentPath, data]) =>
          documentPath.startsWith(prefix) &&
          !documentPath.slice(prefix.length).includes("/") &&
          filters.every(({ field, value }) => data[field] === value),
      )
      .map(([documentPath, data]) => ({
        id: documentPath.split("/").at(-1) ?? "",
        exists: true,
        data: () => data,
      }));
  }

  return {
    documents,
    firestore: {
      doc: (path: string): Reference => ({ id: path.split("/").at(-1) ?? "", path }),
      collection: (path: string) => query(path, []),
      runTransaction: async <T>(callback: (transaction: unknown) => Promise<T>) => {
        const staged = new Map(documents);
        const transaction = {
          get: async (target: Reference | { path: string; filters: never[] }) => {
            if ("filters" in target) return { docs: docsFor(target.path, target.filters) };
            return {
              id: target.id,
              exists: staged.has(target.path),
              data: () => staged.get(target.path),
            };
          },
          create: (reference: Reference, data: Data) => {
            if (staged.has(reference.path)) throw new Error("already exists");
            staged.set(reference.path, data);
          },
          set: (reference: Reference, data: Data) => staged.set(reference.path, data),
        };
        const result = await callback(transaction);
        documents.clear();
        for (const [path, data] of staged) documents.set(path, data);
        return result;
      },
    },
  };
}

function attendance(studentId: string, state: string): readonly [string, Data] {
  return [
    `academies/${academyId}/attendance/${sessionId}__${studentId}`,
    {
      attendanceId: `${sessionId}__${studentId}`,
      academyId,
      sessionId,
      studentId,
      state,
      method: "manual",
      occurredAt: sessionStartAt,
      notes: null,
      correctionOf: null,
      schemaVersion: "1",
      createdAt: sessionStartAt,
      createdBy: "coach-1",
      updatedAt: sessionStartAt,
      updatedBy: "coach-1",
    },
  ];
}

function fixtureWith(
  entries: readonly (readonly [string, Data])[],
  locationId = "town",
): ReturnType<typeof collectionFixture> & {
  service: ReturnType<typeof createNoShowPenaltyService>;
} {
  const fixture = collectionFixture(
    new Map<string, Data>([
      [
        `academies/${academyId}/sessions/${sessionId}`,
        {
          sessionId,
          academyId,
          locationId,
          startAt: sessionStartAt,
          status: "completed",
          minParticipants: 4,
          title: "Adults Gi - Town",
        },
      ],
      ...entries,
    ]),
  );
  return Object.assign(fixture, {
    service: createNoShowPenaltyService({
      firestore: fixture.firestore as never,
      now: () => now,
    }),
  });
}

const penaltyPath = (studentId: string) =>
  `academies/${academyId}/noShowPenalties/${sessionId}__${studentId}`;

describe("no-show penalty service (T111)", () => {
  it("proposes fifteen pounds per Town no-show and audits each proposal", async () => {
    const fixture = fixtureWith([
      attendance("student-1", "no_show"),
      attendance("student-2", "attended"),
      attendance("student-3", "no_show"),
    ]);

    const result = await fixture.service.proposeNoShowPenalties({
      academyId,
      sessionId,
      actorId: "coach-1",
    });

    expect(result.proposed.map((penalty) => penalty.studentId).sort()).toEqual([
      "student-1",
      "student-3",
    ]);
    expect(result.proposed[0]).toMatchObject({
      amountMinor: 1_500,
      currency: "GBP",
      status: "proposed",
      locationId: "town",
      sessionStartAt,
      resolution: null,
      proposedBy: "coach-1",
    });
    expect(result.skipped).toEqual([]);
    expect(result.alreadyProposed).toBe(0);
    expect(
      fixture.documents.get(
        `academies/${academyId}/auditEvents/no-show-penalty-proposed-${sessionId}__student-1`,
      ),
    ).toMatchObject({ action: "penalty.no_show.proposed", actorId: "coach-1" });
  });

  it("proposes nothing at another site, and says why", async () => {
    const fixture = fixtureWith([attendance("student-1", "no_show")], "west");

    const result = await fixture.service.proposeNoShowPenalties({
      academyId,
      sessionId,
      actorId: "coach-1",
    });

    expect(result.proposed).toEqual([]);
    expect(result.skipped).toEqual([{ studentId: "student-1", skipReason: "otherSite" }]);
    expect(fixture.documents.has(penaltyPath("student-1"))).toBe(false);
  });

  it("shields an absence covered by an approved medical leave", async () => {
    const fixture = fixtureWith([
      attendance("student-1", "no_show"),
      [
        `academies/${academyId}/medicalLeaves/leave-1`,
        {
          leaveId: "leave-1",
          academyId,
          studentId: "student-1",
          startDate: "2026-09-01",
          endDate: "2026-09-30",
          status: "active",
        },
      ],
    ]);

    const result = await fixture.service.proposeNoShowPenalties({
      academyId,
      sessionId,
      actorId: "coach-1",
    });

    expect(result.proposed).toEqual([]);
    expect(result.skipped).toEqual([{ studentId: "student-1", skipReason: "medicalLeave" }]);
  });

  it("proposes each absence once, however often it runs", async () => {
    const fixture = fixtureWith([attendance("student-1", "no_show")]);
    await fixture.service.proposeNoShowPenalties({ academyId, sessionId, actorId: "coach-1" });
    const afterFirst = new Map(fixture.documents);

    const repeat = await fixture.service.proposeNoShowPenalties({
      academyId,
      sessionId,
      actorId: "coach-1",
    });

    expect(repeat).toMatchObject({ alreadyProposed: 1 });
    expect(repeat.proposed).toEqual([]);
    expect([...fixture.documents.entries()]).toEqual([...afterFirst.entries()]);
  });

  it("lets office charge a proposal once, linking the invoice it issued", async () => {
    const fixture = fixtureWith([attendance("student-1", "no_show")]);
    await fixture.service.proposeNoShowPenalties({ academyId, sessionId, actorId: "coach-1" });
    const resolution = {
      penaltyId: `${sessionId}__student-1`,
      decision: "charge" as const,
      reason: "Charged on the September invoice after office review.",
      invoiceId: "invoice-1",
    };

    const charged = await fixture.service.resolveNoShowPenalty({
      academyId,
      actorId: "office-1",
      resolution,
    });

    expect(charged).toMatchObject({
      status: "charged",
      resolution: {
        decision: "charge",
        invoiceId: "invoice-1",
        resolvedBy: "office-1",
        resolvedAt: now,
      },
    });
    expect(
      fixture.documents.get(
        `academies/${academyId}/auditEvents/no-show-penalty-resolved-${sessionId}__student-1`,
      ),
    ).toMatchObject({ action: "penalty.no_show.resolved", actorId: "office-1" });

    // A second resolution is refused: a charge cannot quietly become a waiver.
    await expect(
      fixture.service.resolveNoShowPenalty({
        academyId,
        actorId: "office-1",
        resolution: { ...resolution, decision: "waive", reason: "Changed my mind about it." },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("lets office waive a proposal with a reason and no invoice", async () => {
    const fixture = fixtureWith([attendance("student-1", "no_show")]);
    await fixture.service.proposeNoShowPenalties({ academyId, sessionId, actorId: "coach-1" });

    const waived = await fixture.service.resolveNoShowPenalty({
      academyId,
      actorId: "office-1",
      resolution: {
        penaltyId: `${sessionId}__student-1`,
        decision: "waive",
        reason: "First absence and the student warned the coach in advance.",
      },
    });

    expect(waived).toMatchObject({
      status: "waived",
      resolution: { decision: "waive", invoiceId: null },
    });
  });

  it("lists the queue, oldest class first, and filters by status", async () => {
    const fixture = fixtureWith([
      attendance("student-1", "no_show"),
      attendance("student-2", "no_show"),
    ]);
    await fixture.service.proposeNoShowPenalties({ academyId, sessionId, actorId: "coach-1" });
    await fixture.service.resolveNoShowPenalty({
      academyId,
      actorId: "office-1",
      resolution: {
        penaltyId: `${sessionId}__student-1`,
        decision: "waive",
        reason: "Waived after office review of the absence.",
      },
    });

    expect(await fixture.service.listNoShowPenalties({ academyId })).toHaveLength(2);
    const open = await fixture.service.listNoShowPenalties({ academyId, status: "proposed" });
    expect(open.map((penalty) => penalty.studentId)).toEqual(["student-2"]);
  });

  it("refuses an unknown session, an unknown penalty and a foreign tenant", async () => {
    const fixture = fixtureWith([]);
    await expect(
      fixture.service.proposeNoShowPenalties({
        academyId,
        sessionId: "session-absent",
        actorId: "coach-1",
      }),
    ).rejects.toMatchObject({ code: "not-found" });

    await expect(
      fixture.service.resolveNoShowPenalty({
        academyId,
        actorId: "office-1",
        resolution: {
          penaltyId: "session-1__absent",
          decision: "waive",
          reason: "Nothing here to waive at all.",
        },
      }),
    ).rejects.toBeInstanceOf(NoShowPenaltyError);

    const foreign = fixtureWith([attendance("student-1", "no_show")]);
    await foreign.service.proposeNoShowPenalties({ academyId, sessionId, actorId: "coach-1" });
    await expect(
      foreign.service.resolveNoShowPenalty({
        academyId: "other-academy",
        actorId: "office-1",
        resolution: {
          penaltyId: `${sessionId}__student-1`,
          decision: "waive",
          reason: "Trying from the wrong academy entirely.",
        },
      }),
    ).rejects.toMatchObject({ code: "not-found" });
  });
});
