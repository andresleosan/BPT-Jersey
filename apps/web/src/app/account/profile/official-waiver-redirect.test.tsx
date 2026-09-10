import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const profileApi = vi.hoisted(() => ({
  createProfileRequestId: vi.fn(() => "profile-waiver-request-1"),
  getClientProfile: vi.fn(),
  saveClientProfile: vi.fn(),
}));
vi.mock("../../../lib/client-auth", () => ({
  ClientAuthGate: ({ children }: { children: React.ReactNode }) => children,
  ClientAuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useClientSession: () => ({
    session: { email: "adult@example.test", displayName: "Synthetic Adult" },
  }),
}));
vi.mock("../../../lib/profile-client", () => profileApi);
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

import ProfilePage from "./page";

const profile = {
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
    createdAt: "2026-09-01T12:00:00Z",
    createdBy: "user-1",
    updatedAt: "2026-09-01T12:00:00Z",
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
    createdAt: "2026-09-01T12:00:00Z",
    createdBy: "user-1",
    updatedAt: "2026-09-01T12:00:00Z",
    updatedBy: "user-1",
  },
};

describe("profile registration transition", () => {
  it("routes a saved profile to the required waiver", async () => {
    profileApi.getClientProfile.mockResolvedValue(profile);
    profileApi.saveClientProfile.mockResolvedValue(profile);
    const user = userEvent.setup();
    render(<ProfilePage />);
    await screen.findByDisplayValue("Synthetic Adult");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(profileApi.saveClientProfile).toHaveBeenCalled());
    expect(profileApi.createProfileRequestId).toHaveBeenCalledTimes(1);
    expect(profileApi.saveClientProfile).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "profile-waiver-request-1" }),
    );
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/account/waiver"));
  });
});
