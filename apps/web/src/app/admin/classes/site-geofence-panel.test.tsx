import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocationRecord } from "@bpt-jersey/domain/schedule";

const scheduleClient = vi.hoisted(() => ({ saveLocationGeofence: vi.fn() }));

vi.mock("../../../lib/schedule-client", () => scheduleClient);

import { SiteGeofencePanel } from "./site-geofence-panel";

const town: LocationRecord = {
  locationId: "town",
  academyId: "demo-academy",
  name: "BPT Town",
  address: "St Helier, Jersey",
  timezone: "Europe/Jersey",
  active: true,
  schemaVersion: "1",
};

const west: LocationRecord = {
  ...town,
  locationId: "west",
  name: "BPT West",
  address: "St Peter, Jersey",
  geofence: { latitude: 49.2, longitude: -2.18 },
};

describe("SiteGeofencePanel", () => {
  afterEach(() => {
    cleanup();
    scheduleClient.saveLocationGeofence.mockReset();
  });

  it("saves a site's coordinates and reports the signal as active", async () => {
    const onSaved = vi.fn();
    scheduleClient.saveLocationGeofence.mockResolvedValue({
      ...town,
      geofence: { latitude: 49.186, longitude: -2.106 },
    });
    render(<SiteGeofencePanel locations={[town, west]} onSaved={onSaved} />);

    expect(
      screen.getByText("No coordinates recorded: check-ins here carry no location signal."),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Latitude", { selector: "#geofence-lat-town" }), {
      target: { value: "49.186" },
    });
    fireEvent.change(screen.getByLabelText("Longitude", { selector: "#geofence-lng-town" }), {
      target: { value: "-2.106" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "BPT Town coordinates" }));

    await waitFor(() =>
      expect(scheduleClient.saveLocationGeofence).toHaveBeenCalledWith({
        locationId: "town",
        geofence: { latitude: 49.186, longitude: -2.106 },
      }),
    );
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        locationId: "town",
        geofence: { latitude: 49.186, longitude: -2.106 },
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "BPT Town: coordinates saved. The 50 m check-in signal is active there.",
    );
  });

  it("refuses coordinates it cannot parse without calling the backend", async () => {
    render(<SiteGeofencePanel locations={[town]} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "north" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-2.106" } });
    fireEvent.submit(screen.getByRole("form", { name: "BPT Town coordinates" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/decimal degrees/u);
    expect(scheduleClient.saveLocationGeofence).not.toHaveBeenCalled();
  });

  it("refuses blank fields instead of saving the (0, 0) coordinate", async () => {
    render(<SiteGeofencePanel locations={[town]} onSaved={vi.fn()} />);

    // Only the latitude is typed; the longitude stays blank.
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "49.186" } });
    fireEvent.submit(screen.getByRole("form", { name: "BPT Town coordinates" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/decimal degrees/u);
    expect(scheduleClient.saveLocationGeofence).not.toHaveBeenCalled();
  });

  it("clears recorded coordinates with a null geofence", async () => {
    const onSaved = vi.fn();
    scheduleClient.saveLocationGeofence.mockResolvedValue({ ...west, geofence: null });
    render(<SiteGeofencePanel locations={[west]} onSaved={onSaved} />);

    expect(screen.getByText("Recorded: 49.2, -2.18")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear coordinates" }));

    await waitFor(() =>
      expect(scheduleClient.saveLocationGeofence).toHaveBeenCalledWith({
        locationId: "west",
        geofence: null,
      }),
    );
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ geofence: null }));
  });

  it("disables clearing when nothing is recorded", () => {
    render(<SiteGeofencePanel locations={[town]} onSaved={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Clear coordinates" })).toBeDisabled();
  });
});
