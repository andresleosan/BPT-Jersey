import { describe, expect, it, vi } from "vitest";

import type { UserActorContext } from "@bpt-jersey/domain";
import { parseAuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  createApprovePromotionHandler,
  createGetStudentProgressSummaryHandler,
  createListLevelCatalogHandler,
} from "./level-callables";
import { createLevelCatalogStore } from "./level-service";
import {
  createLevelAuthorization,
  type AuthorizedLevelActor,
  type LevelAuthorizationService,
} from "./level-authorization";

const timestamp = "2026-09-03T12:00:00.000Z";

function student(overrides: Record<string, unknown> = {}) {
  const value: Record<string, unknown> = {
    studentId: "student-opaque-1",
    academyId: "academy-1",
    userId: "adult-user-1",
    fullName: "Synthetic Adult",
    dateOfBirth: "1990-01-01",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: timestamp,
    createdBy: "owner-1",
    updatedAt: timestamp,
    updatedBy: "owner-1",
    ...overrides,
  };
  if (value.userId === undefined) delete value.userId;
  return value;
}

function clientUser(userId: string) {
  return {
    userId,
    academyId: "academy-1",
    accountType: "client",
    displayName: "Synthetic Client",
    email: "client@example.test",
    phoneNumber: "+441534000000",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: timestamp,
    createdBy: "owner-1",
    updatedAt: timestamp,
    updatedBy: "owner-1",
  };
}

function request(data: unknown, role: string, uid: string, app = true) {
  return {
    auth: { uid, token: { academyId: "academy-1", role } },
    app: app ? { appId: "test-app" } : undefined,
    data,
  } as never;
}

