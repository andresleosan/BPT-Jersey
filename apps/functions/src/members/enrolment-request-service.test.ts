import { describe, expect, it } from "vitest";

import type { EnrolmentRequestRecord } from "@bpt-jersey/domain/members/enrolment-requests";
import {
  createEnrolmentRequestStore,
  enrolmentRequestId,
  EnrolmentRequestStoreError,
  type EnrolmentDocumentData,
  type EnrolmentDocumentReference,
  type EnrolmentDocumentSnapshot,
  type EnrolmentFirestore,
  type EnrolmentQuery,
  type EnrolmentQuerySnapshot,
  type EnrolmentTransaction,
} from "./enrolment-request-service.js";

const now = "2026-09-06T10:00:00.000Z";
const later = "2026-09-06T11:00:00.000Z";
const requestId = "6f1d2f66-6f4f-4a2e-9a0e-2b6f0a4a1c11";
const otherRequestId = "8a2e3b77-7f5f-4b3f-8b1f-3c7f1b5b2d22";

const applicant = {
  fullName: "Alex Adult",
  dateOfBirth: "1994-04-02",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
} as const;

const submission = {
  requestId,
  applicantIsStudent: true,
  applicant,
  minors: [],
} as const;

/** A synthetic Firestore that keeps documents in a map and honours the query shapes the store uses. */
function firestoreDouble(seed: Readonly<Record<string, EnrolmentDocumentData>> = {}) {
  const documents = new Map<string, EnrolmentDocumentData>(Object.entries(seed));
  const audits: EnrolmentDocumentData[] = [];
  let generated = 0;

  function snapshot(path: string): EnrolmentDocumentSnapshot {
    const data = documents.get(path);
    return {
      id: path.slice(path.lastIndexOf("/") + 1),
      exists: data !== undefined,
      data: () => data,
    };
  }

  const firestore: EnrolmentFirestore = {
    doc: (path) => ({ id: path.slice(path.lastIndexOf("/") + 1), path }),
    collection: (path) => ({
      doc: (id?: string) => {
        const documentId = id ?? `generated-${(generated += 1)}`;
        return { id: documentId, path: `${path}/${documentId}` };
      },
      where: (field, _operator, value) => ({
        limit: (count: number): EnrolmentQuery => ({ path, field, value, limit: count }),
      }),
    }),
    runTransaction: async <T>(callback: (transaction: EnrolmentTransaction) => Promise<T>) => {
      const transaction: EnrolmentTransaction = {
        get: async (target) => {
          if ("field" in target) {
            const docs = [...documents.entries()]
              .filter(
                ([path, data]) =>
                  path.startsWith(`${target.path}/`) &&
                  (data as Record<string, unknown>)[target.field] === target.value,
              )
              .slice(0, target.limit)
              .map(([path]) => snapshot(path));
            return { docs } satisfies EnrolmentQuerySnapshot;
          }
          return snapshot(target.path);
        },
        create: (ref: EnrolmentDocumentReference, data: EnrolmentDocumentData) => {
          if (documents.has(ref.path)) throw new Error("Document already exists");
          documents.set(ref.path, data);
          return transaction;
        },
        set: (ref: EnrolmentDocumentReference, data: EnrolmentDocumentData) => {
          documents.set(ref.path, data);
          return transaction;
        },
      };
      return callback(transaction);
    },
  };

  return {
    documents,
    audits,
    store: createEnrolmentRequestStore({
      firestore,
      appendAudit: (_transaction, _reference, draft) => {
        audits.push(draft);
      },
    }),
  };
}

function record(overrides: Partial<EnrolmentRequestRecord> = {}): EnrolmentRequestRecord {
  return {
    enrolmentRequestId: enrolmentRequestId(requestId),
    academyId: "academy-1",
    requestId,
    status: "submitted",
    applicantIsStudent: true,
    applicant,
    minors: [],
    submittedBy: "visitor-1",
    submittedAt: now,
    schemaVersion: "1",
    ...overrides,
  } as EnrolmentRequestRecord;
}

const requestPath = `academies/academy-1/enrolmentRequests/${enrolmentRequestId(requestId)}`;

