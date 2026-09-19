import { expect, it } from "vitest";
import {
  memberClassQuerySchema,
  memberClassPageSchema,
  projectMemberBooking,
  projectMemberAttendance,
} from "./member-class-record-contracts";
const at = "2026-09-20T10:00:00.000Z";
it("closes page contracts, validates UTC cursors and projects only member-safe values", () => {
  expect(
    memberClassQuerySchema.parse({
      studentId: "s",
      kind: "bookings",
      cursor: { at, recordId: "v2:1:s:1:c" },
    }),
  ).toEqual({ studentId: "s", kind: "bookings", cursor: { at, recordId: "v2:1:s:1:c" } });
  for (const extra of [{ academyId: "a" }, { role: "owner" }, { limit: 100 }])
    expect(
      memberClassQuerySchema.safeParse({ studentId: "s", kind: "bookings", ...extra }).success,
    ).toBe(false);
  for (const cursor of [
    { at: "2026-09-20T11:00:00+01:00", recordId: "r" },
    { at, recordId: "../r" },
    { at: "2026-02-30T10:00:00.000Z", recordId: "r" },
  ])
    expect(
      memberClassQuerySchema.safeParse({ studentId: "s", kind: "attendance", cursor }).success,
    ).toBe(false);
  const raw = {
    bookingId: "b",
    requestedAt: at,
    status: "confirmed" as const,
    createdBy: "staff",
    notes: "private",
  };
  const row = projectMemberBooking(raw, null);
  expect(row).toEqual({ recordId: "b", session: null, requestedAt: at, status: "confirmed" });
  expect(
    projectMemberAttendance(
      { attendanceId: "a", occurredAt: at, state: "late", method: "self" },
      null,
    ),
  ).toEqual({ recordId: "a", session: null, occurredAt: at, state: "late", method: "self" });
  const page = { studentId: "s", kind: "bookings", rows: [row], nextCursor: null };
  expect(memberClassPageSchema.parse(page)).toEqual(page);
  for (const invalid of [
    { ...page, rows: Array(26).fill(row) },
    { ...page, rows: [{ ...row, notes: "private" }] },
    { ...page, rows: [{ ...row, status: "paid" }] },
    { ...page, familyId: "f" },
  ])
    expect(memberClassPageSchema.safeParse(invalid).success).toBe(false);
});
