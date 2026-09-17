import { beforeEach, describe, expect, it } from "vitest";

import {
  sweepClassIpRetention,
  type ClassIpRetentionCandidate,
  type ClassIpRetentionCursor,
  type ClassIpRetentionEventRef,
  type ClassIpRetentionStore,
} from "./class-ip-retention-sweep.js";

const now = "2026-09-17T03:00:00Z";

type FakeAuditEvent = {
  id: string;
  action: string;
  actorIp: string | null;
  occurredAt: string;
};

type FakeStore = ClassIpRetentionStore & {
  documents: FakeAuditEvent[];
  commits: string[][];
};

let eventCounter = 0;

/** More than twelve months before `now`: 2025-01-01 is outside the retention window. */
function oldEvent(): FakeAuditEvent {
  eventCounter += 1;
  return {
    id: `old-${eventCounter}`,
    action: "booking.created",
    actorIp: "82.112.144.10",
    occurredAt: "2025-01-01T00:00:00.000Z",
  };
}

/** Within twelve months of `now`: must never be touched by the sweep. */
const recentEvent: FakeAuditEvent = {
  id: "recent-1",
  action: "booking.created",
  actorIp: "82.112.144.10",
  occurredAt: "2026-08-01T00:00:00.000Z",
};

function createFakeStore(documents: FakeAuditEvent[]): FakeStore {
  const store: FakeStore = {
    documents,
    commits: [],
    async listOlderThan(cutoff, limit, cursor: ClassIpRetentionCursor) {
      const cutoffMs = Date.parse(cutoff);
      const sorted = store.documents
        .filter((document) => Date.parse(document.occurredAt) < cutoffMs)
        .sort(
          (left, right) =>
            left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id),
        );
      const afterId = typeof cursor === "string" ? cursor : null;
      const startIndex =
        afterId === null ? 0 : sorted.findIndex((document) => document.id === afterId) + 1;
      const page = sorted.slice(startIndex, startIndex + limit);
      const candidates: ClassIpRetentionCandidate[] = page.map((document) => ({
        ref: { path: document.id },
        actorIp: document.actorIp,
      }));
      return {
        candidates,
        cursor: page.length > 0 ? page[page.length - 1]!.id : cursor,
      };
    },
    async clearActorIp(refs: readonly ClassIpRetentionEventRef[]) {
      store.commits.push(refs.map((ref) => ref.path));
      for (const ref of refs) {
        const document = store.documents.find((candidate) => candidate.id === ref.path);
        if (document !== undefined) document.actorIp = null;
      }
    },
  };
  return store;
}

let store: FakeStore;

beforeEach(() => {
  eventCounter = 0;
  store = createFakeStore([oldEvent()]);
});

describe("sweepClassIpRetention", () => {
  it("clears the IP of events older than twelve months and keeps the event", async () => {
    const result = await sweepClassIpRetention(store, "2026-09-17T03:00:00Z");
    expect(result.cleared).toBe(1);
    expect(store.documents[0]).toMatchObject({ action: "booking.created", actorIp: null });
  });

  it("leaves recent events untouched", async () => {
    store.documents = [recentEvent];
    expect((await sweepClassIpRetention(store, "2026-09-17T03:00:00Z")).cleared).toBe(0);
    expect(store.documents[0]!.actorIp).toBe("82.112.144.10");
  });

  it("works in batches so a long history does not break it", async () => {
    store.documents = Array.from({ length: 900 }, () => oldEvent());
    expect((await sweepClassIpRetention(store, now)).cleared).toBe(900);
    expect(store.commits.every((batch) => batch.length <= 400)).toBe(true);
  });

  it("is safe to run twice: a second run over the same history clears and writes nothing", async () => {
    store.documents = Array.from({ length: 900 }, () => oldEvent());
    await sweepClassIpRetention(store, now);
    store.commits = [];
    const second = await sweepClassIpRetention(store, now);
    expect(second.cleared).toBe(0);
    expect(store.commits).toEqual([]);
  });
});
