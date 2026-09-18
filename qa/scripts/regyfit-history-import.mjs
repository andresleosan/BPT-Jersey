// Turns the captured Regyfit "class registrations log" into BPT class audit events.
//
// The capture holds real member names and addresses and must stay outside the repository, and so
// must the review file this writes (--review-file, default
// /root/regyfit-capture/data/history-unmatched.json).
//
// Runs against the compiled domain runtime; build it first with
//   corepack pnpm --filter @bpt-jersey/domain build:runtime
//
// usage (a dry run is the default: it counts, prints ten mapped events and writes nothing):
//   node qa/scripts/regyfit-history-import.mjs \
//     --file /root/regyfit-capture/data/history-log.full.json \
//     --academy <academyId> [--review-file <path>] [--apply] [--project <id>]
//
// Writing to a project whose id does not start with "demo-" additionally requires
// --i-know-this-is-production, and is run only after the operator confirms in chat.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { jerseyWallClockToInstant } from "../../packages/domain/lib/audit/class-history-contracts.js";
import {
  isAuditIpAddress,
  parseAuditEventDraft,
} from "../../packages/domain/lib/audit/audit-event.js";

/** Every imported row is written by the import, not by a BPT user; the Regyfit user is the name. */
export const importActorId = "regyfit-import";
export const importPurpose = "regyfit-history-import";

const monthNumbers = Object.freeze({
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
  // Regyfit writes most months in English but slips into Portuguese for a handful of rows. Only
  // the three abbreviations the capture actually uses are accepted; any other stays unreadable.
  Fev: "02",
  Ago: "08",
  Set: "09",
});

const day = "(\\d{1,2} [A-Z][a-z]{2} \\d{4})";
const clock = "(\\d{1,2}:\\d{2})";

/**
 * One explicit expression per Regyfit sentence family. Nothing is inferred from a sentence that
 * matches none of them: it goes to the review file with its original text, because a guessed
 * booking is a fact the academy never recorded.
 */
const sentenceFamilies = Object.freeze([
  {
    family: "member-booking",
    pattern: new RegExp(`^O atleta (.+?) Inscreveu-se na aula do dia ${day} pelas ${clock}$`, "u"),
    read: ([student, date, time]) => ({ student, date, time, program: null }),
    action: "booking.created",
    actorGroup: "member",
  },
  {
    family: "admin-booking",
    pattern: new RegExp(
      `^O atleta (.+?) foi inscrito pelo ADMIN na aula do dia ${day} pelas ${clock}$`,
      "u",
    ),
    read: ([student, date, time]) => ({ student, date, time, program: null }),
    action: "booking.created",
    actorGroup: "staff",
  },
  {
    family: "admin-booking-typed",
    pattern: new RegExp(
      `^O atleta (.+?) foi inscrito pelo ADMIN em (.+?) no dia ${day} pelas ${clock}$`,
      "u",
    ),
    read: ([student, program, date, time]) => ({ student, date, time, program }),
    action: "booking.created",
    actorGroup: "staff",
  },
  {
    family: "app-booking",
    pattern: new RegExp(
      `^O atleta (.+?) foi inscrito pela APP na aula do dia ${day} pelas ${clock}$`,
      "u",
    ),
    read: ([student, date, time]) => ({ student, date, time, program: null }),
    action: "booking.created",
    actorGroup: "member",
  },
  {
    family: "app-booking-typed",
    pattern: new RegExp(
      `^O atleta (.+?) foi inscrito pela APP em (.+?) no dia ${day} pelas ${clock}$`,
      "u",
    ),
    read: ([student, program, date, time]) => ({ student, date, time, program }),
    action: "booking.created",
    actorGroup: "member",
  },
  {
    family: "attendance",
    // The broken rows Regyfit writes as "aula: | |" carry no id, date or time at all: requiring
    // all three here is what keeps them out of the import and in the review file.
    pattern: new RegExp(
      `^Foram marcadas presenças e faltas da aula: \\d+ \\| (\\d{2}-\\d{2}-\\d{4}) \\| ${clock}$`,
      "u",
    ),
    read: ([date, time]) => ({ student: null, date: ukDate(date), time, program: null }),
    action: "attendance.checked_in",
    actorGroup: "staff",
  },
  {
    family: "member-cancellation",
    pattern: new RegExp(
      `^O atleta (.+?) cancelou a inscrição na aula do dia ${day} pelas ${clock}$`,
      "u",
    ),
    read: ([student, date, time]) => ({ student, date, time, program: null }),
    action: "booking.cancelled",
    actorGroup: "member",
  },
  {
    family: "member-cancellation-typed",
    pattern: new RegExp(
      `^O atleta (.+?) cancelou a inscrição na aula (.+?) do dia ${day} pelas ${clock}$`,
      "u",
    ),
    read: ([student, program, date, time]) => ({ student, date, time, program }),
    action: "booking.cancelled",
    actorGroup: "member",
  },
  {
    family: "admin-cancellation",
    pattern: new RegExp(
      `^Foi eliminada pelo ADMIN a inscrição de\\s*(.*?)\\s*da aula do dia ${day} pelas ${clock}$`,
      "u",
    ),
    read: ([student, date, time]) => ({ student, date, time, program: null }),
    action: "booking.cancelled",
    actorGroup: "staff",
  },
  {
    family: "app-cancellation",
    pattern: new RegExp(
      `^Foi eliminada pela APP a inscrição de\\s*(.*?)\\s*da aula do dia ${day} ${clock}$`,
      "u",
    ),
    read: ([student, date, time]) => ({ student, date, time, program: null }),
    action: "booking.cancelled",
    actorGroup: "member",
  },
  {
    family: "group-booking",
    pattern: new RegExp(
      `^O grupo/equipa\\s*(.*?)\\s*foi inscrito na aula do dia ${day} pelas ${clock}$`,
      "u",
    ),
    read: ([group, date, time]) => ({ student: null, group, date, time, program: null }),
    action: "booking.created",
    actorGroup: "staff",
  },
  {
    family: "dropin-booking",
    pattern: new RegExp(
      `^Um (?:dropin|experiência) foi inscrito numa aula: (.+?) » .*?- ${day} (?:at|pelas) ${clock}$`,
      "u",
    ),
    read: ([student, date, time]) => ({ student, date, time, program: null }),
    action: "dropin.created",
    actorGroup: "staff",
  },
  {
    family: "dropin-cancellation",
    pattern: new RegExp(
      `^(?:Foi eliminada|Eliminou) a inscrição do (?:drop-in|experiência) (.+?) da aula do dia: ${day} ${clock}$`,
      "u",
    ),
    read: ([student, date, time]) => ({ student, date, time, program: null }),
    action: "dropin.cancelled",
    actorGroup: "staff",
  },
]);

