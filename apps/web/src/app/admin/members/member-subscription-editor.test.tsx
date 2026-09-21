import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";
import type { RegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";
const api = vi.hoisted(() => ({
  getMemberSubscriptions: vi.fn(),
  getMemberSubscriptionBilling: vi.fn(),
  manageManualSubscription: vi.fn(),
  resolveImportedSubscription: vi.fn(),
  registerImportedMember: vi.fn(),
  listManagedPlans: vi.fn(),
}));
vi.mock("../../../lib/subscription-admin-client", () => api);
vi.mock("../../../lib/membership-admin-client", () => api);
import { MemberSubscriptionEditor } from "./member-subscription-editor";
import { ProfileSubscriptionEditor } from "./search/profile-subscription-editor";

const plans = [
  ...PLAN_CATALOG.slice(0, 2),
  PLAN_CATALOG.find((plan) => plan.planId === "transit-free")!,
].map((plan) => ({ ...plan, active: true }));
const current = {
  membershipId: "membership-1",
  studentId: "student-1",
  planId: plans[0]!.planId,
  status: "active",
  startsAt: "2026-01-01T10:00:00.000Z",
  endsAt: "2027-01-01T10:00:00.000Z",
  updatedAt: "2026-01-01T10:00:00.000Z",
};
const record: RegyfitMemberRecord = {
  recordId: "161",
  fullName: "Synthetic Child",
  birthDate: "2018-01-01",
  gender: "unknown",
  membershipState: "inactive",
  appAccess: {},
  graduation: {},
  plan: {},
  attendance: { records: [] },
  payments: [],
  source: "regyfit-admin-capture",
  schemaVersion: "1",
  capturedAt: "2026-09-01T10:00:00.000Z",
};
beforeEach(() => {
  api.getMemberSubscriptions.mockResolvedValue({
    studentId: "student-1",
    fullName: "Synthetic Child",
    eligiblePlanIds: [plans[0]!.planId],
    memberships: [],
  });
  api.listManagedPlans.mockResolvedValue(plans);
  api.getMemberSubscriptionBilling.mockResolvedValue([]);
  api.manageManualSubscription.mockResolvedValue(current);
  api.resolveImportedSubscription.mockResolvedValue({ studentId: null });
  api.registerImportedMember.mockResolvedValue({ studentId: "student-1", memberId: "student-1" });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe("manual subscription profile", () => {
  it("keeps the same payment request and generated reference when a transport failure is retried", async () => {
    const user = userEvent.setup();
    api.manageManualSubscription.mockRejectedValueOnce(new Error("Temporary connection failure"));
    render(<MemberSubscriptionEditor studentId="student-1" />);
    await user.click(await screen.findByRole("button", { name: "Assign subscription" }));
    await screen.findByRole("alert");
    expect(api.manageManualSubscription).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Assign subscription" }));
    await waitFor(() => expect(api.manageManualSubscription).toHaveBeenCalledTimes(2));
    expect(api.manageManualSubscription.mock.calls[0]![0]).toEqual(
      api.manageManualSubscription.mock.calls[1]![0],
    );
    expect(api.manageManualSubscription.mock.calls[0]![0].settlement).toMatchObject({
      kind: "paid",
      method: "cash",
      reference: expect.stringMatching(/^OFFICE-/),
    });
  });
  it("assigns a complimentary plan with its reason and no payment fields", async () => {
    const user = userEvent.setup();
    render(<MemberSubscriptionEditor studentId="student-1" />);
    await user.selectOptions(
      await screen.findByLabelText("Payment for this period"),
      "complimentary",
    );
    await user.type(screen.getByLabelText("Reason for free membership"), "Office scholarship");
    await user.click(screen.getByRole("button", { name: "Assign subscription" }));
    await waitFor(() => expect(api.manageManualSubscription).toHaveBeenCalledOnce());
    expect(api.manageManualSubscription.mock.calls[0]![0]).toMatchObject({
      operation: "assign",
      settlement: { kind: "complimentary", reason: "Office scholarship" },
    });
    expect(api.manageManualSubscription.mock.calls[0]![0].settlement).not.toHaveProperty(
      "amountMinor",
    );
  });
  it("assigns Transit Free as complimentary indefinite access", async () => {
    const user = userEvent.setup();
    render(<MemberSubscriptionEditor studentId="student-1" />);
    await user.selectOptions(await screen.findByLabelText("Subscription plan"), "transit-free");
    expect(screen.getByLabelText("No end date")).toBeChecked();
    expect(screen.getByLabelText("No end date")).toBeDisabled();
    expect(screen.getByLabelText("Payment for this period")).toHaveValue("complimentary");
    expect(screen.getByLabelText("Payment for this period")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Assign subscription" }));
    await waitFor(() => expect(api.manageManualSubscription).toHaveBeenCalledOnce());
    expect(api.manageManualSubscription.mock.calls[0]![0]).toMatchObject({
      operation: "assign",
      planId: "transit-free",
      endsAt: null,
      settlement: { kind: "complimentary", reason: "Transit Free indefinite access" },
    });
  });

  it("changes to any active plan while preserving a recorded payment", async () => {
    const user = userEvent.setup();
    api.getMemberSubscriptions.mockResolvedValue({
      studentId: "student-1",
      fullName: "Synthetic Child",
      eligiblePlanIds: [plans[0]!.planId],
      memberships: [current],
    });
    api.getMemberSubscriptionBilling.mockResolvedValue([
      {
        membershipId: current.membershipId,
        complimentary: false,
        currentInvoiceId: "invoice-1",
        reason: null,
        invoices: [
          {
            invoiceId: "invoice-1",
            status: "paid",
            totalMinor: 5000,
            dueAt: current.startsAt,
            paidAt: current.startsAt,
            description: "Monthly fee",
            payments: [
              {
                paymentId: "payment-1",
                amountMinor: 5000,
                method: "cash",
                reference: "CASH-1",
                occurredAt: current.startsAt,
              },
            ],
          },
        ],
      },
    ]);
    render(<MemberSubscriptionEditor studentId="student-1" />);
    await user.selectOptions(await screen.findByLabelText("Subscription plan"), plans[1]!.planId);
    expect(screen.getByLabelText("Payment for this period")).toBeDisabled();
    expect(screen.getByText("Reference: CASH-1")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save subscription" }));
    await waitFor(() => expect(api.manageManualSubscription).toHaveBeenCalledOnce());
    expect(api.manageManualSubscription.mock.calls[0]![0]).toMatchObject({
      operation: "update",
      planId: plans[1]!.planId,
      settlement: { kind: "unchanged" },
      startsAt: current.startsAt,
      endsAt: current.endsAt,
    });
  });
  it("registers an unnumbered imported child with confirmed centre and time, then opens assignment", async () => {
    const user = userEvent.setup();
    render(<ProfileSubscriptionEditor record={record} />);
    await user.selectOptions(await screen.findByLabelText("Training centre"), "West");
    await user.selectOptions(screen.getByLabelText("Preferred training time"), "afternoon");
    expect(screen.getByLabelText("Date of birth")).toHaveValue("2018-01-01");
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Register member and choose subscription" })
        .closest("form")!,
    );
    expect(await screen.findByRole("button", { name: "Assign subscription" })).toBeVisible();
    expect(api.resolveImportedSubscription).toHaveBeenCalledWith("161");
    expect(api.registerImportedMember).toHaveBeenCalledWith({
      recordId: "161",
      requestId: expect.any(String),
      dateOfBirth: "2018-01-01",
      trainingCenter: "West",
      trainingTimePreferences: ["afternoon"],
    });
  });
});

it("requires payment confirmation and links the archive without recording another receipt", async () => {
  const user = userEvent.setup();
  render(
    <MemberSubscriptionEditor
      studentId="student-1"
      previousRecord={{
        ...record,
        plan: {
          membershipPlan: "Previous plan",
          validFrom: "2026-08-01",
          validUntil: "2026-09-30",
        },
      }}
    />,
  );
  await user.selectOptions(
    await screen.findByLabelText("Payment for this period"),
    "previously-paid",
  );
  await user.selectOptions(screen.getByLabelText("Subscription plan"), plans[0]!.planId);
  expect(screen.queryByLabelText("Amount (£)")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Assign subscription" }));
  expect(api.manageManualSubscription).not.toHaveBeenCalled();
  await user.click(screen.getByLabelText(/I have verified this member's previous payment/));
  await user.click(screen.getByRole("button", { name: "Assign subscription" }));
  await waitFor(() => expect(api.manageManualSubscription).toHaveBeenCalledOnce());
  expect(api.manageManualSubscription.mock.calls[0]![0]).toMatchObject({
    operation: "assign",
    settlement: { kind: "previously-paid", recordId: "161", paymentConfirmed: true },
    startsAt: new Date("2026-08-01T00:00").toISOString(),
    endsAt: new Date("2026-10-01T00:00").toISOString(),
  });
});
