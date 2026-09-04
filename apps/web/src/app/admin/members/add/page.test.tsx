import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({ createMember: vi.fn() }));

vi.mock("../../../../lib/members-client", () => clientMocks);

import AddMemberRoute, { AddMemberPage } from "./page";

async function fillRequiredAdult(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText("Full name"), "Synthetic Adult");
  await user.type(screen.getByLabelText("Date of birth"), "1990-01-02");
  await user.selectOptions(screen.getByLabelText("Training center"), "Town");
  await user.click(screen.getByLabelText("Evening"));
}

describe("Add canonical adult member page", () => {
  afterEach(() => {
    cleanup();
    clientMocks.createMember.mockReset();
  });

  it("requires identity and training fields and routes minors to the family flow", () => {
    render(<AddMemberPage />);

    expect(screen.getByRole("heading", { name: "Add adult student" })).toBeVisible();
    expect(screen.getByLabelText("Full name")).toBeRequired();
    expect(screen.getByLabelText("Date of birth")).toBeRequired();
    expect(screen.getByLabelText("Training center")).toBeRequired();
    expect(screen.getByRole("group", { name: "Training time preferences" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Create a family and minor student" })).toHaveAttribute(
      "href",
      "/admin/families",
    );
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it("focuses the first missing field and makes no request", async () => {
    const user = userEvent.setup();
    render(<AddMemberPage />);

    await user.click(screen.getByRole("button", { name: "Add adult student" }));

    expect(screen.getByLabelText("Full name")).toHaveFocus();
    expect(screen.getByLabelText("Full name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Full name is required.");
    expect(clientMocks.createMember).not.toHaveBeenCalled();
  });

  it("sends one canonical adult payload with a generated idempotency request ID", async () => {
    const user = userEvent.setup();
    clientMocks.createMember.mockResolvedValue({
      memberId: "student-1",
      studentId: "student-1",
    });
    render(<AddMemberPage />);
    await fillRequiredAdult(user);
    await user.type(screen.getByLabelText("Membership number"), "BPT 00000001");
    await user.type(screen.getByLabelText("Mobile number"), "+44 7000 000000");

    await user.click(screen.getByRole("button", { name: "Add adult student" }));

    await waitFor(() => expect(clientMocks.createMember).toHaveBeenCalledOnce());
    expect(clientMocks.createMember).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._:-]+$/),
      fullName: "Synthetic Adult",
      dateOfBirth: "1990-01-02",
      phoneNumber: "+44 7000 000000",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      membershipNumber: "BPT 00000001",
    });
  });

  it("keeps the request ID across a retry and resets it only after success", async () => {
    const user = userEvent.setup();
    clientMocks.createMember
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ memberId: "student-1", studentId: "student-1" });
    render(<AddMemberPage />);
    await fillRequiredAdult(user);

    await user.click(screen.getByRole("button", { name: "Add adult student" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to add member. Please try again.",
    );
    const firstRequestId = clientMocks.createMember.mock.calls[0]?.[0]?.requestId;

    await user.click(screen.getByRole("button", { name: "Add adult student" }));
    expect(await screen.findByRole("status")).toHaveTextContent("student-1");
    expect(clientMocks.createMember.mock.calls[1]?.[0]?.requestId).toBe(firstRequestId);
    expect(screen.getByLabelText("Full name")).toHaveValue("");
  });

  it("prevents duplicate submissions while a create request is pending", async () => {
    const user = userEvent.setup();
    let resolveRequest: (value: { memberId: string; studentId: string }) => void = () => undefined;
    clientMocks.createMember.mockImplementation(
      () =>
        new Promise<{ memberId: string; studentId: string }>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    render(<AddMemberPage />);
    await fillRequiredAdult(user);

    const submit = screen.getByRole("button", { name: "Add adult student" });
    await user.click(submit);
    await user.click(submit);
    expect(clientMocks.createMember).toHaveBeenCalledOnce();
    expect(submit).toBeDisabled();
    resolveRequest({ memberId: "student-1", studentId: "student-1" });
    await waitFor(() => expect(screen.getByRole("status")).toBeVisible());
  });

  it("rejects a minor date in this route without calling the backend", async () => {
    const user = userEvent.setup();
    render(<AddMemberPage />);
    await user.type(screen.getByLabelText("Full name"), "Synthetic Minor");
    await user.type(screen.getByLabelText("Date of birth"), "2020-01-02");
    await user.selectOptions(screen.getByLabelText("Training center"), "Town");
    await user.click(screen.getByLabelText("Morning"));

    await user.click(screen.getByRole("button", { name: "Add adult student" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Minor students must be created through the family flow.",
    );
    expect(clientMocks.createMember).not.toHaveBeenCalled();
  });

  it("sends the waiver emergency contact and postal address only when complete", async () => {
    const user = userEvent.setup();
    clientMocks.createMember.mockResolvedValue({
      memberId: "student-1",
      studentId: "student-1",
    });
    render(<AddMemberPage />);
    await fillRequiredAdult(user);
    await user.type(screen.getByLabelText("Emergency contact name"), "Synthetic Contact");
    await user.type(screen.getByLabelText("Relationship"), "Spouse");
    await user.type(screen.getByLabelText("Emergency contact phone"), "+44 7000 000001");
    await user.type(screen.getByLabelText("Address"), "1 Synthetic Street, St Helier");
    await user.type(screen.getByLabelText("Post code"), "JE2 3AB");

    await user.click(screen.getByRole("button", { name: "Add adult student" }));

    await waitFor(() => expect(clientMocks.createMember).toHaveBeenCalledOnce());
    expect(clientMocks.createMember).toHaveBeenCalledWith(
      expect.objectContaining({
        emergencyContact: {
          fullName: "Synthetic Contact",
          relationship: "Spouse",
          phoneNumber: "+44 7000 000001",
        },
        postalAddress: { line: "1 Synthetic Street, St Helier", postCode: "JE2 3AB" },
      }),
    );
  });

  it("rejects a partial emergency contact or address before calling the backend", async () => {
    const user = userEvent.setup();
    render(<AddMemberPage />);
    await fillRequiredAdult(user);
    await user.type(screen.getByLabelText("Emergency contact name"), "Synthetic Contact");

    await user.click(screen.getByRole("button", { name: "Add adult student" }));

    expect(
      screen.getByText("Enter the emergency contact name, relationship and phone number."),
    ).toBeVisible();
    expect(screen.getByLabelText("Emergency contact name")).toHaveFocus();
    expect(clientMocks.createMember).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Relationship"), "Spouse");
    await user.type(screen.getByLabelText("Emergency contact phone"), "+44 7000 000001");
    await user.type(screen.getByLabelText("Post code"), "JE2 3AB");
    await user.click(screen.getByRole("button", { name: "Add adult student" }));

    expect(screen.getByText("Enter both the address and the post code.")).toBeVisible();
    expect(screen.getByLabelText("Address")).toHaveFocus();
    expect(clientMocks.createMember).not.toHaveBeenCalled();
  });

  it("keeps the direct route data-free in test mode", () => {
    render(<AddMemberRoute />);
    expect(screen.getByRole("heading", { name: "Add adult student" })).toBeVisible();
  });
});
