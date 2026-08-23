import { describe, expect, it } from "vitest";

import {
  parseStaffAvailabilityWindow,
  parseStaffProfile,
  parseStaffRoleAssignment,
} from "./staff-contracts";

const staffProfile = {
  staffId: "staff-1",
  academyId: "academy-1",
  userId: "user-1",
  role: "coach",
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: "2026-08-21T09:00:00Z",
  createdBy: "owner-1",
  updatedAt: "2026-08-21T09:00:00Z",
  updatedBy: "owner-1",
} as const;

describe("staff contracts", () => {
  it("accepts coach, headCoach, and inactive profiles and freezes the result", () => {
    const coach = parseStaffProfile(staffProfile);
    const headCoach = parseStaffProfile({ ...staffProfile, role: "headCoach" });
    const inactive = parseStaffProfile({ ...staffProfile, active: false, status: "inactive" });

    expect(coach).toEqual({ ok: true, value: staffProfile });
    expect(headCoach).toEqual({ ok: true, value: { ...staffProfile, role: "headCoach" } });
    expect(inactive.ok).toBe(true);
    expect(coach.ok && Object.isFrozen(coach.value)).toBe(true);
  });

  it("rejects administrative roles and unknown or inherited fields", () => {
    expect(parseStaffProfile({ ...staffProfile, role: "owner" }).ok).toBe(false);
    expect(parseStaffProfile({ ...staffProfile, createdAt: "2026-02-31T09:00:00Z" }).ok).toBe(
      false,
    );
    expect(parseStaffProfile({ ...staffProfile, displayName: "Coach" }).ok).toBe(false);

    const inherited = Object.create({ active: true }) as Record<string, unknown>;
    Object.assign(inherited, staffProfile);
    expect(parseStaffProfile(inherited).ok).toBe(false);

    const hostile = { ...staffProfile } as Record<string, unknown>;
    Object.defineProperty(hostile, "role", {
      get: () => {
        throw new Error("hostile getter");
      },
    });
    expect(parseStaffProfile(hostile).ok).toBe(false);

    const accessor = { ...staffProfile } as Record<string, unknown>;
    Object.defineProperty(accessor, "role", { enumerable: true, get: () => "coach" });
    expect(parseStaffProfile(accessor).ok).toBe(false);
    expect(parseStaffProfile({ ...staffProfile, active: true, status: "inactive" }).ok).toBe(false);
  });

  it("accepts one tenant-scoped assignment target and rejects unsupported targets", () => {
    const assignment = parseStaffRoleAssignment({
      academyId: "academy-1",
      staffId: "staff-1",
      targetType: "location",
      targetId: "location-town",
    });

    expect(assignment).toEqual({
      ok: true,
      value: {
        academyId: "academy-1",
        staffId: "staff-1",
        targetType: "location",
        targetId: "location-town",
      },
    });
    expect(
      parseStaffRoleAssignment({
        academyId: "academy-1",
        staffId: "staff-1",
        targetType: "student",
        targetId: "student-1",
      }).ok,
    ).toBe(false);
  });

  it("accepts explicit local availability and rejects reversed windows", () => {
    const availability = parseStaffAvailabilityWindow({
      academyId: "academy-1",
      staffId: "staff-1",
      weekday: 1,
      startLocal: "17:00",
      endLocal: "20:00",
      timezone: "Europe/London",
    });

    expect(availability).toEqual({
      ok: true,
      value: {
        academyId: "academy-1",
        staffId: "staff-1",
        weekday: 1,
        startLocal: "17:00",
        endLocal: "20:00",
        timezone: "Europe/London",
      },
    });
    expect(
      parseStaffAvailabilityWindow({
        academyId: "academy-1",
        staffId: "staff-1",
        weekday: 1,
        startLocal: "20:00",
        endLocal: "17:00",
        timezone: "Europe/London",
      }).ok,
    ).toBe(false);
    expect(
      parseStaffAvailabilityWindow({
        academyId: "academy-1",
        staffId: "staff-1",
        weekday: 1,
        startLocal: "17:00",
        endLocal: "20:00",
        timezone: "Not/IANA",
      }).ok,
    ).toBe(false);
    expect(
      parseStaffAvailabilityWindow({
        academyId: "academy-1",
        staffId: "staff-1",
        weekday: 1,
        startLocal: { toString: () => "17:00" } as never,
        endLocal: "20:00",
        timezone: "Europe/London",
      }).ok,
    ).toBe(false);
  });
});
