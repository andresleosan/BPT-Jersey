import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { MemberOverviewRow } from "@bpt-jersey/domain/members/overview";
import { FamiliesView } from "./families-view";

afterEach(cleanup);

it("labels a child on a free trial", () => {
  const child: MemberOverviewRow = {
    studentId: "s-child",
    rowKind: "member",
    fullName: "Kid Trial",
    trainingCenter: "Town",
    centreConfirmed: true,
    active: true,
    source: "bpt",
    plan: {
      planId: "free-trial",
      displayName: "Free Trial",
      status: "active",
      endsAt: "2026-10-10T00:00:00.000Z",
    },
    planState: "trial",
    guardian: { fullName: "Gina Guard", online: true },
    ownAccount: false,
    flags: [],
  };
  render(<FamiliesView rows={[child]} />);
  expect(screen.getByText(/Free Trial/)).toBeVisible();
});
