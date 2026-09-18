import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

// The card owns its own reads and has its own suite; MemberRecord is only asked to place it and
// to hand it the one decision it cannot make for itself: whether this viewer may open a level.
const gate = vi.hoisted(() => ({ role: "owner" as string }));
vi.mock("./ibjjf-card", () => ({
  IbjjfCard: ({
    canOpenLevel,
    manageHref,
    studentId,
  }: {
    canOpenLevel: boolean;
    manageHref: string;
    studentId: string;
  }) => (
    <section
      aria-label="JIU-JITSU IBJJF"
      data-can-open-level={String(canOpenLevel)}
      data-manage-href={manageHref}
      data-student-id={studentId}
    />
  ),
}));
vi.mock("../../admin-gate", () => ({ useAdminOrStaffSession: () => ({ role: gate.role }) }));
// The Manage view owns its own reads and its own suite; the record only routes `&view=manage` to
// it and hands it the member and the viewer's role.
vi.mock("./manage-view", () => ({
  unsavedRatingsQuestion: "Discard unsaved ratings?",
  ManageView: ({
    age,
    fullName,
    onRatingsDirtyChange,
    recordHref: href,
    role,
    studentId,
  }: {
    age: number | null;
    fullName: string;
    onRatingsDirtyChange: (dirty: boolean) => void;
    recordHref: string;
    role: string;
    studentId: string;
  }) => (
    <section
      aria-label="Manage IBJJF"
      data-age={String(age)}
      data-full-name={fullName}
      data-record-href={href}
      data-role={role}
      data-student-id={studentId}
    >
      {/* The real panel reports its own dirty state upwards; the record is only asked to act on
          it, so the double is given the one button that makes it say so. */}
      <button onClick={() => onRatingsDirtyChange(true)} type="button">
        Rate a skill
      </button>
      <button onClick={() => onRatingsDirtyChange(false)} type="button">
        Save the ratings
      </button>
    </section>
  ),
}));

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
  gate.role = "owner";
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
    // The card reads a restricted method, so it must not mount before the record is known.
    expect(screen.queryByRole("region", { name: "JIU-JITSU IBJJF" })).toBeNull();
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
    expect(screen.getByRole("region", { name: "JIU-JITSU IBJJF" })).toBeTruthy();
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
    // A coach reaches PROFILE and nothing else, so the card lives in that panel or nowhere.
    expect(screen.getByRole("region", { name: "JIU-JITSU IBJJF" })).toBeTruthy();
  });

  it("lets only an owner or head coach open a level, and points Manage at this record", async () => {
    open("?id=student-1");
    const owner = await screen.findByRole("region", { name: "JIU-JITSU IBJJF" });
    expect(owner.getAttribute("data-can-open-level")).toBe("true");
    expect(owner.getAttribute("data-student-id")).toBe("student-1");
    expect(owner.getAttribute("data-manage-href")).toBe(
      "/admin/members/profile?id=student-1&view=manage",
    );

    for (const role of ["headCoach", "administrator", "coach"]) {
      cleanup();
      gate.role = role;
      open("?id=student-1");
      const card = await screen.findByRole("region", { name: "JIU-JITSU IBJJF" });
      expect(card.getAttribute("data-can-open-level")).toBe(String(role === "headCoach"));
    }
  });

  it("opens the Manage view in place of the PROFILE cards, for every role that reaches it", async () => {
    for (const role of ["owner", "headCoach", "administrator", "coach"]) {
      cleanup();
      gate.role = role;
      open("?id=student-1&view=manage");
      const manage = await screen.findByRole("region", { name: "Manage IBJJF" });
      expect(manage.getAttribute("data-student-id")).toBe("student-1");
      expect(manage.getAttribute("data-full-name")).toBe("Test Member A");
      expect(manage.getAttribute("data-age")).toBe("26");
      expect(manage.getAttribute("data-role")).toBe(role);
      expect(manage.getAttribute("data-record-href")).toBe("/admin/members/profile?id=student-1");
      expect(screen.queryByRole("region", { name: "JIU-JITSU IBJJF" })).toBeNull();
    }
  });

  /**
   * DELIBERATE (Task 16): Manage is a mode of the PROFILE panel, not a tab. No other tab has a
   * Manage variant, so carrying `view=manage` into `?tab=payments` would put a flag in the URL
   * that means nothing there and would silently reopen Manage - with its unsaved note and reason
   * - when the operator came back to PROFILE after leaving it. Leaving the panel leaves the mode.
   * Back still returns to Manage, because that history entry really was Manage.
   */
  it("leaves the Manage view when the operator leaves the PROFILE tab, and Back returns to it", async () => {
    const user = open("?id=student-1&view=manage");
    await screen.findByRole("region", { name: "Manage IBJJF" });

    await user.click(screen.getByRole("tab", { name: "Details" }));
    expect(window.location.search).toBe("?id=student-1&tab=details");
    expect(screen.queryByRole("region", { name: "Manage IBJJF" })).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Profile" }));
    expect(window.location.search).toBe("?id=student-1");
    expect(screen.queryByRole("region", { name: "Manage IBJJF" })).toBeNull();
    expect(screen.getByRole("region", { name: "JIU-JITSU IBJJF" })).toBeTruthy();

    window.history.back();
    await waitFor(() => expect(window.location.search).toBe("?id=student-1&tab=details"));
    window.history.back();
    await waitFor(() => expect(window.location.search).toBe("?id=student-1&view=manage"));
    expect(await screen.findByRole("region", { name: "Manage IBJJF" })).toBeTruthy();
  });

  /**
   * T051V2 review of Task 16 (surviving mutant R4). The test above asserts the ADDRESS after a tab
   * switch, which the URL self-heal effect would repair even if `selectTab` pushed `view=manage`
   * into it — so it proved nothing about `selectTab` itself. This one watches the calls: the entry
   * `selectTab` PUSHES must already be free of the flag, and no repair may be needed. A pushed
   * `view=manage` would otherwise live in the browser's history for that tab for ever.
   */
  it("pushes a tab address with no Manage flag in it, needing no repair", async () => {
    const user = open("?id=student-1&view=manage");
    await screen.findByRole("region", { name: "Manage IBJJF" });
    const pushed = vi.spyOn(window.history, "pushState");
    const replaced = vi.spyOn(window.history, "replaceState");

    await user.click(screen.getByRole("tab", { name: "Details" }));
    expect(pushed).toHaveBeenCalledTimes(1);
    expect(pushed).toHaveBeenCalledWith(
      null,
      "",
      "/admin/members/profile?id=student-1&tab=details",
    );
    expect(replaced).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?id=student-1&tab=details");
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

  it("asks before a Back that would discard unsaved Details, and keeps the URL honest", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = open("?id=student-1");
    await user.click(await screen.findByRole("tab", { name: "Details" }));
    await user.type(await screen.findByLabelText("Nickname"), "Tester");

    window.history.back();
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(
        "You have unsaved changes in Details. Leave without saving?",
      ),
    );
    await waitFor(() => expect(window.location.search).toBe("?id=student-1&tab=details"));
    expect(screen.getByRole("tab", { name: "Details" }).getAttribute("aria-selected")).toBe("true");
    expect((screen.getByLabelText("Nickname") as HTMLInputElement).value).toBe("Tester");
  });

  it("lets a confirmed Back leave Details and discard the draft", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = open("?id=student-1");
    await user.click(await screen.findByRole("tab", { name: "Details" }));
    await user.type(await screen.findByLabelText("Nickname"), "Tester");

    window.history.back();
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
    expect(window.location.search).toBe("?id=student-1");
    expect(screen.queryByLabelText("Nickname")).toBeNull();
  });

  it("rewrites an unknown tab in the URL to the tab it renders", async () => {
    open("?id=student-1&tab=secret");
    await screen.findByRole("heading", { level: 2, name: "Test Member A" });
    await waitFor(() => expect(window.location.search).toBe("?id=student-1"));
    expect(screen.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")).toBe("true");
  });

  it("rewrites a tab a coach cannot open to the tab it renders", async () => {
    client.getMemberProfile.mockResolvedValue({ view: "coach", header });
    open("?id=student-1&tab=details");
    await screen.findByRole("heading", { level: 2, name: "Test Member A" });
    await waitFor(() => expect(window.location.search).toBe("?id=student-1"));
  });

  /**
   * Task 17 review, Major-2. The Manage view holds unsaved skill ratings and does NOT own its own
   * lifetime: these three exits all unmount it, and none of them can see a flag kept inside it.
   * Each of the three is proved separately, because each consults the guard in a different place.
   */
  describe("unsaved ratings in the Manage view", () => {
    async function dirtyManage() {
      const user = open("?id=student-1&view=manage");
      await screen.findByRole("region", { name: "Manage IBJJF" });
      await user.click(screen.getByRole("button", { name: "Rate a skill" }));
      return user;
    }

    it("asks before a tab click leaves the Manage view with unsaved ratings", async () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      const user = await dirtyManage();

      await user.click(screen.getByRole("tab", { name: "Details" }));
      expect(confirm).toHaveBeenCalledWith("Discard unsaved ratings?");
      expect(screen.getByRole("region", { name: "Manage IBJJF" })).toBeTruthy();
      expect(window.location.search).toBe("?id=student-1&view=manage");

      confirm.mockReturnValue(true);
      await user.click(screen.getByRole("tab", { name: "Details" }));
      expect(await screen.findByRole("form", { name: "Member details" })).toBeTruthy();
      expect(window.location.search).toBe("?id=student-1&tab=details");
    });

    it("asks before an arrow key leaves the Manage view with unsaved ratings", async () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      const user = await dirtyManage();
      screen.getByRole("tab", { name: "Profile" }).focus();

      await user.keyboard("{ArrowRight}");
      expect(confirm).toHaveBeenCalledWith("Discard unsaved ratings?");
      expect(screen.getByRole("region", { name: "Manage IBJJF" })).toBeTruthy();
    });

    /**
     * `beforeunload` does NOT fire for an in-app history move, so before the fix this was the
     * likeliest way of all to lose the ratings - the page's own copy invites going back.
     */
    it("asks before Back leaves the Manage view, and keeps the URL honest", async () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      const user = open("?id=student-1");
      await screen.findByRole("region", { name: "JIU-JITSU IBJJF" });
      window.history.pushState(null, "", "/admin/members/profile?id=student-1&view=manage");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await screen.findByRole("region", { name: "Manage IBJJF" });
      await user.click(screen.getByRole("button", { name: "Rate a skill" }));

      window.history.back();
      await waitFor(() => expect(confirm).toHaveBeenCalledWith("Discard unsaved ratings?"));
      await waitFor(() => expect(window.location.search).toBe("?id=student-1&view=manage"));
      expect(screen.getByRole("region", { name: "Manage IBJJF" })).toBeTruthy();
    });

    it("asks before the member-search link discards unsaved ratings", async () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      await dirtyManage();
      const link = screen.getByRole("link", { name: "Back to member search" });
      expect(fireEvent.click(link)).toBe(false);
      expect(confirm).toHaveBeenCalledWith("Discard unsaved ratings?");
      confirm.mockReturnValue(true);
      expect(fireEvent.click(link)).toBe(true);
    });

    it("asks nothing once the ratings have been saved", async () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      const user = await dirtyManage();
      await user.click(screen.getByRole("button", { name: "Save the ratings" }));

      expect(fireEvent.click(screen.getByRole("link", { name: "Back to member search" }))).toBe(
        true,
      );
      await user.click(screen.getByRole("tab", { name: "Details" }));
      expect(confirm).not.toHaveBeenCalled();
      expect(await screen.findByRole("form", { name: "Member details" })).toBeTruthy();
    });
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
