import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "owner",
  head: {} as Record<string, unknown>,
  writes: [] as Record<string, unknown>[],
}));
vi.mock("../auth/office-actor.js", () => ({
  requireActiveOfficeActor: async () => ({
    role: state.role, userId: "synthetic-owner", academyId: "synthetic-academy",
  }),
}));
vi.mock("firebase-admin/firestore", async (importOriginal) => ({
  ...await importOriginal<typeof import("firebase-admin/firestore")>(),
  getFirestore: () => ({
    doc: (path: string) => ({ path }),
    collection: (path: string) => ({ doc: () => ({ path: `${path}/synthetic-change` }) }),
    runTransaction: async (update: (transaction: unknown) => Promise<unknown>) => {
      const pending: (() => void)[] = [];
      await update({
        get: async () => ({ exists: true, data: () => state.head }),
        set: (_ref: unknown, data: Record<string, unknown>) => pending.push(() => {
          state.head = data;
          state.writes.push(data);
        }),
        create: (_ref: unknown, data: Record<string, unknown>) => pending.push(() => state.writes.push(data)),
      });
      pending.forEach((apply) => apply());
    },
  }),
}));

import { setProgressClassCount } from "./progress-management-callables";
import { countClassesAtLevel } from "@bpt-jersey/domain/levels";

const request = (data: Record<string, unknown>) => ({
  data: { studentId: "synthetic-member", ...data },
  auth: { uid: "synthetic-owner", token: { name: "Synthetic Owner" } },
}) as never;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T10:00:00.000Z"));
  state.role = "owner";
  state.writes = [];
  state.head = {
    academyId: "synthetic-academy", studentId: "synthetic-member", state: "initialized",
    currentDefinitionKey: "white-belt", currentLevelStartedAt: "2026-09-05T00:00:00.000Z",
    daysOffset: 7,
  };
});
afterEach(() => vi.useRealTimers());

describe("owner progress count editing", () => {
  it("stores exact classes and days together and counts later attendance once", async () => {
    await setProgressClassCount.run(request({ classes: 12, days: 5, reason: "Synthetic correction" }));
    expect(state.head).toMatchObject({
      currentDefinitionKey: "white-belt", daysOffset: -25,
      importedBaseline: { classes: 12, cutoff: "2026-10-06", source: "owner-set" },
    });
    expect(state.writes).toHaveLength(2);
    expect(state.writes[1]).toMatchObject({ summary: "Progress at this level set to 12 classes, 5 days" });
    expect(countClassesAtLevel({
      currentLevelStartedAt: "2026-09-05T00:00:00.000Z",
      importedBaseline: { classes: 12, cutoff: "2026-10-06", source: "owner-set" },
      attendedAt: ["2026-10-05T19:00:00.000Z", "2026-10-06T19:00:00.000Z"],
    })).toEqual({ imported: 12, bpt: 1, total: 13 });
  });

  it("preserves the days correction when only classes are edited", async () => {
    await setProgressClassCount.run(request({ classes: 0 }));
    expect(state.head).toMatchObject({ daysOffset: 7, importedBaseline: { classes: 0 } });
  });

  it.each(["administrator", "headCoach", "coach"])("refuses %s before writing", async (role) => {
    state.role = role;
    await expect(setProgressClassCount.run(request({ classes: 12, days: 5 })))
      .rejects.toMatchObject({ code: "permission-denied" });
    expect(state.writes).toHaveLength(0);
  });

  it.each([{ classes: -1, days: 5 }, { classes: 12, days: -1 }, { classes: 1.5, days: 5 }, { classes: 12, days: 100001 }])(
    "rejects invalid counts %j without writes", async (counts) => {
      await expect(setProgressClassCount.run(request(counts)))
        .rejects.toMatchObject({ code: "invalid-argument" });
      expect(state.writes).toHaveLength(0);
    },
  );

  it("refuses a head from another academy", async () => {
    state.head.academyId = "another-academy";
    await expect(setProgressClassCount.run(request({ classes: 12, days: 5 })))
      .rejects.toMatchObject({ code: "failed-precondition" });
    expect(state.writes).toHaveLength(0);
  });
});
