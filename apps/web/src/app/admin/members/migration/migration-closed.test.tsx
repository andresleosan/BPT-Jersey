import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { memberMigrationQueueResponseSchema } from "@bpt-jersey/domain/members/migration";

const mocks = vi.hoisted(() => ({
  listMemberMigrationQueue: vi.fn(),
  decideMemberMigration: vi.fn(),
}));
vi.mock("../../../../lib/member-migration-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/member-migration-client")>()),
  listMemberMigrationQueue: mocks.listMemberMigrationQueue,
  decideMemberMigration: mocks.decideMemberMigration,
}));
vi.mock("../../admin-gate", () => ({ useAdminOrStaffSession: () => ({ role: "owner" }) }));

import { MemberMigrationClosedError } from "../../../../lib/member-migration-client";
import { MigrationQueue } from "./migration-queue";

// 2026-10-20 capacity prep, part 2: once legacy reads are eliminated the queue says so once and
// offers nothing to retry; an ordinary outage keeps its retry.
function strong(id: string, recordId: string) {
  return {
    legacyMemberId: id,
    sourceVersion: "1:0",
    category: "strong",
    isMinor: false,
    member: { fullName: `Test Member ${id}`, birthDate: "1990-01-02" },
    candidates: [
      {
        recordId,
        sourceVersion: "1:0",
        conflicts: [],
        reason: "member-number",
        record: { fullName: `Test Archive ${recordId}`, birthDate: "1990-01-02" },
      },
    ],
  };
}
const queueOf = (...rows: ReturnType<typeof strong>[]) =>
  memberMigrationQueueResponseSchema.parse({ rows, archiveOnly: 0, decided: 0 });
const queue = queueOf(strong("m1", "10"));
const closedText = /The member migration is closed/;

async function readyToDecide() {
  await userEvent.type(screen.getByLabelText("Identity evidence"), "Synthetic passport seen");
  await userEvent.type(screen.getByLabelText("Reason for the reviewed choices"), "Same person");
  await userEvent.selectOptions(screen.getByLabelText("Centre"), "Town");
  await userEvent.click(screen.getByLabelText("Evening"));
}

beforeEach(() => {
  mocks.listMemberMigrationQueue.mockReset();
  mocks.decideMemberMigration.mockReset();
});
afterEach(cleanup);

it("shows a closed queue once: no retry, no decision form, no error alert", async () => {
  mocks.listMemberMigrationQueue.mockRejectedValue(new MemberMigrationClosedError());

  render(<MigrationQueue />);

  expect(await screen.findByText(closedText)).toBeVisible();
  expect(screen.getByText(/Guardian, date of birth and centre reviews/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("tab")).toBeNull();
  // Absent, not merely hidden: jsdom loads no CSS, and in a browser the form's own display wins
  // over the `hidden` attribute (the first browser run showed it visible).
  expect(screen.queryByLabelText("Identity evidence")).toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(mocks.listMemberMigrationQueue).toHaveBeenCalledTimes(1);
});

it("closes when a decision comes back closed, without reading the queue again", async () => {
  mocks.listMemberMigrationQueue.mockResolvedValue(queue);
  mocks.decideMemberMigration.mockRejectedValue(new MemberMigrationClosedError());
  render(<MigrationQueue />);
  await screen.findByRole("tab", { name: "Strong (1)" });
  await readyToDecide();

  await userEvent.click(screen.getByRole("button", { name: "Link to this record" }));

  expect(await screen.findByText(closedText)).toBeVisible();
  expect(mocks.decideMemberMigration).toHaveBeenCalledTimes(1);
  expect(mocks.listMemberMigrationQueue).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("tab")).toBeNull();
  expect(screen.queryByLabelText("Identity evidence")).toBeNull();
  expect(screen.queryByText(/Could not save/)).toBeNull();
});

it("reports what was decided before the queue closed, sends nothing after, reads nothing again", async () => {
  mocks.listMemberMigrationQueue.mockResolvedValue(queueOf(strong("m1", "10"), strong("m2", "11")));
  mocks.decideMemberMigration.mockResolvedValue({
    results: [{ legacyMemberId: "m1", status: "applied", studentId: "s1" }],
    closed: true,
  });
  render(<MigrationQueue />);
  await screen.findByRole("tab", { name: "Strong (2)" });
  await readyToDecide();

  await userEvent.click(
    screen.getByRole("button", { name: "Approve compatible matches (2, up to 50)" }),
  );

  expect(await screen.findByText(closedText)).toBeVisible();
  expect(screen.getByText("Applied 1 · Rejected 0")).toBeVisible();
  expect(screen.queryByText(/Could not save/)).toBeNull();
  expect(mocks.decideMemberMigration).toHaveBeenCalledTimes(1);
  expect(mocks.listMemberMigrationQueue).toHaveBeenCalledTimes(1);
});

it("keeps the retry for an ordinary outage, with no closed notice", async () => {
  mocks.listMemberMigrationQueue.mockRejectedValue(new Error("raw backend detail"));

  render(<MigrationQueue />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The migration queue is unavailable. Try again.",
  );
  expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  expect(screen.queryByText(closedText)).toBeNull();
  expect(document.body).not.toHaveTextContent("raw backend detail");
});
