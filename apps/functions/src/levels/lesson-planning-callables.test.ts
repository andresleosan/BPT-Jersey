import { describe, expect, it, vi } from "vitest";

import type {
  LessonPlanRecord,
  TechniqueLibraryVersion,
} from "@bpt-jersey/domain/levels/lesson-planning";

import {
  createApproveLessonPlanHandler,
  createGetLessonPlanHandler,
} from "./lesson-planning-callables";
import type { LessonPlanningStore } from "./lesson-planning-service";
import type { LevelAuthorizationService } from "./level-authorization";

const library: TechniqueLibraryVersion = {
  libraryId: "library-1",
  version: 1,
  status: "published",
  publishedAt: "2026-08-31T10:00:00.000Z",
  techniques: [
    {
      techniqueId: "technique-1",
      label: "Guard pass",
      skillKey: "guard-pass",
      sequence: 1,
      active: true,
    },
  ],
};
const plan: LessonPlanRecord = {
  planId: "plan-1",
  academyId: "academy-1",
  title: "Synthetic plan",
  libraryId: "library-1",
  libraryVersion: 1,
  status: "submitted",
  activities: [
    {
      activityId: "activity-1",
      kind: "technique",
      techniqueId: "technique-1",
      durationMinutes: 30,
      sequence: 1,
    },
  ],
  approvedByStaffId: null,
  approvedAt: null,
};

function request(data: unknown, role: string, uid = "staff-1") {
  return {
    auth: { uid, token: { academyId: "academy-1", role } },
    app: { appId: "test-app" },
    data,
  } as never;
}

const authorization: LevelAuthorizationService = {
  requireActor: async (call) => {
    if (!call.auth) throw Object.assign(new Error("unauthenticated"), { code: "unauthenticated" });
    return {
      kind: "user",
      userId: call.auth.uid as never,
      academyId: "academy-1" as never,
      role: call.auth.token.role as never,
      staffId:
        call.auth.token.role === "headCoach" || call.auth.token.role === "coach" ? "staff-1" : null,
    };
  },
  resolveStudent: async () => {
    throw new Error("unused");
  },
};

function store(overrides: Partial<LessonPlanningStore> = {}): LessonPlanningStore {
  return {
    getLibrary: vi.fn(async () => library),
    saveLibrary: vi.fn(),
    getPlan: vi.fn(async () => plan),
    savePlan: vi.fn(),
    approvePlan: vi.fn(async () => ({ ...plan, status: "approved" as const })),
    ...overrides,
  };
}

describe("lesson planning callables", () => {
  it.each(["owner", "administrator", "headCoach", "coach"])(
    "allows %s to read a plan",
    async (role) => {
      const current = store();
      const response = await createGetLessonPlanHandler({ store: current, authorization })(
        request({ planId: "plan-1" }, role),
      );
      expect(response).toEqual({ plan, library });
      expect(current.getPlan).toHaveBeenCalledWith("academy-1", "plan-1");
    },
  );

  it("allows only headCoach to approve and derives the staff identity from auth", async () => {
    const current = store();
    const response = await createApproveLessonPlanHandler({ store: current, authorization })(
      request({ planId: "plan-1" }, "headCoach", "head-coach-1"),
    );

    expect(response.plan.status).toBe("approved");
    expect(current.approvePlan).toHaveBeenCalledWith({
      academyId: "academy-1",
      planId: "plan-1",
      input: expect.objectContaining({
        staffId: "staff-1",
        staffRole: "head_coach",
        approvedAt: expect.any(String),
      }),
    });
  });

  it("denies owner approval, malformed payloads and unauthenticated requests", async () => {
    const current = store();
    const approve = createApproveLessonPlanHandler({ store: current, authorization });
    const get = createGetLessonPlanHandler({ store: current, authorization });

    await expect(approve(request({ planId: "plan-1" }, "owner"))).rejects.toMatchObject({
      code: "permission-denied",
    });
    await expect(
      approve(request({ planId: "plan-1", extra: true }, "headCoach")),
    ).rejects.toMatchObject({
      code: "invalid-argument",
    });
    await expect(
      get({ auth: undefined, data: { planId: "plan-1" } } as never),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });
});
