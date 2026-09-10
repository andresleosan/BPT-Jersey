import { describe, expect, it } from "vitest";

import { enrolmentWaiverTermsVersion } from "@bpt-jersey/domain/consents/enrolment-waiver";

import type { EnrolmentRequestRecord } from "@bpt-jersey/domain/members/enrolment-requests";
import {
  createEnrolmentRequestStore,
  enrolmentHoldId,
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
  phoneNumber: "07700900123",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
} as const;

const submission = {
  requestId,
  applicantIsStudent: true,
  applicant,
  minors: [],
  waiverAcceptance: { version: enrolmentWaiverTermsVersion, accepted: true },
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
      orderBy: (field, direction) => ({
        limit: (count: number): EnrolmentQuery => ({
          path,
          orderBy: { field, direction },
          limit: count,
        }),
      }),
    }),
    runTransaction: async <T>(callback: (transaction: EnrolmentTransaction) => Promise<T>) => {
      const transaction: EnrolmentTransaction = {
        get: async (target) => {
          if ("limit" in target) {
            const field = target.field;
            const matches = [...documents.entries()].filter(
              ([path, data]) =>
                path.startsWith(`${target.path}/`) &&
                (field === undefined || (data as Record<string, unknown>)[field] === target.value),
            );
            const order = target.orderBy;
            if (order) {
              matches.sort(([, left], [, right]) =>
                String((right as Record<string, unknown>)[order.field]).localeCompare(
                  String((left as Record<string, unknown>)[order.field]),
                ),
              );
            }
            const docs = matches.slice(0, target.limit).map(([path]) => snapshot(path));
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
const holdPath = `academies/academy-1/enrolmentRequestHolds/${enrolmentHoldId("visitor-1")}`;

function hold(status: string) {
  return {
    submittedBy: "visitor-1",
    enrolmentRequestId: enrolmentRequestId(requestId),
    status,
    updatedAt: now,
  };
}

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
    const { store } = firestoreDouble({
      [requestPath]: record(),
      [holdPath]: hold("submitted"),
    });

    await expect(
      store.submit({
        academyId: "academy-1",
        actorId: "visitor-1",
        now: later,
        submission: { ...submission, requestId: otherRequestId },
      }),
    ).rejects.toMatchObject({ code: "precondition" });
  });

  it("still finds the open request behind a long history of resolved ones", async () => {
    // Scanning the applicant's own rows answers this only while they have few rows; the scan is
    // capped, so a busy applicant could slip a second open request past it. The hold document is
    // exact no matter how much history sits in front of it.
    const noise = Object.fromEntries(
      Array.from({ length: 40 }, (_item, index) => [
        `academies/academy-1/enrolmentRequests/enrolment-old-${index}`,
        record({
          enrolmentRequestId: `enrolment-old-${index}`,
          requestId: `6f1d2f66-6f4f-4a2e-9a0e-2b6f0a4a1c${String(index).padStart(2, "0")}`,
          status: "withdrawn",
        }),
      ]),
    );
    const { store } = firestoreDouble({
      ...noise,
      [requestPath]: record(),
      [holdPath]: hold("submitted"),
    });

    await expect(
      store.submit({
        academyId: "academy-1",
        actorId: "visitor-1",
        now: later,
        submission: { ...submission, requestId: otherRequestId },
      }),
    ).rejects.toMatchObject({ code: "precondition" });
  });

  it("does not let somebody the academy already enrolled apply again", async () => {
    const { store } = firestoreDouble({ [holdPath]: hold("approved") });

    await expect(
      store.submit({
        academyId: "academy-1",
        actorId: "visitor-1",
        now: later,
        submission: { ...submission, requestId: otherRequestId },
      }),
    ).rejects.toMatchObject({ code: "precondition" });
  });

  it("keeps the hold in step with the request it points at", async () => {
    const { store, documents } = firestoreDouble();

    await store.submit({ academyId: "academy-1", actorId: "visitor-1", now, submission });
    expect(documents.get(holdPath)).toMatchObject({
      submittedBy: "visitor-1",
      status: "submitted",
    });

    await store.withdraw({
      academyId: "academy-1",
      actorId: "visitor-1",
      now: later,
      enrolmentRequestId: enrolmentRequestId(requestId),
    });
    expect(documents.get(holdPath)).toMatchObject({ status: "withdrawn", updatedAt: later });
  });

  it("lets an applicant submit again once the previous request is resolved", async () => {
    const { store } = firestoreDouble({
      [requestPath]: record({ status: "withdrawn" }),
      [holdPath]: hold("withdrawn"),
    });

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

    expect(office.truncated).toBe(false);
    expect(office.requests.map((item) => item.submittedBy)).toEqual(["visitor-2", "visitor-1"]);
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

describe("enrolment approval lock", () => {
  const approvalKey = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";
  const otherApprovalKey = "9e8d7c6b-5a49-4382-9176-0f1e2d3c4b5a";

  async function begin(
    seed: Readonly<Record<string, EnrolmentDocumentData>>,
    requestIdInput = approvalKey,
    actorId = "owner-1",
  ) {
    const double = firestoreDouble(seed);
    const result = await double.store.beginApproval({
      academyId: "academy-1",
      actorId,
      now: later,
      enrolmentRequestId: enrolmentRequestId(requestId),
      requestId: requestIdInput,
    });
    return { ...double, result };
  }

  it("takes the lock, pins the reviewer's idempotency key and closes the applicant's hold", async () => {
    const { result, documents } = await begin({
      [requestPath]: record(),
      [holdPath]: hold("submitted"),
    });

    expect(result.alreadyApproved).toBe(false);
    expect(result.record).toMatchObject({
      status: "approving",
      approvalRequestId: approvalKey,
      reviewedBy: "owner-1",
      reviewedAt: later,
    });
    expect(documents.get(holdPath)).toMatchObject({ status: "approving" });
  });

  it("gives a retry the key the first attempt pinned, never a fresh one", async () => {
    // This is the whole defence against two students for one person: a second key would mint a
    // second write receipt, and the canonical writer would happily create a second record.
    const { result } = await begin(
      { [requestPath]: record({ status: "approving", approvalRequestId: approvalKey }) },
      otherApprovalKey,
      "owner-2",
    );

    expect(result.record.approvalRequestId).toBe(approvalKey);
  });

  it("resumes an approval that previously stopped", async () => {
    const { result } = await begin({
      [requestPath]: record({
        status: "approval-failed",
        approvalRequestId: approvalKey,
        approvalFailureCode: "claim_not_persisted",
      }),
    });

    expect(result.record).toMatchObject({ status: "approving", approvalRequestId: approvalKey });
  });

  it("answers an already approved request without writing anything", async () => {
    const { result, documents } = await begin({
      [requestPath]: record({
        status: "approved",
        approvalRequestId: approvalKey,
        approvedStudentIds: ["student-1"],
      }),
    });

    expect(result).toMatchObject({ alreadyApproved: true });
    expect(documents.get(requestPath)).toMatchObject({ status: "approved" });
  });

  it("refuses to approve a request the applicant withdrew", async () => {
    const double = firestoreDouble({ [requestPath]: record({ status: "withdrawn" }) });

    await expect(
      double.store.beginApproval({
        academyId: "academy-1",
        actorId: "owner-1",
        now: later,
        enrolmentRequestId: enrolmentRequestId(requestId),
        requestId: approvalKey,
      }),
    ).rejects.toMatchObject({ code: "precondition" });
  });

  it("settles a held approval and records what it created", async () => {
    const { store, documents, audits } = firestoreDouble({
      [requestPath]: record({ status: "approving", approvalRequestId: approvalKey }),
      [holdPath]: hold("approving"),
    });

    const settled = await store.completeApproval({
      academyId: "academy-1",
      actorId: "owner-1",
      now: later,
      enrolmentRequestId: enrolmentRequestId(requestId),
      studentIds: ["student-7"],
    });

    expect(settled).toMatchObject({ status: "approved", approvedStudentIds: ["student-7"] });
    expect(documents.get(holdPath)).toMatchObject({ status: "approved" });
    expect(audits.at(-1)).toMatchObject({ action: "enrolment.request.approved" });
  });

  it("parks a half-finished approval where office can see it, never back with the applicant", async () => {
    const { store, documents, audits } = firestoreDouble({
      [requestPath]: record({ status: "approving", approvalRequestId: approvalKey }),
      [holdPath]: hold("approving"),
    });

    const settled = await store.failApproval({
      academyId: "academy-1",
      actorId: "owner-1",
      now: later,
      enrolmentRequestId: enrolmentRequestId(requestId),
      failureCode: "claim_not_persisted",
    });

    expect(settled).toMatchObject({
      status: "approval-failed",
      approvalFailureCode: "claim_not_persisted",
    });
    expect(documents.get(holdPath)).toMatchObject({ status: "approval-failed" });
    expect(audits.at(-1)).toMatchObject({ action: "enrolment.request.approval.failed" });
  });

  it("refuses a settlement from an attempt that no longer holds the lock", async () => {
    const { store } = firestoreDouble({ [requestPath]: record({ status: "submitted" }) });

    await expect(
      store.completeApproval({
        academyId: "academy-1",
        actorId: "owner-1",
        now: later,
        enrolmentRequestId: enrolmentRequestId(requestId),
        studentIds: ["student-7"],
      }),
    ).rejects.toMatchObject({ code: "precondition" });
  });

  it("stops an applicant applying again while their approval is in flight or parked", async () => {
    // Neither state is "open", so a deny list written against the old vocabulary would have let
    // both through and produced a second request for a person already being enrolled.
    for (const status of ["approving", "approval-failed"] as const) {
      const { store } = firestoreDouble({ [holdPath]: hold(status) });

      await expect(
        store.submit({
          academyId: "academy-1",
          actorId: "visitor-1",
          now: later,
          submission: { ...submission, requestId: otherRequestId },
        }),
      ).rejects.toMatchObject({ code: "precondition" });
    }
  });

  it("lets office hand back an approval that stopped, so the applicant is not stuck", async () => {
    // Without this the person is trapped: they cannot withdraw a request that is not open, and
    // they cannot apply again while they hold one.
    const { store, documents } = firestoreDouble({
      [requestPath]: record({
        status: "approval-failed",
        approvalRequestId: approvalKey,
        approvalFailureCode: "applicant_account_incomplete",
      }),
      [holdPath]: hold("approval-failed"),
    });

    const returned = await store.returnForChanges({
      academyId: "academy-1",
      actorId: "owner-1",
      now: later,
      enrolmentRequestId: enrolmentRequestId(requestId),
      note: "Add a name to your Google account, then apply again.",
    });

    expect(returned.status).toBe("returned");
    expect(documents.get(holdPath)).toMatchObject({ status: "returned" });
  });

  it("does not let the applicant pull a request out from under an approval in progress", async () => {
    const { store } = firestoreDouble({
      [requestPath]: record({ status: "approving", approvalRequestId: approvalKey }),
    });

    await expect(
      store.withdraw({
        academyId: "academy-1",
        actorId: "visitor-1",
        now: later,
        enrolmentRequestId: enrolmentRequestId(requestId),
      }),
    ).rejects.toMatchObject({ code: "precondition" });
  });

  it("lets somebody who withdrew apply again", async () => {
    const { store } = firestoreDouble({ [holdPath]: hold("withdrawn") });

    const saved = await store.submit({
      academyId: "academy-1",
      actorId: "visitor-1",
      now: later,
      submission: { ...submission, requestId: otherRequestId },
    });

    expect(saved.status).toBe("submitted");
  });
});
