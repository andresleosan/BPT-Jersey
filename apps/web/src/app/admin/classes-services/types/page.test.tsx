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
    fireEvent.change(screen.getByLabelText(/colour of GI All Levels Evenings/i), {
      target: { value: "#d9d7ff" },
    });
    await waitFor(() =>
      expect(mocks.updateProgram).toHaveBeenCalledWith({ programId: "p1", colour: "#d9d7ff" }),
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
    fireEvent.click(screen.getByRole("button", { name: /save message of GI All Levels Evenings/i }));
    await waitFor(() =>
      expect(mocks.updateProgram).toHaveBeenCalledWith({ programId: "p1", message: "Bring a gi" }),
    );
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
    expect(
      screen.getByLabelText(/colour of GI All Levels Evenings/i),
    ).toBeDisabled();
  });
});
