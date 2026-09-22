// Read-only breakdown of the Regyfit archive so the office can map legacy plans to BPT plans.
// Output: counters only — amount × age band × legacy plan label, plus the three migration waves.
// Build first: corepack pnpm --filter @bpt-jersey/domain build:runtime
// usage:
//   S1_ACADEMY_ID=<academyId> S1_TARGET=emulator|production \
//   node qa/scripts/member-unification-plan-breakdown.mjs
// Production requires GCLOUD_PROJECT=bptjersey-f5a25 and no emulator host.

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { parseStoredRegyfitMemberRecord } from "../../packages/domain/lib/members/regyfit-member-record-contracts.js";
import { participantTypeOn } from "../../packages/domain/lib/schedule/member-calendar-contracts.js";
import { reportScriptError, resolveTarget, SafeScriptError } from "./member-unification-s1-report.mjs";

/** "£45.00", "45", "GBP 45" → "45.00"; anything else → "unknown". */
export function normalizeAmount(amount) {
  const match = (amount ?? "").replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  return match ? Number(match[1]).toFixed(2) : "unknown";
}

export function ageBandOn(birthDate, today) {
  return birthDate ? participantTypeOn(birthDate, today) : "unknown";
}

/** Wave 1: paid through today or later. Wave 2: labelled active but lapsed/undated. Wave 3: inactive. */
export function waveOf(record, today) {
  const validUntil = record.plan.validUntil;
  if (validUntil !== undefined && validUntil >= today) return 1;
  return record.membershipState === "active" ? 2 : 3;
}

export function breakdown(records, today) {
  const combos = new Map();
  const waves = { 1: 0, 2: 0, 3: 0 };
  let missingAmount = 0;
  let missingBirthDate = 0;
  for (const record of records) {
    const wave = waveOf(record, today);
    waves[wave] += 1;
    const amount = normalizeAmount(record.plan.amount);
    const band = ageBandOn(record.birthDate, today);
    if (amount === "unknown") missingAmount += 1;
    if (band === "unknown") missingBirthDate += 1;
    const key = `${amount}|${band}|${record.plan.membershipPlan ?? "(no plan label)"}|${record.plan.frequency ?? ""}`;
    const entry = combos.get(key) ?? { amount, band, plan: record.plan.membershipPlan ?? "(no plan label)", frequency: record.plan.frequency ?? "", total: 0, wave1: 0, wave2: 0, wave3: 0 };
    entry.total += 1;
    entry[`wave${wave}`] += 1;
    combos.set(key, entry);
  }
  const rows = [...combos.values()].sort((a, b) => b.total - a.total);
  return { rows, waves, missingAmount, missingBirthDate, records: records.length };
}

export async function runBreakdown(firestore, root, today) {
  const [records, plans] = await Promise.all([
    firestore.collection(`${root}/regyfitMemberRecords`).get(),
    firestore.collection(`${root}/plans`).get(),
  ]);
  const parsed = [];
  let unparsable = 0;
  for (const document of records.docs) {
    const result = parseStoredRegyfitMemberRecord(document.data());
    if (result.ok) parsed.push(result.value);
    else unparsable += 1;
  }
  const result = breakdown(parsed, today);
  console.log(`archiveRecords: ${result.records}`);
  console.log(`unparsableRecords: ${unparsable}`);
  console.log(`wave1_paidThroughToday: ${result.waves[1]}`);
  console.log(`wave2_activeLabelLapsed: ${result.waves[2]}`);
  console.log(`wave3_inactive: ${result.waves[3]}`);
  console.log(`missingAmount: ${result.missingAmount}`);
  console.log(`missingBirthDate: ${result.missingBirthDate}`);
  console.log("");
  console.log("BPT plans in the catalogue (planId | display name | price | participant types | sites | weekly limit):");
  for (const document of plans.docs) {
    const plan = document.data();
    console.log(
      `  ${document.id} | ${plan.displayName} | ${(plan.priceMinor / 100).toFixed(2)} | ${(plan.eligibleParticipantTypes ?? []).join("/")} | ${(plan.classSites ?? []).join("/")} | ${plan.weeklyClassLimit ?? "unlimited"}${plan.active === false ? " | retired" : ""}`,
    );
  }
  console.log("");
  console.log("Legacy combinations (amount | age band | legacy plan label | frequency | total | wave1 | wave2 | wave3):");
  for (const row of result.rows) {
    console.log(`  ${row.amount} | ${row.band} | ${row.plan} | ${row.frequency} | ${row.total} | ${row.wave1} | ${row.wave2} | ${row.wave3}`);
  }
  if (unparsable > 0) throw new SafeScriptError("Some archive records could not be parsed");
}

async function main() {
  const academyId = process.env.S1_ACADEMY_ID?.trim();
  if (!academyId || academyId.includes("/")) throw new SafeScriptError("Invalid S1_ACADEMY_ID");
  const { projectId } = resolveTarget(process.env);
  const requireFromFunctions = createRequire(new URL("../../apps/functions/package.json", import.meta.url));
  const { initializeApp } = requireFromFunctions("firebase-admin/app");
  const { getFirestore } = requireFromFunctions("firebase-admin/firestore");
  const firestore = getFirestore(initializeApp({ projectId }));
  await runBreakdown(firestore, `academies/${academyId}`, new Date().toISOString().slice(0, 10));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.on("unhandledRejection", reportScriptError);
  main().catch(reportScriptError);
}
