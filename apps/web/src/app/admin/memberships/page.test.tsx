import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const membershipApi = vi.hoisted(() => ({
  cancelMembership: vi.fn(),
  createMembership: vi.fn(),
  listManagedPlans: vi.fn(),
  listMemberships: vi.fn(),
  saveMembershipPlan: vi.fn(),
  setMembershipPlanActive: vi.fn(),
  transitionMembership: vi.fn(),
}));

vi.mock("../../../lib/membership-admin-client", () => membershipApi);

import { MembershipsAdminPage } from "./page";

const activePlan = {
  planId: "town-adult" as const,
  displayName: "Town Adult",
  priceMinor: 8_500,
  currency: "GBP" as const,
  billingPeriod: "monthly" as const,
  eligibleParticipantTypes: ["adult"] as const,
  classSites: ["Town"] as const,
  weeklyClassLimit: null,
  openMatSites: ["Town"] as const,
  openMatFeeMinor: null,
  active: true,
};

const inactivePlan = {
  ...activePlan,
  planId: "west-adult" as const,
  displayName: "West Adult",
  priceMinor: 6_500,
  classSites: ["West"] as const,
  openMatSites: ["Town", "West"] as const,
  active: false,
};

const activeMembership = {
  membershipId: "membership-1",
  familyId: "family-1",
  studentId: "student-1",
  planId: "town-adult" as const,
  status: "active" as const,
  startsAt: "2026-09-03T10:00:00.000Z",
  endsAt: null,
  nextBillingAt: null,
};

describe("memberships admin page", () => {
  afterEach(() => {
    cleanup();
    Object.values(membershipApi).forEach((mock) => mock.mockReset());
  });

  it("manages connected plans and only valid membership operations", async () => {
    const user = userEvent.setup();
    membershipApi.listManagedPlans.mockResolvedValue([activePlan, inactivePlan]);
    membershipApi.listMemberships.mockResolvedValue([activeMembership]);
    membershipApi.saveMembershipPlan.mockImplementation(async (plan) => ({
      ...plan,
      active: false,
    }));
    membershipApi.setMembershipPlanActive.mockResolvedValue({
      ...inactivePlan,
      displayName: "West Adults Plus",
      active: true,
    });
    membershipApi.createMembership.mockResolvedValue({
      ...activeMembership,
      membershipId: "membership-2",
      familyId: "family-2",
      studentId: "student-2",
      status: "trial",
    });
    membershipApi.transitionMembership.mockResolvedValue({
      ...activeMembership,
      status: "paused",
    });
    membershipApi.cancelMembership.mockResolvedValue({
      ...activeMembership,
      status: "cancelled",
      endsAt: "2026-09-03T11:00:00.000Z",
    });

    render(<MembershipsAdminPage />);

    const plansTable = await screen.findByRole("table", { name: "Membership plan catalog" });
    expect(within(plansTable).getByText("West Adult")).toBeVisible();
    expect(within(plansTable).getByText("Inactive")).toBeVisible();

    await user.selectOptions(screen.getByLabelText("Plan to edit"), "west-adult");
    await user.clear(screen.getByLabelText("Display name"));
    await user.type(screen.getByLabelText("Display name"), "West Adults Plus");
    await user.click(screen.getByRole("button", { name: "Save plan" }));

    await waitFor(() => expect(membershipApi.saveMembershipPlan).toHaveBeenCalledOnce());
    expect(membershipApi.saveMembershipPlan).toHaveBeenCalledWith({
      planId: "west-adult",
      displayName: "West Adults Plus",
      priceMinor: 6_500,
      currency: "GBP",
      billingPeriod: "monthly",
      eligibleParticipantTypes: ["adult"],
      classSites: ["West"],
      weeklyClassLimit: null,
      openMatSites: ["Town", "West"],
      openMatFeeMinor: null,
    });

    await user.click(screen.getByRole("button", { name: "Activate plan" }));
    await waitFor(() =>
      expect(membershipApi.setMembershipPlanActive).toHaveBeenCalledWith("west-adult", true),
    );

    await user.type(screen.getByLabelText("Family ID"), "family-2");
    await user.type(screen.getByLabelText("Student ID"), "student-2");
    await user.selectOptions(screen.getByLabelText("Membership plan"), "town-adult");
    await user.selectOptions(screen.getByLabelText("Initial status"), "trial");
    await user.click(screen.getByRole("button", { name: "Create membership" }));
    await waitFor(() =>
      expect(membershipApi.createMembership).toHaveBeenCalledWith({
        familyId: "family-2",
        studentId: "student-2",
        planId: "town-adult",
        status: "trial",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Pause membership membership-1" }));
    await waitFor(() =>
      expect(membershipApi.transitionMembership).toHaveBeenCalledWith({
        membershipId: "membership-1",
        targetStatus: "paused",
      }),
    );
    expect(
      screen.queryByRole("button", { name: /Mark cancelled membership membership-1/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel membership membership-1" }));
    await waitFor(() =>
      expect(membershipApi.cancelMembership).toHaveBeenCalledWith("membership-1"),
    );
  });
});
