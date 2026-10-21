import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressManagement } from "@bpt-jersey/domain/levels";
import type { MemberOverview, MemberOverviewRow } from "@bpt-jersey/domain/members/overview";
import type { SubscriptionBilling } from "@bpt-jersey/domain/memberships/admin";
const mocks = vi.hoisted(() => ({ getMemberOverview: vi.fn(), deleteMemberAccount: vi.fn() }));
const progressClient = vi.hoisted(() => ({ getProgressManagement: vi.fn() }));
const billingClient = vi.hoisted(() => ({ getMemberSubscriptionBilling: vi.fn() }));
vi.mock("../../../lib/member-overview-client", () => mocks);
vi.mock("../../../lib/member-migration-client", () => ({}));
vi.mock("../../../lib/member-profile-client", () => ({ searchMemberNames: vi.fn() }));
vi.mock("../../../lib/progress-management-client", () => progressClient);
vi.mock("../../../lib/subscription-admin-client", () => billingClient);
import { AdminGateSessionProvider } from "../admin-gate";
import { MembersWorkspace, filterRows, planLabel } from "./members-workspace";

function row(overrides: Partial<MemberOverviewRow>): MemberOverviewRow {
  return {
    studentId: "s-1",
    rowKind: "member",
    fullName: "Mia Rowe",
    trainingCenter: "Town",
    centreConfirmed: true,
    active: false,
    recordActive: true,
    source: "bpt",
    planState: "none",
    ownAccount: false,
    flags: [],
    ...overrides,
  };
}

const trialRow = row({
  studentId: "s-trial",
  fullName: "Tia Trial",
  active: true,
  planState: "trial",
  plan: {
    planId: "free-trial",
    displayName: "Free Trial",
    status: "active",
    endsAt: "2026-10-10T00:00:00.000Z",
  },
});
const syntheticGuardian = row({
  studentId: "guardian:user-g",
  rowKind: "guardian",
  userId: "user-g",
  fullName: "Gina Guard",
  ownAccount: true,
});
const recordGuardian = row({
  studentId: "s-g2",
  rowKind: "guardian",
  fullName: "Glen Guard",
  planState: "expired",
});
const inactiveRow = row({ studentId: "s-old", fullName: "Olly Old" });

const overview: MemberOverview = {
  rows: [syntheticGuardian, recordGuardian, inactiveRow, trialRow],
  counters: { total: 4, active: 1, expiring: 0, review: 0, inactive: 1, guardians: 2 },
  generatedAt: "2026-09-25T10:00:00.000Z",
};
const filters = { query: "", centre: "", band: "", source: "" };

// MembersWorkspace reads the signed-in role (owner-only Progress management tab since 68d5acd).
const session = {
  uid: "synthetic-admin",
  email: "admin@example.test",
  displayName: "Synthetic Administrator",
  academyId: "synthetic-academy",
  role: "owner" as const,
};

function renderWorkspace() {
  return render(
    <AdminGateSessionProvider session={session}>
      <MembersWorkspace />
    </AdminGateSessionProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getMemberOverview.mockResolvedValue(overview);
});
afterEach(cleanup);

it("labels a free trial and a guardian row", () => {
  expect(planLabel(trialRow).title).toBe("Free Trial");
  expect(planLabel(recordGuardian)).toEqual({
    title: "Guardian",
    detail: "Parent or guardian of an active member",
  });
});

it("filters guardians apart from inactive members and finds them by name", () => {
  expect(
    filterRows(overview.rows, { ...filters, status: "guardians" }).map((item) => item.fullName),
  ).toEqual(["Gina Guard", "Glen Guard"]);
  expect(
    filterRows(overview.rows, { ...filters, status: "inactive" }).map((item) => item.fullName),
  ).toEqual(["Olly Old"]);
  expect(
    filterRows(overview.rows, { ...filters, status: "active", query: "gina" }).map(
      (item) => item.fullName,
    ),
  ).toEqual(["Gina Guard"]);
});

it("shows the Guardians tile with its counter and lists guardians without student links for synthetic rows", async () => {
  renderWorkspace();
  expect(await screen.findByText("Tia Trial")).toBeVisible();
  expect(screen.getByText("Free Trial")).toBeVisible();
  const tile = screen.getByRole("button", { name: /Guardians/ });
  expect(tile).toHaveTextContent("2");
  await userEvent.click(tile);
  const table = screen.getByRole("table", { name: "Member directory" });
  const gina = within(table).getByText("Gina Guard").closest("tr") as HTMLElement;
  expect(within(gina).queryByRole("link")).not.toBeInTheDocument();
  expect(within(gina).queryByRole("button", { name: "Delete account" })).not.toBeInTheDocument();
  expect(within(gina).getByText("Guardian")).toBeVisible();
  const glen = within(table).getByText("Glen Guard").closest("tr") as HTMLElement;
  expect(within(glen).getByRole("link", { name: "Glen Guard" })).toBeVisible();
  expect(within(table).queryByText("Olly Old")).not.toBeInTheDocument();
});

