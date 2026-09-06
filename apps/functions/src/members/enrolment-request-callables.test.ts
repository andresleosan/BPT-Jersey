import { describe, expect, it, vi } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";

import type { EnrolmentRequestRecord } from "@bpt-jersey/domain/members/enrolment-requests";
import {
  listEnrolmentRequestsHandler,
  listMyEnrolmentRequestsHandler,
  returnEnrolmentRequestHandler,
  submitEnrolmentRequestHandler,
  withdrawEnrolmentRequestHandler,
  type EnrolmentRequestCallableServices,
} from "./enrolment-request-callables.js";
import { EnrolmentRequestStoreError } from "./enrolment-request-service.js";

const now = "2026-09-06T10:00:00.000Z";
const requestId = "6f1d2f66-6f4f-4a2e-9a0e-2b6f0a4a1c11";

const applicant = {
  fullName: "Alex Adult",
  dateOfBirth: "1994-04-02",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
  postalAddress: { line: "9 Library Place", postCode: "JE2 4WW" },
} as const;

const submission = { requestId, applicantIsStudent: true, applicant, minors: [] } as const;

const record: EnrolmentRequestRecord = {
  enrolmentRequestId: "enrolment-1",
  academyId: "academy-1",
  requestId,
  status: "submitted",
  applicantIsStudent: true,
  applicant,
  minors: [],
  submittedBy: "client-1",
  submittedAt: now,
  schemaVersion: "1",
};

function services() {
  return {
    now: () => now,
    store: {
      submit: vi.fn().mockResolvedValue(record),
      listForAcademy: vi.fn().mockResolvedValue([record]),
      listForSubmitter: vi.fn().mockResolvedValue([record]),
      returnForChanges: vi
        .fn()
        .mockResolvedValue({ ...record, status: "returned", reviewNote: "Add a phone." }),
      withdraw: vi.fn().mockResolvedValue({ ...record, status: "withdrawn" }),
    },
  } satisfies EnrolmentRequestCallableServices & {
    store: Record<string, ReturnType<typeof vi.fn>>;
  };
}

function request(data: unknown, role?: string, uid = "client-1"): CallableRequest<unknown> {
  return {
    data,
    auth: role === undefined ? undefined : { uid, token: { academyId: "academy-1", role } },
  } as unknown as CallableRequest<unknown>;
}

describe("enrolment request callables", () => {
  it("accepts a submission from any client account, including a buyer", async () => {
    for (const role of ["shopper", "guardian", "adultStudent"]) {
      const current = services();

      const view = await submitEnrolmentRequestHandler(request(submission, role), current);

      expect(view).toEqual({
        enrolmentRequestId: "enrolment-1",
        status: "submitted",
        submittedAt: now,
      });
      expect(current.store.submit).toHaveBeenCalledWith(
        expect.objectContaining({ academyId: "academy-1", actorId: "client-1", now }),
      );
    }
  });

  it("refuses a submission from staff, from office and from nobody", async () => {
    for (const role of ["coach", "headCoach", "owner", "administrator"]) {
      await expect(
        submitEnrolmentRequestHandler(request(submission, role), services()),
      ).rejects.toMatchObject({ code: "permission-denied" });
    }
    await expect(
      submitEnrolmentRequestHandler(request(submission), services()),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("validates the submission before it reaches the store", async () => {
    const current = services();

    for (const payload of [
      null,
      { ...submission, extra: true },
      { ...submission, requestId: "not-a-uuid" },
      { ...submission, applicant: { ...applicant, membershipNumber: "BPT-0001" } },
      { ...submission, applicant: { ...applicant, dateOfBirth: "2015-01-01" } },
      { ...submission, applicantIsStudent: false, minors: [] },
    ]) {
      await expect(
        submitEnrolmentRequestHandler(request(payload, "shopper"), current),
      ).rejects.toMatchObject({ code: "invalid-argument" });
    }
    expect(current.store.submit).not.toHaveBeenCalled();
  });

  it("tells the applicant why a second open request was refused", async () => {
    const current = services();
    current.store.submit.mockRejectedValueOnce(
      new EnrolmentRequestStoreError("precondition", "You already have a request waiting"),
    );

    await expect(
      submitEnrolmentRequestHandler(request(submission, "shopper"), current),
    ).rejects.toMatchObject({
      code: "failed-precondition",
      message: "You already have a request waiting",
    });
  });

  it("shows an applicant only their own requests and no personal detail", async () => {
    const current = services();
    current.store.listForSubmitter.mockResolvedValueOnce([
      record,
      { ...record, enrolmentRequestId: "enrolment-2", submittedBy: "someone-else" },
    ]);

    const views = await listMyEnrolmentRequestsHandler(request(null, "shopper"), current);

    expect(views.map((view) => view.enrolmentRequestId)).toEqual(["enrolment-1"]);
    expect(JSON.stringify(views)).not.toContain("Library Place");
    expect(JSON.stringify(views)).not.toContain("1994-04-02");
  });

  it("keeps confidential detail out of the office queue", async () => {
    const current = services();

    const rows = await listEnrolmentRequestsHandler(request(null, "administrator"), current);

    expect(rows).toEqual([
      {
        enrolmentRequestId: "enrolment-1",
        applicantName: "Alex Adult",
        applicantIsStudent: true,
        minorCount: 0,
        trainingCenter: "Town",
        status: "submitted",
        submittedAt: now,
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("Library Place");
    expect(JSON.stringify(rows)).not.toContain("1994-04-02");
    await expect(
      listEnrolmentRequestsHandler(request(null, "guardian"), current),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      listEnrolmentRequestsHandler(request({ any: true }, "owner"), current),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("returns a request with a note, and only office may do it", async () => {
    const current = services();

    const row = await returnEnrolmentRequestHandler(
      request({ enrolmentRequestId: "enrolment-1", note: "Add a phone." }, "owner", "admin-1"),
      current,
    );

    expect(row.status).toBe("returned");
    expect(current.store.returnForChanges).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "admin-1", note: "Add a phone." }),
    );
    await expect(
      returnEnrolmentRequestHandler(
        request({ enrolmentRequestId: "enrolment-1", note: "Add a phone." }, "shopper"),
        current,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      returnEnrolmentRequestHandler(
        request({ enrolmentRequestId: "enrolment-1" }, "owner"),
        current,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("lets an applicant withdraw a request by id and nothing else", async () => {
    const current = services();

    const view = await withdrawEnrolmentRequestHandler(
      request({ enrolmentRequestId: "enrolment-1" }, "guardian"),
      current,
    );

    expect(view.status).toBe("withdrawn");
    for (const payload of [
      null,
      {},
      { enrolmentRequestId: 7 },
      { enrolmentRequestId: "x", extra: 1 },
    ]) {
      await expect(
        withdrawEnrolmentRequestHandler(request(payload, "guardian"), current),
      ).rejects.toMatchObject({ code: "invalid-argument" });
    }
  });

  it("maps store failures to callable error codes", async () => {
    const current = services();
    current.store.withdraw.mockRejectedValueOnce(
      new EnrolmentRequestStoreError("not-found", "Enrolment request not found"),
    );
    current.store.listForAcademy.mockRejectedValueOnce(new Error("firestore is down"));

    await expect(
      withdrawEnrolmentRequestHandler(
        request({ enrolmentRequestId: "enrolment-1" }, "guardian"),
        current,
      ),
    ).rejects.toMatchObject({ code: "not-found" });
    await expect(
      listEnrolmentRequestsHandler(request(null, "owner"), current),
    ).rejects.toMatchObject({ code: "internal" });
  });
});
