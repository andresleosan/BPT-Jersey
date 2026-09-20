import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getLevelCatalog: vi.fn(),
  getStudentLevelCard: vi.fn(),
  openStudentLevel: vi.fn(),
  levelsSafeErrors: { open: "Unable to save level." },
}));
vi.mock("../../../../lib/levels-client", () => api);
vi.mock("../member-subscription-editor", () => ({
  MemberSubscriptionEditor: ({ onStatusChange }: { onStatusChange: (saved: boolean) => void }) => (
    <button onClick={() => onStatusChange(true)}>Save synthetic subscription</button>
  ),
}));
import { RegistrationCompletion } from "./registration-completion";

beforeEach(() => {
  api.getLevelCatalog.mockResolvedValue({
    definitions: [{ definitionKey: "white-belt", name: "White belt", sequence: 1 }],
  });
  api.getStudentLevelCard.mockResolvedValue({ state: "uninitialized", studentId: "student-1" });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("requires saved level, subscription and medical information before declaring completion", async () => {
  const user = userEvent.setup();
  const restart = vi.fn();
  const view = render(
    <RegistrationCompletion studentId="student-1" healthComplete={false} onRestart={restart} />,
  );
  await user.selectOptions(await screen.findByLabelText("Level"), "white-belt");
  await user.type(screen.getByLabelText("Start date"), "2026-01-01");
  await user.type(screen.getByLabelText("Notes"), "Initial registration");
  api.openStudentLevel.mockResolvedValue({});
  api.getStudentLevelCard.mockResolvedValue({
    state: "initialized",
    currentDefinition: { definitionKey: "white-belt" },
  });
  await user.click(screen.getByRole("button", { name: "Open level" }));
  expect(await screen.findByText("Saved: White belt")).toBeVisible();
  expect(api.openStudentLevel).toHaveBeenCalledWith({
    studentId: "student-1",
    definitionKey: "white-belt",
    startedOn: "2026-01-01",
    decisionNotes: "Initial registration",
  });
  expect(screen.queryByRole("heading", { name: "Registration complete" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save synthetic subscription" }));
  expect(screen.queryByRole("button", { name: "Add another member" })).not.toBeInTheDocument();
  view.rerender(
    <RegistrationCompletion studentId="student-1" healthComplete onRestart={restart} />,
  );
  expect(screen.getByRole("heading", { name: "Registration complete" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Add another member" }));
  expect(restart).toHaveBeenCalledOnce();
});

it("recovers from a read failure without creating another student or level", async () => {
  const user = userEvent.setup();
  api.getStudentLevelCard.mockRejectedValueOnce(new Error("internal detail"));
  render(<RegistrationCompletion studentId="student-1" healthComplete onRestart={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load the level");
  expect(screen.queryByText("internal detail")).not.toBeInTheDocument();
  api.getStudentLevelCard.mockResolvedValue({
    state: "initialized",
    currentDefinition: { definitionKey: "white-belt" },
  });
  await user.click(screen.getByRole("button", { name: "Check saved level" }));
  expect(await screen.findByText("Saved: White belt")).toBeVisible();
  expect(api.openStudentLevel).not.toHaveBeenCalled();
});

it("keeps completion pending if saving succeeds but verifying the level fails", async () => {
  const user = userEvent.setup();
  render(<RegistrationCompletion studentId="student-1" healthComplete onRestart={vi.fn()} />);
  await user.selectOptions(await screen.findByLabelText("Level"), "white-belt");
  await user.type(screen.getByLabelText("Start date"), "2026-01-01");
  await user.type(screen.getByLabelText("Notes"), "Initial registration");
  api.openStudentLevel.mockResolvedValue({});
  api.getStudentLevelCard.mockRejectedValue(new Error("offline"));
  await user.click(screen.getByRole("button", { name: "Open level" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeVisible());
  expect(screen.getByText("Initial level: pending")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Open level" })).not.toBeInTheDocument();
});
