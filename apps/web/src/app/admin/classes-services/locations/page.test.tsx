import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

// jsdom's <dialog> does not implement showModal()/close() at all (neither method exists on the
// prototype), so the page relies on stand-ins to open the edit dialog and to fire the native
// "close" event that returns focus to the row's Edit button.
let showModalSpy: ReturnType<typeof vi.fn<() => void>>;
let dialogCloseSpy: ReturnType<typeof vi.fn<(returnValue?: string) => void>>;

beforeEach(() => {
  mocks.useAdminOrStaffSession.mockReturnValue({ role: "administrator" });
  mocks.getScheduleCatalog.mockResolvedValue({ locations: [town, west], programs: [] });
  mocks.listSessions.mockResolvedValue([]);
  showModalSpy = vi.fn<() => void>();
  dialogCloseSpy = vi.fn<(returnValue?: string) => void>();
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    showModalSpy();
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement, returnValue?: string) {
    dialogCloseSpy(returnValue);
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
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

  it("clears the notice as soon as the next action starts", async () => {
    mocks.updateLocation.mockRejectedValueOnce(new Error("Unable to update the location"));
    render(<LocationsPage />);
    await screen.findByText("BPT West");
    const status = screen.getAllByRole("combobox", { name: /status/i })[1]!;
    fireEvent.change(status, { target: { value: "inactive" } });
    expect(await screen.findByText("Unable to update the location")).toBeInTheDocument();

    // A notice from the previous attempt must not sit under an action that is still running.
    mocks.updateLocation.mockReturnValue(new Promise(() => {}));
    fireEvent.change(status, { target: { value: "active" } });
    await waitFor(() =>
      expect(screen.queryByText("Unable to update the location")).not.toBeInTheDocument(),
    );
  });

  it("hides the geofence panel from a head coach, who cannot save it", async () => {
    mocks.useAdminOrStaffSession.mockReturnValue({ role: "headCoach" });
    render(<LocationsPage />);
    await screen.findByText("BPT Town");

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Name")).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("form", { name: "BPT Town coordinates" }),
    ).not.toBeInTheDocument();
  });

  it("is read-only for a coach", async () => {
    mocks.useAdminOrStaffSession.mockReturnValue({ role: "coach" });
    render(<LocationsPage />);
    await screen.findByText("BPT Town");
    expect(screen.queryByRole("button", { name: "Create" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("combobox", { name: /status/i })[0]).toBeDisabled();
  });

  it("opens the edit dialog without nesting forms and renames the site", async () => {
    mocks.updateLocation.mockResolvedValue({ ...town, name: "BPT Town Renamed" });
    render(<LocationsPage />);
    await screen.findByText("BPT Town");

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    expect(showModalSpy).toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Edit BPT Town" })).toBeInTheDocument();

    // The geofence panel's own <form> must be a sibling of the edit form, not nested inside it.
    const forms = dialog.querySelectorAll("form");
    expect(forms).toHaveLength(2);
    for (const form of forms) expect(form.closest("form")).toBe(form);

    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "BPT Town Renamed" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.updateLocation).toHaveBeenCalledWith({
        locationId: "town",
        name: "BPT Town Renamed",
        abbreviation: "tow",
      }),
    );
    expect(dialogCloseSpy).toHaveBeenCalled();
  });

  it("keeps the dialog open and the typed values when saving the rename fails", async () => {
    mocks.updateLocation.mockRejectedValue(new Error("Unable to update the location"));
    render(<LocationsPage />);
    await screen.findByText("BPT Town");

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "BPT Town Renamed" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.updateLocation).toHaveBeenCalled());
    expect(dialogCloseSpy).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText("Name")).toHaveValue("BPT Town Renamed");
  });

  it("refreshes the edit dialog after saving a geofence, enabling Clear coordinates", async () => {
    mocks.saveLocationGeofence.mockResolvedValue({
      ...town,
      geofence: { latitude: 49.186, longitude: -2.106 },
    });
    render(<LocationsPage />);
    await screen.findByText("BPT Town");

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    const dialog = screen.getByRole("dialog");
    const clearButton = within(dialog).getByRole("button", { name: "Clear coordinates" });
    expect(clearButton).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Latitude"), { target: { value: "49.186" } });
    fireEvent.change(within(dialog).getByLabelText("Longitude"), { target: { value: "-2.106" } });
    fireEvent.submit(within(dialog).getByRole("form", { name: "BPT Town coordinates" }));

    await waitFor(() => expect(mocks.saveLocationGeofence).toHaveBeenCalled());
    await waitFor(() => expect(clearButton).toBeEnabled());
  });

  it("returns focus to the row's Edit button when the dialog closes", async () => {
    render(<LocationsPage />);
    await screen.findByText("BPT Town");

    const editButton = screen.getAllByRole("button", { name: "Edit" })[0]!;
    fireEvent.click(editButton);
    const dialog = screen.getByRole("dialog");
    dialog.dispatchEvent(new Event("close"));

    await waitFor(() => expect(editButton).toHaveFocus());
  });
});