describe("enrolment request store", () => {
  it("stores a submitted request with its audit trail", async () => {
    const { store, documents, audits } = firestoreDouble();

    const saved = await store.submit({
      academyId: "academy-1",
      actorId: "visitor-1",
      now,
      submission,
    });

    expect(saved).toMatchObject({
      status: "submitted",
      submittedBy: "visitor-1",
      submittedAt: now,
    });
    expect(documents.get(requestPath)).toMatchObject({ academyId: "academy-1" });
    expect(audits).toEqual([
      expect.objectContaining({
        action: "enrolment.request.submitted",
        academyId: "academy-1",
        actorId: "visitor-1",
        targetRef: requestPath,
      }),
    ]);
  });

  it("treats a retry of the same submission as the same request", async () => {
    const { store, audits } = firestoreDouble();

    const first = await store.submit({
      academyId: "academy-1",
      actorId: "visitor-1",
      now,
      submission,
    });
    const retry = await store.submit({
      academyId: "academy-1",
      actorId: "visitor-1",
      now: later,
      submission,
    });

    expect(retry).toEqual(first);
    expect(audits).toHaveLength(1);
  });

  it("refuses to reuse another applicant's request id", async () => {
    const { store } = firestoreDouble({ [requestPath]: record() });

    await expect(
      store.submit({ academyId: "academy-1", actorId: "intruder-1", now: later, submission }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("keeps one open request per applicant", async () => {
    const { store } = firestoreDouble({ [requestPath]: record() });

    await expect(
      store.submit({
        academyId: "academy-1",
        actorId: "visitor-1",
        now: later,
        submission: { ...submission, requestId: otherRequestId },
      }),
    ).rejects.toMatchObject({ code: "precondition" });
  });

  it("lets an applicant submit again once the previous request is resolved", async () => {
    const { store } = firestoreDouble({ [requestPath]: record({ status: "withdrawn" }) });

    const saved = await store.submit({
      academyId: "academy-1",
      actorId: "visitor-1",
      now: later,
      submission: { ...submission, requestId: otherRequestId },
    });

    expect(saved.status).toBe("submitted");
  });

  it("returns a request to the applicant with the note office wrote", async () => {
    const { store, audits } = firestoreDouble({ [requestPath]: record() });

    const returned = await store.returnForChanges({
      academyId: "academy-1",
      actorId: "admin-1",
      now: later,
      enrolmentRequestId: enrolmentRequestId(requestId),
      note: "Add a phone number we can reach you on.",
    });

    expect(returned).toMatchObject({
      status: "returned",
      reviewedBy: "admin-1",
      reviewedAt: later,
      reviewNote: "Add a phone number we can reach you on.",
    });
    expect(audits[0]).toMatchObject({ action: "enrolment.request.returned" });
  });

  it("lets an applicant withdraw their own request and nobody else's", async () => {
    const { store, audits } = firestoreDouble({ [requestPath]: record() });

    await expect(
      store.withdraw({
        academyId: "academy-1",
        actorId: "someone-else",
        now: later,
        enrolmentRequestId: enrolmentRequestId(requestId),
      }),
    ).rejects.toMatchObject({ code: "not-found" });

    const withdrawn = await store.withdraw({
      academyId: "academy-1",
      actorId: "visitor-1",
      now: later,
      enrolmentRequestId: enrolmentRequestId(requestId),
    });

    expect(withdrawn.status).toBe("withdrawn");
    expect(audits[0]).toMatchObject({ action: "enrolment.request.withdrawn" });
  });

  it("never reopens a resolved request", async () => {
    const { store } = firestoreDouble({ [requestPath]: record({ status: "approved" }) });

    await expect(
      store.returnForChanges({
        academyId: "academy-1",
        actorId: "admin-1",
        now: later,
        enrolmentRequestId: enrolmentRequestId(requestId),
        note: "Reconsidered.",
      }),
    ).rejects.toMatchObject({ code: "precondition" });
  });

  it("reads only the requests of the academy and of the applicant asking", async () => {
    const otherPath = `academies/academy-1/enrolmentRequests/${enrolmentRequestId(otherRequestId)}`;
    const { store } = firestoreDouble({
      [requestPath]: record(),
      [otherPath]: record({
        enrolmentRequestId: enrolmentRequestId(otherRequestId),
        requestId: otherRequestId,
        submittedBy: "visitor-2",
        submittedAt: later,
      }),
    });

    const office = await store.listForAcademy("academy-1");
    const mine = await store.listForSubmitter("academy-1", "visitor-1");

    expect(office.map((item) => item.submittedBy)).toEqual(["visitor-2", "visitor-1"]);
    expect(mine.map((item) => item.submittedBy)).toEqual(["visitor-1"]);
  });

  it("rejects a stored document that belongs to another academy", async () => {
    // The document sits under academy-1 but claims academy-2 inside. Reading it by submitter still
    // returns it, so the tenant check inside the store is the thing that must catch it.
    const { store } = firestoreDouble({ [requestPath]: record({ academyId: "academy-2" }) });

    await expect(store.listForSubmitter("academy-1", "visitor-1")).rejects.toBeInstanceOf(
      EnrolmentRequestStoreError,
    );
  });

  it("validates identifiers and timestamps before touching the store", async () => {
    const { store } = firestoreDouble();

    await expect(
      store.submit({ academyId: "../escape", actorId: "visitor-1", now, submission }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      store.submit({ academyId: "academy-1", actorId: "visitor-1", now: "2026-09-06", submission }),
    ).rejects.toMatchObject({ code: "invalid" });
  });
});
