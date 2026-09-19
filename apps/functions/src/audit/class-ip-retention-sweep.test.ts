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

describe("sweepClassIpRetention age boundary", () => {
  it("does not clear an event dated exactly twelve calendar months before now (strict less-than)", async () => {
    // now - 12 months, via setUTCMonth, lands exactly on 2025-09-17T03:00:00.000Z. The sweep's
    // comparison is `occurredAt < cutoff`, so an event sitting exactly on the cutoff is not yet
    // past the boundary and must survive.
    const exact = createFakeStore([
      { id: "exact", action: "booking.created", actorIp: "1.2.3.4", occurredAt: now },
    ]);
    const result = await sweepClassIpRetention(exact, "2026-09-17T03:00:00Z");
    expect(result.cleared).toBe(0);
    expect(exact.documents[0]!.actorIp).toBe("1.2.3.4");
  });

  it("clears an event one minute older than the exact twelve-month cutoff", async () => {
    const oneMinuteOlder = createFakeStore([
      {
        id: "one-minute-older",
        action: "booking.created",
        actorIp: "1.2.3.4",
        occurredAt: "2025-09-17T02:59:00.000Z",
      },
    ]);
    const result = await sweepClassIpRetention(oneMinuteOlder, "2026-09-17T03:00:00Z");
    expect(result.cleared).toBe(1);
    expect(oneMinuteOlder.documents[0]!.actorIp).toBeNull();
  });

  it("leaves an event one minute younger than the exact twelve-month cutoff untouched", async () => {
    const oneMinuteYounger = createFakeStore([
      {
        id: "one-minute-younger",
        action: "booking.created",
        actorIp: "1.2.3.4",
        occurredAt: "2025-09-17T03:01:00.000Z",
      },
    ]);
    const result = await sweepClassIpRetention(oneMinuteYounger, "2026-09-17T03:00:00Z");
    expect(result.cleared).toBe(0);
    expect(oneMinuteYounger.documents[0]!.actorIp).toBe("1.2.3.4");
  });

  it("pins calendar-month subtraction against a leap-spanning window where fixed-365-day math disagrees", async () => {
    // NOTE: the 2026-03-01/2027-03-01 pair suggested for this case does not actually diverge from
    // fixed-365-day arithmetic - neither 2026 nor 2027 is a leap year, so that twelve-month span is
    // exactly 365 days and both methods land on the same cutoff (verified by hand: 31+30+31+30+31+
    // 31+30+31+30+31+31+28 = 365). To get a pair that genuinely disagrees, this test spans 2028,
    // which IS a leap year: Mar 2027 -> Feb 2028 totals 366 days (the same sum with Feb 2028's 29
    // days instead of 28), one more than a fixed 365-day subtraction would allow for.
    //
    // Correct (calendar-month) cutoff for now = 2028-03-01T00:00:00.000Z is exactly
    // 2027-03-01T00:00:00.000Z, twelve calendar months back, via `setUTCMonth`. A refactor to
    // `cutoff = now - 365 days` would instead land on 2027-03-02T00:00:00.000Z - one day later -
    // and would wrongly treat the boundary event below (dated exactly 2027-03-01) as older than
    // that shifted cutoff, clearing it. The correct implementation must not.
    const leapSpanningBoundary = createFakeStore([
      {
        id: "leap-spanning-boundary",
        action: "booking.created",
        actorIp: "1.2.3.4",
        occurredAt: "2027-03-01T00:00:00.000Z",
      },
    ]);
    const result = await sweepClassIpRetention(leapSpanningBoundary, "2028-03-01T00:00:00.000Z");
    expect(result.cleared).toBe(0);
    expect(leapSpanningBoundary.documents[0]!.actorIp).toBe("1.2.3.4");
  });
});
