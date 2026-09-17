import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";

const clientMocks = vi.hoisted(() => ({ revealRegyfitRecordField: vi.fn() }));

vi.mock("../../../../lib/members-client", () => clientMocks);

import { MemberProfilePanel } from "./member-profile-panel";

const baseRecord: RegyfitMemberRecord = {
  recordId: "152",
  memberNumber: "1",
  fullName: "Synthetic Child",
  country: "Jersey",
  idCardNumber: "•••789",
  gender: "unknown",
  membershipState: "inactive",
  appAccess: { login: "a1", logins: 0, lastLogin: "----" },
  graduation: {},
  plan: {},
  attendance: { records: [] },
  payments: [],
  capturedAt: "2026-09-04T18:04:32.000Z",
  source: "regyfit-admin-capture",
  schemaVersion: "1",
};

const otherRecord: RegyfitMemberRecord = {
  ...baseRecord,
  recordId: "300",
  memberNumber: "2",
  fullName: "Synthetic Adult",
  idCardNumber: "•••444",
};

describe("Member profile panel restricted identifiers", () => {
  afterEach(() => {
    cleanup();
    clientMocks.revealRegyfitRecordField.mockReset();
  });

  it("drops a revealed identifier when the panel moves to another member's record", async () => {
    const user = userEvent.setup();
    clientMocks.revealRegyfitRecordField.mockResolvedValue("ID-000789");
    const { rerender } = render(
      <MemberProfilePanel record={baseRecord} onCanonicalLookup={() => {}} onClose={() => {}} />,
    );
    const profile = screen.getByRole("region", { name: "Synthetic Child" });

    await user.click(within(profile).getByRole("tab", { name: "Details" }));
    await user.click(within(profile).getByRole("button", { name: "Reveal ID card Nº" }));
    expect(await within(profile).findByText("ID-000789")).toBeVisible();

    rerender(
      <MemberProfilePanel record={otherRecord} onCanonicalLookup={() => {}} onClose={() => {}} />,
    );

    expect(screen.queryByText("ID-000789")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Profile" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.queryByText("ID-000789")).not.toBeInTheDocument();
    expect(screen.getByText("•••444")).toBeVisible();
  });
});
