import { cleanup, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
const client = vi.hoisted(() => ({
  getMemberClassRecords: vi.fn(),
  MemberClassLoadError: class extends Error {},
}));
vi.mock("../../../../lib/member-class-records-client", () => client);
import { ClassesTab } from "./classes-tab";
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("loads booking activity independently from failed attendance and retries only that section", async () => {
  client.getMemberClassRecords.mockImplementation(async ({ kind }) => {
    if (kind === "attendance") throw Error("private");
    return { studentId: "s", kind, rows: [], nextCursor: null };
  });
  render(<ClassesTab studentId="s" />);
  expect((await screen.findByText("No bookings recorded")).textContent).toBe(
    "No bookings recorded",
  );
  expect(screen.getByRole("alert").textContent).toBe(
    "Unable to load class history. Refresh to try again.",
  );
  expect(screen.queryByText("No attendance recorded")).toBeNull();
  client.getMemberClassRecords.mockResolvedValue({
    studentId: "s",
    kind: "attendance",
    rows: [],
    nextCursor: null,
  });
  await userEvent.setup().click(
    within(screen.getByRole("region", { name: "Attendance" })).getByRole("button", {
      name: "Refresh",
    }),
  );
  await screen.findByText("No attendance recorded");
  expect(client.getMemberClassRecords.mock.calls.map(([input]) => input.kind)).toEqual([
    "bookings",
    "attendance",
    "attendance",
  ]);
});
it("continues an all-skipped page, deduplicates rows and resets history on Refresh", async () => {
  const at = "2026-09-20T10:00:00.000Z";
  const row = {
    recordId: "b",
    requestedAt: at,
    status: "confirmed",
    session: {
      sessionId: "session",
      title: "BJJ",
      startAt: at,
      endAt: "2026-09-20T11:00:00.000Z",
      locationId: "town",
    },
  };
  client.getMemberClassRecords.mockImplementation(async ({ kind, cursor }) =>
    kind === "attendance"
      ? {
          studentId: "s",
          kind,
          rows: [{ recordId: "a", occurredAt: at, state: "late", method: "self", session: null }],
          nextCursor: null,
        }
      : {
          studentId: "s",
          kind,
          rows: cursor ? [row] : [],
          nextCursor: { at, recordId: cursor ? "b" : "imported" },
        },
  );
  render(<ClassesTab studentId="s" />);
  const user = userEvent.setup();
  const section = within(screen.getByRole("region", { name: "Booking activity" }));
  await user.click(await section.findByRole("button", { name: "Load more" }));
  expect((await section.findByText("BJJ")).textContent).toBe("BJJ");
  expect(section.getByText(/^20 Sept 2026, 11:00/).textContent).toContain("Town (St Helier)");
  await user.click(section.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(section.getAllByRole("listitem")).toHaveLength(1));
  expect(screen.getByText("Class details unavailable").textContent).toBe(
    "Class details unavailable",
  );
  expect(screen.getByText(/Late · Self check-in/).textContent).toContain("Late · Self check-in");
  await user.click(section.getByRole("button", { name: "Refresh" }));
  await section.findByRole("button", { name: "Load more" });
  expect(section.queryByText("BJJ")).toBeNull();
  expect(section.queryByText("No bookings recorded")).toBeNull();
  expect(client.getMemberClassRecords.mock.calls.at(-1)![0]).toEqual({
    studentId: "s",
    kind: "bookings",
  });
});

it("discards pending responses when the student changes", async () => {
  let resolve: (value: unknown) => void = () => {};
  client.getMemberClassRecords.mockImplementation(({ studentId, kind }) =>
    studentId === "old"
      ? new Promise((done) => {
          if (kind === "bookings") resolve = done;
        })
      : Promise.resolve({ studentId, kind, rows: [], nextCursor: null }),
  );
  const view = render(<ClassesTab studentId="old" />);
  view.rerender(<ClassesTab studentId="new" />);
  await screen.findByText("No bookings recorded");
  resolve({
    studentId: "old",
    kind: "bookings",
    rows: [
      {
        recordId: "old",
        requestedAt: "2026-09-20T10:00:00.000Z",
        status: "confirmed",
        session: null,
      },
    ],
    nextCursor: null,
  });
  await waitFor(() => expect(screen.queryByText("Class details unavailable")).toBeNull());
  expect(screen.getByText("No bookings recorded").textContent).toBe("No bookings recorded");
});
