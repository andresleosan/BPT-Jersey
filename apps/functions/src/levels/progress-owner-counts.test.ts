import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "owner",
  head: {} as Record<string, unknown>,
  writes: [] as Record<string, unknown>[],
}));
// Read before the transaction: the member record and the published ladder (white, then blue belt).
const stored = vi.hoisted(() => {
  const documents: Record<string, Record<string, unknown>> = {
    "academies/synthetic-academy/students/synthetic-member": { academyId: "synthetic-academy" },
    "academies/synthetic-academy/levelSystems/synthetic-ladder": { status: "published" },
    "academies/synthetic-academy/levelDefinitions/white-belt": {
      systemId: "synthetic-ladder", definitionKey: "white-belt", name: "White Belt", sequence: 1,
      criteria: { minClasses: null, minimumTime: null },
    },
    "academies/synthetic-academy/levelDefinitions/blue-belt": {
      systemId: "synthetic-ladder", definitionKey: "blue-belt", name: "Blue Belt", sequence: 2,
      criteria: { minClasses: 100, minimumTime: { years: 1, months: 0, days: 0 } },
    },
  };
  const snapshot = (path: string) => {
    const data = documents[path];
    return { id: path.split("/").at(-1), exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] };
  };
  const children = (path: string) => Object.keys(documents)
    .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/"))
    .map(snapshot);
  return { snapshot, children };
});
// The real office gate runs (it holds the role refusal); only live Auth is synthetic.
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    getUser: async (uid: string) => ({
      uid, disabled: false, customClaims: { academyId: "synthetic-academy", role: state.role },
    }),
  }),
}));
vi.mock("firebase-admin/firestore", async (importOriginal) => ({
  ...await importOriginal<typeof import("firebase-admin/firestore")>(),
  getFirestore: () => ({
    doc: (path: string) => ({ path, get: async () => stored.snapshot(path) }),
    collection: (path: string) => ({
      doc: () => ({ path: `${path}/synthetic-change` }),
      get: async () => ({ docs: stored.children(path) }),
      where: (field: string, _operator: "==", value: unknown) => ({
        get: async () => ({ docs: stored.children(path).filter((document) => document.get(field) === value) }),
      }),
    }),
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
  auth: {
    uid: "synthetic-owner",
    token: {
      name: "Synthetic Owner", academyId: "synthetic-academy", role: state.role,
      auth_time: Date.parse("2026-10-05T09:00:00.000Z") / 1000,
    },
  },
}) as never;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T10:00:00.000Z"));
  state.role = "owner";
  state.writes = [];
  state.head = {
    academyId: "synthetic-academy", studentId: "synthetic-member", state: "initialized",
    systemId: "synthetic-ladder",
    currentDefinitionKey: "white-belt", currentLevelStartedAt: "2026-09-05T00:00:00.000Z",
    daysOffset: 7,
  };
});
afterEach(() => vi.useRealTimers());

describe("owner progress count editing", () => {
  it("stores exact classes and days together and counts later attendance once", async () => {
    await setProgressClassCount.run(request({ classes: 12, days: 5, reason: "Synthetic correction" }));
    const baseline = {
      classes: 12, cutoff: "2026-10-06", countedThrough: "2026-10-05T10:00:00.000Z", source: "owner-set",
    } as const;
    expect(state.head).toMatchObject({
      currentDefinitionKey: "white-belt", daysOffset: -25, importedBaseline: baseline,
    });
    expect(state.writes).toHaveLength(2);
    expect(state.writes[1]).toMatchObject({ summary: "White Belt: classes set to 12, days set to 5" });
    // The save instant is the boundary: a class before it is inside the 12, later ones add once.
    expect(countClassesAtLevel({
      currentLevelStartedAt: "2026-09-05T00:00:00.000Z",
      importedBaseline: baseline,
      attendedAt: ["2026-10-05T09:00:00.000Z", "2026-10-05T19:00:00.000Z", "2026-10-06T19:00:00.000Z"],
    })).toEqual({ imported: 12, bpt: 2, total: 14 });
  });

  it("preserves the days correction when only classes are edited", async () => {
    await setProgressClassCount.run(request({ classes: 0 }));
    expect(state.head).toMatchObject({ daysOffset: 7, importedBaseline: { classes: 0 } });
  });

  // Since 2026-10-15 an administrator has the owner's powers, progress management included.
  it("lets an administrator set the counts like the owner", async () => {
    state.role = "administrator";
    await setProgressClassCount.run(request({ classes: 12, days: 5 }));
    expect(state.head).toMatchObject({ daysOffset: -25, importedBaseline: { classes: 12 } });
    expect(state.writes).toHaveLength(2);
  });

  it.each(["headCoach", "coach"])("refuses %s before writing", async (role) => {
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
