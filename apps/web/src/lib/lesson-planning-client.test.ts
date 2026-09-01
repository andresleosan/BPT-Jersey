import { afterEach, describe, expect, it, vi } from "vitest";

import { approveLessonPlan, getLessonPlan } from "./lesson-planning-client";

const response = {
  data: {
    plan: {
      planId: "plan-1",
      academyId: "academy-1",
      title: "Synthetic guard passing",
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
    },
    library: {
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
    },
  },
};

const api = vi.hoisted(() => ({
  httpsCallable: vi.fn(),
  callable: vi.fn(),
}));

vi.mock("firebase/functions", () => ({ httpsCallable: api.httpsCallable }));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));

describe("lesson planning web client", () => {
  afterEach(() => vi.clearAllMocks());

  it("loads and validates a plan with its versioned library", async () => {
    api.httpsCallable.mockReturnValue(api.callable);
    api.callable.mockResolvedValue(response);

    const result = await getLessonPlan("plan-1");

    expect(result.plan.title).toBe("Synthetic guard passing");
    expect(result.library.techniques[0]?.label).toBe("Guard pass");
    expect(api.httpsCallable).toHaveBeenCalledWith({}, "getLessonPlan");
    expect(api.callable).toHaveBeenCalledWith({ planId: "plan-1" });
  });

  it("rejects unsafe IDs and malformed payloads with a safe error", async () => {
    await expect(getLessonPlan("plan/other")).rejects.toThrow(safeError());

    api.httpsCallable.mockReturnValue(api.callable);
    api.callable.mockResolvedValue({ data: { plan: response.data.plan } });
    await expect(getLessonPlan("plan-1")).rejects.toThrow(safeError());
  });

  it("validates an approved plan against the already loaded library", async () => {
    api.httpsCallable.mockReturnValue(api.callable);
    api.callable.mockResolvedValue({
      data: {
        plan: {
          ...response.data.plan,
          status: "approved",
          approvedByStaffId: "head-coach-1",
          approvedAt: "2026-08-31T11:00:00.000Z",
        },
      },
    });

    const result = await approveLessonPlan("plan-1", {
      libraryId: "library-1",
      version: 1,
      status: "published",
      publishedAt: "2026-08-31T10:00:00.000Z",
      techniques: response.data.library.techniques,
    });

    expect(result.status).toBe("approved");
    expect(api.httpsCallable).toHaveBeenCalledWith({}, "approveLessonPlan");
    expect(api.callable).toHaveBeenCalledWith({ planId: "plan-1" });
  });
});

function safeError(): string {
  return "Unable to load the lesson plan. Please try again.";
}
