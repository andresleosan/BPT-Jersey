import { describe, expect, it } from "vitest";

import {
  mapSessionRow,
  mapType,
  parseRegyfitDate,
  planImport,
  productionConfirmation,
  programIdFor,
  resolveTarget,
  trainerKeyFor,
  zonedIso,
  type RegyfitRow,
  type RegyfitType,
} from "../scripts/regyfit-classes-services-map.mjs";

const timezone = "Europe/Jersey";
const now = "2026-09-17T08:00:00.000Z";

function type(overrides: Partial<RegyfitType> = {}): RegyfitType {
  return {
    name: "Synthetic GI Evenings",
    abbreviation: "SYN_GI",
    colour: "#d9d7ff",
    active: true,
    type: "Class: Registrations = weekly/monthly frequency",
    dropIns: "Automatic",
    email: false,
    list: true,
    message: "",
    icon: "../../imagens/icons/656.svg",
    ...overrides,
  };
}

function row(
  id: string,
  date: string,
  time: string,
  overrides: Partial<Record<number, string>> = {},
): RegyfitRow {
  const cells = [
    "",
    "",
    "",
    "Synthetic GI Evenings AULA",
    "BPT Town",
    "Synthetic Trainer",
    date,
    time,
    "0",
    "0",
    "2/40",
    "",
    "",
  ];
  for (const [index, value] of Object.entries(overrides)) cells[Number(index)] = value!;
  return { week: "2026-09-01", id: `feed_aula${id}`, cells, icon: "/admin2/imagens/icons/656.svg" };
}

describe("dates and times", () => {
  it("parses the Regyfit DATE cell", () => {
    expect(parseRegyfitDate("14 Sep 2026")).toBe("2026-09-14");
    expect(() => parseRegyfitDate("14/09/2026")).toThrow("Unparseable Regyfit date");
  });

  it("converts Jersey wall time to UTC across summer and winter time", () => {
    expect(zonedIso("2026-09-14", "06:00", timezone)).toBe("2026-09-14T05:00:00.000Z");
    expect(zonedIso("2026-12-14", "06:00", timezone)).toBe("2026-12-14T06:00:00.000Z");
  });
});

describe("ids", () => {
  it("derives stable slugs", () => {
    expect(programIdFor("GI Beginners Evenings")).toBe("regyfit-gi-beginners-evenings");
    expect(programIdFor("13-15YO")).toBe("regyfit-13-15yo");
    expect(trainerKeyFor("Zoé Exemple")).toBe("regyfit-trainer-zoe-exemple");
  });
});

describe("mapType", () => {
  it("builds a v1 program carrying the v2 fields", () => {
    expect(mapType(type(), "academy-a")).toEqual({
      programId: "regyfit-synthetic-gi-evenings",
      academyId: "academy-a",
      name: "Synthetic GI Evenings",
      ageBand: "all",
      discipline: "bjj",
      level: "all-levels",
      abbreviation: "SYN_GI",
      colour: "#d9d7ff",
      kind: "class-frequency",
      dropInPolicy: "automatic",
      notifyByEmail: false,
      showInList: true,
      message: "",
      active: true,
      schemaVersion: "1",
    });
  });

  it("maps unlimited classes and numeric drop-in policies", () => {
    const program = mapType(type({ type: "Class: Unlimited registrations", dropIns: "3" }), "a");
    expect(program.kind).toBe("class-unlimited");
    expect(program.dropInPolicy).toBe("3");
  });

  it("refuses a type kind it does not know instead of guessing", () => {
    expect(() => mapType(type({ type: "Room: something new" }), "a")).toThrow(
      "Unknown Regyfit type kind",
    );
  });
});

