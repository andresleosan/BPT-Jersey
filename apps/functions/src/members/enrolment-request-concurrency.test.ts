import { describe, expect, it } from "vitest";

import { enrolmentWaiverTermsVersion } from "@bpt-jersey/domain/consents/enrolment-waiver";

import {
  createEnrolmentRequestStore,
  enrolmentHoldId,
  enrolmentRequestId,
  type EnrolmentDocumentData,
  type EnrolmentDocumentReference,
  type EnrolmentDocumentSnapshot,
  type EnrolmentFirestore,
  type EnrolmentTransaction,
} from "./enrolment-request-service.js";

const academyId = "academy-1";
const actorId = "visitor-1";
const now = "2026-10-21T10:00:00.000Z";
const later = "2026-10-21T11:00:00.000Z";
const afterLease = "2026-10-21T11:02:01.000Z";
const formId = "6f1d2f66-6f4f-4a2e-9a0e-2b6f0a4a1c11";
const secondFormId = "8a2e3b77-7f5f-4b3f-8b1f-3c7f1b5b2d22";
const approvalKey = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";
const otherApprovalKey = "9e8d7c6b-5a49-4382-9176-0f1e2d3c4b5a";
const retryApprovalKey = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
const requests = `academies/${academyId}/enrolmentRequests`;
const requestPath = `${requests}/${enrolmentRequestId(formId)}`;
const holdPath = `academies/${academyId}/enrolmentRequestHolds/${enrolmentHoldId(actorId)}`;
const limitPath = `academies/${academyId}/enrolmentSubmitLimits/${actorId}`;

type Write = Readonly<{ path: string; data?: EnrolmentDocumentData; create?: true }>;

const submission = (requestId: string) =>
  ({
    requestId,
    applicantIsStudent: true,
    applicant: {
      fullName: "Alex Adult",
      dateOfBirth: "1994-04-02",
      phoneNumber: "07700900123",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
    },
    minors: [],
    planSelections: { applicant: "town-adult", minors: [] },
    waiverAcceptance: { version: enrolmentWaiverTermsVersion, accepted: true },
  }) as const;

/**
 * Unlike the plain map in enrolment-request-service.test.ts, this keeps the guarantees the store
 * relies on: a transaction reads committed data, its writes land together at commit, and a commit
 * whose reads went stale runs the callback again, as the Admin SDK does under contention (five
 * attempts). Every read and every commit yields, so callers interleave like two calls reaching the
 * server at once.
 */
function contendedFirestore() {
  const documents = new Map<string, EnrolmentDocumentData>();
  const versions = new Map<string, number>();
  let commits = 0;
  let audits = 0;
  let reruns = 0;
  const parent = (path: string) => path.slice(0, path.lastIndexOf("/"));
  const reference = (path: string): EnrolmentDocumentReference => ({
    id: path.slice(path.lastIndexOf("/") + 1),
    path,
  });
  const snapshot = (path: string): EnrolmentDocumentSnapshot => {
    const data = documents.get(path);
    return { id: reference(path).id, exists: data !== undefined, data: () => data };
  };

  const firestore: EnrolmentFirestore = {
    doc: reference,
    collection: (path) => ({
      doc: (id = `generated-${documents.size}`) => reference(`${path}/${id}`),
      where: (field, _operator, value) => ({ limit: (limit) => ({ path, field, value, limit }) }),
      orderBy: (field, direction) => ({
        limit: (limit) => ({ path, orderBy: { field, direction }, limit }),
      }),
    }),
    runTransaction: async <T>(
      callback: (transaction: EnrolmentTransaction) => Promise<T>,
    ): Promise<T> => {
      for (let attempt = 1; ; attempt += 1) {
        const seen = new Map<string, number>();
        const writes: Write[] = [];
        const transaction: EnrolmentTransaction = {
          async get(target) {
            await Promise.resolve();
            seen.set(target.path, versions.get(target.path) ?? 0);
            if (!("limit" in target)) return snapshot(target.path);
            const { path: collection, field, value, orderBy, limit } = target;
            if (orderBy) throw new Error("Ordered queries are not modelled here");
            const docs = [...documents.keys()]
              .filter(
                (path) =>
                  parent(path) === collection &&
                  (field === undefined || documents.get(path)?.[field] === value),
              )
              .slice(0, limit)
              .map(snapshot);
            return { docs };
          },
          create(ref, data) {
            writes.push({ path: ref.path, data, create: true });
            return transaction;
          },
          set(ref, data) {
            writes.push({ path: ref.path, data });
            return transaction;
          },
          delete(ref) {
            writes.push({ path: ref.path });
            return transaction;
          },
        };
        const result = await callback(transaction);
        await Promise.resolve();
        if ([...seen].every(([path, version]) => (versions.get(path) ?? 0) === version)) {
          if (writes.some((write) => write.create && documents.has(write.path)))
            throw new Error("Already exists");
          for (const write of writes) {
            if (write.data === undefined) documents.delete(write.path);
            else documents.set(write.path, write.data);
            commits += 1;
            versions.set(write.path, commits);
            versions.set(parent(write.path), commits);
          }
          return result;
        }
        reruns += 1;
        if (attempt === 5) throw new Error("Transaction aborted after five attempts");
      }
    },
  };

  return {
    documents,
    /** Commits that found their reads stale: above zero, the calls really overlapped. */
    reruns: () => reruns,
    count: (collection: string) =>
      [...documents.keys()].filter((path) => parent(path) === collection).length,
    store: createEnrolmentRequestStore({
      firestore,
      // As in production the audit row is a write of the same transaction, so an attempt that
      // lost a race leaves none behind.
      appendAudit: (transaction, _reference, draft) => {
        audits += 1;
        transaction.set(reference(`auditEvents/${audits}`), draft);
      },
    }),
  };
}

