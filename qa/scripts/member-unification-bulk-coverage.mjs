// Recognise the paid period of wave-1 legacy members (archive `validUntil` today or later) as a
// BPT membership through the existing `previously-paid` settlement: no invoice, no charge, no
// second coverage. Dry-run by default; output is counters only.
//
// Requires the plan mapping the office wrote from member-unification-plan-breakdown.mjs:
//   { "65.00|adult": "west-adult", "95.00|kids": { "Town": "town-kids-1x", "West": "west-kids-1x" } }
//   (amount|ageBand → planId, or → planId per confirmed centre when the price exists at both)
// A member is skipped (and stays in Data review) when: no mapping, no birth date, centre still
// unconfirmed, the plan does not cover the member's centre or age band, or a membership exists.
//
// Build first: node apps/functions/scripts/build-deploy-artifact.mjs
// usage (dry-run):
//   S1_ACADEMY_ID=<academyId> S1_TARGET=production GCLOUD_PROJECT=bptjersey-f5a25 \
//   S1_ACTOR_ID=<provisioned owner uid> BULK_COVERAGE_MAPPING=<path.json> \
//   node qa/scripts/member-unification-bulk-coverage.mjs
// apply: add BULK_COVERAGE_APPLY=yes MEMBER_UNIFICATION_CONFIRMATION=member-unification-coverage-v1

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { parseStoredRegyfitMemberRecord } from "../../packages/domain/lib/members/regyfit-member-record-contracts.js";
import { ageBandOn, normalizeAmount, waveOf } from "./member-unification-plan-breakdown.mjs";
import { reportScriptError, resolveTarget, SafeScriptError } from "./member-unification-s1-report.mjs";

const confirmationPhrase = "member-unification-coverage-v1";

export function parseMapping(text) {
  const raw = JSON.parse(text);
  const mapping = new Map();
  for (const [key, planId] of Object.entries(raw)) {
    const bySite = planId !== null && typeof planId === "object" && !Array.isArray(planId);
    const valid =
      typeof planId === "string" ||
      (bySite && Object.keys(planId).every((site) => ["Town", "West"].includes(site) && typeof planId[site] === "string"));
    if (!/^(?:\d+\.\d{2}|unknown)\|(?:kids|teens|adult|unknown)$/u.test(key) || !valid) {
      throw new SafeScriptError("Mapping keys must be amount|ageBand and values plan ids (or {Town, West} plan ids)");
    }
    mapping.set(key, planId);
  }
  return mapping;
}

/** Pure planner so the rules can be self-checked without Firestore. */
export function planCoverage({ links, recordsById, studentsById, plansById, membershipStudentIds, mapping, today }) {
  const planned = [];
  const skipped = {};
  const skip = (reason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };
  for (const link of links) {
    const record = recordsById.get(link.recordId);
    const student = studentsById.get(link.studentId);
    if (!record || !student) {
      skip("missingRecordOrStudent");
      continue;
    }
    if (waveOf(record, today) !== 1) {
      skip("notWave1");
      continue;
    }
    if (membershipStudentIds.has(link.studentId)) {
      skip("membershipExists");
      continue;
    }
    if (student.trainingCenterStatus === "unconfirmed") {
      skip("centreUnconfirmed");
      continue;
    }
    const band = ageBandOn(student.dateOfBirth, today);
    if (band === "unknown") {
      skip("dateOfBirthMissing");
      continue;
    }
    const mapped = mapping.get(`${normalizeAmount(record.plan.amount)}|${band}`);
    const planId = typeof mapped === "string" ? mapped : mapped?.[student.trainingCenter];
    const plan = planId ? plansById.get(planId) : undefined;
    if (!plan) {
      skip("noMapping");
      continue;
    }
    if (plan.active === false || !(plan.classSites ?? []).includes(student.trainingCenter) || !(plan.eligibleParticipantTypes ?? []).includes(band)) {
      skip("planNotCompatible");
      continue;
    }
    const startDate = record.plan.validFrom ?? record.capturedAt.slice(0, 10);
    planned.push({
      studentId: link.studentId,
      input: {
        studentId: link.studentId,
        membershipId: null,
        expectedUpdatedAt: null,
        requestId: randomUUID(),
        operation: "assign",
        planId,
        startsAt: `${startDate}T00:00:00.000Z`,
        endsAt: `${record.plan.validUntil}T23:59:59.000Z`,
        settlement: { kind: "previously-paid", recordId: link.recordId, paymentConfirmed: true },
      },
    });
  }
  return { planned, skipped };
}

