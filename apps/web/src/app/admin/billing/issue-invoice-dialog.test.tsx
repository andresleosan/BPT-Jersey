import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IssueInvoiceDialog } from "./issue-invoice-dialog";

const members = [
  { studentId: "s1", fullName: "Ana Coelho", familyId: "f1" },
  { studentId: "s2", fullName: "Zé Pinto", familyId: null },
  { studentId: "s3", fullName: "Ana Maria Costa", familyId: "f3" },
] as const;

describe("issue invoice dialog", () => {
  afterEach(cleanup);

  it("issues a custom charge to a member without membership", async () => {
    const issue = vi.fn().mockResolvedValue({ invoiceId: "i1" });
    const onIssued = vi.fn();
    render(
      <IssueInvoiceDialog
        issue={issue}
        members={members}
        memberships={[]}
        onClose={vi.fn()}
        onIssued={onIssued}
      />,
    );
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a member" }), {
      target: { value: "ana" },
    });
    fireEvent.click(screen.getByRole("option", { name: "Ana Coelho" }));
    expect(screen.getByRole("radio", { name: "No membership · custom charge" })).toBeChecked();
    fireEvent.change(screen.getByLabelText("Invoice amount (GBP)"), { target: { value: "15.00" } });
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Charge type"), {
      target: { value: "manual_adjustment" },
    });
    fireEvent.change(screen.getByLabelText("Invoice reference"), {
      target: { value: "INV-SEM-1" },
    });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Seminar" } });
    fireEvent.click(screen.getByRole("button", { name: "Issue invoice" }));
    await waitFor(() =>
      expect(issue).toHaveBeenCalledWith({
        familyId: "f1",
        membershipId: null,
        totalMinor: 1500,
        dueAt: "2026-10-01T23:59:59.000Z",
        chargeKind: "manual_adjustment",
        invoiceReference: "INV-SEM-1",
        description: "Seminar",
      }),
    );
    expect(onIssued).toHaveBeenCalledWith({ invoiceId: "i1" });
  });

  it("preselects the active membership and blocks a member with no family", async () => {
    render(
      <IssueInvoiceDialog
        members={members}
        memberships={[
          {
            membershipId: "m1",
            familyId: "f1",
            studentId: "s1",
            planId: "town-teens",
            status: "active",
            startsAt: "2026-01-01T00:00:00.000Z",
            endsAt: null,
            nextBillingAt: null,
          },
        ]}
        onClose={vi.fn()}
        onIssued={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a member" }), {
      target: { value: "ana c" },
    });
    fireEvent.click(screen.getByRole("option", { name: "Ana Coelho" }));
    expect(screen.getByRole("radio", { name: /town-teens · active/u })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Change member" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a member" }), {
      target: { value: "ze" },
    });
    fireEvent.click(screen.getByRole("option", { name: "Zé Pinto" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This member has no billing family yet. Add the family before invoicing.",
    );
    expect(screen.getByRole("button", { name: "Issue invoice" })).toBeDisabled();
  });
});
