import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { MemberProfile } from "@bpt-jersey/domain/members/profile";
const transport = vi.hoisted(() => vi.fn());
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => (input: unknown) => transport(name, input),
}));
vi.mock("../../../../lib/firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));
vi.mock("../../admin-gate", () => ({ useAdminOrStaffSession: () => ({ role: "owner" }) }));
vi.mock("./ibjjf-card", () => ({ IbjjfCard: () => null }));
import { MemberRecord } from "./member-record";

const header = {
  studentId: "student-1",
  fullName: "Test Member A",
  age: 26,
  participantType: "adult",
  status: "active",
  birthdayBadge: { kind: "today" },
} as const;

const full: MemberProfile = {
  view: "full",
  header: { ...header, maskedMemberReference: "****0001" },
  cards: {
    memberSince: "2026-01-15",
    monthsAsMember: 8,
    accountManagers: [],
    currentMembership: null,
  },
  details: {
    studentId: "student-1",
    fullName: "Test Member A",
    dateOfBirth: "2000-09-17",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    gender: "unknown",
    membershipNumber: "1",
  },
};

const at = "2026-09-20T10:00:00.000Z";
const booking = {
  recordId: "booking-1",
  requestedAt: at,
  status: "confirmed",
  session: {
    sessionId: "session-1",
    title: "Synthetic class",
    startAt: at,
    endAt: "2026-09-20T11:00:00.000Z",
    locationId: "town",
  },
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("removes loaded Classes and invalidates the parent when paging finds the member missing", async () => {
  let missing = false;
  transport.mockImplementation(async (name, input) => {
    if (name === "getMemberProfile") return { data: full };
    if (name === "listMemberClassRecords") {
      if (missing) throw { code: "functions/not-found", message: "private" };
      return {
        data: {
          studentId: "student-1",
          kind: input.kind,
          rows: input.kind === "bookings" ? [booking] : [],
          nextCursor: input.kind === "bookings" ? { at, recordId: "booking-1" } : null,
        },
      };
    }
    throw Error(`Unexpected callable ${name}`);
  });
  window.history.replaceState(null, "", "/admin/members/profile?id=student-1&tab=classes");
  render(<MemberRecord />);
  await screen.findByText("Synthetic class");
  missing = true;
  await userEvent.setup().click(screen.getByRole("button", { name: "Load more" }));
  expect(screen.queryByText("Synthetic class")).toBeNull();
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(screen.getByText(/Live member record unavailable/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Review member migration" }).getAttribute("href")).toBe(
    "/admin/members/migration",
  );
  expect(screen.getByRole("link", { name: "Imported archive" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  expect(screen.queryByText("private")).toBeNull();
});

it.each(["plan", "payments"])(
  "%s propagates a missing member through the real client and replaces the ready parent",
  async (tab) => {
    let missing = false;
    transport.mockImplementation(async (name) => {
      if (name === "getMemberProfile") return { data: full };
      if (name === "listManagedPlans") return { data: [] };
      if (missing) throw { code: "functions/not-found", message: "private" };
      if (name === "listMemberSubscriptions")
        return {
          data: {
            studentId: "student-1",
            fullName: "Test Member A",
            eligiblePlanIds: [],
            memberships: [],
          },
        };
      if (name === "listMemberSubscriptionBilling") return { data: [] };
      throw Error(`Unexpected callable ${name}`);
    });
    window.history.replaceState(null, "", `/admin/members/profile?id=student-1&tab=${tab}`);
    render(<MemberRecord />);
    await screen.findByText(
      tab === "plan" ? /No membership recorded yet/ : /No invoices or payments recorded/,
    );
    missing = true;
    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh" }));
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Test Member A" })).toBeNull();
    expect(screen.getByText(/Live member record unavailable/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review member migration" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Imported archive" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(
      screen.queryByText(/No membership recorded yet|No invoices or payments recorded/),
    ).toBeNull();
  },
);

it.each(["functions/permission-denied", "functions/unauthenticated"])(
  "Classes discards both sections and the ready parent after %s while paging",
  async (code) => {
    transport.mockImplementation(async (name, input) => {
      if (name === "getMemberProfile") return { data: full };
      if (input.cursor) throw { code, message: "private" };
      return {
        data: {
          studentId: "student-1",
          kind: input.kind,
          rows:
            input.kind === "bookings"
              ? [booking]
              : [
                  {
                    recordId: "attendance-1",
                    occurredAt: at,
                    state: "late",
                    method: "self",
                    session: null,
                  },
                ],
          nextCursor: input.kind === "bookings" ? { at, recordId: "booking-1" } : null,
        },
      };
    });
    window.history.replaceState(null, "", "/admin/members/profile?id=student-1&tab=classes");
    render(<MemberRecord />);
    await screen.findByText("Synthetic class");
    await screen.findByText("Class details unavailable");
    await userEvent.setup().click(screen.getByRole("button", { name: "Load more" }));
    expect(screen.queryByText("Synthetic class")).toBeNull();
    expect(screen.queryByText("Class details unavailable")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Sign in again");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  },
);

it("Classes retains rows and cursor only for recoverable paging failures", async () => {
  let failed = true;
  transport.mockImplementation(async (name, input) => {
    if (name === "getMemberProfile") return { data: full };
    if (input.cursor && failed) throw { code: "functions/unavailable", message: "private" };
    return {
      data: {
        studentId: "student-1",
        kind: input.kind,
        rows: input.kind === "bookings" ? [booking] : [],
        nextCursor:
          input.kind === "bookings" && !input.cursor ? { at, recordId: "booking-1" } : null,
      },
    };
  });
  window.history.replaceState(null, "", "/admin/members/profile?id=student-1&tab=classes");
  render(<MemberRecord />);
  await screen.findByText("Synthetic class");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Load more" }));
  expect(screen.getByText("Synthetic class")).toBeTruthy();
  expect(screen.getByText("Unable to load class history. Refresh to try again.")).toBeTruthy();
  expect(screen.queryByText("No bookings recorded")).toBeNull();
  failed = false;
  await user.click(screen.getByRole("button", { name: "Load more" }));
  expect(screen.queryByText("Unable to load class history. Refresh to try again.")).toBeNull();
  expect(screen.getAllByText("Synthetic class")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
});

it("ignores an old student's missing response after navigating to another ready record", async () => {
  let reject: (error: unknown) => void = () => {};
  transport.mockImplementation(async (name, input) => {
    if (name === "getMemberProfile")
      return {
        data: {
          ...full,
          header: { ...full.header, studentId: input.studentId },
          details: { ...full.details, studentId: input.studentId },
        },
      };
    if (input.studentId === "student-1")
      return new Promise((_, fail) => {
        reject = fail;
      });
    return { data: [] };
  });
  window.history.replaceState(null, "", "/admin/members/profile?id=student-1&tab=payments");
  render(<MemberRecord />);
  await screen.findByRole("status", { name: "Loading recorded payments" });
  window.history.pushState(null, "", "/admin/members/profile?id=student-2&tab=payments");
  fireEvent.popState(window);
  await screen.findByText(/No invoices or payments recorded/);
  await act(async () => reject({ code: "functions/not-found" }));
  expect(screen.getByRole("tablist")).toBeTruthy();
  expect(screen.queryByText(/Live member record unavailable/)).toBeNull();
});
