import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { EnrolmentRequestRecord } from "@bpt-jersey/domain/members/enrolment-requests";
const api = vi.hoisted(() => ({
  listPublished: vi.fn(),
  openStudentLevel: vi.fn(),
  saveManualSubscription: vi.fn(),
}));
vi.mock("../levels/level-service.js", () => ({ createLevelCatalogStore: () => api }));
vi.mock("../memberships/manual-subscription-service.js", () => ({
  saveManualSubscription: api.saveManualSubscription,
}));
import { createEnrolmentRegistration } from "./enrolment-registration.js";
const baseRecord = {
  academyId: "academy-1",
  enrolmentRequestId: "enrolment-1",
  requestId: "request",
  applicantIsStudent: true,
  approvalRequestId: "6f1d2f66-6f4f-4a2e-9a0e-2b6f0a4a1c11",
  approvalStartedAt: "2026-09-20T12:00:00.000Z",
  planSelections: { applicant: "town-adult", minors: [] },
  payment: {
    amountMinor: 8500,
    paidOn: "2026-09-19",
    proofId: "a".repeat(64),
    reference: "TRANSFER",
  },
  approvalSetup: {
    students: [
      {
        planId: "town-adult",
        definitionKey: "yellow-2",
        startsOn: "2026-09-20",
        endsOn: "2026-10-20",
      },
    ],
    detailsVerified: true,
    paymentVerified: true,
  },
} as unknown as EnrolmentRequestRecord;
const actor = {
  academyId: "academy-1",
  actorId: "admin-1",
  role: "administrator",
  active: true,
  appCheckVerified: true,
} as const;
function harness() {
  const documents = new Map<string, Record<string, unknown>>();
  const db = {
    doc: () => ({
      collection: (name: string) => ({
        doc: (id: string) => ({
          get: async () => ({
            exists: documents.has(`${name}/${id}`),
            get: (key: string) => documents.get(`${name}/${id}`)?.[key],
          }),
        }),
      }),
    }),
  } as unknown as Firestore;
  return { service: createEnrolmentRegistration(db), documents };
}
beforeEach(() => {
  vi.resetAllMocks();
  api.listPublished.mockResolvedValue({ definitions: [{ definitionKey: "yellow-2" }] });
});
describe("registration completion", () => {
  it("uses the admin-selected stripe and records the chosen paid subscription", async () => {
    const { service } = harness();
    await service.validate(baseRecord);
    await service.complete(baseRecord, ["student-1"], actor);
    expect(api.openStudentLevel).toHaveBeenCalledWith(
      expect.objectContaining({
        openedByRole: "administrator",
        input: expect.objectContaining({ definitionKey: "yellow-2", studentId: "student-1" }),
      }),
    );
    expect(api.saveManualSubscription).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: "administrator" }),
      expect.objectContaining({
        planId: "town-adult",
        settlement: expect.objectContaining({
          kind: "paid",
          method: "bank_transfer",
          amountMinor: 8500,
        }),
      }),
    );
  });
  it("creates PAYG without inventing a payment or a complimentary charge", async () => {
    const record = {
      ...baseRecord,
      payment: undefined,
      planSelections: { applicant: "payg", minors: [] },
      approvalSetup: {
        ...baseRecord.approvalSetup!,
        students: [{ ...baseRecord.approvalSetup!.students[0]!, planId: "payg", endsOn: null }],
      },
    } as unknown as EnrolmentRequestRecord;
    const { service } = harness();
    await service.validate(record);
    await service.complete(record, ["student-1"], actor);
    expect(api.saveManualSubscription.mock.calls[0]?.[2].settlement).toEqual({
      kind: "pay-as-you-go",
    });
  });
  it.each([
    { ...baseRecord, payment: undefined },
    { ...baseRecord, payment: { ...baseRecord.payment!, amountMinor: 1 } },
    {
      ...baseRecord,
      approvalSetup: {
        ...baseRecord.approvalSetup!,
        students: [{ ...baseRecord.approvalSetup!.students[0]!, definitionKey: "invented" }],
      },
    },
    {
      ...baseRecord,
      approvalSetup: {
        ...baseRecord.approvalSetup!,
        students: [{ ...baseRecord.approvalSetup!.students[0]!, endsOn: null }],
      },
    },
  ])("refuses incomplete payment, level or period before writing", async (record) => {
    await expect(
      harness().service.validate(record as EnrolmentRequestRecord),
    ).rejects.toMatchObject({ failureCode: "registration_incomplete" });
    expect(api.saveManualSubscription).not.toHaveBeenCalled();
  });
  it("resumes a saved level and subscription without duplicate writes", async () => {
    const { service, documents } = harness();
    api.openStudentLevel.mockImplementation(async () => {
      documents.set("studentLevelProgress/student-1", {
        openedDefinitionKey: "yellow-2",
        openingNotes: "Enrolment enrolment-1",
      });
    });
    api.saveManualSubscription.mockImplementation(async (_db, _actor, input) => {
      documents.set(`membershipChanges/${input.requestId}`, {
        result: { studentId: "student-1", planId: "town-adult" },
      });
    });
    await service.complete(baseRecord, ["student-1"], actor);
    await service.complete(baseRecord, ["student-1"], { ...actor, actorId: "admin-2" });
    expect(api.openStudentLevel).toHaveBeenCalledOnce();
    expect(api.saveManualSubscription).toHaveBeenCalledOnce();
  });
});