describe("mapSessionRow", () => {
  const programIdsByName = new Map([["Synthetic GI Evenings", "regyfit-synthetic-gi-evenings"]]);

  it("maps a past row into a completed session in UTC", () => {
    expect(
      mapSessionRow(row("1", "14 Sep 2026", "06:00 - 07:00"), {
        academyId: "a",
        programIdsByName,
        now,
        timezone,
      }),
    ).toEqual({
      sessionId: "regyfit-1",
      academyId: "a",
      classId: null,
      programId: "regyfit-synthetic-gi-evenings",
      locationId: "town",
      instructorId: "regyfit-trainer-synthetic-trainer",
      instructorIds: ["regyfit-trainer-synthetic-trainer"],
      title: "Synthetic GI Evenings",
      startAt: "2026-09-14T05:00:00.000Z",
      endAt: "2026-09-14T06:00:00.000Z",
      capacity: 40,
      minParticipants: 0,
      status: "completed",
      isSeminar: false,
      cancellationReason: null,
      schemaVersion: "1",
      createdAt: now,
      createdBy: "regyfit-import",
      updatedAt: now,
      updatedBy: "regyfit-import",
    });
  });

  it("keeps a class that has not ended scheduled, including one in progress", () => {
    const options = { academyId: "a", programIdsByName, now, timezone };
    // now = 08:00Z = 09:00 in Jersey.
    expect(mapSessionRow(row("5", "17 Sep 2026", "08:00 - 09:00"), options).status).toBe(
      "completed",
    );
    expect(mapSessionRow(row("6", "17 Sep 2026", "08:30 - 09:30"), options).status).toBe(
      "scheduled",
    );
    expect(mapSessionRow(row("7", "18 Sep 2026", "06:00 - 07:00"), options).status).toBe(
      "scheduled",
    );
  });

  it("reads ∞ as unlimited capacity and BPT West as west", () => {
    const session = mapSessionRow(
      row("2", "15 Sep 2026", "17:30 - 18:30", { 4: "BPT West", 10: "0/∞" }),
      { academyId: "a", programIdsByName, now, timezone },
    );
    expect(session.capacity).toBeNull();
    expect(session.locationId).toBe("west");
  });

  it("splits a co-taught TRAINERS cell into one instructor per person", () => {
    const session = mapSessionRow(
      row("8", "14 Sep 2026", "06:00 - 07:00", { 5: "Synthetic Coach One, Synthetic Coach Two" }),
      { academyId: "a", programIdsByName, now, timezone },
    );
    expect(session.instructorId).toBe("regyfit-trainer-synthetic-coach-one");
    expect(session.instructorIds).toEqual([
      "regyfit-trainer-synthetic-coach-one",
      "regyfit-trainer-synthetic-coach-two",
    ]);
  });

  it("refuses a row with no trainer", () => {
    expect(() =>
      mapSessionRow(row("9", "14 Sep 2026", "06:00 - 07:00", { 5: "" }), {
        academyId: "a",
        programIdsByName,
        now,
        timezone,
      }),
    ).toThrow("No trainer (row feed_aula9)");
  });

  it("fails loudly on an unknown type or location rather than dropping the class", () => {
    const options = { academyId: "a", programIdsByName, now, timezone };
    expect(() =>
      mapSessionRow(row("3", "14 Sep 2026", "06:00 - 07:00", { 3: "Unknown AULA" }), options),
    ).toThrow('No type named "Unknown" (row feed_aula3)');
    expect(() =>
      mapSessionRow(row("4", "14 Sep 2026", "06:00 - 07:00", { 4: "BPT Moon" }), options),
    ).toThrow('Unknown location "BPT Moon" (row feed_aula4)');
  });
});

