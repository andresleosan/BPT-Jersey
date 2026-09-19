import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  memberMigrationQueueResponseSchema,
  type MemberMigrationQueueResponse,
  type MemberMigrationDecisionInput,
} from "@bpt-jersey/domain/members/migration";

const mocks = vi.hoisted(() => ({
  listMemberMigrationQueue: vi.fn(),
  decideMemberMigration: vi.fn(),
  session: { role: "owner" },
}));
vi.mock("../../../../lib/member-migration-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/member-migration-client")>()),
  listMemberMigrationQueue: mocks.listMemberMigrationQueue,
  decideMemberMigration: mocks.decideMemberMigration,
}));
vi.mock("../../admin-gate", () => ({ useAdminOrStaffSession: () => mocks.session }));

import { MigrationQueue } from "./migration-queue";
import MemberMigrationPage from "./page";

type Row = MemberMigrationQueueResponse["rows"][number];
function strongRow(id: string, recordId: string): Row {
  return {
    legacyMemberId: id,
    category: "strong",
    isMinor: false,
    member: {
      fullName: `Test Member ${id}`,
      birthDate: "1990-01-02",
      memberNumberMasked: "•••123",
      idCardMasked: "•••456",
    },
    candidates: [
      {
        recordId,
        reason: "member-number",
        record: {
          fullName: `Test Archive ${recordId}`,
          birthDate: "1990-01-03",
          memberNumberMasked: "•••123",
          idCardMasked: "•••789",
        },
      },
    ],
  };
}
function queueWith(rows: Row[]): MemberMigrationQueueResponse {
  return memberMigrationQueueResponseSchema.parse({ rows, archiveOnly: 3, decided: 4 });
}
async function chooseTraining() {
  await userEvent.selectOptions(screen.getByLabelText("Centre"), "Town");
  await userEvent.click(screen.getByLabelText("Evening"));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.role = "owner";
  mocks.listMemberMigrationQueue.mockReset();
  mocks.decideMemberMigration.mockReset();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  });
});
afterEach(cleanup);

it("approves every strong row in one batch with the chosen training", async () => {
  mocks.listMemberMigrationQueue.mockResolvedValue(
    queueWith([strongRow("m1", "10"), strongRow("m2", "11")]),
  );
  mocks.decideMemberMigration.mockResolvedValue({
    results: [
      { legacyMemberId: "m1", status: "applied", studentId: "s1" },
      { legacyMemberId: "m2", status: "rejected", code: "record-already-linked" },
    ],
  });
  render(<MigrationQueue />);
  await screen.findByRole("tab", { name: /Strong \(2\)/ });
  expect(screen.getByRole("button", { name: /Approve all visible/ })).toBeDisabled();
  expect(screen.getByText("Choose centre and training times first.")).toBeVisible();
  expect(screen.getByLabelText("Centre")).toHaveValue("");
  await userEvent.selectOptions(screen.getByLabelText("Centre"), "Town");
  expect(screen.getByRole("button", { name: /Approve all visible/ })).toBeDisabled();
  await userEvent.click(screen.getByLabelText("Evening"));
  await userEvent.click(screen.getByRole("button", { name: "Approve all visible (2)" }));
  expect(mocks.decideMemberMigration).toHaveBeenCalledWith([
    expect.objectContaining({
      kind: "link",
      legacyMemberId: "m1",
      recordId: "10",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      requestId: expect.any(String),
    }),
    expect.objectContaining({ kind: "link", legacyMemberId: "m2", recordId: "11" }),
  ]);
  expect(await screen.findByText("Applied 1 · Rejected 1")).toBeVisible();
  expect(screen.getByText("That record already belongs to another member.")).toBeVisible();
  expect(mocks.listMemberMigrationQueue).toHaveBeenCalledTimes(2);
});

it("chunks strong approvals at 50 and uses a unique UUID for every enrolment", async () => {
  mocks.listMemberMigrationQueue
    .mockResolvedValueOnce(
      queueWith(Array.from({ length: 51 }, (_, i) => strongRow(`m${i}`, String(i)))),
    )
    .mockResolvedValue(queueWith([]));
  mocks.decideMemberMigration.mockImplementation(
    async (decisions: MemberMigrationDecisionInput[]) => ({
      results: decisions.map(({ legacyMemberId }) => ({ legacyMemberId, status: "applied" })),
    }),
  );
  render(<MigrationQueue />);
  await screen.findByRole("tab", { name: "Strong (51)" });
  await chooseTraining();
  await userEvent.click(screen.getByRole("button", { name: "Approve all visible (51)" }));
  expect(await screen.findByText("Applied 51 · Rejected 0")).toBeVisible();
  expect(mocks.decideMemberMigration.mock.calls.map(([decisions]) => decisions.length)).toEqual([
    50, 1,
  ]);
  const ids = mocks.decideMemberMigration.mock.calls.flatMap(([decisions]) =>
    decisions.map((decision: { requestId: string }) => decision.requestId),
  );
  expect(new Set(ids).size).toBe(51);
  ids.forEach((id) =>
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  );
});