describe("Delete account confirmation", () => {
  const member = row({
    studentId: "s-ana",
    fullName: "Ana María Coelho",
    active: true,
    planState: "current",
    ownAccount: true,
    plan: {
      planId: "adults-monthly",
      displayName: "Adults Monthly",
      status: "active",
      endsAt: null,
    },
  });
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** Each hand-added date also writes a change-log entry; the delete keeps both. */
  function progressOf(attended: number, manual = 0, initialized = true): ProgressManagement {
    return {
      studentId: member.studentId,
      initialized,
      currentDefinitionKey: initialized ? "adult-white-0" : null,
      startedOn: null,
      classesAtLevel: 0,
      daysAtLevel: 0,
      baselineCutoff: null,
      undoPromotionId: null,
      attendance: [
        ...Array.from({ length: attended }, (_, index) => ({
          id: `session-${index}__s-ana`,
          kind: "attendance" as const,
          date: "2026-10-01",
          label: "Adults Gi",
          openMat: false,
          voided: false,
          reason: null,
        })),
        ...Array.from({ length: manual }, (_, index) => ({
          id: `manual-${index}`,
          kind: "manual" as const,
          date: "2026-10-02",
          label: "Added by owner",
          openMat: false,
          voided: false,
          reason: "Trained at a seminar",
        })),
      ],
      history: Array.from({ length: manual }, () => ({
        at: "2026-10-02T10:00:00.000Z",
        by: "Office",
        summary: "Attendance added on 2026-10-02",
        reason: "Trained at a seminar",
      })),
    };
  }

  /** One array per subscription, one number of payments per invoice. */
  function billingOf(...subscriptions: number[][]): SubscriptionBilling[] {
    return subscriptions.map((invoices, membership) => ({
      membershipId: `m-${membership}`,
      complimentary: false,
      currentInvoiceId: null,
      reason: null,
      invoices: invoices.map((payments, invoice) => ({
        invoiceId: `i-${membership}-${invoice}`,
        status: "paid" as const,
        totalMinor: 5000,
        paidAt: null,
        dueAt: "2026-09-01T00:00:00.000Z",
        description: "Adults Monthly",
        payments: Array.from({ length: payments }, (_, payment) => ({
          paymentId: `p-${membership}-${invoice}-${payment}`,
          amountMinor: 5000,
          method: "cash" as const,
          reference: "Cash at the desk",
          occurredAt: "2026-09-01T10:00:00.000Z",
          lastEdit: null,
          auditHistory: [],
        })),
      })),
    }));
  }

  function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    let reject: (reason: unknown) => void = () => {};
    const promise = new Promise<T>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    return { promise, resolve, reject };
  }

  function rowDeleteButton(fullName = member.fullName) {
    const table = screen.getByRole("table", { name: "Member directory" });
    const line = within(table).getByText(fullName).closest("tr") as HTMLElement;
    return within(line).getByRole("button", { name: "Delete account" });
  }

  async function openDialog(fullName = member.fullName) {
    renderWorkspace();
    await screen.findByRole("table", { name: "Member directory" });
    await userEvent.click(rowDeleteButton(fullName));
    return screen.getByRole("dialog", { name: "Delete account" });
  }

  function nameBox(dialog: HTMLElement) {
    return within(dialog).getByRole("textbox", { name: "Type “Ana María Coelho” to confirm" });
  }

  function deletedItems(dialog: HTMLElement) {
    return within(within(dialog).getByRole("list", { name: "What will be deleted" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
  }

  beforeEach(() => {
    mocks.getMemberOverview.mockResolvedValue({ ...overview, rows: [...overview.rows, member] });
    progressClient.getProgressManagement.mockResolvedValue(progressOf(12, 3));
    billingClient.getMemberSubscriptionBilling.mockResolvedValue(billingOf([2, 1], [1]));
  });

  it("opens a dialog that lists what will be deleted, loaded only when it opens", async () => {
    renderWorkspace();
    await screen.findByRole("table", { name: "Member directory" });
    expect(progressClient.getProgressManagement).not.toHaveBeenCalled();
    expect(billingClient.getMemberSubscriptionBilling).not.toHaveBeenCalled();

    await userEvent.click(rowDeleteButton());
    const dialog = screen.getByRole("dialog", { name: "Delete account" });
    expect(await within(dialog).findByText("12 classes attended")).toBeVisible();
    expect(progressClient.getProgressManagement).toHaveBeenCalledWith("s-ana");
    expect(billingClient.getMemberSubscriptionBilling).toHaveBeenCalledWith("s-ana");
    // The 3 hand-added dates and their change log survive the delete, so none of them is listed.
    expect(deletedItems(dialog)).toEqual([
      "12 classes attended",
      "Current level",
      "4 plan payments, unless the family has other members",
      "Plan: Adults Monthly",
      "Bookings",
      "The app login, unless another member uses it",
    ]);
    expect(within(dialog).getByText(/A copy is kept for 30 days\./)).toBeVisible();
    expect(nameBox(dialog)).toHaveAccessibleDescription(
      "This deletes the member and everything below for good, even with an active plan. A copy is kept for 30 days.",
    );
    expect(within(dialog).queryByText("Some totals could not be loaded.")).not.toBeInTheDocument();
    expect(mocks.deleteMemberAccount).not.toHaveBeenCalled();
  });

  it("lists a plan and the app login only when the member has them", async () => {
    const kid = row({ studentId: "s-kid", fullName: "Kit Kid", active: true });
    mocks.getMemberOverview.mockResolvedValue({ ...overview, rows: [...overview.rows, kid] });
    const dialog = await openDialog("Kit Kid");
    await within(dialog).findByText("12 classes attended");
    expect(progressClient.getProgressManagement).toHaveBeenCalledWith("s-kid");
    expect(deletedItems(dialog)).toEqual([
      "12 classes attended",
      "Current level",
      "4 plan payments, unless the family has other members",
      "Bookings",
    ]);
  });

  it("says “or more” at the list limit and says when there is no level yet", async () => {
    progressClient.getProgressManagement.mockResolvedValue(progressOf(1000, 0, false));
    billingClient.getMemberSubscriptionBilling.mockResolvedValue([]);
    let dialog = await openDialog();
    expect(await within(dialog).findByText("1,000 or more classes attended")).toBeVisible();
    expect(within(dialog).getByText("No level yet")).toBeVisible();
    expect(within(dialog).getByText("0 plan payments")).toBeVisible();

    // The limit counts hand-added dates too, so the classes left in a full list are a minimum.
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    progressClient.getProgressManagement.mockResolvedValue(progressOf(990, 10));
    billingClient.getMemberSubscriptionBilling.mockResolvedValue(billingOf([1]));
    await userEvent.click(rowDeleteButton());
    dialog = screen.getByRole("dialog", { name: "Delete account" });
    expect(await within(dialog).findByText("990 or more classes attended")).toBeVisible();
    expect(
      within(dialog).getByText("1 plan payment, unless the family has other members"),
    ).toBeVisible();

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    progressClient.getProgressManagement.mockResolvedValue(progressOf(1, 2));
    await userEvent.click(rowDeleteButton());
    dialog = screen.getByRole("dialog", { name: "Delete account" });
    expect(await within(dialog).findByText("1 class attended")).toBeVisible();
  });

  it("keeps Delete account disabled until the totals are in and the full name is typed", async () => {
    const progress = deferred<ProgressManagement>();
    progressClient.getProgressManagement.mockReturnValue(progress.promise);
    const dialog = await openDialog();
    const remove = within(dialog).getByRole("button", { name: "Delete account" });
    expect(within(dialog).getByText("Checking what will be deleted…")).toBeVisible();
    fireEvent.change(nameBox(dialog), { target: { value: "Ana María Coelho" } });
    expect(remove).toBeDisabled();

    progress.resolve(progressOf(12, 3));
    expect(await within(dialog).findByText("12 classes attended")).toBeVisible();
    expect(remove).toBeEnabled();
    for (const wrong of ["", "Ana", "Ana María Coelh", "Ana Maria Coelho", "Ana María Coelho Jr"]) {
      fireEvent.change(nameBox(dialog), { target: { value: wrong } });
      expect(remove).toBeDisabled();
    }
    // Capitals, extra spaces and a decomposed accent still match the name on record.
    fireEvent.change(nameBox(dialog), { target: { value: "  ana  MARÍA coelho " } });
    expect(remove).toBeEnabled();
    expect(mocks.deleteMemberAccount).not.toHaveBeenCalled();
  });

  it("deletes the member with its studentId once the name is typed, then closes and reloads", async () => {
    const deletion = deferred<unknown>();
    mocks.deleteMemberAccount.mockReturnValue(deletion.promise);
    const dialog = await openDialog();
    await within(dialog).findByText("12 classes attended");
    fireEvent.change(nameBox(dialog), { target: { value: "Ana María Coelho" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete account" }));

    expect(mocks.deleteMemberAccount).toHaveBeenCalledTimes(1);
    expect(mocks.deleteMemberAccount).toHaveBeenCalledWith({
      studentId: "s-ana",
      requestId: expect.stringMatching(uuidPattern),
    });
    expect(within(dialog).getByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("dialog", { name: "Delete account" })).toBe(dialog);

    deletion.resolve({ studentId: "s-ana", cancelledBookings: 0, removedMemberships: 1 });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(mocks.getMemberOverview).toHaveBeenCalledTimes(2));
    expect(mocks.deleteMemberAccount).toHaveBeenCalledTimes(1);
  });

  it("closes on Cancel or Escape without deleting anything, back on the row's button", async () => {
    let dialog = await openDialog();
    fireEvent.change(nameBox(dialog), { target: { value: "Ana María Coelho" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(rowDeleteButton()).toHaveFocus();

    await userEvent.click(rowDeleteButton());
    dialog = screen.getByRole("dialog", { name: "Delete account" });
    expect(nameBox(dialog)).toHaveValue("");
    await userEvent.click(nameBox(dialog));
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(rowDeleteButton()).toHaveFocus();
    expect(mocks.deleteMemberAccount).not.toHaveBeenCalled();
    expect(mocks.getMemberOverview).toHaveBeenCalledTimes(1);
  });

  it("still allows deletion, with a warning, when the totals cannot be loaded", async () => {
    progressClient.getProgressManagement.mockRejectedValue(
      new Error("Unable to load this member's progress. Please try again."),
    );
    billingClient.getMemberSubscriptionBilling.mockRejectedValue(
      new Error("Unable to complete this request. Please try again."),
    );
    mocks.deleteMemberAccount.mockResolvedValue({
      studentId: "s-ana",
      cancelledBookings: 0,
      removedMemberships: 1,
    });
    const dialog = await openDialog();
    expect(await within(dialog).findByText("Some totals could not be loaded.")).toBeVisible();
    expect(deletedItems(dialog)).toEqual([
      "Classes attended",
      "Current level",
      "Plan payments, unless the family has other members",
      "Plan: Adults Monthly",
      "Bookings",
      "The app login, unless another member uses it",
    ]);
    fireEvent.change(nameBox(dialog), { target: { value: "Ana María Coelho" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete account" }));
    expect(mocks.deleteMemberAccount).toHaveBeenCalledWith({
      studentId: "s-ana",
      requestId: expect.stringMatching(uuidPattern),
    });
    await waitFor(() => expect(mocks.getMemberOverview).toHaveBeenCalledTimes(2));
  });

  it("shows a failed delete inside the dialog, stays open and retries with a fresh request id", async () => {
    mocks.deleteMemberAccount.mockRejectedValue(
      new Error("This member is also a coach. Remove coach access first in Staff."),
    );
    const dialog = await openDialog();
    await within(dialog).findByText("12 classes attended");
    fireEvent.change(nameBox(dialog), { target: { value: "Ana María Coelho" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete account" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This member is also a coach. Remove coach access first in Staff.",
    );
    expect(screen.getByRole("dialog", { name: "Delete account" })).toBe(dialog);
    expect(within(dialog).getByRole("button", { name: "Delete account" })).toBeEnabled();
    expect(mocks.getMemberOverview).toHaveBeenCalledTimes(1);

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete account" }));
    expect(mocks.deleteMemberAccount).toHaveBeenCalledTimes(2);
    const [first, second] = mocks.deleteMemberAccount.mock.calls.map(
      ([input]) => (input as { requestId: string }).requestId,
    );
    expect(first).not.toBe(second);
  });

  it("opens again if the browser closes it during a delete, so a failure still shows", async () => {
    const deletion = deferred<unknown>();
    mocks.deleteMemberAccount.mockReturnValue(deletion.promise);
    const dialog = (await openDialog()) as HTMLDialogElement;
    await within(dialog).findByText("12 classes attended");
    fireEvent.change(nameBox(dialog), { target: { value: "Ana María Coelho" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete account" }));

    // Chromium closes a modal on a repeated Escape: that cancel can no longer be refused.
    fireEvent(dialog, new Event("cancel", { cancelable: false }));
    dialog.close();
    fireEvent(dialog, new Event("close"));
    expect(dialog.open).toBe(true);

    deletion.reject(new Error("This member is also a coach. Remove coach access first in Staff."));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This member is also a coach. Remove coach access first in Staff.",
    );
    expect(dialog.open).toBe(true);
    expect(screen.getByRole("dialog", { name: "Delete account" })).toBe(dialog);
  });
});