function settled<T>(results: readonly PromiseSettledResult<T>[]) {
  return {
    done: results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
    refused: results.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
  };
}

describe("enrolment requests under concurrent and repeated calls", () => {
  it("files one request when the same form arrives twice at once, and once more later", async () => {
    const { store, documents, count, reruns } = contendedFirestore();
    const send = () => store.submit({ academyId, actorId, now, submission: submission(formId) });

    const [first, second] = await Promise.all([send(), send()]);
    // The answer was lost and the applicant pressed Send again: the form keeps its id.
    const retried = await send();

    expect(reruns()).toBeGreaterThan(0);
    expect(second).toEqual(first);
    expect(retried).toEqual(first);
    expect(count(requests)).toBe(1);
    expect(count("auditEvents")).toBe(1);
    // A repeat is not a new request, so it does not use up the applicant's daily allowance.
    expect(documents.get(limitPath)).toMatchObject({ count: 1 });
  });

  it("keeps one open request when two forms from one account arrive at once", async () => {
    const { store, documents, count, reruns } = contendedFirestore();

    const results = await Promise.allSettled(
      [formId, secondFormId].map((requestId) =>
        store.submit({ academyId, actorId, now, submission: submission(requestId) }),
      ),
    );

    const { done, refused } = settled(results);
    expect(reruns()).toBeGreaterThan(0);
    expect(done).toHaveLength(1);
    expect(refused).toEqual([
      expect.objectContaining({
        code: "precondition",
        message: "You already have a request waiting for the academy to review",
      }),
    ]);
    expect(count(requests)).toBe(1);
    expect(documents.get(holdPath)).toMatchObject({
      enrolmentRequestId: done[0]?.enrolmentRequestId,
      status: "submitted",
    });
  });

  it("lets one of two reviewers approving at once pin the key every retry then uses", async () => {
    const { store, documents, reruns } = contendedFirestore();
    const filed = await store.submit({ academyId, actorId, now, submission: submission(formId) });
    const approve = (reviewer: string, key: string, at = later) =>
      store.beginApproval({
        academyId,
        actorId: reviewer,
        now: at,
        enrolmentRequestId: filed.enrolmentRequestId,
        requestId: key,
      });

    const results = await Promise.allSettled([
      approve("owner-1", approvalKey),
      approve("owner-2", otherApprovalKey),
    ]);
    // Past the lease, a retry with another key still runs on the pinned one. Only the lock and the
    // stored key are covered: no canonical writer, student creation or Auth runs here.
    const resumed = await approve("owner-2", retryApprovalKey, afterLease);

    const { done, refused } = settled(results);
    expect(reruns()).toBeGreaterThan(0);
    expect(done).toHaveLength(1);
    expect(refused).toEqual([
      expect.objectContaining({
        code: "precondition",
        message: "Approval is already running. Wait two minutes before retrying.",
      }),
    ]);
    const pinned = done[0]?.record.approvalRequestId;
    expect([approvalKey, otherApprovalKey]).toContain(pinned);
    expect(resumed.record.approvalRequestId).toBe(pinned);
    expect(documents.get(requestPath)).toMatchObject({
      status: "approving",
      approvalRequestId: pinned,
    });
  });

  it("settles a denial and an approval racing on one request as exactly one of them", async () => {
    const { store, documents, reruns } = contendedFirestore();
    const filed = await store.submit({ academyId, actorId, now, submission: submission(formId) });
    const target = { academyId, now: later, enrolmentRequestId: filed.enrolmentRequestId };

    const [approval, denial] = await Promise.allSettled([
      store.beginApproval({ ...target, actorId: "owner-1", requestId: approvalKey }),
      store.deny({ ...target, actorId: "owner-2" }),
    ]);

    // Exactly one went through. Whichever committed first, the other was refused whole: no denied
    // request half approved, no approval running on a request that was deleted.
    expect(reruns()).toBeGreaterThan(0);
    expect(approval.status).not.toBe(denial.status);
    if (approval.status === "fulfilled") {
      expect(documents.get(requestPath)).toMatchObject({ status: "approving" });
      expect(denial).toMatchObject({ reason: { code: "precondition" } });
    } else {
      expect(documents.has(requestPath)).toBe(false);
      expect(documents.has(holdPath)).toBe(false);
      expect(approval).toMatchObject({ reason: { code: "not-found" } });
    }
  });
});
