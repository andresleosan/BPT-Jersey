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
const scheduleApi = vi.hoisted(() => ({ getTrialAccess: vi.fn() }));
const introApi = vi.hoisted(() => ({ getIntroMembershipContext: vi.fn() }));

vi.mock("../../../lib/client-auth", () => ({
  ClientAuthGate: ({ children }: { children: React.ReactNode }) => children,
  ClientAuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useClientSession: () => authState,
}));
vi.mock("../../../lib/membership-client", () => membershipApi);
vi.mock("../../../lib/profile-client", () => profileApi);
vi.mock("../../../lib/family-client", () => ({ getFamily: vi.fn() }));
vi.mock("../../../lib/schedule-client", () => scheduleApi);
vi.mock("../../../lib/intro-conversion-client", () => ({
  getIntroMembershipContext: introApi.getIntroMembershipContext,
  submitIntroMembershipApplication: vi.fn(),
  uploadIntroMembershipProof: vi.fn(),
}));

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
  scheduleApi.getTrialAccess.mockResolvedValue(null);
  introApi.getIntroMembershipContext.mockResolvedValue({
    conversions: [],
    applications: [],
    plans: [],
    instructions: null,
  });
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

  it("shows the trial allowance in the membership status of a member without a membership", async () => {
    adultAt("Town");
    scheduleApi.getTrialAccess.mockResolvedValue({
      site: "Town",
      allowance: 2,
      attendedCount: 1,
      futureBookings: 0,
      expiresAt: "2026-10-31T12:00:00.000Z",
      status: "active",
    });
    render(<MembershipPage />);
    expect(
      await screen.findByText("Trial · 1 of 2 classes left · ends 31/10/2026"),
    ).toBeVisible();
  });

  it("asks an ended trial to choose a membership", async () => {
    adultAt("Town");
    scheduleApi.getTrialAccess.mockResolvedValue({
      site: "Town",
      allowance: 2,
      attendedCount: 2,
      futureBookings: 0,
      expiresAt: "2026-10-31T12:00:00.000Z",
      status: "exhausted",
    });
    render(<MembershipPage />);
    expect(
      await screen.findByText("Your trial has ended. Choose a membership to keep training."),
    ).toBeVisible();
  });

  it("opens the membership application when an intro conversion is ready", async () => {
    adultAt("Town");
    introApi.getIntroMembershipContext.mockResolvedValue({
      conversions: [{ conversionId: "intro-student-1", studentId: "student-1", status: "ready" }],
      applications: [],
      plans: [
        {
          planId: "town-adult",
          displayName: "Town Adult",
          priceMinor: 8500,
          currency: "GBP",
          billingPeriod: "monthly",
          eligibleParticipantTypes: ["adult"],
          classSites: ["Town"],
        },
      ],
      instructions: {
        accountName: "BPT Jersey",
        sortCode: "00-00-00",
        accountNumber: "00000000",
        bankName: "Synthetic Bank",
        referenceHint: "MEMBER",
      },
    });
    render(<MembershipPage />);
    expect(
      await screen.findByRole("heading", { name: "Choose your membership" }),
    ).toBeVisible();
    expect(screen.queryByLabelText("Trial plan")).not.toBeInTheDocument();
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
