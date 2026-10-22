import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const peopleApi = vi.hoisted(() => ({ loadAccountPeople: vi.fn() }));
const scheduleApi = vi.hoisted(() => ({ getTrialAccess: vi.fn() }));
const introApi = vi.hoisted(() => ({
  getIntroMembershipContext: vi.fn(),
  submitIntroMembershipApplication: vi.fn(),
  uploadIntroMembershipProof: vi.fn(),
}));

vi.mock("../../../lib/client-auth", () => ({
  ClientAuthGate: ({ children }: { children: React.ReactNode }) => children,
  ClientAuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useClientSession: () => authState,
}));
vi.mock("../../../lib/membership-client", () => membershipApi);
vi.mock("../../../lib/account-people", () => peopleApi);
vi.mock("../../../lib/schedule-client", () => scheduleApi);
vi.mock("../../../lib/intro-conversion-client", () => introApi);

import MembershipPage from "./page";

function adultAt(trainingCenter: "Town" | "West") {
  peopleApi.loadAccountPeople.mockResolvedValue([
    { studentId: "student-1", fullName: "Synthetic Adult", via: "self", trainingCenter },
  ]);
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
    const name = await screen.findByText("Town Adult");
    const card = within(name.closest("label")!);
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
      await screen.findByText(
        "You've had your first class. Choose a plan below to keep training after your trial (1 free class left · ends 31/10/2026).",
      ),
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
      await screen.findByText("Your free trial has ended. Choose a plan to keep training."),
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
    introApi.uploadIntroMembershipProof.mockResolvedValue("a".repeat(64));
    introApi.submitIntroMembershipApplication.mockResolvedValue({
      applicationId: "application-1",
      studentId: "student-1",
      conversionId: "intro-student-1",
      planId: "town-adult",
      planName: "Town Adult",
      status: "pending_review",
      createdAt: "2026-10-22T10:00:00.000Z",
      updatedAt: "2026-10-22T10:00:00.000Z",
    });
    // jsdom has no scrollIntoView; choosing a plan scrolls its payment step into view.
    Element.prototype.scrollIntoView = vi.fn();
    render(<MembershipPage />);
    // The page is the application itself: choosing a plan opens its bank transfer step.
    fireEvent.click(await screen.findByRole("radio", { name: /^Town Adult/u }));
    // The whole page re-renders on this click; under a loaded runner it can pass findBy's 1 s default.
    expect(
      await screen.findByRole("heading", { name: "Pay for Town Adult" }, { timeout: 5000 }),
    ).toBeVisible();
    expect(screen.queryByLabelText("Trial plan")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Transfer reference"), {
      target: { value: "MEMBER 1" },
    });
    const proof = new File(["png"], "proof.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Payment screenshot (PNG or JPEG, up to 2 MB)"), {
      target: { files: [proof] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to the academy" }));
    // Applying through the ready conversion closes the intro funnel too.
    await waitFor(() =>
      expect(introApi.submitIntroMembershipApplication).toHaveBeenCalledWith(
        expect.objectContaining({
          conversionId: "intro-student-1",
          studentId: "student-1",
          planId: "town-adult",
        }),
      ),
    );
  });

  it("explains open mats only when an eligible plan has both a weekly limit and open mats", async () => {
    adultAt("Town");
    const { unmount } = render(<MembershipPage />);
    await screen.findByText("Town Adult");
    expect(screen.queryByText(/Open mats don.t count/u)).not.toBeInTheDocument();
    unmount();

    adultAt("West");
    render(<MembershipPage />);
    await screen.findByText("West Adult");
    expect(screen.getByText("Open mats don't count towards your weekly classes.")).toBeVisible();
  });
});
