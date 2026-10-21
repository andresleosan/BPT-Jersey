import { describe, expect, it, vi } from "vitest";

const syntheticAuthUsers = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUser: async (uid: string) => syntheticAuthUsers.get(uid) }),
}));

import {
  programEditorFields,
  programEditorUpdate,
  type ProgramEditorFields,
} from "@bpt-jersey/domain/schedule";

import { createSaveProgramHandler, createUpdateProgramHandler } from "./schedule-callables";
import { createInMemoryScheduleStore } from "./schedule-service";

const academyId = "demo-academy";

function request(data: unknown, role: string, uid = "user-1") {
  syntheticAuthUsers.set(uid, {
    uid,
    disabled: false,
    customClaims: { academyId, role },
    tokensValidAfterTime: "2020-01-01T00:00:00.000Z",
  });
  return {
    app: { appId: "synthetic-app" },
    auth: { uid, token: { academyId, role, auth_time: 1_700_000_000 } },
    data,
  } as never;
}

const audienceRefusal = {
  code: "failed-precondition",
  details: { reason: "introduction-class-audience" },
};

describe("Introduction Class marker on class types (2026-10-20 item 3)", () => {
  it("stores the office's explicit choice, and the name rule only for an older client", async () => {
    const store = createInMemoryScheduleStore();
    const marked = await store.createProgramV2(academyId, {
      name: "Saturday Beginners",
      abbreviation: "SAT_BEG",
      introductionClass: true,
    });
    const unmarked = await store.createProgramV2(academyId, {
      name: "Introduction Class Saturdays",
      abbreviation: "INT_SAT",
      introductionClass: false,
    });
    const olderClient = await store.createProgramV2(academyId, {
      name: "Introduction Class Sundays",
      abbreviation: "INT_SUN",
    });

    expect([marked, unmarked, olderClient].map((type) => type.introductionClass)).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("never flips a type on rename, including a type saved before the marker", async () => {
    const store = createInMemoryScheduleStore();
    const legacyIntro = await store.createProgram(academyId, {
      name: "Introduction Class Saturdays",
      ageBand: "adult",
      discipline: "bjj",
      level: "fundamentals",
    });
    const legacyClass = await store.createProgram(academyId, {
      name: "Adults Fundamentals",
      ageBand: "adult",
      discipline: "bjj",
      level: "fundamentals",
    });
    expect(legacyIntro.introductionClass).toBeUndefined();

    const renamedIntro = await store.updateProgramV2(academyId, {
      programId: legacyIntro.programId,
      name: "Saturday Beginners",
    });
    const renamedClass = await store.updateProgramV2(academyId, {
      programId: legacyClass.programId,
      name: "Introduction Class Fundamentals",
    });

    expect(renamedIntro).toMatchObject({ name: "Saturday Beginners", introductionClass: true });
    expect(renamedClass).toMatchObject({
      name: "Introduction Class Fundamentals",
      introductionClass: false,
    });
  });

  it("refuses an explicit marker on a type some adult beginners may not join", async () => {
    const store = createInMemoryScheduleStore();
    await expect(
      store.createProgramV2(academyId, {
        name: "Kids Beginners",
        abbreviation: "KID_BEG",
        ageRange: { minAge: 4, maxAge: 7 },
        introductionClass: true,
      }),
    ).rejects.toMatchObject(audienceRefusal);
    expect((await store.listPrograms(academyId)).map((type) => type.name)).not.toContain(
      "Kids Beginners",
    );

    const intro = await store.createProgramV2(academyId, {
      name: "Saturday Beginners",
      abbreviation: "SAT_BEG",
      introductionClass: true,
    });
    await expect(
      store.updateProgramV2(academyId, {
        programId: intro.programId,
        ageRange: { minAge: 4, maxAge: 7 },
      }),
    ).rejects.toMatchObject(audienceRefusal);
  });

  it("saves the Types editor's own payload for a legacy kids type, and checks a new audience", async () => {
    const store = createInMemoryScheduleStore();
    const legacy = await store.createProgram(academyId, {
      name: "Introduction Class Kids",
      ageBand: "kids",
      discipline: "bjj",
      level: "fundamentals",
    });
    // What the page sends: every field its editor shows (age range included), one of them changed.
    const save = (change: Partial<ProgramEditorFields>) => {
      const sent = programEditorUpdate({ ...programEditorFields(legacy), ...change }, legacy);
      if (!sent.ok) throw new Error(sent.error);
      expect(sent.value).toHaveProperty("ageRange");
      return createUpdateProgramHandler({ store })(request(sent.value, "owner"));
    };

    await expect(save({ colour: "#D9D7FF" })).resolves.toMatchObject({
      program: { colour: "#D9D7FF", ageBand: "kids", ageRange: null, introductionClass: true },
    });
    await expect(save({ ageRange: { minAge: 4, maxAge: 12 } })).rejects.toMatchObject(
      audienceRefusal,
    );
    await expect(
      save({ introductionClass: false, ageRange: { minAge: 4, maxAge: 12 } }),
    ).resolves.toMatchObject({
      program: { introductionClass: false, ageRange: { minAge: 4, maxAge: 12 } },
    });
  });

  it("leaves who may set it as before: managers yes, coaches no", async () => {
    const store = createInMemoryScheduleStore();
    const input = { name: "Saturday Beginners", abbreviation: "SAT_BEG", introductionClass: true };

    const saved = await createSaveProgramHandler({ store })(request(input, "headCoach"));
    expect(saved.program.introductionClass).toBe(true);
    await expect(
      createSaveProgramHandler({ store })(request(input, "coach")),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      createUpdateProgramHandler({ store })(
        request(
          { programId: saved.program.programId, ageRange: { minAge: 4, maxAge: 7 } },
          "owner",
        ),
      ),
    ).rejects.toMatchObject(audienceRefusal);
  });
});