it("allows decisions for minors and missing dates and shows their review flags", async () => {
  mocks.listMemberMigrationQueue.mockResolvedValue(
    queueWith([
      { ...strongRow("m1", "10"), isMinor: true },
      { ...strongRow("m2", "11"), isMinor: "unknown" },
    ]),
  );
  render(<MigrationQueue />);
  expect(await screen.findByRole("tab", { name: "Strong (0)" })).toBeVisible();
  expect(screen.queryByText("Test Member m1")).toBeNull();
  await userEvent.click(screen.getByRole("tab", { name: /Under 18/ }));
  expect(screen.getByText("Test Member m1")).toBeVisible();
  expect(screen.getByText("Test Member m2")).toBeVisible();
  expect(screen.getByText("Guardian required")).toBeVisible();
  expect(screen.getByText("Check age")).toBeVisible();
  await chooseTraining();
  for (const name of ["Link to this record", "Create without archive record", "Skip…"])
    expect(screen.getAllByRole("button", { name })).toHaveLength(2);
});

it("requires a trimmed reason of 3 to 200 characters to skip", async () => {
  mocks.listMemberMigrationQueue.mockResolvedValue(queueWith([strongRow("m1", "10")]));
  mocks.decideMemberMigration.mockResolvedValue({
    results: [{ legacyMemberId: "m1", status: "applied" }],
  });
  render(<MigrationQueue />);
  await userEvent.click(await screen.findByRole("button", { name: "Skip…" }));
  const dialog = screen.getByRole("dialog", { hidden: true });
  const reason = within(dialog).getByLabelText("Reason");
  const confirm = within(dialog).getByRole("button", { name: "Skip member" });
  expect(reason).toHaveFocus();
  await userEvent.type(reason, "ab");
  expect(confirm).toBeDisabled();
  fireEvent.change(reason, { target: { value: "   " } });
  expect(confirm).toBeDisabled();
  fireEvent.change(reason, { target: { value: "x".repeat(201) } });
  expect(confirm).toBeDisabled();
  fireEvent.change(reason, { target: { value: "ab" } });
  await userEvent.type(reason, "c");
  await userEvent.click(confirm);
  expect(mocks.decideMemberMigration).toHaveBeenCalledWith([
    { kind: "skip", legacyMemberId: "m1", reason: "abc" },
  ]);
});

it("returns focus to Skip when the dialog is cancelled", async () => {
  mocks.listMemberMigrationQueue.mockResolvedValue(queueWith([strongRow("m1", "10")]));
  render(<MigrationQueue />);
  const trigger = await screen.findByRole("button", { name: "Skip…" });
  await userEvent.click(trigger);
  const reason = screen.getByRole("dialog").querySelector("textarea");
  expect(reason).toHaveFocus();
  await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  await userEvent.tab();
  expect(reason).toHaveFocus();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger).toHaveFocus();
  expect(mocks.decideMemberMigration).not.toHaveBeenCalled();
});

it("preserves completed batches when a later batch and refresh fail", async () => {
  mocks.listMemberMigrationQueue
    .mockResolvedValueOnce(
      queueWith(Array.from({ length: 51 }, (_, i) => strongRow(`m${i}`, String(i)))),
    )
    .mockRejectedValueOnce(new Error("raw refresh detail"));
  mocks.decideMemberMigration
    .mockImplementationOnce(async (decisions: MemberMigrationDecisionInput[]) => ({
      results: decisions.map(({ legacyMemberId }) => ({ legacyMemberId, status: "applied" })),
    }))
    .mockRejectedValueOnce(new Error("raw batch detail"));
  render(<MigrationQueue />);
  await screen.findByRole("tab", { name: "Strong (51)" });
  await chooseTraining();
  await userEvent.click(screen.getByRole("button", { name: "Approve all visible (51)" }));
  expect(await screen.findByText("Applied 50 · Rejected 0")).toBeVisible();
  expect(screen.getByText("The migration queue is unavailable. Try again.")).toBeVisible();
  expect(document.body).not.toHaveTextContent("The queue has been refreshed");
  expect(document.body).not.toHaveTextContent("raw batch detail");
  expect(document.body).not.toHaveTextContent("raw refresh detail");
  expect(screen.queryByRole("button", { name: /Approve all visible/ })).toBeNull();
});

