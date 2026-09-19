import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ assignMemberGuardian: vi.fn(), setMemberDateOfBirth: vi.fn() }));
vi.mock("../../../lib/member-migration-client", () => mocks);
import { MemberReviewActions, MemberReviewBadge } from "./member-review";
beforeEach(() => {
  vi.resetAllMocks();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  });
});
afterEach(cleanup);
it("shows text with the review indicator and clears it after assignment", () => {
  const { rerender } = render(<MemberReviewBadge guardianStatus="pending" />);
  expect(screen.getByText("Guardian required")).toBeVisible();
  rerender(<MemberReviewBadge reviewReason="date-of-birth-missing" />);
  expect(screen.getByText("Check age")).toBeVisible();
  rerender(<MemberReviewBadge guardianStatus="assigned" />);
  expect(screen.queryByText("Guardian required")).not.toBeInTheDocument();
});
it("validates the guardian and keeps the request ID when retrying a failed save", async () => {
  const onSaved = vi.fn();
  mocks.assignMemberGuardian
    .mockRejectedValueOnce(new Error("Private backend detail"))
    .mockResolvedValue({ studentId: "student-1" });
  render(<MemberReviewActions studentId="student-1" guardianStatus="pending" onSaved={onSaved} />);
  await userEvent.click(screen.getByRole("button", { name: "Assign guardian" }));
  const dialog = screen.getByRole("dialog");
  expect(screen.getByLabelText("Full name")).toHaveFocus();
  await userEvent.type(screen.getByLabelText("Full name"), "Synthetic Guardian");
  await userEvent.click(within(dialog).getByRole("button", { name: "Assign guardian" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Enter a full name and a valid phone number or email.",
  );
  expect(mocks.assignMemberGuardian).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText("Email"), "guardian@example.test");
  await userEvent.click(within(dialog).getByRole("button", { name: "Assign guardian" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not save this review. Please try again.",
  );
  expect(screen.queryByText(/Private backend/)).not.toBeInTheDocument();
  const first = mocks.assignMemberGuardian.mock.calls[0]?.[0];
  await userEvent.click(within(dialog).getByRole("button", { name: "Assign guardian" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(mocks.assignMemberGuardian.mock.calls[1]?.[0]).toEqual(first);
  expect(first).toMatchObject({
    studentId: "student-1",
    guardianContact: { fullName: "Synthetic Guardian", email: "guardian@example.test" },
  });
});
it("sets a missing birth date and returns focus on cancellation", async () => {
  const onSaved = vi.fn();
  mocks.setMemberDateOfBirth.mockResolvedValue({ studentId: "student-1" });
  render(
    <MemberReviewActions
      studentId="student-1"
      reviewReason="date-of-birth-missing"
      onSaved={onSaved}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Set date of birth" });
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(trigger).toHaveFocus();
  await userEvent.click(trigger);
  fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: "2014-03-02" } });
  await userEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Set date of birth" }),
  );
  expect(mocks.setMemberDateOfBirth).toHaveBeenCalledWith({
    studentId: "student-1",
    requestId: expect.any(String),
    dateOfBirth: "2014-03-02",
  });
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
});
