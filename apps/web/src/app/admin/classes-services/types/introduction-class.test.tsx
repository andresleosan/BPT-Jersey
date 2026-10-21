import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { introductionClassAudienceError } from "@bpt-jersey/domain/schedule/classes-services";

const mocks = vi.hoisted(() => ({
  getScheduleCatalog: vi.fn(),
  saveProgramV2: vi.fn(),
  updateProgram: vi.fn(),
  deleteProgram: vi.fn(),
  useAdminOrStaffSession: vi.fn(),
}));
vi.mock("../../../../lib/schedule-client", () => ({
  getScheduleCatalog: mocks.getScheduleCatalog,
  saveProgramV2: mocks.saveProgramV2,
  updateProgram: mocks.updateProgram,
  deleteProgram: mocks.deleteProgram,
}));
vi.mock("../../admin-gate", () => ({ useAdminOrStaffSession: mocks.useAdminOrStaffSession }));

import { TypesPage } from "./page";

const marker = "Introduction Class: free trial class for beginners";
// Saved before the marker existed: only its name makes it an Introduction Class.
const legacyIntro = {
  programId: "p-int",
  academyId: "a",
  name: "Introduction Class Saturdays",
  ageBand: "adult",
  discipline: "bjj",
  level: "fundamentals",
  active: true,
  schemaVersion: "1",
  abbreviation: "INT_SAT",
};

beforeEach(() => {
  mocks.useAdminOrStaffSession.mockReturnValue({ role: "administrator" });
  mocks.getScheduleCatalog.mockResolvedValue({ locations: [], programs: [legacyIntro] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function createType(introduction: boolean) {
  const form = within(screen.getByRole("region", { name: "Create a class type" }));
  fireEvent.change(form.getByLabelText("Name"), { target: { value: "Saturday Beginners" } });
  fireEvent.change(form.getByLabelText("Abbreviation"), { target: { value: "SAT_BEG" } });
  if (introduction) fireEvent.click(form.getByRole("checkbox", { name: marker }));
  fireEvent.click(form.getByRole("button", { name: "Create type" }));
}

describe("Introduction Class marker on the Types page (2026-10-20 item 3)", () => {
  it.each([true, false])("sends the office's explicit choice when creating (%s)", async (on) => {
    mocks.saveProgramV2.mockImplementation(async (input) => ({
      ...legacyIntro,
      ...input,
      programId: "p-new",
    }));
    render(<TypesPage />);
    await screen.findByText("Introduction Class Saturdays");

    await createType(on);

    await waitFor(() =>
      expect(mocks.saveProgramV2).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Saturday Beginners", introductionClass: on }),
      ),
    );
  });

  it("shows a legacy type as marked and leaves the marker out of a rename", async () => {
    mocks.updateProgram.mockImplementation(async (input) => ({
      ...legacyIntro,
      ...input,
      introductionClass: true,
    }));
    render(<TypesPage />);
    await screen.findByText("Introduction Class Saturdays");
    fireEvent.click(screen.getByRole("button", { name: "Edit Introduction Class Saturdays" }));
    const editor = within(screen.getByRole("group", { name: "Edit Introduction Class Saturdays" }));
    expect(editor.getByRole("checkbox", { name: marker })).toBeChecked();

    fireEvent.change(editor.getByLabelText("Name"), { target: { value: "Saturday Beginners" } });
    fireEvent.click(editor.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.updateProgram).toHaveBeenCalledTimes(1));
    const sent = mocks.updateProgram.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).toMatchObject({ programId: "p-int", name: "Saturday Beginners" });
    expect(sent).not.toHaveProperty("introductionClass");
  });

  it("sends the marker when the office changes it", async () => {
    mocks.updateProgram.mockImplementation(async (input) => ({ ...legacyIntro, ...input }));
    render(<TypesPage />);
    await screen.findByText("Introduction Class Saturdays");
    fireEvent.click(screen.getByRole("button", { name: "Edit Introduction Class Saturdays" }));
    const editor = within(screen.getByRole("group", { name: "Edit Introduction Class Saturdays" }));

    fireEvent.click(editor.getByRole("checkbox", { name: marker }));
    fireEvent.click(editor.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mocks.updateProgram).toHaveBeenCalledWith(
        expect.objectContaining({ programId: "p-int", introductionClass: false }),
      ),
    );
  });

  it("shows the server's audience refusal and keeps the form for a correction", async () => {
    mocks.saveProgramV2.mockRejectedValue(new Error(introductionClassAudienceError));
    render(<TypesPage />);
    await screen.findByText("Introduction Class Saturdays");

    await createType(true);

    expect(await screen.findByRole("alert")).toHaveTextContent(introductionClassAudienceError);
    const form = within(screen.getByRole("region", { name: "Create a class type" }));
    expect(form.getByLabelText("Name")).toHaveValue("Saturday Beginners");
  });
});
