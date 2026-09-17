import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MemberProfile } from "@bpt-jersey/domain/members/profile";

const client = vi.hoisted(() => {
  class MemberRecordLoadError extends Error {}
  class MemberDetailsConflictError extends Error {}
  return {
    MemberRecordLoadError,
    MemberDetailsConflictError,
    getMemberProfile: vi.fn(),
    saveMemberDetails: vi.fn(),
    searchMemberNames: vi.fn(),
    isMemberRecordId: (value: string | null) =>
      value !== null && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value),
  };
});

vi.mock("../../../../lib/member-profile-client", () => client);

import { MemberRecord, readRecordLocation, recordHref } from "./member-record";

const header = {
  studentId: "student-1",
  fullName: "Test Member A",
  age: 26,
  participantType: "adult",
  status: "active",
  birthdayBadge: { kind: "today" },
} as const;

const full: MemberProfile = {
  view: "full",
  header: { ...header, maskedMemberReference: "****0000" },
  cards: {
    memberSince: "2026-01-15",
    monthsAsMember: 8,
    accountManagers: [],
    currentMembership: null,
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
    membershipNumber: "00000000",
  },
};

function open(search: string) {
  window.history.replaceState(null, "", `/admin/members/profile${search}`);
  render(<MemberRecord />);
  return userEvent.setup();
}

beforeEach(() => {
  client.getMemberProfile.mockResolvedValue(full);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("record location", () => {
  it("reads and writes linkable record URLs", () => {
    expect(readRecordLocation("?id=student-1&tab=details&view=manage")).toEqual({
      studentId: "student-1",
      tab: "details",
      manage: true,
    });
    expect(readRecordLocation("?id=../x&tab=secret")).toEqual({
      studentId: null,
      tab: "profile",
      manage: false,
    });
    expect(recordHref("student-1")).toBe("/admin/members/profile?id=student-1");
    expect(recordHref("student-1", "details")).toBe(
      "/admin/members/profile?id=student-1&tab=details",
    );
    expect(recordHref("student-1", "profile", true)).toBe(
      "/admin/members/profile?id=student-1&view=manage",
    );
  });
});

describe("member record page", () => {
  it("refuses an invalid id without calling the backend", async () => {
    open("?id=../student");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "This member record link is not valid.",
    );
    expect(client.getMemberProfile).not.toHaveBeenCalled();
  });

  it("shows a skeleton, then the header and eight tabs for office", async () => {
    let resolve: (value: MemberProfile) => void = () => {};
    client.getMemberProfile.mockReturnValue(new Promise<MemberProfile>((done) => (resolve = done)));
    open("?id=student-1");
    expect(screen.getByRole("status", { name: "Loading member record" })).toBeTruthy();
    resolve(full);

    expect(await screen.findByRole("heading", { level: 2, name: "Test Member A" })).toBeTruthy();
    expect(screen.getByText("****0000")).toBeTruthy();
    expect(screen.getByText("Birthday today")).toBeTruthy();
    expect(screen.getByText("Active").className).toContain("member-record-status-active");
    const tabs = within(
      screen.getByRole("tablist", { name: "Member record sections" }),
    ).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Profile",
      "Details",
      "Plan",
      "Documents",
      "Payments",
      "Classes",
      "Communication",
      "Notes",
    ]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(client.getMemberProfile).toHaveBeenCalledWith("student-1");
  });

  it("opens the tab named in the URL", async () => {
    open("?id=student-1&tab=details");
    expect(await screen.findByRole("form", { name: "Member details" })).toBeTruthy();
  });

  it("shows a coach only the Profile tab, whatever the URL asks for", async () => {
    client.getMemberProfile.mockResolvedValue({ view: "coach", header });
    open("?id=student-1&tab=details");
    await screen.findByRole("heading", { level: 2, name: "Test Member A" });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Profile"]);
    expect(screen.queryByRole("form", { name: "Member details" })).toBeNull();
    expect(screen.queryByText("Member reference")).toBeNull();
  });

  it("moves between tabs with arrow, Home and End keys and keeps the URL in step", async () => {
    const user = open("?id=student-1");
    const profileTab = await screen.findByRole("tab", { name: "Profile" });
    profileTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Details" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Details" }));
    expect(window.location.search).toBe("?id=student-1&tab=details");
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Notes" }).getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")).toBe("true");
    expect(window.location.search).toBe("?id=student-1");
  });

  it("warns before leaving Details with unsaved changes", async () => {
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const user = open("?id=student-1&tab=details");
    await user.type(await screen.findByLabelText("Nickname"), "Tester");

    await user.click(screen.getByRole("tab", { name: "Plan" }));
    expect(confirm).toHaveBeenCalledWith(
      "You have unsaved changes in Details. Leave without saving?",
    );
    expect(screen.getByRole("tab", { name: "Details" }).getAttribute("aria-selected")).toBe("true");

    await user.click(screen.getByRole("tab", { name: "Plan" }));
    expect(screen.getByRole("link", { name: "Open Memberships" })).toBeTruthy();
  });

  it("shows the safe load error and retries", async () => {
    client.getMemberProfile.mockRejectedValueOnce(
      new client.MemberRecordLoadError("This member record was not found."),
    );
    const user = open("?id=student-1");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "This member record was not found.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(client.getMemberProfile).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("heading", { level: 2, name: "Test Member A" })).toBeTruthy();
  });
});