async function main() {
  const env = process.env;
  const academyId = env.S1_ACADEMY_ID?.trim();
  if (!academyId || academyId.includes("/")) throw new SafeScriptError("Invalid S1_ACADEMY_ID");
  const actorId = env.S1_ACTOR_ID?.trim();
  if (!actorId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(actorId)) throw new SafeScriptError("Invalid S1_ACTOR_ID");
  const { projectId } = resolveTarget(env);
  const apply = env.BULK_COVERAGE_APPLY === "yes";
  if (apply && env.MEMBER_UNIFICATION_CONFIRMATION !== confirmationPhrase) {
    throw new SafeScriptError("Apply requires MEMBER_UNIFICATION_CONFIRMATION=" + confirmationPhrase);
  }
  if (!env.BULK_COVERAGE_MAPPING) throw new SafeScriptError("BULK_COVERAGE_MAPPING path is required");
  let mapping;
  try {
    mapping = parseMapping(readFileSync(env.BULK_COVERAGE_MAPPING, "utf8"));
  } catch (error) {
    throw error instanceof SafeScriptError ? error : new SafeScriptError("Mapping file is unreadable or invalid JSON");
  }

  let manualSubscription;
  try {
    manualSubscription = await import(new URL("../../.firebase-functions/lib/src/memberships/manual-subscription-service.js", import.meta.url));
  } catch {
    throw new SafeScriptError("Deploy artifact missing: run node apps/functions/scripts/build-deploy-artifact.mjs first");
  }
  const requireFromArtifact = createRequire(new URL("../../.firebase-functions/package.json", import.meta.url));
  const { initializeApp } = requireFromArtifact("firebase-admin/app");
  const { getFirestore } = requireFromArtifact("firebase-admin/firestore");
  const firestore = getFirestore(initializeApp({ projectId }));
  const root = `academies/${academyId}`;
  const today = new Date().toISOString().slice(0, 10);

  const [decisions, records, students, plans, memberships] = await Promise.all(
    ["memberMigrationDecisions", "regyfitMemberRecords", "students", "plans", "memberships"].map((name) =>
      firestore.collection(`${root}/${name}`).get(),
    ),
  );
  const recordsById = new Map();
  let unparsable = 0;
  for (const document of records.docs) {
    const parsed = parseStoredRegyfitMemberRecord(document.data());
    if (parsed.ok) recordsById.set(parsed.value.recordId, parsed.value);
    else unparsable += 1;
  }
  const links = decisions.docs
    .map((document) => document.data())
    .filter((decision) => decision.kind === "link" && decision.studentId && decision.recordId)
    .map((decision) => ({ studentId: decision.studentId, recordId: decision.recordId }));
  const plan = planCoverage({
    links,
    recordsById,
    studentsById: new Map(students.docs.map((document) => [document.id, document.data()])),
    plansById: new Map(plans.docs.map((document) => [document.id, document.data()])),
    membershipStudentIds: new Set(memberships.docs.map((document) => document.get("studentId"))),
    mapping,
    today,
  });
  console.log(`mode: ${apply ? "APPLY" : "dry-run"}`);
  console.log(`linkedMembers: ${links.length}`);
  console.log(`unparsableRecords: ${unparsable}`);
  console.log(`plannedCoverage: ${plan.planned.length}`);
  for (const [reason, count] of Object.entries(plan.skipped)) console.log(`skipped_${reason}: ${count}`);
  if (!apply) return;

  const actor = Object.freeze({ kind: "user", academyId, userId: actorId, role: "owner" });
  let applied = 0;
  let failed = 0;
  const failures = {};
  for (const item of plan.planned) {
    try {
      await manualSubscription.saveManualSubscription(firestore, actor, item.input);
      applied += 1;
    } catch (error) {
      failed += 1;
      if (env.BPT_OPERATOR_DEBUG === "1") {
        // The subscription service raises fixed sentences (HttpsError); count them by message.
        const message = `${error?.code ?? error?.constructor?.name ?? "Error"}: ${String(error?.message ?? "").slice(0, 160)}`;
        failures[message] = (failures[message] ?? 0) + 1;
      }
    }
  }
  console.log(`applied: ${applied}`);
  console.log(`failed: ${failed}`);
  for (const [message, count] of Object.entries(failures)) console.error(`failure x${count}: ${message}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.on("unhandledRejection", reportScriptError);
  main().catch(reportScriptError);
}
