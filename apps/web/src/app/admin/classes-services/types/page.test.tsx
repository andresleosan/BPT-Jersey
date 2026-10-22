import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const program = {
  programId: "p1",
  academyId: "a",
  name: "GI All Levels Evenings",
  ageBand: "adult",
  discipline: "gi",
  level: "all-levels",
  active: true,
  schemaVersion: "1",
  abbreviation: "LEV_EVE",
  colour: "#F0EFFF",
  kind: "class-frequency",
  dropInPolicy: "unlimited",
  notifyByEmail: false,
  showInList: true,
  message: "",
};

const bareProgram = {
  programId: "p2",
  academyId: "a",
  name: "Open Mat",
  ageBand: "adult",
  discipline: "gi",
  level: "all-levels",
  active: true,
  schemaVersion: "1",
};

// Saving the editor sends every field it shows (programEditorUpdate): `program` left untouched.
const savedProgram = {
  programId: "p1",
  name: "GI All Levels Evenings",
  active: true,
  abbreviation: "LEV_EVE",
  colour: "#F0EFFF",
  kind: "class-frequency",
  dropInPolicy: "unlimited",
  notifyByEmail: false,
  showInList: true,
  message: "",
  ageRange: null,
  sites: [],
};

beforeEach(() => {
  mocks.useAdminOrStaffSession.mockReturnValue({ role: "administrator" });
  mocks.getScheduleCatalog.mockResolvedValue({ locations: [], programs: [program] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Class / Service Types tab", () => {
  it("lists types with colour swatch, kind and drop-in policy", async () => {
    render(<TypesPage />);
    expect(await screen.findByText("GI All Levels Evenings")).toBeInTheDocument();
    expect(screen.getByText("LEV_EVE")).toBeInTheDocument();
    expect(screen.getByText("Class: weekly/monthly allowance")).toBeInTheDocument();
  });

  it("creates a type from name and abbreviation", async () => {
    mocks.saveProgramV2.mockResolvedValue({
      ...program,
      programId: "p-new",
      name: "Open Mat Teens",
      abbreviation: "OM_TEEN",
    });
    render(<TypesPage />);
    await screen.findByText("GI All Levels Evenings");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Open Mat Teens" } });
    fireEvent.change(screen.getByLabelText("Abbreviation"), { target: { value: "OM_TEEN" } });
    fireEvent.click(screen.getByRole("button", { name: "Create type" }));
    await waitFor(() =>
      expect(mocks.saveProgramV2).toHaveBeenCalledWith({
        name: "Open Mat Teens",
        abbreviation: "OM_TEEN",
        ageRange: null,
        sites: [],
        introductionClass: false,
      }),
    );
    expect(await screen.findByText("Open Mat Teens")).toBeInTheDocument();
  });

  it("saves the colour, the drop-in policy and the message inline", async () => {
    mocks.updateProgram.mockImplementation(async (input) => ({ ...program, ...input }));
    render(<TypesPage />);
    await screen.findByText("GI All Levels Evenings");
    fireEvent.click(screen.getByRole("button", { name: "Edit GI All Levels Evenings" }));
    const editor = within(screen.getByRole("group", { name: "Edit GI All Levels Evenings" }));
    const colourInput = editor.getByLabelText(/timetable colour/i);
    fireEvent.change(colourInput, { target: { value: "#d9d7ff" } });
    expect(mocks.updateProgram).not.toHaveBeenCalled();
    fireEvent.change(editor.getByLabelText("Drop-ins / trials"), { target: { value: "3" } });
    fireEvent.change(editor.getByLabelText(/message shown when booking/i), {
      target: { value: "Bring a gi" },
    });
    fireEvent.click(editor.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mocks.updateProgram).toHaveBeenCalledWith({
        ...savedProgram,
        colour: "#D9D7FF",
        dropInPolicy: "3",
        message: "Bring a gi",
      }),
    );
    expect(mocks.updateProgram).toHaveBeenCalledTimes(1);
  });

  it("does not re-save a colour the picker only echoed back in another case", async () => {
    render(<TypesPage />);
    await screen.findByText("GI All Levels Evenings");
    fireEvent.click(screen.getByRole("button", { name: "Edit GI All Levels Evenings" }));
    const colourInput = within(
      screen.getByRole("group", { name: "Edit GI All Levels Evenings" }),
    ).getByLabelText(/timetable colour/i);
    // The stored colour is "#F0EFFF"; <input type="color"> hands the same colour back lowercase.
    fireEvent.change(colourInput, { target: { value: "#f0efff" } });
    fireEvent.blur(colourInput);
    expect(mocks.updateProgram).not.toHaveBeenCalled();
  });

  it("falls back to programDefaultsV2 for a program with no v2 fields", async () => {
    mocks.getScheduleCatalog.mockResolvedValue({ locations: [], programs: [bareProgram] });
    render(<TypesPage />);
    expect(await screen.findByText("Open Mat")).toBeInTheDocument();
    expect(screen.getByText("No abbreviation")).toBeInTheDocument();
    expect(screen.getByText("Class: weekly/monthly allowance")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit Open Mat" }));
    const editor = within(screen.getByRole("group", { name: "Edit Open Mat" }));
    expect(editor.getByLabelText("Registration type")).toHaveValue("class-frequency");
    expect(editor.getByLabelText("Drop-ins / trials")).toHaveValue("unlimited");
  });

  it("deletes a type only after warning that its existing sessions are kept", async () => {
    mocks.getScheduleCatalog.mockResolvedValue({ locations: [], programs: [program, bareProgram] });
    mocks.deleteProgram.mockImplementation(async (input) => ({
      ...program,
      ...input,
      active: false,
      showInList: false,
      deletedAt: "2026-10-22T09:00:00.000Z",
      deletedBy: "admin-1",
    }));
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(<TypesPage />);
    await screen.findByText("GI All Levels Evenings");
    fireEvent.click(screen.getByRole("button", { name: "Delete GI All Levels Evenings" }));
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("Existing sessions, bookings and attendance will be kept"),
    );
    expect(mocks.deleteProgram).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete GI All Levels Evenings" }));
    await waitFor(() => expect(mocks.deleteProgram).toHaveBeenCalledWith({ programId: "p1" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "GI All Levels Evenings" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "Open Mat" })).toBeInTheDocument();
    confirm.mockRestore();
  });

  it("filters the table by the search box", async () => {
    render(<TypesPage />);
    await screen.findByText("GI All Levels Evenings");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search types" }), {
      target: { value: "open" },
    });
    expect(screen.queryByText("GI All Levels Evenings")).not.toBeInTheDocument();
  });

  it("edits name and abbreviation inline and keeps the row open when the save fails", async () => {
    mocks.updateProgram.mockRejectedValueOnce(new Error("Unable to update the class type"));
    mocks.updateProgram.mockImplementationOnce(async (input) => ({ ...program, ...input }));
    render(<TypesPage />);
    await screen.findByText("GI All Levels Evenings");
    fireEvent.click(screen.getByRole("button", { name: "Edit GI All Levels Evenings" }));
    const editor = () => within(screen.getByRole("group", { name: "Edit GI All Levels Evenings" }));
    fireEvent.change(editor().getByLabelText("Name"), { target: { value: "GI Evenings" } });
    fireEvent.click(editor().getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to update the class type");
    fireEvent.click(editor().getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mocks.updateProgram).toHaveBeenLastCalledWith({
        ...savedProgram,
        name: "GI Evenings",
      }),
    );
    expect(await screen.findByText("GI Evenings")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^edit /i })).not.toBeInTheDocument();
  });

  it("sorts by name and flips direction from the header", async () => {
    mocks.getScheduleCatalog.mockResolvedValue({ locations: [], programs: [bareProgram, program] });
    render(<TypesPage />);
    await screen.findByText("GI All Levels Evenings");
    const names = () =>
      screen.getAllByRole("listitem").map((item) => item.querySelector("h4")?.textContent);
    expect(names()).toEqual(["GI All Levels Evenings", "Open Mat"]);
    fireEvent.click(screen.getByRole("button", { name: "Sort names Z to A" }));
    expect(names()).toEqual(["Open Mat", "GI All Levels Evenings"]);
  });

  it("is read-only for a coach", async () => {
    mocks.useAdminOrStaffSession.mockReturnValue({ role: "coach" });
    render(<TypesPage />);
    await screen.findByText("GI All Levels Evenings");
    expect(screen.queryByRole("button", { name: "Create type" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit GI All Levels Evenings" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete GI All Levels Evenings" }),
    ).not.toBeInTheDocument();
  });
});

describe("inkOn", () => {
  it("picks dark ink on light swatches and white on dark ones", async () => {
    const { inkOn } = await import("./page");
    expect(inkOn("#F0EFFF")).toBe("#1A1A18");
    expect(inkOn("#1befa2")).toBe("#1A1A18");
    expect(inkOn("#ff0000")).toBe("#1A1A18");
    expect(inkOn("#2F2483")).toBe("#ffffff");
  });
});
