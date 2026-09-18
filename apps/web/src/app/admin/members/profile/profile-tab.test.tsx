import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MemberProfile } from "@bpt-jersey/domain/members/profile";
import { currentMembershipStatuses } from "@bpt-jersey/domain/memberships/lifecycle";

import { ProfileTab, membershipStatusClass } from "./profile-tab";
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
  it("styles every membership status the domain allows", () => {
    expect(Object.keys(membershipStatusClass).sort()).toEqual(
      [...currentMembershipStatuses].sort(),
    );
  });

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

  it.each([
    // A trial is a normal beginning, so it keeps the base neutral rule: purple is the accent
    // reserved for emphasis and primary actions (DESIGN.md §2, §4).
    ["trial", "Trial", "member-record-status"],
    ["active", "Active", "member-record-status member-record-status-active"],
    ["paused", "Paused", "member-record-status member-record-status-attention"],
    ["overdue", "Overdue", "member-record-status member-record-status-attention"],
  ] as const)("shows a %s membership as text plus its own left rule", (status, label, rule) => {
    render(
      <ProfileTab
        profile={{
          ...full,
          cards: {
            ...full.cards,
            currentMembership: {
              membershipId: "membership-1",
              planName: "Test Plan",
              status,
              validUntil: "2026-12-31",
            },
          },
        }}
      />,
    );
    const plan = screen.getByRole("region", { name: "Plan" });
    expect(within(plan).getByText(label).className).toBe(rule);
  });

  // DESIGN.md §3: one eyebrow opens a screen. The record header already carries it, so the
  // PROFILE cards must not repeat it down the column.
  it("does not repeat an eyebrow on every card", () => {
    const { container } = render(<ProfileTab profile={full} />);
    expect(container.querySelectorAll(".admin-eyebrow")).toHaveLength(0);
  });

  it("keeps Families reachable when there is no account manager", () => {
    render(<ProfileTab profile={{ ...full, cards: { ...full.cards, accountManagers: [] } }} />);
    const manager = screen.getByRole("region", { name: "Account manager" });
    expect(within(manager).getByRole("link", { name: "Open Families" }).getAttribute("href")).toBe(
      "/admin/families",
    );
  });

  it("treats a null slot as no slot at all", () => {
    const { container } = render(
      <ProfileTab profile={{ view: "coach", header }} ibjjfCardSlot={null} />,
    );
    expect(screen.getByRole("link", { name: "Open Levels" }).getAttribute("href")).toBe(
      "/admin/levels",
    );
    expect(container.querySelectorAll("div.member-record-wide")).toHaveLength(0);
  });

  it("gives a coach without the IBJJF card a way to Levels, and nothing restricted", () => {
    render(<ProfileTab profile={{ view: "coach", header }} />);
    const levels = screen.getByRole("link", { name: "Open Levels" });
    expect(levels.getAttribute("href")).toBe("/admin/levels");
    expect(levels.className).toBe("member-record-button");
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
    const action = screen.getByRole("link", { name });
    expect(action.getAttribute("href")).toBe(href);
    // DESIGN.md §4: an empty state offers a single primary button, never a secondary weight.
    expect(action.className).toBe("member-record-button");
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

  it("still offers one way out when the viewer cannot open Details", () => {
    render(
      <RecordEmptyTab
        tab="notes"
        studentId="student-1"
        canOpenDetails={false}
        onOpenDetails={() => {}}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    const members = screen.getByRole("link", { name: "Open Members" });
    expect(members.getAttribute("href")).toBe("/admin/members");
    expect(members.className).toBe("member-record-button");
  });
});
