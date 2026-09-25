import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MemberOverview, MemberOverviewRow } from "@bpt-jersey/domain/members/overview";
const mocks = vi.hoisted(() => ({ getMemberOverview: vi.fn(), deleteMemberAccount: vi.fn() }));
vi.mock("../../../lib/member-overview-client", () => mocks);
vi.mock("../../../lib/member-migration-client", () => ({}));
vi.mock("../../../lib/member-profile-client", () => ({ searchMemberNames: vi.fn() }));
import { MembersWorkspace, filterRows, planLabel } from "./members-workspace";

function row(overrides: Partial<MemberOverviewRow>): MemberOverviewRow {
  return {
    studentId: "s-1",
    rowKind: "member",
    fullName: "Mia Rowe",
    trainingCenter: "Town",
    centreConfirmed: true,
    active: false,
    recordActive: true,
    source: "bpt",
    planState: "none",
    ownAccount: false,
    flags: [],
    ...overrides,
  };
}

const trialRow = row({
  studentId: "s-trial",
  fullName: "Tia Trial",
  active: true,
  planState: "trial",
  plan: {
    planId: "free-trial",
    displayName: "Free Trial",
    status: "active",
    endsAt: "2026-10-10T00:00:00.000Z",
  },
});
const syntheticGuardian = row({
  studentId: "guardian:user-g",
  rowKind: "guardian",
  userId: "user-g",
  fullName: "Gina Guard",
  ownAccount: true,
});
const recordGuardian = row({
  studentId: "s-g2",
  rowKind: "guardian",
  fullName: "Glen Guard",
  planState: "expired",
});
const inactiveRow = row({ studentId: "s-old", fullName: "Olly Old" });

const overview: MemberOverview = {
  rows: [syntheticGuardian, recordGuardian, inactiveRow, trialRow],
  counters: { total: 4, active: 1, expiring: 0, review: 0, inactive: 1, guardians: 2 },
  generatedAt: "2026-09-25T10:00:00.000Z",
};
const filters = { query: "", centre: "", band: "", source: "" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getMemberOverview.mockResolvedValue(overview);
});
afterEach(cleanup);

it("labels a free trial and a guardian row", () => {
  expect(planLabel(trialRow).title).toBe("Free Trial");
  expect(planLabel(recordGuardian)).toEqual({
    title: "Guardian",
    detail: "Parent or guardian of an active member",
  });
});

it("filters guardians apart from inactive members and finds them by name", () => {
  expect(
    filterRows(overview.rows, { ...filters, status: "guardians" }).map((item) => item.fullName),
  ).toEqual(["Gina Guard", "Glen Guard"]);
  expect(
    filterRows(overview.rows, { ...filters, status: "inactive" }).map((item) => item.fullName),
  ).toEqual(["Olly Old"]);
  expect(
    filterRows(overview.rows, { ...filters, status: "active", query: "gina" }).map(
      (item) => item.fullName,
    ),
  ).toEqual(["Gina Guard"]);
});

it("shows the Guardians tile with its counter and lists guardians without student links for synthetic rows", async () => {
  render(<MembersWorkspace />);
  expect(await screen.findByText("Tia Trial")).toBeVisible();
  expect(screen.getByText("Free Trial")).toBeVisible();
  const tile = screen.getByRole("button", { name: /Guardians/ });
  expect(tile).toHaveTextContent("2");
  await userEvent.click(tile);
  const table = screen.getByRole("table", { name: "Member directory" });
  const gina = within(table).getByText("Gina Guard").closest("tr") as HTMLElement;
  expect(within(gina).queryByRole("link")).not.toBeInTheDocument();
  expect(within(gina).queryByRole("button", { name: "Delete account" })).not.toBeInTheDocument();
  expect(within(gina).getByText("Guardian")).toBeVisible();
  const glen = within(table).getByText("Glen Guard").closest("tr") as HTMLElement;
  expect(within(glen).getByRole("link", { name: "Glen Guard" })).toBeVisible();
  expect(within(table).queryByText("Olly Old")).not.toBeInTheDocument();
});
