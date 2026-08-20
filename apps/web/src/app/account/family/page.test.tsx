import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  status: "signed-in" as "signed-in" | "signed-out",
  session: { uid: "user-1", email: "guardian@example.test", displayName: "Synthetic Guardian" },
}));
const familyApi = vi.hoisted(() => ({ getFamily: vi.fn() }));

vi.mock("../../../lib/client-auth", () => ({
  ClientAuthGate: ({ children }: { children: React.ReactNode }) =>
    authState.status === "signed-in" ? children : <a href="/login">Sign in</a>,
  ClientAuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useClientSession: () => authState,
}));
vi.mock("../../../lib/family-client", () => familyApi);

import FamilyPage from "./page";

const projection = {
  family: { familyId: "family-1", active: true, status: "active" },
  tutor: {
    userId: "user-1",
    displayName: "Synthetic Guardian",
    email: "guardian@example.test",
    phoneNumber: "+441234567890",
  },
  students: [
    {
      studentId: "student-1",
      fullName: "Synthetic Minor One",
      dateOfBirth: "2015-08-19",
      trainingCenter: "Town",
      trainingTimePreferences: ["afternoon"],
      active: true,
      status: "active",
    },
    {
      studentId: "student-2",
      fullName: "Synthetic Minor Two",
      dateOfBirth: "2017-04-12",
      trainingCenter: "West",
      trainingTimePreferences: ["evening"],
      active: true,
      status: "active",
    },
  ],
};

describe("guardian family page", () => {
  afterEach(() => {
    cleanup();
    authState.status = "signed-in";
    familyApi.getFamily.mockReset();
  });

  it("loads exactly the linked minors as a read-only view", async () => {
    familyApi.getFamily.mockResolvedValue(projection);
    render(<FamilyPage />);

    expect(await screen.findByRole("heading", { name: "Your family" })).toBeVisible();
    expect(screen.getByText("Synthetic Minor One")).toBeVisible();
    expect(screen.getByText("Synthetic Minor Two")).toBeVisible();
    expect(familyApi.getFamily).toHaveBeenCalledWith();
    expect(
      screen.queryByRole("button", { name: /edit|delete|remove|add/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/family-1|student-1|user-1|createdBy|claims/i),
    ).not.toBeInTheDocument();
  });

  it("renders an empty state and a safe error state", async () => {
    familyApi.getFamily.mockResolvedValueOnce(undefined);
    const { unmount } = render(<FamilyPage />);
    expect(await screen.findByText("No family has been linked to your account yet.")).toBeVisible();
    unmount();
    familyApi.getFamily.mockRejectedValueOnce(new Error("private relationship details"));
    render(<FamilyPage />);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Unable to load your family"),
    );
    expect(screen.queryByText("private relationship details")).not.toBeInTheDocument();
  });

  it("keeps the signed-out guard without calling the family callable", () => {
    authState.status = "signed-out";
    render(<FamilyPage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(familyApi.getFamily).not.toHaveBeenCalled();
  });
});
