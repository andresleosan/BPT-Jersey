// Members whose normalised full name appears more than once in the canonical directory, with the
// facts the office needs to pick the record to keep: origin (original vs migrated), login, billing
// family, invoices and memberships. Read-only. Prints names and ids: an office tool, not a log.
//
// usage: S1_ACADEMY_ID=<academyId> GCLOUD_PROJECT=bptjersey-f5a25 node qa/scripts/member-duplicates-report.mjs

import { createRequire } from "node:module";

const academyId = process.env.S1_ACADEMY_ID?.trim();
if (!academyId || academyId.includes("/")) throw new Error("Invalid S1_ACADEMY_ID");
const projectId = process.env.GCLOUD_PROJECT?.trim();
if (!projectId) throw new Error("GCLOUD_PROJECT is required");

const req = createRequire(new URL("../../.firebase-functions/package.json", import.meta.url));
const { initializeApp } = req("firebase-admin/app");
const { getFirestore } = req("firebase-admin/firestore");
const db = getFirestore(initializeApp({ projectId }));
const root = `academies/${academyId}`;
const [students, decisions, memberships, invoices, profiles] = await Promise.all(
  ["students", "memberMigrationDecisions", "memberships", "invoices", "studentAdminProfiles"].map((name) => db.collection(`${root}/${name}`).get()),
);
const migrated = new Map(decisions.docs.map((d) => [d.get("studentId"), d.get("kind")]).filter(([id]) => id));
const legacyOf = new Map(profiles.docs.map((d) => [d.id, d.get("legacyMemberId") ?? d.get("membershipNumber") ?? ""]));
const membershipsOf = new Map();
for (const d of memberships.docs) {
  const x = d.data();
  (membershipsOf.get(x.studentId) ?? membershipsOf.set(x.studentId, []).get(x.studentId)).push(`${x.planId}:${x.status}:${(x.endsAt ?? "open").slice(0, 10)}`);
}
const invoicesOf = new Map();
for (const d of invoices.docs) invoicesOf.set(d.get("familyId"), (invoicesOf.get(d.get("familyId")) ?? 0) + 1);
const normalise = (s) => String(s ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const groups = new Map();
for (const d of students.docs) {
  const key = normalise(d.get("fullName"));
  (groups.get(key) ?? groups.set(key, []).get(key)).push({ id: d.id, ...d.data() });
}
let repeated = 0;
for (const [, rows] of [...groups].sort()) {
  if (rows.length < 2) continue;
  repeated += 1;
  const sameBirth = new Set(rows.map((r) => r.dateOfBirth ?? "?")).size === 1;
  console.log(`\n${sameBirth ? "DUPLICATE" : "same name, different birth date"}: ${rows[0].fullName} (${rows.length})`);
  for (const r of rows) {
    console.log(
      `  ${r.id}  dob=${r.dateOfBirth ?? "-"}  ${r.participantType ?? "-"}  origin=${migrated.has(r.id) ? "migrated:" + migrated.get(r.id) : "original"}` +
        `  login=${r.userId ? "yes" : "no"}  family=${r.familyId ?? "-"}  invoices=${invoicesOf.get(r.familyId) ?? 0}` +
        `  centre=${r.trainingCenter ?? "-"}${r.trainingCenterStatus ? "(unconfirmed)" : ""}  legacy=${legacyOf.get(r.id) || "-"}  memberships=[${(membershipsOf.get(r.id) ?? []).join(", ")}]`,
    );
  }
}
console.log(`\nstudents: ${students.size} · repeated names: ${repeated}`);
process.exit(0);
