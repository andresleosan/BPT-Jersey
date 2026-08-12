import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({ createMember: vi.fn() }));

vi.mock("../../../../lib/members-client", () => clientMocks);

import AddMemberRoute, { AddMemberPage } from "./page";

describe("Add new member page", () => {
  afterEach(() => {
    cleanup();
    clientMocks.createMember.mockReset();
  });

  it("renders member fields with labels, a required name, and no password field", () => {
    render(<AddMemberPage />);

    expect(screen.getByRole("heading", { name: "Add new member" })).toBeVisible();
    expect(screen.getByLabelText("Full name")).toBeRequired();
    expect(screen.getByLabelText("Membership number")).not.toBeRequired();
    expect(screen.getByLabelText("Email address")).toBeVisible();
    expect(screen.getByLabelText("ID card number")).toBeVisible();
    expect(screen.getByLabelText("VAT number")).toBeVisible();
    expect(screen.getByLabelText("Birth date")).toBeVisible();
    expect(screen.getByLabelText("Mobile number")).toBeVisible();
    expect(screen.getByLabelText("Frequency")).toBeVisible();
    expect(screen.getByLabelText("Gender")).toBeVisible();
    expect(screen.getByLabelText("Training center")).toBeVisible();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it("validates the required name and announces the field error", async () => {
    const user = userEvent.setup();
    render(<AddMemberPage />);

    await user.click(screen.getByRole("button", { name: "Add member" }));

    const fullName = screen.getByLabelText("Full name");
    expect(fullName).toHaveAttribute("aria-invalid", "true");
    expect(fullName).toHaveAttribute("aria-describedby", "member-full-name-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Full name is required.");
    expect(clientMocks.createMember).not.toHaveBeenCalled();
  });

  it("moves keyboard focus to the first invalid field", async () => {
    const user = userEvent.setup();
    render(<AddMemberPage />);

    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(screen.getByLabelText("Full name")).toHaveFocus();
  });

  it("sends optional membership number and preserves a valid date-only value", async () => {
    const user = userEvent.setup();
    clientMocks.createMember.mockResolvedValue({ memberId: "member-123" });
    render(<AddMemberPage />);

    await user.type(screen.getByLabelText("Full name"), " Alex Johnson ");
    await user.type(screen.getByLabelText("Membership number"), "BPT-123");
    await user.type(screen.getByLabelText("Birth date"), "1990-01-02");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    await waitFor(() => expect(clientMocks.createMember).toHaveBeenCalledOnce());
    expect(clientMocks.createMember).toHaveBeenCalledWith({
      fullName: "Alex Johnson",
      membershipNumber: "BPT-123",
      birthDate: "1990-01-02",
    });
  });

  it("prevents duplicate submissions while the create request is pending", async () => {
    const user = userEvent.setup();
    let resolveRequest: (value: { memberId: string }) => void = () => undefined;
    clientMocks.createMember.mockImplementation(
      () =>
        new Promise<{ memberId: string }>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    render(<AddMemberPage />);

    await user.type(screen.getByLabelText("Full name"), "Alex Johnson");
    const submit = screen.getByRole("button", { name: "Add member" });
    await user.click(submit);
    await user.click(submit);

    expect(clientMocks.createMember).toHaveBeenCalledOnce();
    expect(submit).toBeDisabled();
    resolveRequest({ memberId: "member-123" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Member added"));
  });

  it("shows a success confirmation and resets the form after creation", async () => {
    const user = userEvent.setup();
    clientMocks.createMember.mockResolvedValue({ memberId: "member-123" });
    render(<AddMemberPage />);

    await user.type(screen.getByLabelText("Full name"), "Alex Johnson");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    const confirmation = await screen.findByRole("status");
    expect(confirmation).toHaveTextContent("Member added successfully.");
    expect(confirmation).toHaveTextContent("member-123");
    expect(screen.getByLabelText("Full name")).toHaveValue("");
  });

  it("shows only a generic error when the callable fails", async () => {
    const user = userEvent.setup();
    clientMocks.createMember.mockRejectedValue(new Error("private Firebase stack detail"));
    render(<AddMemberPage />);

    await user.type(screen.getByLabelText("Full name"), "Alex Johnson");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Unable to add member. Please try again.");
    expect(error).not.toHaveTextContent("private Firebase stack detail");
  });

  it("keeps the direct route data-free and renders the form in test mode", () => {
    render(<AddMemberRoute />);

    expect(screen.getByRole("heading", { name: "Add new member" })).toBeVisible();
  });
});