export const sentenceFamilyNames = Object.freeze(sentenceFamilies.map((entry) => entry.family));

/** "16-09-2026" as Regyfit writes it, read as the calendar date "2026-09-16". */
function ukDate(value) {
  const [d, m, y] = value.split("-");
  return `${y}-${m}-${d}`;
}

/** "23 Sep 2026" as the sentences write it, read as the calendar date "2026-09-23". */
function sentenceDate(value) {
  const [d, month, y] = value.split(" ");
  const monthNumber = monthNumbers[month];
  if (monthNumber === undefined) return null;
  return `${y}-${monthNumber}-${d.padStart(2, "0")}`;
}

function clockTime(value) {
  const [hour, minute] = value.split(":");
  return `${hour.padStart(2, "0")}:${minute}`;
}

function emptyToNull(value) {
  const trimmed = value === null || value === undefined ? "" : value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * What one Regyfit sentence says, or null when no family recognises it. The class date and time are
 * the Jersey wall clock the sentence names; the caller turns them into an instant.
 */
export function parseHistorySentence(sentence) {
  const text = sentence.normalize("NFC").trim();
  for (const entry of sentenceFamilies) {
    const match = entry.pattern.exec(text);
    if (match === null) continue;
    const read = entry.read(match.slice(1));
    const date = entry.family === "attendance" ? read.date : sentenceDate(read.date);
    if (date === null) return null;
    return Object.freeze({
      family: entry.family,
      action: entry.action,
      actorGroup: entry.actorGroup,
      studentName: emptyToNull(read.student),
      groupName: emptyToNull(read.group ?? null),
      programName: emptyToNull(read.program),
      classDate: date,
      classTime: clockTime(read.time),
    });
  }
  return null;
}

const logStampPattern = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}:\d{2})$/u;

/**
 * The instant a Regyfit log line was written. Regyfit prints the Jersey wall clock, so a row read
 * as UTC would land an hour early all summer - and a row stamped "now" would collapse the whole
 * history onto the import date.
 */
