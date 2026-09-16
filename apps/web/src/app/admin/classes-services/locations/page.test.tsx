import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getScheduleCatalog: vi.fn(),
  saveLocation: vi.fn(),
  updateLocation: vi.fn(),
  saveLocationGeofence: vi.fn(),
  listSessions: vi.fn(),
  useAdminOrStaffSession: vi.fn(),
}));
vi.mock("../../../../lib/schedule-client", () => ({
  getScheduleCatalog: mocks.getScheduleCatalog,
  saveLocation: mocks.saveLocation,
  updateLocation: mocks.updateLocation,
  saveLocationGeofence: mocks.saveLocationGeofence,
  listSessions: mocks.listSessions,
}));
vi.mock("../../admin-gate", () => ({ useAdminOrStaffSession: mocks.useAdminOrStaffSession }));

import { LocationsPage } from "./page";

const town = {
  locationId: "town",
  academyId: "a",
  name: "BPT Town",
  address: "",
  timezone: "Europe/Jersey",
  active: true,
  abbreviation: "tow",
  kind: "presential",
  schemaVersion: "1",
};
const west = { ...town, locationId: "west", name: "BPT West", abbreviation: "wes" };

beforeEach(() => {
  mocks.useAdminOrStaffSession.mockReturnValue({ role: "administrator" });
  mocks.getScheduleCatalog.mockResolvedValue({ locations: [town, west], programs: [] });
  mocks.listSessions.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Locations tab", () => {
  it("lists the sites with abbreviation, status and kind", async () => {
    render(<LocationsPage />);
    expect(await screen.findByText("BPT Town")).toBeInTheDocument();
    expect(screen.getByText("tow")).toBeInTheDocument();
    expect(screen.getAllByRole("combobox", { name: /status/i })).toHaveLength(2);
  });

  it("creates a site and appends it to the table", async () => {
    mocks.saveLocation.mockResolvedValue({
      ...town,
      locationId: "salle-ouest",
      name: "Salle Ouest",
      abbreviation: "ouest",
    });
    render(<LocationsPage />);
    await screen.findByText("BPT Town");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Salle Ouest" } });
    fireEvent.change(screen.getByLabelText("Abbreviation"), { target: { value: "ouest" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(mocks.saveLocation).toHaveBeenCalledWith({
        name: "Salle Ouest",
        abbreviation: "ouest",
        kind: "presential",
      }),
    );
    expect(await screen.findByText("Salle Ouest")).toBeInTheDocument();
    expect(screen.getByText("Site saved.")).toBeInTheDocument();
  });

  it("saves status changes inline", async () => {
    mocks.updateLocation.mockResolvedValue({ ...west, active: false });
    render(<LocationsPage />);
    await screen.findByText("BPT West");
    fireEvent.change(screen.getAllByRole("combobox", { name: /status/i })[1]!, {
      target: { value: "inactive" },
    });
    await waitFor(() =>
      expect(mocks.updateLocation).toHaveBeenCalledWith({ locationId: "west", active: false }),
    );
  });

  it("is read-only for a coach", async () => {
    mocks.useAdminOrStaffSession.mockReturnValue({ role: "coach" });
    render(<LocationsPage />);
    await screen.findByText("BPT Town");
    expect(screen.queryByRole("button", { name: "Create" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("combobox", { name: /status/i })[0]).toBeDisabled();
  });
});