it("supports keyboard tabs, masked comparisons and individual link or unlinked decisions", async () => {
  mocks.listMemberMigrationQueue.mockResolvedValue(
    queueWith([
      { ...strongRow("m1", "10"), category: "suggested" },
      { ...strongRow("m2", "11"), category: "ambiguous" },
      { ...strongRow("m3", "12"), category: "none", candidates: [] },
    ]),
  );
  mocks.decideMemberMigration.mockResolvedValue({
    results: [{ legacyMemberId: "m1", status: "applied" }],
  });
  render(<MigrationQueue />);
  const strong = await screen.findByRole("tab", { name: "Strong (0)" });
  strong.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Suggested (1)" })).toHaveFocus();
  expect(screen.getByRole("tab", { name: "Suggested (1)" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByText("Test Member m1")).toBeVisible();
  expect(screen.getByText("Test Archive 10")).toBeVisible();
  expect(screen.getByText(/1990-01-02/)).toBeVisible();
  expect(screen.getByText(/1990-01-03/)).toBeVisible();
  expect(screen.getByText(/•••456/)).toBeVisible();
  expect(screen.getByText(/•••789/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Link to this record" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: /Approve all visible/ })).toBeNull();
  await chooseTraining();
  await userEvent.click(screen.getByRole("button", { name: "Link to this record" }));
  expect(mocks.decideMemberMigration).toHaveBeenLastCalledWith([
    expect.objectContaining({
      kind: "link",
      legacyMemberId: "m1",
      recordId: "10",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
    }),
  ]);
  await userEvent.click(screen.getByRole("tab", { name: "No match (1)" }));
  await userEvent.click(screen.getByRole("button", { name: "Create without archive record" }));
  expect(mocks.decideMemberMigration).toHaveBeenLastCalledWith([
    expect.objectContaining({
      kind: "create-unlinked",
      legacyMemberId: "m3",
      requestId: expect.any(String),
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
    }),
  ]);
  expect(screen.getByText("Only in the archive: 3")).toBeVisible();
});

it("shows loading and a safe alert when the queue fails to load, with retry", async () => {
  mocks.listMemberMigrationQueue
    .mockRejectedValueOnce(new Error("raw backend detail"))
    .mockResolvedValue(queueWith([]));
  render(<MigrationQueue />);
  expect(screen.getByText("Loading the migration queue…")).toBeVisible();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The migration queue is unavailable. Try again.",
  );
  expect(document.body).not.toHaveTextContent("raw backend detail");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("tab", { name: "Strong (0)" })).toBeVisible();
});

it("disables repeat submissions and refreshes after a safe transport error", async () => {
  mocks.listMemberMigrationQueue.mockResolvedValue(queueWith([strongRow("m1", "10")]));
  let reject!: (error: Error) => void;
  mocks.decideMemberMigration.mockReturnValue(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  render(<MigrationQueue />);
  await screen.findByRole("tab", { name: "Strong (1)" });
  await chooseTraining();
  await userEvent.click(screen.getByRole("button", { name: "Link to this record" }));
  expect(screen.getByRole("button", { name: /Approve all visible/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Skip…" })).toBeDisabled();
  reject(new Error("raw write detail"));
  expect(await screen.findByRole("alert")).toHaveTextContent(/Could not save/);
  expect(document.body).not.toHaveTextContent("raw write detail");
  await waitFor(() => expect(mocks.listMemberMigrationQueue).toHaveBeenCalledTimes(2));
});

it.each(["coach", "headCoach"])("never loads migration data for %s", (role) => {
  mocks.session.role = role;
  render(<MemberMigrationPage />);
  expect(screen.getByText("Only the office can review the member migration.")).toBeVisible();
  expect(mocks.listMemberMigrationQueue).not.toHaveBeenCalled();
});

it.each(["owner", "administrator"])("loads migration data for %s", async (role) => {
  mocks.session.role = role;
  mocks.listMemberMigrationQueue.mockResolvedValue(queueWith([]));
  render(<MemberMigrationPage />);
  expect(await screen.findByRole("tab", { name: "Strong (0)" })).toBeVisible();
});