export function parseLogTimestamp(value) {
  const match = logStampPattern.exec(String(value).trim());
  if (match === null) return null;
  return jerseyWallClockToInstant(`${match[3]}-${match[2]}-${match[1]}`, match[4]);
}

/** Case, accents and spacing are Regyfit's, not the member's: only the letters identify a person. */
export function normaliseName(value) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

/**
 * The document id of one row: a hash of exactly what Regyfit logged. Re-running the import writes
 * nothing twice, and two genuinely different rows (a member booking and cancelling the same class)
 * differ in their sentence or their stamp, so they keep their own ids.
 */
export function historyEventId(row) {
  const digest = createHash("sha256")
    .update(JSON.stringify([row[0] ?? "", row[1] ?? "", row[2] ?? "", row[4] ?? ""]))
    .digest("hex");
  return `regyfit-${digest.slice(0, 40)}`;
}

/** A group booking names a team, never a person: the reader must not read it as a member. */
export function groupStudentName(groupName) {
  return groupName === null ? null : `Group: ${groupName}`.slice(0, 128);
}

/**
 * One captured row as an audit event, or the reason it cannot be one. `resolveSession` and
 * `resolveStudent` are the target's own lookups, so the pure mapping is testable without Firestore.
 */
export function mapHistoryRow(row, options) {
  const sentence = String(row[4] ?? "").trim();
  const occurredAt = parseLogTimestamp(row[0]);
  if (occurredAt === null) {
    return { ok: false, reason: "unreadable-log-timestamp", sentence, loggedAt: row[0] ?? null };
  }
  const parsed = parseHistorySentence(sentence);
  if (parsed === null) {
    return { ok: false, reason: "unrecognised-sentence", sentence, loggedAt: row[0] };
  }
  const sessionStartAt = jerseyWallClockToInstant(parsed.classDate, parsed.classTime);
  if (sessionStartAt === null) {
    return { ok: false, reason: "unreadable-class-moment", sentence, loggedAt: row[0] };
  }

  const resolved = options.resolveSession(sessionStartAt, parsed.programName) ?? null;
  const session = resolved === "class-mismatch" ? null : resolved;
  const notes = [];
  let studentId = null;
  let studentName = parsed.studentName;

  if (parsed.family === "group-booking") {
    studentName = groupStudentName(parsed.groupName);
    if (studentName === null) notes.push("group-not-named");
  } else if (parsed.family === "attendance") {
    studentName = null;
  } else if (parsed.studentName === null) {
    notes.push("student-not-named");
  } else {
    const student = options.resolveStudent(parsed.studentName);
    if (student === null) notes.push("student-unmatched");
    else if (student === "ambiguous") notes.push("student-ambiguous");
    else studentId = student;
  }
  // Every unlinked row is noted, attendance included: a null session id is honest, but one nobody
  // can see in the review file is invisible, and the operator cannot audit what they cannot see.
  if (session === null) {
    notes.push(resolved === "class-mismatch" ? "session-class-mismatch" : "session-unmatched");
  }

  const actorIp = isAuditIpAddress(row[2]) ? row[2] : null;
  const eventId = historyEventId(row);
  const draft = {
    academyId: options.academyId,
    actorId: importActorId,
    action: parsed.action,
    targetRef: `academies/${options.academyId}/auditEvents/${eventId}`,
    purpose: importPurpose,
    correlationId: eventId,
    class: {
      studentId,
      // A resolved student is named by their own record, so the imported name is kept only when
      // nothing was matched - and never for a group, where it is the team's name with its prefix.
      studentName: studentId === null ? studentName : null,
      sessionId: session === null ? null : session.sessionId,
      sessionStartAt,
      programId: session === null ? null : session.programId,
      locationId: session === null ? null : session.locationId,
    },
    actorIp,
    actorRole: "regyfit",
    actorGroup: parsed.actorGroup,
    actorName: emptyToNull(String(row[1] ?? "")),
    source: "regyfit",
  };
  const validated = parseAuditEventDraft(draft);
  if (!validated.ok) {
    return { ok: false, reason: "invalid-audit-event", sentence, loggedAt: row[0] };
  }

  return {
    ok: true,
    family: parsed.family,
    eventId,
    occurredAt,
    draft: validated.value,
    notes,
  };
}

