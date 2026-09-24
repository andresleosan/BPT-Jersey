import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestEmailChange: vi.fn(),
  changePassword: vi.fn(),
  getOwnEmergencyContact: vi.fn(),
  saveOwnEmergencyContact: vi.fn(),
  getClientProfile: vi.fn(),
  saveClientProfile: vi.fn(),
  getGuardianProfile: vi.fn(),
  saveGuardianProfile: vi.fn(),
}));

vi.mock("../../../lib/account-settings-client", () => ({
  requestEmailChange: mocks.requestEmailChange,
  changePassword: mocks.changePassword,
  getOwnEmergencyContact: mocks.getOwnEmergencyContact,
  saveOwnEmergencyContact: mocks.saveOwnEmergencyContact,
}));
vi.mock("../../../lib/profile-client", () => ({
  createProfileRequestId: () => "req-1",
  getClientProfile: mocks.getClientProfile,
  saveClientProfile: mocks.saveClientProfile,
}));
vi.mock("../../../lib/guardian-profile-client", () => ({
  createGuardianProfileRequestId: () => "req-2",
  getGuardianProfile: mocks.getGuardianProfile,
  saveGuardianProfile: mocks.saveGuardianProfile,
}));

import { EmailSection } from "./email-section";
import { EmergencyContactSection } from "./emergency-contact-section";
import { PasswordSection } from "./password-section";
import { PhoneSection } from "./phone-section";

