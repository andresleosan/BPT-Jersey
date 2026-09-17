import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MemberProfile } from "@bpt-jersey/domain/members/profile";

import { ProfileTab } from "./profile-tab";
import { RecordEmptyTab } from "./record-empty-tab";

afterEach(cleanup);

const header = {
  studentId: "student-1",
  fullName: "Test Member A",
  age: 26,
  participantType: "adult",
  status: "active",
  birthdayBadge: null,
} as const;

const full: MemberProfile = {
  view: "full",
  header,
  cards: {
    memberSince: "2026-01-15",
    monthsAsMember: 8,
    profession: "Tester",
    accountManagers: [{ displayName: "Test Guardian", familyId: "family-1" }],
    currentMembership: {
      membershipId: "membership-1",
      planName: "Test Plan",
      status: "active",
      validUntil: "2026-12-31",
    },
  },
  details: {
    studentId: "student-1",
    fullName: "Test Member A",
    dateOfBirth: "2000-09-17",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    gender: "unknown",
  },
};

describe("PROFILE tab", () => {
  it("renders member, account manager and plan cards for office", () => {
    render(<ProfileTab profile={full} />);
    const member = screen.getByRole("region", { name: "Member" });
    expect(within(member).getByText("15 Jan 2026 · 8 months")).toBeTruthy();
    expect(within(member).getByText("Tester")).toBeTruthy();
    const manager = screen.getByRole("region", { name: "Account manager" });
    expect(within(manager).getByText("Test Guardian")).toBeTruthy();
    expect(within(manager).getByRole("link", { name: "Open Families" }).getAttribute("href")).toBe(
      "/admin/families",
    );
    const plan = screen.getByRole("region", { name: "Plan" });
    expect(within(plan).getByText("Test Plan")).toBeTruthy();
    expect(within(plan).getByText("Active")).toBeTruthy();
    expect(within(plan).getByText("31 Dec 2026")).toBeTruthy();
    expect(within(plan).getByRole("link", { name: "Open Memberships" }).getAttribute("href")).toBe(
      "/admin/memberships?studentId=student-1",
    );
  });

  it("shows plain empty states when there is no manager or membership", () => {
    render(
      <ProfileTab
        profile={{
          ...full,
          cards: { ...full.cards, accountManagers: [], currentMembership: null },
        }}
      />,
    );
    expect(screen.getByText("No account manager")).toBeTruthy();
    expect(screen.getByText("No current membership")).toBeTruthy();
  });

  it("renders the IBJJF slot first, for both views", () => {
    const { unmount } = render(
      <ProfileTab profile={full} ibjjfCardSlot={<section aria-label="IBJJF slot" />} />,
    );
    const regions = screen.getAllByRole("region");
    expect(regions[0]?.getAttribute("aria-label")).toBe("IBJJF slot");
    unmount();
    render(
      <ProfileTab
        profile={{ view: "coach", header }}
        ibjjfCardSlot={<section aria-label="IBJJF slot" />}
      />,
    );
    expect(screen.getAllByRole("region")).toHaveLength(1);
    expect(screen.queryByText("Test Guardian")).toBeNull();
  });

  it("gives a coach without the IBJJF card a way to Levels, and nothing restricted", () => {
    render(<ProfileTab profile={{ view: "coach", header }} />);
    expect(screen.getByRole("link", { name: "Open Levels" }).getAttribute("href")).toBe(
      "/admin/levels",
    );
    expect(screen.queryByRole("region", { name: "Plan" })).toBeNull();
  });
});

describe("empty record tabs", () => {
  it.each([
    ["plan", "Open Memberships", "/admin/memberships?studentId=student-1"],
    ["documents", "Open Waivers", "/admin/waivers"],
    ["payments", "Open Billing", "/admin/billing"],
    ["classes", "Open Attendance", "/admin/attendance"],
    ["communication", "Open CRM", "/admin/crm"],
  ] as const)("%s links to the module that holds it today", (tab, name, href) => {
    render(
      <RecordEmptyTab tab={tab} studentId="student-1" canOpenDetails onOpenDetails={() => {}} />,
    );
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(href);
  });

  it("sends NOTES to the Details tab", async () => {
    const onOpenDetails = vi.fn();
    render(
      <RecordEmptyTab
        tab="notes"
        studentId="student-1"
        canOpenDetails
        onOpenDetails={onOpenDetails}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open Details" }));
    expect(onOpenDetails).toHaveBeenCalledOnce();
  });
});
