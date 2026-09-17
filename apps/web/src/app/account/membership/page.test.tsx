import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  status: "signed-in" as const,
  session: { uid: "user-1", role: "adult", displayName: "Synthetic Adult" },
}));
const membershipApi = vi.hoisted(() => ({
  listAvailableMembershipPlans: vi.fn(),
  listClientMemberships: vi.fn(),
  startTrialMembership: vi.fn(),
}));
const profileApi = vi.hoisted(() => ({ getClientProfile: vi.fn() }));

vi.mock("../../../lib/client-auth", () => ({
  ClientAuthGate: ({ children }: { children: React.ReactNode }) => children,
  ClientAuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useClientSession: () => authState,
}));
vi.mock("../../../lib/membership-client", () => membershipApi);
vi.mock("../../../lib/profile-client", () => profileApi);
vi.mock("../../../lib/family-client", () => ({ getFamily: vi.fn() }));

import MembershipPage from "./page";

function adultAt(trainingCenter: "Town" | "West") {
  profileApi.getClientProfile.mockResolvedValue({
    student: {
      studentId: "student-1",
      familyId: "family-1",
      fullName: "Synthetic Adult",
      trainingCenter,
    },
  });
  membershipApi.listAvailableMembershipPlans.mockResolvedValue(PLAN_CATALOG);
  membershipApi.listClientMemberships.mockResolvedValue([]);
}

describe("client membership page", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows catalogue price and access on each eligible plan card", async () => {
    adultAt("Town");
    render(<MembershipPage />);
    const heading = await screen.findByRole("heading", { name: "Town Adult" });
    const card = within(heading.closest("article")!);
    expect(card.getByText("£85 per month")).toBeVisible();
    expect(card.getByText("Unlimited classes at Town · open mats at Town")).toBeVisible();
  });

  it("explains open mats only when an eligible plan has both a weekly limit and open mats", async () => {
    adultAt("Town");
    const { unmount } = render(<MembershipPage />);
    await screen.findByRole("heading", { name: "Town Adult" });
    expect(screen.queryByText(/Open mats don.t count/u)).not.toBeInTheDocument();
    unmount();

    adultAt("West");
    render(<MembershipPage />);
    await screen.findByRole("heading", { name: "West Adult" });
    expect(screen.getByText("Open mats don't count towards your weekly classes.")).toBeVisible();
  });
});
