import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ListView } from "./list-view";
import type { GridSession } from "./week-grid";

const academyId = "academy-test";

const locations = [
  {
    locationId: "town",
    academyId,
    name: "BPT Town",
    address: "Town address",
    timezone: "Europe/Jersey",
    active: true,
    schemaVersion: "1",
  },
] as const;

const programs = [
  {
    programId: "p1",
    academyId,
    name: "GI All Levels",
    ageBand: "adult",
    discipline: "bjj",
    level: "fundamentals",
    active: true,
    schemaVersion: "1",
    abbreviation: "GI",
  },
] as const;

function sessionAt(index: number, title: string): GridSession {
  const day = String(14 + index).padStart(2, "0");
  return {
    sessionId: `s${index}`,
    title,
    startAt: `2026-09-${day}T16:30:00.000Z`,
    endAt: `2026-09-${day}T17:30:00.000Z`,
    colour: "#F0EFFF",
    booked: 2,
    capacity: 40,
    status: "scheduled",
    locationId: "town",
    programId: "p1",
    instructorIds: ["coach-a"],
  };
}

const createObjectURL = vi.fn((blob: Blob) => `blob:${blob.size}`);
const revokeObjectURL = vi.fn();

function renderList(sessions: readonly GridSession[]) {
  return render(
    <ListView
      sessions={sessions}
      locations={locations}
      programs={programs}
      timezone="Europe/Jersey"
      today="2026-09-16"
      dateRange={null}
      onDateRange={vi.fn()}
      onOpen={vi.fn()}
    />,
  );
}

describe("ListView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    // jsdom would try to navigate on a programmatic anchor click.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("neutralises a formula cell and marks the file as UTF-8", async () => {
    renderList([sessionAt(0, "=1+1")]);
    fireEvent.click(screen.getByRole("button", { name: "Excel" }));
    const blob = createObjectURL.mock.calls[0]![0];
    // `Blob.text()` decodes UTF-8 and drops the BOM, so the marker is asserted on the bytes.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await blob.text();
    expect(text).toContain(`"'=1+1"`);
    expect(text).not.toContain(`"=1+1"`);
  });

  it("exports every filtered row, not only the page the table shows", async () => {
    renderList(Array.from({ length: 12 }, (_, index) => sessionAt(index, `Class ${index}`)));
    fireEvent.change(screen.getByLabelText("Records"), { target: { value: "10" } });
    expect(screen.getAllByRole("row")).toHaveLength(11); // header + 10
    fireEvent.click(screen.getByRole("button", { name: "Excel" }));
    const blob = createObjectURL.mock.calls[0]![0];
    const text = await blob.text();
    expect(text.trim().split("\n")).toHaveLength(13); // header + 12
  });
});
