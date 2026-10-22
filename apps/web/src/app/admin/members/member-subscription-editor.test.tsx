import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";
const api = vi.hoisted(() => ({
  getMemberSubscriptions: vi.fn(),
  getMemberSubscriptionBilling: vi.fn(),
  manageManualSubscription: vi.fn(),
  listManagedPlans: vi.fn(),
}));
vi.mock("../../../lib/subscription-admin-client", () => api);
vi.mock("../../../lib/membership-admin-client", () => api);
import { MemberSubscriptionEditor } from "./member-subscription-editor";

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
    render(<MemberSubscriptionEditor studentId="student-1" role="owner" />);
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

  // db8bd61 (PRODUCT.md, 2026-10-15): an administrator has the owner's powers, Transit Free
  // included; coaches still never get it.
  it("offers Transit Free to an administrator and hides it from a coach", async () => {
    render(<MemberSubscriptionEditor studentId="student-1" role="administrator" />);
    expect(await screen.findByText("Transit Free · unlimited, indefinite")).toBeInTheDocument();
    cleanup();
    render(<MemberSubscriptionEditor studentId="student-1" role="coach" />);
    await screen.findByLabelText("Subscription plan");
    expect(screen.queryByText("Transit Free · unlimited, indefinite")).not.toBeInTheDocument();
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
});
