// Pure mapping of the Regyfit Classes / Services capture (class-service-types.json and
// scheduled-classes-list.json) into BPT programs and sessions. No I/O: the CLI in
// regyfit-classes-services-import.mjs reads the files and writes Firestore.

export const productionConfirmation = "classes-services-types-sessions-production-v1";
const productionProjectId = "bptjersey-f5a25";

const months = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
};
const locationIds = new Map([
  ["BPT Town", "town"],
  ["BPT West", "west"],
]);
const kinds = new Map([
  ["Class: Registrations = weekly/monthly frequency", "class-frequency"],
  ["Class: Unlimited registrations", "class-unlimited"],
]);
const dropInPolicies = new Map([
  ["No", "no"],
  ["Unlimited", "unlimited"],
  ["Automatic", "automatic"],
  ["1", "1"],
  ["2", "2"],
  ["3", "3"],
  ["4", "4"],
  ["5", "5"],
]);

function slug(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function programIdFor(typeName) {
  return `regyfit-${slug(typeName)}`;
}

export function trainerKeyFor(name) {
  return `regyfit-trainer-${slug(name)}`;
}

export function parseRegyfitDate(text) {
  const match = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/u.exec(text.trim());
  if (!match || !months[match[2]]) throw new Error(`Unparseable Regyfit date "${text}"`);
  return `${match[3]}-${String(months[match[2]]).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function offsetMinutes(utcMs, timezone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(utcMs))
      .map((part) => [part.type, part.value]),
  );
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return (local - utcMs) / 60_000;
}

// ponytail: one offset lookup; wrong only for a class starting inside the 1-hour DST gap/overlap.
export function zonedIso(date, time, timezone) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  return new Date(guess - offsetMinutes(guess, timezone) * 60_000).toISOString();
}

export function mapType(type, academyId) {
  const kind = kinds.get(type.type);
  if (!kind) throw new Error(`Unknown Regyfit type kind "${type.type}" (${type.name})`);
  const dropInPolicy = dropInPolicies.get(type.dropIns);
  if (!dropInPolicy)
    throw new Error(`Unknown Regyfit drop-in policy "${type.dropIns}" (${type.name})`);
  return {
    programId: programIdFor(type.name),
    academyId,
    name: type.name,
    ageBand: "all",
    discipline: "bjj",
    level: "all-levels",
    abbreviation: type.abbreviation,
    colour: type.colour,
    kind,
    dropInPolicy,
    notifyByEmail: type.email,
    showInList: type.list,
    message: type.message,
    active: type.active,
    schemaVersion: "1",
  };
}

function rowParts(row) {
  if (!Array.isArray(row.cells) || row.cells.length < 11) {
    throw new Error(`Row ${row.id} does not have the 11 expected cells`);
  }
  const [, , , rawTitle, location, trainer, dateText, range, , , registrations] = row.cells;
  const times = /^(\d{2}:\d{2}) - (\d{2}:\d{2})$/u.exec(range.trim());
  if (!times) throw new Error(`Unparseable time range "${range}" (row ${row.id})`);
  // Co-taught classes list their trainers in one cell, joined by ", ".
  const trainers = trainer
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  return {
    title: rawTitle.replace(/\s+AULA$/u, "").trim(),
    location,
    trainers,
    date: parseRegyfitDate(dateText),
    start: times[1],
    end: times[2],
    registrations,
  };
}

export function mapSessionRow(
  row,
  { academyId, programIdsByName, locationIdsByName = locationIds, now, timezone },
) {
  const parts = rowParts(row);
  if (parts.trainers.length === 0) throw new Error(`No trainer (row ${row.id})`);
  const programId = programIdsByName.get(parts.title);
  if (!programId) throw new Error(`No type named "${parts.title}" (row ${row.id})`);
  const locationId = locationIdsByName.get(parts.location);
  if (!locationId) throw new Error(`Unknown location "${parts.location}" (row ${row.id})`);
  const capacityText = parts.registrations.split("/")[1]?.trim();
  const capacity = capacityText === "∞" ? null : Number(capacityText);
  if (capacity !== null && !(Number.isInteger(capacity) && capacity > 0)) {
    throw new Error(`Unparseable capacity "${parts.registrations}" (row ${row.id})`);
  }
  const instructorIds = [...new Set(parts.trainers.map(trainerKeyFor))];
  const endAt = zonedIso(parts.date, parts.end, timezone);
  return {
    sessionId: `regyfit-${row.id.replace(/^feed_aula/u, "")}`,
    academyId,
    classId: null,
    programId,
    locationId,
    instructorId: instructorIds[0],
    instructorIds,
    title: parts.title,
    startAt: zonedIso(parts.date, parts.start, timezone),
    endAt,
    capacity,
    minParticipants: 0,
    status: endAt <= now ? "completed" : "scheduled",
    isSeminar: false,
    cancellationReason: null,
    schemaVersion: "1",
    createdAt: now,
    createdBy: "regyfit-import",
    updatedAt: now,
    updatedBy: "regyfit-import",
  };
}

export function planImport(
  { types, rows },
  {
    academyId,
    now,
    timezone,
    from,
    to,
    existingProgramIdsByName = new Map(),
    existingLocationIdsByName = new Map(),
  },
) {
  const programs = types.map((type) => mapType(type, academyId));
  const namesById = new Map();
  for (const { programId, name } of programs) {
    const earlier = namesById.get(programId);
    if (earlier !== undefined) {
      throw new Error(
        `Regyfit types "${earlier}" and "${name}" map to the same programId ${programId}`,
      );
    }
    namesById.set(programId, name);
  }
  // A type already in the target (created by hand in the admin screen) keeps its own id, so the
  // import links sessions to it instead of writing a second program with the same name.
  const programIdsByName = new Map(
    programs.map(({ name, programId }) => [name, existingProgramIdsByName.get(name) ?? programId]),
  );
  const locationIdsByName = new Map([...locationIds, ...existingLocationIdsByName]);
  const toCreate = programs.filter(({ name }) => !existingProgramIdsByName.has(name));
  const seen = new Map();
  const trainers = new Set();
  const sessions = [];
  let outsideWindow = 0;
  let duplicates = 0;
  let withoutTrainer = 0;
  for (const row of rows) {
    // The list capture pages overlap, so the same class can arrive twice with identical cells.
    const earlier = seen.get(row.id);
    if (earlier !== undefined) {
      if (JSON.stringify(earlier) !== JSON.stringify(row.cells)) {
        throw new Error(`Regyfit row id ${row.id} appears twice with different cells`);
      }
      duplicates += 1;
      continue;
    }
    seen.set(row.id, row.cells);
    const { date, trainers: rowTrainers } = rowParts(row);
    if ((from && date < from) || (to && date > to)) {
      outsideWindow += 1;
      continue;
    }
    // ponytail: a session needs an instructor; one trainerless Regyfit class is reported, not invented.
    if (rowTrainers.length === 0) {
      withoutTrainer += 1;
      continue;
    }
    sessions.push(
      mapSessionRow(row, { academyId, programIdsByName, locationIdsByName, now, timezone }),
    );
    for (const name of rowTrainers) trainers.add(name);
  }
  return {
    programs: toCreate,
    reusedPrograms: programs.length - toCreate.length,
    sessions,
    trainers: [...trainers].sort(),
    outsideWindow,
    duplicates,
    withoutTrainer,
  };
}

function isLoopbackHost(value) {
  const host = value?.split(":")[0]?.toLowerCase();
  return host === "127.0.0.1" || host === "localhost";
}

export function resolveTarget(env) {
  const target = env.REGYFIT_IMPORT_TARGET?.trim();
  if (target === "emulator") {
    if (!isLoopbackHost(env.FIRESTORE_EMULATOR_HOST)) {
      throw new Error("Emulator imports require FIRESTORE_EMULATOR_HOST on a loopback host");
    }
    const projectId = env.GCLOUD_PROJECT?.trim() || "demo-bpt-jersey";
    if (!/^demo-/u.test(projectId)) {
      throw new Error("Emulator imports require a demo- project id");
    }
    return { target, projectId };
  }
  if (target === "production") {
    if (env.FIRESTORE_EMULATOR_HOST) {
      throw new Error("Production imports must not run with FIRESTORE_EMULATOR_HOST set");
    }
    if (env.GCLOUD_PROJECT?.trim() !== productionProjectId) {
      throw new Error(`Production imports require GCLOUD_PROJECT=${productionProjectId}`);
    }
    if (env.REGYFIT_OPERATOR_CONFIRMATION !== productionConfirmation) {
      throw new Error("Production imports require the operator confirmation value");
    }
    return { target, projectId: productionProjectId };
  }
  throw new Error("REGYFIT_IMPORT_TARGET must be emulator or production");
}
