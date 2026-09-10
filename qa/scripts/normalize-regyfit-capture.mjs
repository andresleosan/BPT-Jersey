// Normalises a raw Regyfit admin capture into canonical member records.
//
// usage:
//   node scripts/normalize-regyfit-capture.mjs <captureDir> <outFile> <capturedAt>
//
// <captureDir> holds the raw capture chunks written by the browser-side harvester:
//   members-*.json  profile, plan and attendance payloads (UTF-8 endpoints)
//   details-*.json  personal details, classes and payments (ISO-8859-1 endpoint)
// Raw captures contain personal data and must stay outside the repository.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const attendanceStatuses = new Map([
  ["present", "present"],
  ["absent", "absent"],
  ["no data", "no-data"],
]);

const genders = new Map([
  ["Masculino", "male"],
  ["Feminino", "female"],
]);

const placeholders = new Set(["", "---", "----", "--", "-"]);

function text(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return placeholders.has(normalized) ? undefined : normalized;
}

function count(value) {
  const normalized = text(value);
  if (normalized === undefined) return undefined;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function calendarDate(value) {
  const normalized = text(value);
  if (normalized === undefined || !/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) return undefined;
  const [year, month, day] = normalized.split("-").map((part) => Number.parseInt(part, 10));
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
    ? normalized
    : undefined;
}

function birthDate(details) {
  const day = text(details.birthDay);
  const month = text(details.birthMonth);
  const year = text(details.birthYear);
  if (day === undefined || month === undefined || year === undefined) return undefined;
  return calendarDate(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
}

function optional(target, key, value) {
  if (value !== undefined) target[key] = value;
  return target;
}

function findTable(tables, ...required) {
  if (!Array.isArray(tables)) return undefined;
  return tables.find((table) =>
    required.every((header) =>
      (table.headers ?? []).some((candidate) => candidate.toLowerCase() === header),
    ),
  );
}

function attendanceRecords(classes) {
  const table = findTable(classes?.tables, "date", "status");
  if (table === undefined) return [];
  const records = [];
  for (const row of table.rows) {
    const date = text(row[0]);
    if (date === undefined) continue;
    const rawStatus = (text(row[3]) ?? "").toLowerCase();
    records.push(
      optional(
        optional(
          { date, status: attendanceStatuses.get(rawStatus) ?? "unknown" },
          "time",
          text(row[1]),
        ),
        "className",
        text(row[2]),
      ),
    );
    if (records.length === 50) break;
  }
  return records;
}

function paymentRows(payments) {
  const table = findTable(payments?.tables, "date", "amount");
  if (table === undefined) return [];
  const rows = [];
  for (const row of table.rows) {
    const entry = optional(
      optional(optional({}, "date", text(row[0])), "description", text(row[1])),
      "amount",
      text(row[2]),
    );
    if (Object.keys(entry).length > 0) rows.push(entry);
    if (rows.length === 50) break;
  }
  return rows;
}

function normalize(record, capturedAt) {
  const details = record.details ?? {};
  const profile = record.profile ?? {};
  const graduation = profile.graduation ?? {};
  const plan = record.plan ?? {};
  const stats = record.classes?.stats ?? {};

  const normalized = {
    recordId: record.alunoId,
    fullName: text(details.fullName) ?? "",
    gender: genders.get(text(details.gender) ?? "") ?? "unknown",
    membershipState: profile.inactiveProfile === true ? "inactive" : "active",
    appAccess: optional(
      optional(
        optional(
          optional({}, "login", text(profile.appLogin)),
          "password",
          text(profile.appPassword),
        ),
        "logins",
        count(profile.appLogins),
      ),
      "lastLogin",
      text(profile.appLastLogin),
    ),
    graduation: optional(
      optional(
        optional(
          optional(
            optional(
              optional({}, "modality", text(graduation.modality)),
              "belt",
              text(graduation.belt),
            ),
            "nextGraduationDate",
            text(graduation.nextGraduationDate),
          ),
          "progressPercent",
          count(graduation.progressPercent),
        ),
        "classesProgress",
        text(graduation.classesProgress),
      ),
      "daysProgress",
      text(graduation.daysProgress),
    ),
    plan: optional(
      optional(
        optional(
          optional(
            optional(
              optional(
                optional({}, "membershipPlan", text(plan.membershipPlan)),
                "paymentMode",
                text(plan.paymentMode),
              ),
              "amount",
              text(plan.amount),
            ),
            "validFrom",
            calendarDate(plan.validFrom),
          ),
          "validUntil",
          calendarDate(plan.validUntil),
        ),
        "frequency",
        text(plan.frequency),
      ),
      "discount",
      text(plan.discount),
    ),
    attendance: optional(
      optional(
        optional(
          optional(
            optional(
              optional(
                optional(
                  { records: attendanceRecords(record.classes) },
                  "registrations",
                  count(stats.Registrations),
                ),
                "attended",
                count(stats.Attendance),
              ),
              "absences",
              count(stats.Absences),
            ),
            "thisMonth",
            count(stats["This month"]),
          ),
          "last30Days",
          count(profile.attendanceLast30),
        ),
        "lastAttendance",
        text(profile.lastAttendance),
      ),
      "advantage",
      text(profile.advantage),
    ),
    payments: paymentRows(record.payments),
    capturedAt,
    source: "regyfit-admin-capture",
    schemaVersion: "1",
  };

  optional(normalized, "memberNumber", text(details.memberNumber));
  optional(normalized, "nickname", text(details.nickname));
  optional(normalized, "email", text(details.email));
  optional(normalized, "mobile", text(details.mobile));
  optional(normalized, "emergencyContact", text(details.emergencyContact));
  optional(normalized, "address", text(details.address));
  optional(normalized, "locality", text(details.locality));
  optional(normalized, "postcode", text(details.postcode));
  optional(normalized, "country", text(details.country));
  optional(normalized, "idCardNumber", text(details.idCardNumber));
  optional(normalized, "idCardDue", calendarDate(details.idCardDue));
  optional(normalized, "healthNumber", text(details.healthNumber));
  optional(normalized, "vatNumber", text(details.vatNumber));
  optional(normalized, "profession", text(details.profession));
  optional(normalized, "birthDate", birthDate(details));
  optional(normalized, "age", count(profile.age));
  optional(normalized, "registrationDate", calendarDate(details.registrationDate));
  optional(normalized, "responsibleTrainer", text(profile.responsibleTrainer));
  optional(normalized, "accountManager", text(profile.accountManager));
  optional(normalized, "notes", text(details.notes));
  return normalized;
}

function readChunks(directory, prefix) {
  const merged = new Map();
  for (const name of readdirSync(directory).sort()) {
    if (!name.startsWith(prefix) || !name.endsWith(".json")) continue;
    for (const record of JSON.parse(readFileSync(join(directory, name), "utf8"))) {
      merged.set(record.alunoId, record);
    }
  }
  return merged;
}

function main() {
  const [captureDir, outFile, capturedAt] = process.argv.slice(2);
  if (!captureDir || !outFile || !capturedAt) {
    throw new Error(
      "usage: node scripts/normalize-regyfit-capture.mjs <captureDir> <outFile> <capturedAt>",
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(capturedAt)) {
    throw new Error("capturedAt must be a canonical UTC millisecond timestamp");
  }

  const base = readChunks(captureDir, "members-");
  const detailPass = readChunks(captureDir, "details-");
  if (base.size === 0) throw new Error("no members-*.json chunks found");

  const records = [];
  for (const [alunoId, record] of base) {
    const authoritativeDetails = detailPass.get(alunoId);
    const merged = {
      ...record,
      ...(authoritativeDetails === undefined
        ? {}
        : {
            details: authoritativeDetails.details ?? record.details,
            classes: authoritativeDetails.classes ?? record.classes,
            payments: authoritativeDetails.payments ?? record.payments,
          }),
    };
    const normalized = normalize(merged, capturedAt);
    if (normalized.fullName.length === 0) {
      throw new Error(`record ${alunoId} has no full name`);
    }
    records.push(normalized);
  }

  records.sort((left, right) => Number(left.recordId) - Number(right.recordId));
  writeFileSync(outFile, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify({
      records: records.length,
      withMemberNumber: records.filter((record) => record.memberNumber !== undefined).length,
      withBirthDate: records.filter((record) => record.birthDate !== undefined).length,
      inactive: records.filter((record) => record.membershipState === "inactive").length,
      outFile,
    }),
  );
}

main();