/** The stored shape: the audit writer's fields, with the row's real log instant as `occurredAt`. */
export function historyEventDocument(mapped, timestampFromIso) {
  return {
    ...mapped.draft,
    auditEventId: mapped.eventId,
    // The writer stamps a live event with a server timestamp. An imported row happened months ago,
    // and the log is queried and paged by `occurredAt`, so the true past instant is written here
    // instead - as a Timestamp, which is what the query compares against.
    occurredAt: timestampFromIso(mapped.occurredAt),
    result: "completed",
    schemaVersion: 1,
  };
}

function parseArguments(argv) {
  const options = {
    file: "/root/regyfit-capture/data/history-log.full.json",
    reviewFile: "/root/regyfit-capture/data/history-unmatched.json",
    academyId: null,
    projectId: null,
    apply: false,
    productionAcknowledged: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new Error(`${argument} needs a value`);
      index += 1;
      return value;
    };
    if (argument === "--file") options.file = next();
    else if (argument === "--review-file") options.reviewFile = next();
    else if (argument === "--academy") options.academyId = next();
    else if (argument === "--project") options.projectId = next();
    else if (argument === "--apply") options.apply = true;
    else if (argument === "--dry-run") options.apply = false;
    else if (argument === "--i-know-this-is-production") options.productionAcknowledged = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.academyId === null) throw new Error("--academy <academyId> is required");
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/u.test(options.academyId)) {
    throw new Error("--academy must be a lowercase slug");
  }
  if (options.apply) {
    if (options.projectId === null) throw new Error("--apply requires --project <id>");
    if (!options.projectId.startsWith("demo-") && !options.productionAcknowledged) {
      throw new Error(
        "Refusing to write to a non-demo project without --i-know-this-is-production",
      );
    }
  }
  return options;
}

/**
 * Which of the sessions that start at one instant a sentence meant: the session itself, null when
 * nothing at that instant can be told apart, or "class-mismatch" when the sentence names a class
 * and no single session at that instant is it.
 */
export function chooseSession(candidates, programName, programNameById) {
  if (candidates.length === 0) return null;
  // Two classes can start at the same minute, and only the typed sentences say which one. A moment
  // that names several classes and no type stays unlinked rather than picking one.
  if (programName === null) return candidates.length === 1 ? candidates[0] : null;
  // When the sentence does name its class, that name decides even against a single candidate: a
  // lone session at the minute is not evidence it is the class the sentence meant, and a wrongly
  // linked row is a quiet lie where an unlinked one is merely a gap.
  const wanted = normaliseName(programName);
  const matches = candidates.filter(
    (entry) => normaliseName(String(programNameById.get(entry.programId) ?? "")) === wanted,
  );
  return matches.length === 1 ? matches[0] : "class-mismatch";
}

/** The target's sessions, keyed by the instant they start, so a sentence's moment can find one. */
function sessionIndex(snapshot) {
  const byStart = new Map();
  for (const document of snapshot.docs) {
    const data = document.data();
    const startAt = typeof data.startAt === "string" ? data.startAt : null;
    if (startAt === null) continue;
    const key = new Date(startAt).toISOString();
    const entry = {
      sessionId: data.sessionId ?? document.id,
      programId: typeof data.programId === "string" ? data.programId : null,
      locationId: typeof data.locationId === "string" ? data.locationId : null,
      programName: null,
    };
    byStart.set(key, [...(byStart.get(key) ?? []), entry]);
  }
  return byStart;
}

function studentIndex(snapshot) {
  const byName = new Map();
  for (const document of snapshot.docs) {
    const data = document.data();
    const fullName = typeof data.fullName === "string" ? data.fullName : null;
    if (fullName === null) continue;
    const key = normaliseName(fullName);
    if (key === "") continue;
    byName.set(key, byName.has(key) ? "ambiguous" : (data.studentId ?? document.id));
  }
  return byName;
}