function authorizationFixture() {
  const documents = new Map<string, Record<string, unknown>>([
    ["academies/academy-1/users/adult-user-1", clientUser("adult-user-1")],
    ["academies/academy-1/users/guardian-1", clientUser("guardian-1")],
    [
      "academies/academy-1/users/coach-user-1",
      {
        userId: "coach-user-1",
        academyId: "academy-1",
        accountType: "staff",
        active: true,
        status: "active",
      },
    ],
    [
      "academies/academy-1/staff/staff-1",
      {
        staffId: "staff-1",
        academyId: "academy-1",
        userId: "coach-user-1",
        role: "coach",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: timestamp,
        createdBy: "owner-1",
        updatedAt: timestamp,
        updatedBy: "owner-1",
      },
    ],
    ["academies/academy-1/students/student-opaque-1", student()],
    [
      "academies/academy-1/students/minor-1",
      student({
        studentId: "minor-1",
        userId: undefined,
        familyId: "family-1",
        fullName: "Synthetic Minor",
        dateOfBirth: "2015-01-01",
        participantType: "minor",
      }),
    ],
    [
      "academies/academy-1/families/family-1",
      {
        familyId: "family-1",
        academyId: "academy-1",
        primaryContactUserId: "guardian-1",
        billingContactUserId: "guardian-1",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: timestamp,
        createdBy: "owner-1",
        updatedAt: timestamp,
        updatedBy: "owner-1",
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
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: timestamp,
        createdBy: "owner-1",
        updatedAt: timestamp,
        updatedBy: "owner-1",
      },
    ],
  ]);
  const claimsByUser = new Map([
    ["adult-user-1", { academyId: "academy-1", role: "adultStudent" }],
    ["guardian-1", { academyId: "academy-1", role: "guardian" }],
    ["coach-user-1", { academyId: "academy-1", role: "coach" }],
  ]);

  return createLevelAuthorization({
    now: () => timestamp,
    getAuthUser: async (uid) => ({
      uid,
      disabled: false,
      customClaims: claimsByUser.get(uid) ?? {},
    }),
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
}

describe("canonical Levels security boundary", () => {
  it("requires verified App Check before reading even the catalog", async () => {
    const store = { listPublished: vi.fn() } as never;
    const handler = createListLevelCatalogHandler({
      store,
      authorization: authorizationFixture(),
    });

    await expect(
      handler(request(null, "adultStudent", "adult-user-1", false)),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(
      (store as { listPublished: ReturnType<typeof vi.fn> }).listPublished,
    ).not.toHaveBeenCalled();
  });

  it("resolves an adult through the unique canonical students.userId link", async () => {
    const authorization = authorizationFixture();
    const actor = await authorization.requireActor(request({}, "adultStudent", "adult-user-1"));

    await expect(authorization.resolveStudent(actor, undefined)).resolves.toMatchObject({
      studentId: "student-opaque-1",
      userId: "adult-user-1",
      participantType: "adult",
    });
    await expect(authorization.resolveStudent(actor, "adult-user-1")).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("revalidates an active staff profile and resolves its canonical staffId", async () => {
    await expect(
      authorizationFixture().requireActor(request({}, "coach", "coach-user-1")),
    ).resolves.toMatchObject({
      userId: "coach-user-1",
      role: "coach",
      staffId: "staff-1",
    });
  });

  it("permits a guardian only through a current active same-family relationship", async () => {
    const authorization = authorizationFixture();
    const actor = await authorization.requireActor(request({}, "guardian", "guardian-1"));

    await expect(authorization.resolveStudent(actor, "minor-1")).resolves.toMatchObject({
      studentId: "minor-1",
      familyId: "family-1",
      participantType: "minor",
    });
    await expect(authorization.resolveStudent(actor, "student-opaque-1")).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("rejects browser-supplied progress state before invoking the store", async () => {
    const actor = {
      kind: "user",
      userId: "coach-user-1",
      academyId: "academy-1",
      role: "coach",
      staffId: "staff-1",
    } as AuthorizedLevelActor;
    const authorization: LevelAuthorizationService = {
      requireActor: vi.fn(async () => actor),
      resolveStudent: vi.fn(async () => student() as never),
    };
    const store = { getStudentProgressSummary: vi.fn() } as never;
    const handler = createGetStudentProgressSummaryHandler({ store, authorization });

    await expect(
      handler(
        request(
          { studentId: "student-opaque-1", currentDefinitionKey: "white-0" },
          "coach",
          "coach-user-1",
        ),
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(
      (store as { getStudentProgressSummary: ReturnType<typeof vi.fn> }).getStudentProgressSummary,
    ).not.toHaveBeenCalled();
  });

  it("returns uninitialized from the direct canonical head and never probes members", async () => {
    const readPaths: string[] = [];
    const records = new Map<string, Record<string, unknown>>([
      ["academies/academy-1/students/student-opaque-1", student()],
    ]);
    const firestore = {
      doc(path: string) {
        return {
          id: path.split("/").at(-1) ?? "",
          get: async () => {
            readPaths.push(path);
            return {
              exists: records.has(path),
              data: () => records.get(path),
            };
          },
          set: async () => undefined,
          delete: async () => undefined,
        };
      },
      collection: vi.fn(() => {
        throw new Error("uninitialized progress must not enumerate collections");
      }),
      batch: vi.fn(() => {
        throw new Error("uninitialized progress must not write");
      }),
      runTransaction: vi.fn(() => {
        throw new Error("uninitialized progress must not write");
      }),
    };
    const store = createLevelCatalogStore({ firestore: firestore as never });

    await expect(store.getStudentProgressSummary("academy-1", "student-opaque-1")).resolves.toEqual(
      {
        state: "uninitialized",
        studentId: "student-opaque-1",
        calculatedAt: expect.any(String),
      },
    );
    expect(readPaths).toEqual([
      "academies/academy-1/students/student-opaque-1",
      "academies/academy-1/studentLevelProgress/student-opaque-1",
    ]);
    expect(readPaths.some((path) => path.includes("/members"))).toBe(false);
  });

  it("accepts only closed, tenant-bound audit drafts for canonical level writes", () => {
    const correlationId = `level-write-${"a".repeat(64)}`;
    const cases = [
      ["level.assessment.recorded", "assessments", "student-development-assessment"],
      ["level.medical-leave.recorded", "medicalLeaves", "student-medical-leave"],
      ["level.promotion.approved", "levelPromotions", "student-level-promotion"],
      ["level.promotion.rejected", "levelPromotions", "student-level-promotion"],
    ] as const;

    for (const [action, collection, purpose] of cases) {
      const draft = {
        academyId: "academy-1",
        actorId: "staff-user-1",
        action,
        targetRef: `academies/academy-1/${collection}/opaque-record-1`,
        purpose,
        correlationId,
      };
      expect(parseAuditEventDraft(draft).ok).toBe(true);
      expect(
        parseAuditEventDraft({ ...draft, targetRef: `${collection}/opaque-record-1` }).ok,
      ).toBe(false);
    }
  });

  it("atomically writes a direct assessment and standard audit for the assigned coach", async () => {
    const records = new Map<string, Record<string, unknown>>([
      [
        "academies/academy-1/users/coach-user-1",
        {
          userId: "coach-user-1",
          academyId: "academy-1",
          accountType: "staff",
          active: true,
          status: "active",
        },
      ],
      [
        "academies/academy-1/staff/staff-1",
        {
          staffId: "staff-1",
          academyId: "academy-1",
          userId: "coach-user-1",
          role: "coach",
          active: true,
          status: "active",
          schemaVersion: "1",
          createdAt: timestamp,
          createdBy: "owner-1",
          updatedAt: timestamp,
          updatedBy: "owner-1",
        },
      ],
      ["academies/academy-1/students/student-opaque-1", student()],
      [
        "academies/academy-1/sessions/session-1",
        {
          sessionId: "session-1",
          academyId: "academy-1",
          instructorId: "staff-1",
          status: "completed",
        },
      ],
      [
        "academies/academy-1/levelDefinitions/white-1",
        {
          definitionKey: "white-1",
          academyId: "academy-1",
          systemId: "system-1",
        },
      ],
      [
        "academies/academy-1/levelSystems/system-1",
        {
          systemId: "system-1",
          academyId: "academy-1",
          status: "published",
          skillCatalog: [{ key: "guard-pass" }],
        },
      ],
    ]);
    const creates: { path: string; data: Record<string, unknown> }[] = [];
    const reference = (path: string) => ({
      id: path.split("/").at(-1) ?? "",
      path,
      get: async () => ({ exists: records.has(path), data: () => records.get(path) }),
      set: async () => undefined,
      delete: async () => undefined,
    });
    const firestore = {
      doc: reference,
      collection: vi.fn(() => ({ get: async () => ({ docs: [] }) })),
      batch: vi.fn(() => {
        throw new Error("assessment must use a transaction");
      }),
      runTransaction: async <T>(
        update: (transaction: {
          get: (ref: ReturnType<typeof reference>) => Promise<{
            exists: boolean;
            data: () => Record<string, unknown> | undefined;
          }>;
          create: (ref: ReturnType<typeof reference>, data: Record<string, unknown>) => void;
          set: (ref: ReturnType<typeof reference>, data: Record<string, unknown>) => void;
        }) => Promise<T>,
      ) =>
        update({
          get: async (ref) => ({
            exists: records.has(ref.path),
            data: () => records.get(ref.path),
          }),
          create: (ref, data) => {
            if (records.has(ref.path)) throw new Error("create collision");
            creates.push({ path: ref.path, data });
            records.set(ref.path, data);
          },
          set: (ref, data) => records.set(ref.path, data),
        }),
    };
    const store = createLevelCatalogStore({ firestore: firestore as never });

    const assessment = await store.recordEvaluation({
      academyId: "academy-1",
      input: {
        studentId: "student-opaque-1",
        sessionId: "session-1",
        definitionKey: "white-1",
        skillKey: "guard-pass",
        score: 4,
        evidenceNotes: "Observed under resistance in the assigned session.",
      },
      evaluatorId: "coach-user-1",
      evaluatorStaffId: "staff-1",
      evaluatorRole: "coach",
      evaluatedAt: timestamp,
    });

    expect(assessment.sessionId).toBe("session-1");
    expect(creates).toHaveLength(2);
    expect(creates[0]).toMatchObject({
      path: `academies/academy-1/assessments/${assessment.evaluationId}`,
      data: {
        assessmentId: assessment.evaluationId,
        academyId: "academy-1",
        studentId: "student-opaque-1",
        coachStaffId: "staff-1",
        sessionId: "session-1",
        status: "recorded",
      },
    });
    expect(creates[1]).toMatchObject({
      path: expect.stringMatching(/^academies\/academy-1\/auditEvents\/audit-level-write-/u),
      data: {
        action: "level.assessment.recorded",
        targetRef: `academies/academy-1/assessments/${assessment.evaluationId}`,
        purpose: "student-development-assessment",
        result: "completed",
        schemaVersion: 1,
      },
    });
    expect(creates.some(({ path }) => /\/members(?:\/|$)|\/evaluations(?:\/|$)/u.test(path))).toBe(
      false,
    );
  });

  it("allows formal promotion decisions only for the current head coach", async () => {
    const promotion = {
      studentId: "student-opaque-1",
      fromDefinitionKey: "white-0",
      toDefinitionKey: "white-1",
      decisionNotes: "Reviewed in person by the current head coach.",
    };
    const store = { approvePromotion: vi.fn(async () => ({ status: "approved" })) } as never;
    const studentProfile = student();
    const serviceFor = (role: UserActorContext["role"]): LevelAuthorizationService => ({
      requireActor: vi.fn(
        async () =>
          ({
            kind: "user",
            userId: `${role}-user`,
            academyId: "academy-1",
            role,
            staffId: role === "headCoach" ? "staff-head-1" : null,
          }) as AuthorizedLevelActor,
      ),
      resolveStudent: vi.fn(async () => studentProfile as never),
    });

    await expect(
      createApprovePromotionHandler({ store, authorization: serviceFor("owner") })(
        request(promotion, "owner", "owner-user"),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });

    await createApprovePromotionHandler({
      store,
      authorization: serviceFor("headCoach"),
    })(request(promotion, "headCoach", "headCoach-user"));
    expect(
      (store as { approvePromotion: ReturnType<typeof vi.fn> }).approvePromotion,
    ).toHaveBeenCalledWith(expect.objectContaining({ decidedByRole: "headCoach" }));
  });
});