describe("planImport", () => {
  it("keeps the rows inside the local date window, ignoring the bogus week tag", () => {
    const plan = planImport(
      {
        types: [type()],
        rows: [
          row("10", "13 Sep 2026", "10:00 - 11:00"),
          row("11", "14 Sep 2026", "06:00 - 07:00"),
          row("12", "20 Sep 2026", "10:00 - 11:00"),
          row("13", "21 Sep 2026", "06:00 - 07:00"),
        ],
      },
      { academyId: "a", now, timezone, from: "2026-09-14", to: "2026-09-20" },
    );
    expect(plan.programs.map((p) => p.programId)).toEqual(["regyfit-synthetic-gi-evenings"]);
    expect(plan.sessions.map((s) => s.sessionId)).toEqual(["regyfit-11", "regyfit-12"]);
    expect(plan.outsideWindow).toBe(2);
    expect(plan.trainers).toEqual(["Synthetic Trainer"]);
  });

  it("lists each co-teaching trainer once, by name", () => {
    const plan = planImport(
      {
        types: [type()],
        rows: [
          row("30", "14 Sep 2026", "06:00 - 07:00", {
            5: "Synthetic Coach One, Synthetic Coach Two",
          }),
          row("31", "15 Sep 2026", "06:00 - 07:00", { 5: "Synthetic Coach Two" }),
        ],
      },
      { academyId: "a", now, timezone },
    );
    expect(plan.trainers).toEqual(["Synthetic Coach One", "Synthetic Coach Two"]);
  });

  it("skips an identical repeated row but refuses a conflicting one", () => {
    const repeated = planImport(
      {
        types: [type()],
        rows: [
          row("20", "14 Sep 2026", "06:00 - 07:00"),
          row("20", "14 Sep 2026", "06:00 - 07:00"),
        ],
      },
      { academyId: "a", now, timezone },
    );
    expect(repeated.sessions).toHaveLength(1);
    expect(repeated.duplicates).toBe(1);
    expect(() =>
      planImport(
        {
          types: [type()],
          rows: [
            row("21", "14 Sep 2026", "06:00 - 07:00"),
            row("21", "15 Sep 2026", "06:00 - 07:00"),
          ],
        },
        { academyId: "a", now, timezone },
      ),
    ).toThrow("Regyfit row id feed_aula21 appears twice with different cells");
  });

  it("refuses two types that would write the same program", () => {
    const options = { academyId: "a", now, timezone };
    expect(() =>
      planImport({ types: [type(), type({ name: "Synthetic GI  Evenings!" })], rows: [] }, options),
    ).toThrow(
      'Regyfit types "Synthetic GI Evenings" and "Synthetic GI  Evenings!" map to the same programId regyfit-synthetic-gi-evenings',
    );
    expect(() => planImport({ types: [type(), type()], rows: [] }, options)).toThrow(
      'Regyfit types "Synthetic GI Evenings" and "Synthetic GI Evenings" map to the same programId regyfit-synthetic-gi-evenings',
    );
  });
});

describe("resolveTarget", () => {
  it("accepts only a loopback emulator", () => {
    expect(
      resolveTarget({
        REGYFIT_IMPORT_TARGET: "emulator",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      }),
    ).toEqual({ target: "emulator", projectId: "demo-bpt-jersey" });
    expect(() =>
      resolveTarget({
        REGYFIT_IMPORT_TARGET: "emulator",
        FIRESTORE_EMULATOR_HOST: "10.0.0.5:8080",
      }),
    ).toThrow("loopback");
    expect(() => resolveTarget({ REGYFIT_IMPORT_TARGET: "emulator" })).toThrow("loopback");
  });

  it("refuses an emulator import into a project id that is not demo-", () => {
    const emulator = {
      REGYFIT_IMPORT_TARGET: "emulator",
      FIRESTORE_EMULATOR_HOST: "localhost:8080",
    };
    expect(resolveTarget({ ...emulator, GCLOUD_PROJECT: "demo-other" })).toEqual({
      target: "emulator",
      projectId: "demo-other",
    });
    expect(() => resolveTarget({ ...emulator, GCLOUD_PROJECT: "bptjersey-f5a25" })).toThrow(
      "Emulator imports require a demo- project id",
    );
  });

  it("requires the project and the operator confirmation for production", () => {
    const base = { REGYFIT_IMPORT_TARGET: "production", GCLOUD_PROJECT: "bptjersey-f5a25" };
    expect(() => resolveTarget(base)).toThrow("operator confirmation");
    expect(() =>
      resolveTarget({
        ...base,
        REGYFIT_OPERATOR_CONFIRMATION: productionConfirmation,
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      }),
    ).toThrow("must not run with FIRESTORE_EMULATOR_HOST");
    expect(
      resolveTarget({ ...base, REGYFIT_OPERATOR_CONFIRMATION: productionConfirmation }),
    ).toEqual({ target: "production", projectId: "bptjersey-f5a25" });
  });

  it("rejects anything else", () => {
    expect(() => resolveTarget({})).toThrow("REGYFIT_IMPORT_TARGET must be emulator or production");
  });
});
