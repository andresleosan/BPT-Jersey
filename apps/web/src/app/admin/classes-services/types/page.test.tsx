import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getScheduleCatalog: vi.fn(),
  saveProgramV2: vi.fn(),
  updateProgram: vi.fn(),
  listSessions: vi.fn(),
  useAdminOrStaffSession: vi.fn(),
}));
vi.mock("../../../../lib/schedule-client", () => ({
  getScheduleCatalog: mocks.getScheduleCatalog,
  saveProgramV2: mocks.saveProgramV2,
  updateProgram: mocks.updateProgram,
  listSessions: mocks.listSessions,
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

beforeEach(() => {
  mocks.useAdminOrStaffSession.mockReturnValue({ role: "administrator" });
  mocks.getScheduleCatalog.mockResolvedValue({ locations: [], programs: [program] });
  mocks.listSessions.mockResolvedValue([]);
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
    expect(screen.getByRole("combobox", { name: /kind of GI All Levels Evenings/i })).toHaveValue(
      "class-frequency",
    );
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
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(mocks.saveProgramV2).toHaveBeenCalledWith({
        name: "Open Mat Teens",
        abbreviation: "OM_TEEN",
      }),
    );
    expect(await screen.findByText("Open Mat Teens")).toBeInTheDocument();
  });

  it("saves the colour, the drop-in policy and the message inline", async () => {
    mocks.updateProgram.mockImplementation(async (input) => ({ ...program, ...input }));
    render(<TypesPage />);
    await screen.findByText("GI All Levels Evenings");
    const colourInput = screen.getByLabelText(/colour of GI All Levels Evenings/i);
    fireEvent.change(colourInput, { target: { value: "#d9d7ff" } });
    expect(mocks.updateProgram).not.toHaveBeenCalled();
    fireEvent.blur(colourInput);
    await waitFor(() =>
      expect(mocks.updateProgram).toHaveBeenCalledWith({ programId: "p1", colour: "#D9D7FF" }),
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: /drop-ins of GI All Levels Evenings/i }),
      { target: { value: "3" } },
    );
    await waitFor(() =>
      expect(mocks.updateProgram).toHaveBeenCalledWith({ programId: "p1", dropInPolicy: "3" }),
    );
    fireEvent.change(screen.getByLabelText(/message of GI All Levels Evenings/i), {
      target: { value: "Bring a gi" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /save message of GI All Levels Evenings/i }),
    );
    await waitFor(() =>
      expect(mocks.updateProgram).toHaveBeenCalledWith({ programId: "p1", message: "Bring a gi" }),
    );
  });

  it("does not re-save a colour the picker only echoed back in another case", async () => {
    render(<TypesPage />);
    await screen.findByText("GI All Levels Evenings");
    const colourInput = screen.getByLabelText(/colour of GI All Levels Evenings/i);
    // The stored colour is "#F0EFFF"; <input type="color"> hands the same colour back lowercase.
    fireEvent.change(colourInput, { target: { value: "#f0efff" } });
    fireEvent.blur(colourInput);
    expect(mocks.updateProgram).not.toHaveBeenCalled();
  });

  it("falls back to programDefaultsV2 for a program with no v2 fields", async () => {
    mocks.getScheduleCatalog.mockResolvedValue({ locations: [], programs: [bareProgram] });
    render(<TypesPage />);
    expect(await screen.findByText("Open Mat")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /kind of Open Mat/i })).toHaveValue(
      "class-frequency",
    );
    expect(screen.getByRole("combobox", { name: /drop-ins of Open Mat/i })).toHaveValue(
      "unlimited",
    );
  });

  it("shows In use only for a program with a non-cancelled session in the next 90 days", async () => {
    mocks.getScheduleCatalog.mockResolvedValue({ locations: [], programs: [program, bareProgram] });
    mocks.listSessions.mockResolvedValue([
      { programId: "p1", status: "scheduled" },
      { programId: "p2", status: "cancelled" },
    ]);
    render(<TypesPage />);
    await screen.findByText("GI All Levels Evenings");
    const rows = screen.getAllByRole("row");
    const p1Row = rows.find((row) => row.textContent?.includes("GI All Levels Evenings"));
    const p2Row = rows.find((row) => row.textContent?.includes("Open Mat"));
    expect(p1Row).toHaveTextContent("In use");
    expect(p2Row).not.toHaveTextContent("In use");
  });

  it("filters the table by the search box", async () => {
    render(<TypesPage />);
    await screen.findByText("GI All Levels Evenings");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search types" }), {
      target: { value: "open" },
    });
    expect(screen.queryByText("GI All Levels Evenings")).not.toBeInTheDocument();
  });

  it("is read-only for a coach", async () => {
    mocks.useAdminOrStaffSession.mockReturnValue({ role: "coach" });
    render(<TypesPage />);
    await screen.findByText("GI All Levels Evenings");
    expect(screen.queryByRole("button", { name: "Create" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /kind of GI All Levels Evenings/i }),
    ).toBeDisabled();
    expect(screen.getByLabelText(/colour of GI All Levels Evenings/i)).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /save message of GI All Levels Evenings/i }),
    ).toBeDisabled();
    expect(screen.getByLabelText(/e-mail for GI All Levels Evenings/i)).toBeDisabled();
    expect(screen.getByLabelText(/list GI All Levels Evenings/i)).toBeDisabled();
  });
});
