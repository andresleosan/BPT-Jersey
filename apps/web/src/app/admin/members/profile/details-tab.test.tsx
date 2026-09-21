import { existsSync, readFileSync } from "node:fs";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FullMemberProfile } from "@bpt-jersey/domain/members/profile";

const client = vi.hoisted(() => {
  class MemberDetailsConflictError extends Error {}
  class MemberDetailsSaveError extends Error {}
  return {
    MemberDetailsConflictError,
    MemberDetailsSaveError,
    saveMemberDetails: vi.fn(),
    searchMemberNames: vi.fn(),
  };
});

vi.mock("../../../../lib/member-profile-client", () => client);

import { DetailsTab } from "./details-tab";

const outOfListMessage = "This stored value is no longer a choice. Pick one from the list.";

const profile: FullMemberProfile = {
  view: "full",
  header: {
    studentId: "student-1",
    fullName: "Test Member A",
    age: 26,
    participantType: "adult",
    status: "active",
    birthdayBadge: { kind: "today" },
  },
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
    membershipNumber: "0000",
    details: { weightKg: 70.5, heightCm: 175, idCardExpiresOn: "2026-09-30" },
  },
};

function renderTab(overrides: Partial<FullMemberProfile> = {}) {
  const onDirtyChange = vi.fn();
  const onSaved = vi.fn();
  render(
    <DetailsTab
      profile={{ ...profile, ...overrides }}
      onDirtyChange={onDirtyChange}
      onSaved={onSaved}
    />,
  );
  return { onDirtyChange, onSaved, user: userEvent.setup() };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-17T09:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("DETAILS tab", () => {
  it("groups every field in Regyfit's sections with labels above inputs", () => {
    renderTab();
    expect(
      screen.getAllByRole("group").map((group) => group.querySelector("legend")?.textContent),
    ).toEqual(["Identification", "Contacts", "Documents", "Personal", "Registration", "Notes"]);
    for (const label of [
      "Full name",
      "Short name",
      "Member No.",
      "Nickname",
      "E-mail",
      "Mobile country code",
      "Mobile number",
      "Emergency contact name",
      "Emergency contact relationship",
      "Emergency contact phone",
      "ID card no.",
      "ID expiry",
      "Health number",
      "Tax number",
      "Profession",
      "Gender",
      "Date of birth",
      "Weight (kg)",
      "Height (cm)",
      "Registration date",
      "How they heard",
      "Initial contact",
      "Internal notes",
    ]) {
      const control = screen.getByLabelText(label);
      const labelElement = document.querySelector(`label[for="${control.id}"]`);
      expect(labelElement).not.toBeNull();
      expect(
        labelElement!.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("does not render legacy location fields", () => {
    renderTab();
    expect(screen.queryByRole("group", { name: "Address" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Address/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^City/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Postal code/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Country/i)).not.toBeInTheDocument();
  });

  it("warns that the registration date is what Profile shows as Member since", () => {
    renderTab();
    const field = screen.getByLabelText("Registration date");
    const hint = document.getElementById(field.getAttribute("aria-describedby") ?? "");
    expect(hint?.textContent).toBe("This is what the Profile tab shows as Member since.");
  });

  it("derives age, BMI and the ID expiry notice without storing them", () => {
    renderTab();
    expect(screen.getByText("26 years old")).toBeTruthy();
    expect(screen.getByRole("status", { name: "BMI" }).textContent).toBe("23.0 · Healthy");
    expect(screen.getByText("ID card expires in 13 days")).toBeTruthy();
  });

  it("saves the whole form once and reports it", async () => {
    client.saveMemberDetails.mockResolvedValue(undefined);
    const { onDirtyChange, onSaved, user } = renderTab();
    await user.type(screen.getByLabelText("Nickname"), "Tester");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await user.click(screen.getByRole("button", { name: "Save details" }));

    expect(await screen.findByText("Details saved.")).toBeTruthy();
    expect(client.saveMemberDetails).toHaveBeenCalledOnce();
    expect(client.saveMemberDetails.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        studentId: "student-1",
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
        details: {
          nickname: "Tester",
          weightKg: 70.5,
          heightCm: 175,
          idCardExpiresOn: "2026-09-30",
        },
      }),
    );
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("saves with Ctrl+S and Cmd+S", async () => {
    client.saveMemberDetails.mockResolvedValue(undefined);
    const { user } = renderTab();
    await user.keyboard("{Control>}s{/Control}");
    await waitFor(() => expect(client.saveMemberDetails).toHaveBeenCalledTimes(1));
    await user.keyboard("{Meta>}s{/Meta}");
    await waitFor(() => expect(client.saveMemberDetails).toHaveBeenCalledTimes(2));
  });

  it("marks and focuses invalid fields without calling the backend", async () => {
    const { user } = renderTab();
    const weight = screen.getByLabelText("Weight (kg)");
    await user.clear(weight);
    await user.type(weight, "500");
    await user.click(screen.getByRole("button", { name: "Save details" }));
    expect(screen.getByRole("alert").textContent).toBe("Check the highlighted fields.");
    expect(weight.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(weight);
    expect(client.saveMemberDetails).not.toHaveBeenCalled();
  });

  it("explains a member number conflict on the member number field", async () => {
    client.saveMemberDetails.mockRejectedValue(new client.MemberDetailsConflictError("conflict"));
    const { user } = renderTab();
    await user.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "That member number is already used by another member.",
      ),
    );
    expect(screen.getByLabelText("Member No.").getAttribute("aria-invalid")).toBe("true");
  });

  it("offers the next free member number when the member has none", async () => {
    const { user } = renderTab({
      details: { ...profile.details, membershipNumber: undefined } as never,
      nextFreeMemberNumber: "13",
    });
    await user.click(screen.getByRole("button", { name: "Use next free number 13" }));
    expect((screen.getByLabelText("Member No.") as HTMLInputElement).value).toBe("13");
  });

  it("asks the browser to warn before leaving with unsaved changes", async () => {
    const { user } = renderTab();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    await user.type(screen.getByLabelText("Profession"), "Tester");
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it("picks the recommending member by name", async () => {
    client.searchMemberNames.mockResolvedValue([
      { studentId: "student-1", fullName: "Test Member A" },
      { studentId: "student-2", fullName: "Test Member B" },
    ]);
    client.saveMemberDetails.mockResolvedValue(undefined);
    const { user } = renderTab();
    await user.type(screen.getByLabelText("Recommended by"), "test");
    await user.click(screen.getByRole("button", { name: "Find member" }));
    expect(screen.queryByRole("button", { name: "Choose Test Member A" })).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Choose Test Member B" }));
    expect(screen.getByText("Test Member B")).toBeTruthy();
    fireEvent.submit(screen.getByRole("button", { name: "Save details" }).closest("form")!);
    await waitFor(() => expect(client.saveMemberDetails).toHaveBeenCalledOnce());
    expect(client.saveMemberDetails.mock.calls[0]![0].details.recommendedByStudentId).toBe(
      "student-2",
    );
  });

  it("caps the member search at the 80 characters the client sends", () => {
    renderTab();
    expect(screen.getByLabelText("Recommended by").getAttribute("maxLength")).toBe("80");
  });

  it("shows a stored option outside the list and refuses to save it unchanged", async () => {
    const { user } = renderTab({
      details: {
        ...profile.details,
        details: {
          ...profile.details.details,
          howHeard: "Google",
          initialContact: "Carrier pigeon",
        },
      } as never,
    });
    const howHeard = screen.getByLabelText("How they heard") as HTMLSelectElement;
    const initialContact = screen.getByLabelText("Initial contact") as HTMLSelectElement;
    expect(howHeard.value).toBe("Google");
    expect(initialContact.value).toBe("Carrier pigeon");
    expect(howHeard.getAttribute("aria-invalid")).toBe("true");
    expect(initialContact.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toContain(
      "This stored value is no longer a choice. Pick one from the list.",
    );

    await user.click(screen.getByRole("button", { name: "Save details" }));
    expect(client.saveMemberDetails).not.toHaveBeenCalled();
    const bar = screen.getByRole("button", { name: "Save details" }).closest("div")!;
    expect(within(bar).getByRole("alert").textContent).toBe("Check the highlighted fields.");
    expect(document.activeElement).toBe(howHeard);

    await user.selectOptions(howHeard, "Website");
    expect(screen.getByLabelText("How they heard").getAttribute("aria-invalid")).toBe("false");
    expect(within(howHeard).queryByText("Google")).toBeNull();
  });

  it("gives an invalid select and the notes textarea the hooks the record CSS styles", async () => {
    const { user } = renderTab({
      details: {
        ...profile.details,
        details: { ...profile.details.details, howHeard: "Google" },
      } as never,
    });
    const howHeard = screen.getByLabelText("How they heard");
    expect(howHeard.tagName).toBe("SELECT");
    expect(howHeard.getAttribute("aria-invalid")).toBe("true");
    expect(howHeard.closest(".login-field")).not.toBeNull();
    expect(screen.getByText(outOfListMessage).className).toBe("member-record-error");
    expect(screen.getByLabelText("Internal notes").getAttribute("aria-invalid")).toBe("false");

    await user.click(screen.getByRole("button", { name: "Save details" }));
    // The stylesheet is not loaded in jsdom, so the record's own CSS is read from disk. The path
    // is resolved from either working directory vitest may run this project from.
    const cssPath = ["apps/web/src/app/admin/admin.css", "src/app/admin/admin.css"].find(
      existsSync,
    );
    const css = readFileSync(cssPath!, "utf8");
    for (const selector of [
      '.member-record-form .login-field input[aria-invalid="true"]',
      '.member-record-form .login-field select[aria-invalid="true"]',
      '.member-record-form .login-field textarea[aria-invalid="true"]',
      '.member-record-form .login-field:has([aria-invalid="true"])',
      ".member-record-error",
    ]) {
      expect(css).toContain(selector);
    }
  });

  it("says that waiting is the fix when a save is rate limited", async () => {
    client.saveMemberDetails.mockRejectedValue(
      new client.MemberDetailsSaveError(
        "Too many member changes in a few minutes. Wait a moment and try again.",
      ),
    );
    const { user } = renderTab();
    await user.click(screen.getByRole("button", { name: "Save details" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Too many member changes in a few minutes. Wait a moment and try again.",
    );
  });

  it("keeps the generic sentence for a failure it does not recognise", async () => {
    client.saveMemberDetails.mockRejectedValue(new TypeError("raw internal detail"));
    const { user } = renderTab();
    await user.click(screen.getByRole("button", { name: "Save details" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Unable to save member details. Please try again.",
    );
  });

  it("ignores a second save while one is in flight", async () => {
    let release = (): void => {};
    client.saveMemberDetails.mockReturnValue(
      new Promise<void>((resolve) => {
        release = () => resolve();
      }),
    );
    const { user } = renderTab();
    await user.click(screen.getByRole("button", { name: "Save details" }));
    await user.keyboard("{Control>}s{/Control}");
    await user.keyboard("{Meta>}s{/Meta}");
    expect(client.saveMemberDetails).toHaveBeenCalledOnce();
    release();
    await screen.findByText("Details saved.");
  });

  it("omits the notes key instead of sending an empty string", async () => {
    client.saveMemberDetails.mockResolvedValue(undefined);
    const { user } = renderTab({
      details: {
        ...profile.details,
        details: { ...profile.details.details, internalNotes: "Old note" },
      } as never,
    });
    await user.clear(screen.getByLabelText("Internal notes"));
    await user.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(client.saveMemberDetails).toHaveBeenCalledOnce());
    expect("internalNotes" in client.saveMemberDetails.mock.calls[0]![0].details).toBe(false);
  });
});
