import { describe, expect, it, vi } from "vitest";

import {
  createListUpcomingBirthdaysHandler,
  upcomingBirthdayCallableOptions,
} from "./upcoming-birthday-callables";
import { UpcomingBirthdayError, type UpcomingBirthdayService } from "./upcoming-birthday-service";

function fakeRequest(data: unknown, role = "coach", uid = "staff-1") {
  return { auth: { uid, token: { academyId: "academy-1", role } }, data } as never;
}

function service(overrides: Partial<UpcomingBirthdayService> = {}): UpcomingBirthdayService {
  return { listUpcomingBirthdays: vi.fn().mockResolvedValue([]), ...overrides };
}

describe("upcoming birthday callable (T112)", () => {
  it("requires and consumes App Check", () => {
    expect(upcomingBirthdayCallableOptions).toEqual({
      cors: ["https://bptjersey.pages.dev"],
      invoker: "public",
      enforceAppCheck: true,
      consumeAppCheckToken: true,
    });
  });

  it("lets every staff role read the birthdays of their own academy", async () => {
    for (const role of ["owner", "administrator", "headCoach", "coach"]) {
      const birthdays = service();
      await createListUpcomingBirthdaysHandler({ service: birthdays })(fakeRequest(null, role));
      expect(birthdays.listUpcomingBirthdays).toHaveBeenCalledWith({
        academyId: "academy-1",
        query: { windowDays: 7 },
      });
    }
  });

  it.each(["guardian", "adultStudent"])("refuses %s", async (role) => {
    await expect(
      createListUpcomingBirthdaysHandler({ service: service() })(fakeRequest(null, role, "c-1")),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("refuses an unauthenticated caller", async () => {
    await expect(
      createListUpcomingBirthdaysHandler({ service: service() })({ data: null } as never),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("passes the site and window the coach panel asked for", async () => {
    const birthdays = service();
    await createListUpcomingBirthdaysHandler({ service: birthdays })(
      fakeRequest({ trainingCenter: "West", windowDays: 14 }),
    );
    expect(birthdays.listUpcomingBirthdays).toHaveBeenCalledWith({
      academyId: "academy-1",
      query: { trainingCenter: "West", windowDays: 14 },
    });
  });

  it.each([
    ["a site that does not exist", { trainingCenter: "North" }],
    ["an unknown key", { trainingCenter: "Town", studentId: "s-1" }],
    ["a window out of range", { windowDays: 400 }],
    ["a payload that is not an object", "Town"],
  ])("refuses %s", async (_label, data) => {
    await expect(
      createListUpcomingBirthdaysHandler({ service: service() })(fakeRequest(data)),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("returns the birthdays under a single key", async () => {
    const entry = {
      studentId: "s-1",
      displayName: "Ana Coelho",
      daysAway: 2,
      participantType: "adult",
      trainingCenter: "Town",
    };
    const result = await createListUpcomingBirthdaysHandler({
      service: service({ listUpcomingBirthdays: vi.fn().mockResolvedValue([entry]) }),
    })(fakeRequest(null));
    expect(result).toEqual({ birthdays: [entry] });
  });

  it("translates store failures into safe codes", async () => {
    await expect(
      createListUpcomingBirthdaysHandler({
        service: service({
          listUpcomingBirthdays: vi
            .fn()
            .mockRejectedValue(new UpcomingBirthdayError("invalid", "academyId is invalid")),
        }),
      })(fakeRequest(null)),
    ).rejects.toMatchObject({ code: "invalid-argument" });

    await expect(
      createListUpcomingBirthdaysHandler({
        service: service({
          listUpcomingBirthdays: vi
            .fn()
            .mockRejectedValue(new UpcomingBirthdayError("conflict", "too many")),
        }),
      })(fakeRequest(null)),
    ).rejects.toMatchObject({ code: "failed-precondition" });

    await expect(
      createListUpcomingBirthdaysHandler({
        service: service({
          listUpcomingBirthdays: vi.fn().mockRejectedValue(new Error("firestore exploded")),
        }),
      })(fakeRequest(null)),
    ).rejects.toMatchObject({ code: "internal" });
  });
});