/** A promise the test settles by hand, so the "Saving…" state can be observed. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const field = (name: string) => screen.getByLabelText(name, { exact: true });
const type = (name: string, value: string) => fireEvent.change(field(name), { target: { value } });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EmailSection", () => {
  it("disables the button while saving and then asks to check the new inbox", async () => {
    const pending = deferred<{ ok: true; sentTo: string }>();
    mocks.requestEmailChange.mockReturnValueOnce(pending.promise);
    render(<EmailSection currentEmail="old@example.test" />);

    type("New email", "New@Example.test");
    type("Current password", "current-pass");
    fireEvent.click(screen.getByRole("button", { name: "Change email" }));

    const saving = await screen.findByRole("button", { name: "Saving…" });
    expect(saving).toBeDisabled();
    expect(mocks.requestEmailChange).toHaveBeenCalledWith({
      currentPassword: "current-pass",
      newEmail: "New@Example.test",
    });
    pending.resolve({ ok: true, sentTo: "new@example.test" });

    expect(await screen.findByText("Check new@example.test to confirm the change.")).toHaveClass(
      "settings-band-success",
    );
    expect(screen.getByRole("button", { name: "Change email" })).toBeEnabled();
  });

  it("shows the client's message in a red band", async () => {
    mocks.requestEmailChange.mockResolvedValueOnce({
      ok: false,
      message: "That password is not right.",
    });
    render(<EmailSection currentEmail="old@example.test" />);

    type("New email", "new@example.test");
    type("Current password", "wrong");
    fireEvent.click(screen.getByRole("button", { name: "Change email" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That password is not right.");
    expect(screen.getByRole("alert")).toHaveClass("settings-band-error");
  });

  it("shows validation errors under the fields without calling the client", () => {
    render(<EmailSection currentEmail="old@example.test" />);

    type("New email", "not-an-email");
    fireEvent.click(screen.getByRole("button", { name: "Change email" }));

    expect(field("New email")).toHaveAccessibleDescription("Enter a valid email address.");
    expect(field("Current password")).toHaveAccessibleDescription("Enter your current password.");
    expect(mocks.requestEmailChange).not.toHaveBeenCalled();
  });
});

describe("PasswordSection", () => {
  it("disables the button while saving and confirms the change", async () => {
    const pending = deferred<{ ok: true }>();
    mocks.changePassword.mockReturnValueOnce(pending.promise);
    render(<PasswordSection />);

    type("Current password", "current-password");
    type("New password", "a-new-long-password");
    type("Confirm new password", "a-new-long-password");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    pending.resolve({ ok: true });
    expect(await screen.findByText("Password changed.")).toHaveClass("settings-band-success");
    expect(field("New password")).toHaveValue("");
  });

  it("shows a mismatch and a short password under the fields", () => {
    render(<PasswordSection />);

    type("Current password", "current-password");
    type("New password", "short");
    type("Confirm new password", "different");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(field("New password")).toHaveAccessibleDescription(
      expect.stringContaining("Choose a new password of at least 12 characters."),
    );
    expect(field("Confirm new password")).toHaveAccessibleDescription(
      "The new passwords do not match.",
    );
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it("shows the client's message in a red band", async () => {
    mocks.changePassword.mockResolvedValueOnce({
      ok: false,
      message: "Please sign in again, then retry.",
    });
    render(<PasswordSection />);

    type("Current password", "current-password");
    type("New password", "a-new-long-password");
    type("Confirm new password", "a-new-long-password");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Please sign in again, then retry.");
  });
});

const student = {
  studentId: "student-1",
  academyId: "demo-academy",
  fullName: "Ana Silva",
  dateOfBirth: "1990-01-01",
  phoneNumber: "+44 7700 900123",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
};

describe("PhoneSection", () => {
  it("saves a member's phone through the client profile, keeping the other details", async () => {
    mocks.getClientProfile.mockResolvedValueOnce({ user: {}, student });
    const pending = deferred<unknown>();
    mocks.saveClientProfile.mockReturnValueOnce(pending.promise);
    render(<PhoneSection mode="member" />);

    await waitFor(() => expect(field("Phone number")).toHaveValue("+44 7700 900123"));
    type("Phone number", " +44 7700 900456 ");
    fireEvent.click(screen.getByRole("button", { name: "Save phone" }));

    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(mocks.saveClientProfile).toHaveBeenCalledWith({
      requestId: "req-1",
      fullName: "Ana Silva",
      dateOfBirth: "1990-01-01",
      phoneNumber: "+44 7700 900456",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
    });
    pending.resolve({ user: {}, student: { ...student, phoneNumber: "+44 7700 900456" } });
    expect(await screen.findByText("Phone number saved.")).toHaveClass("settings-band-success");
  });

  it("saves a guardian's phone through the guardian profile", async () => {
    mocks.getGuardianProfile.mockResolvedValueOnce({
      displayName: "Carla Silva",
      phoneNumber: "+44 7700 900123",
    });
    mocks.saveGuardianProfile.mockResolvedValueOnce({});
    render(<PhoneSection mode="guardian" />);

    await waitFor(() => expect(field("Phone number")).toHaveValue("+44 7700 900123"));
    type("Phone number", "07700 900456");
    fireEvent.click(screen.getByRole("button", { name: "Save phone" }));

    await screen.findByText("Phone number saved.");
    expect(mocks.saveGuardianProfile).toHaveBeenCalledWith({
      requestId: "req-2",
      displayName: "Carla Silva",
      phoneNumber: "07700 900456",
    });
  });

  it("refuses a phone number with letters under the field", async () => {
    mocks.getGuardianProfile.mockResolvedValueOnce({ displayName: "Carla", phoneNumber: "" });
    render(<PhoneSection mode="guardian" />);

    await screen.findByLabelText("Phone number");
    type("Phone number", "call me");
    fireEvent.click(screen.getByRole("button", { name: "Save phone" }));

    expect(field("Phone number")).toHaveAccessibleDescription(
      "Enter a phone number using digits, spaces, +, ( ) or -.",
    );
    expect(mocks.saveGuardianProfile).not.toHaveBeenCalled();
  });

  it("shows the save error in a red band", async () => {
    mocks.getGuardianProfile.mockResolvedValueOnce({ displayName: "Carla", phoneNumber: "" });
    mocks.saveGuardianProfile.mockRejectedValueOnce(
      new Error("Unable to save your guardian profile. Please try again."),
    );
    render(<PhoneSection mode="guardian" />);

    await screen.findByLabelText("Phone number");
    type("Phone number", "07700 900456");
    fireEvent.click(screen.getByRole("button", { name: "Save phone" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to save your guardian profile. Please try again.",
    );
  });
});

const contact = { fullName: "Carla Silva", relationship: "Mother", phoneNumber: "+44 7700 900123" };

describe("EmergencyContactSection", () => {
  it("requires a name, a relationship and a phone number", async () => {
    mocks.getOwnEmergencyContact.mockResolvedValueOnce(null);
    render(<EmergencyContactSection students={[{ studentId: "student-1", label: "You" }]} />);

    await screen.findByLabelText("Name");
    fireEvent.click(screen.getByRole("button", { name: "Save emergency contact" }));

    expect(field("Name")).toHaveAccessibleDescription("Enter the contact's name.");
    expect(field("Relationship")).toHaveAccessibleDescription(
      "Enter how they are related to the member.",
    );
    expect(field("Phone number")).toHaveAccessibleDescription("Enter a phone number.");
    expect(mocks.saveOwnEmergencyContact).not.toHaveBeenCalled();
  });

  it("disables the button while saving and confirms the save", async () => {
    mocks.getOwnEmergencyContact.mockResolvedValueOnce(contact);
    const pending = deferred<{ ok: true }>();
    mocks.saveOwnEmergencyContact.mockReturnValueOnce(pending.promise);
    render(<EmergencyContactSection students={[{ studentId: "student-1", label: "You" }]} />);

    await waitFor(() => expect(field("Name")).toHaveValue("Carla Silva"));
    type("Relationship", " Aunt ");
    fireEvent.click(screen.getByRole("button", { name: "Save emergency contact" }));

    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(mocks.saveOwnEmergencyContact).toHaveBeenCalledWith("student-1", {
      ...contact,
      relationship: "Aunt",
    });
    pending.resolve({ ok: true });
    expect(await screen.findByText("Emergency contact saved.")).toHaveClass(
      "settings-band-success",
    );
  });

  it("shows the client's message in a red band", async () => {
    mocks.getOwnEmergencyContact.mockResolvedValueOnce(contact);
    mocks.saveOwnEmergencyContact.mockResolvedValueOnce({
      ok: false,
      message: "We couldn't save the emergency contact. Try again.",
    });
    render(<EmergencyContactSection students={[{ studentId: "student-1", label: "You" }]} />);

    await waitFor(() => expect(field("Name")).toHaveValue("Carla Silva"));
    fireEvent.click(screen.getByRole("button", { name: "Save emergency contact" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't save the emergency contact. Try again.",
    );
  });

  it("lets a guardian with several children choose whose contact to edit", async () => {
    mocks.getOwnEmergencyContact.mockResolvedValueOnce(null).mockResolvedValueOnce(contact);
    render(
      <EmergencyContactSection
        students={[
          { studentId: "child-1", label: "Leo Silva" },
          { studentId: "child-2", label: "Mia Silva" },
        ]}
      />,
    );

    const select = await screen.findByLabelText("Member");
    expect(mocks.getOwnEmergencyContact).toHaveBeenCalledWith("child-1");
    fireEvent.change(select, { target: { value: "child-2" } });

    await waitFor(() => expect(field("Name")).toHaveValue("Carla Silva"));
    expect(mocks.getOwnEmergencyContact).toHaveBeenLastCalledWith("child-2");
  });

  it("has no member selector for a single member", async () => {
    mocks.getOwnEmergencyContact.mockResolvedValueOnce(null);
    render(<EmergencyContactSection students={[{ studentId: "student-1", label: "You" }]} />);

    await screen.findByLabelText("Name");
    expect(screen.queryByLabelText("Member")).not.toBeInTheDocument();
  });
});
