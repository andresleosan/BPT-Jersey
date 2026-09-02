import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  status: "signed-in" as "signed-in" | "signed-out",
  session: { uid: "user-1", email: "adult@example.test", displayName: "Synthetic Adult" },
}));
const profileApi = vi.hoisted(() => ({
  getClientProfile: vi.fn(),
  saveClientProfile: vi.fn(),
}));

vi.mock("../../../lib/client-auth", () => ({
  ClientAuthGate: ({ children }: { children: React.ReactNode }) =>
    authState.status === "signed-in" ? children : <a href="/login">Sign in</a>,
  ClientAuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useClientSession: () => authState,
}));

vi.mock("../../../lib/profile-client", () => profileApi);

import ProfilePage from "./page";

const savedProjection = {
  user: {
    userId: "user-1",
    academyId: "academy-1",
    accountType: "client",
    displayName: "Synthetic Adult",
    email: "adult@example.test",
    phoneNumber: "+15550000001",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-08-19T12:00:00.000Z",
    createdBy: "user-1",
    updatedAt: "2026-08-19T12:00:00.000Z",
    updatedBy: "user-1",
  },
  student: {
    studentId: "student-1",
    academyId: "academy-1",
    userId: "user-1",
    fullName: "Synthetic Adult",
    dateOfBirth: "1990-08-19",
    phoneNumber: "+15550000001",
    email: "adult@example.test",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-08-19T12:00:00.000Z",
    createdBy: "user-1",
    updatedAt: "2026-08-19T12:00:00.000Z",
    updatedBy: "user-1",
  },
};

describe("client profile page", () => {
  afterEach(() => {
    cleanup();
    authState.status = "signed-in";
    profileApi.getClientProfile.mockReset();
    profileApi.saveClientProfile.mockReset();
    profileNavigation.push.mockReset();
  });

  it("loads the form, validates required fields, and shows accessible errors", async () => {
    profileApi.getClientProfile.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ProfilePage />);

    expect(
      await screen.findByRole("heading", { name: "Build your training profile" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(screen.getByText("Enter your full name.")).toBeVisible();
    expect(screen.getByText("Choose at least one training time.")).toBeVisible();
  });

  it("saves the editable fields and reports success without exposing authority data", async () => {
    profileApi.getClientProfile.mockResolvedValue(savedProjection);
    profileApi.saveClientProfile.mockResolvedValue(savedProjection);
    const user = userEvent.setup();
    render(<ProfilePage />);

    await screen.findByDisplayValue("Synthetic Adult");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(profileApi.saveClientProfile).toHaveBeenCalled());
    expect(profileApi.saveClientProfile).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: "Synthetic Adult", trainingCenter: "Town" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Profile saved.");
    expect(screen.queryByText(/academyId|claims|student-1|user-1/i)).not.toBeInTheDocument();
  });

  it("shows a safe error when the profile cannot be saved", async () => {
    profileApi.getClientProfile.mockResolvedValue(undefined);
    profileApi.saveClientProfile.mockRejectedValue(
      new Error("Unable to save your profile. Please try again."),
    );
    const user = userEvent.setup();
    render(<ProfilePage />);

    await screen.findByRole("heading", { name: "Build your training profile" });
    await user.type(screen.getByLabelText("Full name"), "Synthetic Adult");
    await user.type(screen.getByLabelText("Date of birth"), "1990-08-19");
    await user.type(screen.getByLabelText("Phone number"), "+15550000001");
    await user.click(screen.getByRole("combobox", { name: "Training center" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Training center" }), "Town");
    await user.click(screen.getByRole("checkbox", { name: "Evening" }));
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save your profile");
  });
});
const profileNavigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => profileNavigation }));
