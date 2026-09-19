import type { Firestore } from "firebase-admin/firestore";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ materialise: vi.fn() }));
vi.mock("./weekly-session-service", () => ({
  createWeeklySessionStore: () => ({ materialise: mocks.materialise }),
}));

import { createFirestoreQuorumSweepStore } from "./quorum-sweep-firestore";
import { sweepSessionQuorums } from "./quorum-sweep-job";

it("isolates an academy read failure once and continues healthy academies and existing candidates", async () => {
  const docs = ["bad/first", "bad/second", "healthy/first"].map((value) => {
    const [academy, id] = value.split("/");
    return { ref: { path: `academies/${academy}/sessionSeries/${id}` } };
  });
  const firestore = {
    collectionGroup: () => ({
      limit: () => ({ get: async () => ({ docs, empty: false, size: docs.length }) }),
    }),
  } as unknown as Firestore;
  mocks.materialise.mockImplementation(async (academy: string) => {
    if (academy === "bad") throw Object.assign(new Error("private SDK message"), { code: 7 });
  });
  const store = createFirestoreQuorumSweepStore(firestore);
  const report = await sweepSessionQuorums(
    {
      ...store,
      listPage: async () => ({
        sessions: [{ academyId: "healthy", sessionId: "existing" }],
        nextCursor: null,
      }),
      reconcile: async () => ({ outcome: "cancelled", releasedBookings: 0 }),
    },
    "2036-09-19T17:00:01.000Z",
  );
  expect(mocks.materialise.mock.calls.map(([academy]) => academy)).toEqual(["bad", "healthy"]);
  expect(report).toMatchObject({
    cancelledSessions: 1,
    failedMaterialisations: 1,
    failures: [{ stage: "materialise-academy", code: "permission-denied", retryable: false }],
  });
});
