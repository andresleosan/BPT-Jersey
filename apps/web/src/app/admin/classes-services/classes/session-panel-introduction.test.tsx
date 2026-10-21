import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ saveSession: vi.fn(), updateSession: vi.fn() }));
vi.mock("../../../../lib/schedule-client", () => ({
  cancelSession: vi.fn(),
  listSessionBookings: vi.fn(),
  requestBooking: vi.fn(),
  saveSession: mocks.saveSession,
  updateSession: mocks.updateSession,
}));
vi.mock("../../../../lib/members-client", () => ({ listMemberNames: vi.fn() }));
vi.mock("../../../../lib/membership-admin-client", () => ({ getRegistrationChoice: vi.fn() }));

import { parseCreateSessionInput, type ProgramRecord } from "@bpt-jersey/domain/schedule";

import { SessionPanel } from "./session-panel";

const program = (
  programId: string,
  name: string,
  extra: Partial<ProgramRecord> = {},
): ProgramRecord => ({
  programId,
  academyId: "academy-test",
  name,
  ageBand: "adult",
  discipline: "bjj",
  level: "fundamentals",
  active: true,
  schemaVersion: "1",
  ...extra,
});
const catalog = {
  locations: [
    {
      locationId: "town",
      academyId: "academy-test",
      name: "BPT Town",
      address: "Town address",
      timezone: "Europe/Jersey",
      active: true,
      schemaVersion: "1",
    },
  ],
  programs: [
    program("p-gi", "GI All Levels"),
    // Explicitly marked; its name says nothing.
    program("p-beg", "Saturday Beginners", { introductionClass: true }),
  ],
} as const;
const staff = [{ staffKey: "coach-a", role: "coach", active: true, status: "active", self: false }];
const legacyIntroSession = {
  sessionId: "s-legacy",
  academyId: "academy-test",
  classId: null,
  programId: "p-gi",
  locationId: "town",
  instructorId: "coach-a",
  instructorIds: ["coach-a"],
  title: "GI All Levels",
  startAt: "2026-10-24T09:00:00.000Z",
  endAt: "2026-10-24T10:00:00.000Z",
  capacity: 20,
  minParticipants: 0,
  status: "scheduled",
  isSeminar: false,
  cancellationReason: null,
  accessMode: "intro",
  schemaVersion: "1",
  createdAt: "2026-10-01T00:00:00.000Z",
  createdBy: "admin",
  updatedAt: "2026-10-01T00:00:00.000Z",
  updatedBy: "admin",
} as const;

function panel(props: Record<string, unknown>) {
  return render(
    <SessionPanel
      mode="create"
      catalog={catalog}
      staff={staff as never}
      timezone="Europe/Jersey"
      defaults={{ date: "2026-10-24", startTime: "09:00" }}
      canEdit
      canReadMemberships
      onSaved={vi.fn()}
      onCancelled={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionPanel: Introduction Class coherence (2026-10-20 item 3)", () => {
  it("names the type's Introduction Class in create, and sends no new field", async () => {
    mocks.saveSession.mockImplementation(async (input) => ({ ...legacyIntroSession, ...input }));
    panel({});
    const access = screen.getByLabelText("Class access");
    expect(within(access).getByRole("option", { name: "Membership required" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Class/service type"), { target: { value: "p-beg" } });
    expect(
      within(access).getByRole("option", { name: "Introduction Class (set by the class type)" }),
    ).toBeInTheDocument();
    expect(access).toHaveAccessibleDescription(
      /Free trial class for beginners of its type's ages/u,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "coach-a" }));
    fireEvent.change(screen.getByLabelText("Maximum capacity"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() => expect(mocks.saveSession).toHaveBeenCalledTimes(1));
    const sent = mocks.saveSession.mock.calls[0]![0];
    expect(sent).toMatchObject({ programId: "p-beg", accessMode: "membership" });
    expect(parseCreateSessionInput(sent).ok).toBe(true);
  });

  it("keeps a legacy session's Free Intro Class on offer after switching away", () => {
    panel({ mode: "edit", session: legacyIntroSession });
    const access = screen.getByLabelText("Class access");
    expect(access).toHaveValue("intro");

    fireEvent.change(access, { target: { value: "membership" } });
    expect(access).toHaveValue("membership");
    expect(within(access).getByRole("option", { name: "Free Intro Class" })).toBeInTheDocument();
    fireEvent.change(access, { target: { value: "intro" } });
    expect(access).toHaveValue("intro");
  });
});
