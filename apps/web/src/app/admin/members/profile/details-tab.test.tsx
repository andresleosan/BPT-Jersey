import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FullMemberProfile } from "@bpt-jersey/domain/members/profile";

const client = vi.hoisted(() => {
  class MemberDetailsConflictError extends Error {}
  return {
    MemberDetailsConflictError,
    saveMemberDetails: vi.fn(),
    searchMemberNames: vi.fn(),
  };
});

vi.mock("../../../../lib/member-profile-client", () => client);

import { DetailsTab } from "./details-tab";

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
    ).toEqual([
      "Identification",
      "Contacts",
      "Address",
      "Documents",
      "Personal",
      "Registration",
      "Notes",
    ]);
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
      "Address",
      "City",
      "Postal code",
      "Country",
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