function summarise(results) {
  const byFamily = new Map();
  const reasons = new Map();
  const notes = new Map();
  let mapped = 0;
  let withSession = 0;
  let withStudent = 0;
  for (const result of results) {
    if (!result.ok) {
      reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1);
      continue;
    }
    mapped += 1;
    byFamily.set(result.family, (byFamily.get(result.family) ?? 0) + 1);
    if (result.draft.class.sessionId !== null) withSession += 1;
    if (result.draft.class.studentId !== null) withStudent += 1;
    for (const note of result.notes) notes.set(note, (notes.get(note) ?? 0) + 1);
  }
  return {
    mapped,
    withSession,
    withStudent,
    byFamily: Object.fromEntries([...byFamily].sort()),
    reasons: Object.fromEntries([...reasons].sort()),
    notes: Object.fromEntries([...notes].sort()),
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const capture = JSON.parse(readFileSync(options.file, "utf8"));
  const rows = Object.values(capture.rows ?? {});

  const requireFromFunctions = createRequire(
    new URL("../../apps/functions/package.json", import.meta.url),
  );
  const { getApps, initializeApp } = requireFromFunctions("firebase-admin/app");
  const { getFirestore, Timestamp } = requireFromFunctions("firebase-admin/firestore");
  const firestore = getFirestore(
    getApps()[0] ?? initializeApp({ projectId: options.projectId ?? "demo-bpt-jersey" }),
  );
  const academy = `academies/${options.academyId}`;
  const [sessions, students, programs] = await Promise.all(
    ["sessions", "students", "programs"].map((name) =>
      firestore.collection(`${academy}/${name}`).get(),
    ),
  );
  const programNames = new Map(
    programs.docs.map((doc) => [doc.get("programId") ?? doc.id, doc.get("name")]),
  );
  const sessionsByStart = sessionIndex(sessions);
  const studentsByName = studentIndex(students);

  const resolveSession = (startAt, programName) =>
    chooseSession(
      sessionsByStart.get(new Date(startAt).toISOString()) ?? [],
      programName,
      programNames,
    );
  const resolveStudent = (name) => studentsByName.get(normaliseName(name)) ?? null;

  const results = rows.map((row) =>
    mapHistoryRow(row, { academyId: options.academyId, resolveSession, resolveStudent }),
  );
  const summary = summarise(results);

  const review = {
    generatedAt: new Date().toISOString(),
    capture: {
      file: options.file,
      since: capture.since ?? null,
      capturedAt: capture.capturedAt ?? null,
    },
    summary,
    notImported: results
      .filter((result) => !result.ok)
      .map((result) => ({
        loggedAt: result.loggedAt,
        reason: result.reason,
        sentence: result.sentence,
      })),
    unresolved: results
      .filter((result) => result.ok && result.notes.length > 0)
      .map((result) => ({
        eventId: result.eventId,
        occurredAt: result.occurredAt,
        notes: result.notes,
        studentName: result.draft.class.studentName,
        sessionStartAt: result.draft.class.sessionStartAt,
      })),
  };
  writeFileSync(options.reviewFile, `${JSON.stringify(review, null, 2)}\n`, "utf8");

  const mapped = results.filter((result) => result.ok);
  let created = 0;
  let skippedExisting = 0;

  if (options.apply) {
    for (let index = 0; index < mapped.length; index += 400) {
      const chunk = mapped.slice(index, index + 400);
      const references = chunk.map((result) =>
        firestore.doc(`${academy}/auditEvents/${result.eventId}`),
      );
      const snapshots = await firestore.getAll(...references);
      const batch = firestore.batch();
      chunk.forEach((result, position) => {
        if (snapshots[position].exists) {
          skippedExisting += 1;
          return;
        }
        batch.create(
          references[position],
          historyEventDocument(result, (iso) => Timestamp.fromDate(new Date(iso))),
        );
        created += 1;
      });
      await batch.commit();
      console.log(
        JSON.stringify({
          progress: {
            written: Math.min(index + 400, mapped.length),
            of: mapped.length,
            created,
            skippedExisting,
          },
        }),
      );
    }
  } else {
    // A dry run prints shapes, never members: the ten samples carry no name, address or sentence.
    console.log(
      JSON.stringify(
        {
          sample: mapped.slice(0, 10).map((result) => ({
            eventId: result.eventId,
            family: result.family,
            action: result.draft.action,
            actorGroup: result.draft.actorGroup,
            occurredAt: result.occurredAt,
            sessionStartAt: result.draft.class.sessionStartAt,
            sessionId: result.draft.class.sessionId,
            studentResolved: result.draft.class.studentId !== null,
            notes: result.notes,
          })),
        },
        null,
        2,
      ),
    );
  }

  console.log(
    JSON.stringify({
      mode: options.apply ? "apply" : "dry-run",
      project: options.projectId,
      academyId: options.academyId,
      rows: rows.length,
      ...summary,
      reviewFile: options.reviewFile,
      reviewed: review.notImported.length + review.unresolved.length,
      created,
      skippedExisting,
    }),
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
