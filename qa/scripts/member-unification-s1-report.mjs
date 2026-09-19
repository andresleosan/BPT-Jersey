// Read-only S1 migration report; output contains counters and the reader version only.
// Build first: corepack pnpm --filter @bpt-jersey/domain build:runtime
// usage:
//   S1_ACADEMY_ID=<academyId> S1_TARGET=emulator|production \
//   node qa/scripts/member-unification-s1-report.mjs
// Emulator requires FIRESTORE_EMULATOR_HOST on loopback.
// Production requires GCLOUD_PROJECT=bptjersey-f5a25 and no emulator host.
// Production execution is reserved for the operator after explicit authorization.

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { buildMemberMigrationQueue } from "../../packages/domain/lib/members/member-migration-contracts.js";
import { parseMemberRecord } from "../../packages/domain/lib/members/member-contracts.js";
import { parseStoredRegyfitMemberRecord } from "../../packages/domain/lib/members/regyfit-member-record-contracts.js";

export class SafeScriptError extends Error {}

export function reportScriptError(error) {
  // Only explicitly safe guard messages may leave the script; SDK errors can contain personal data.
  console.error(error instanceof SafeScriptError ? `errors: 1 — ${error.message}` : "errors: 1");
  process.exitCode = 1;
}

const productionProjectId = "bptjersey-f5a25";

export function resolveTarget(env) {
  const target = env.S1_TARGET?.trim();
  if (target === "emulator") {
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\]):[0-9]+$/i.test(env.FIRESTORE_EMULATOR_HOST ?? "")) {
      throw new SafeScriptError(
        "Emulator reports require FIRESTORE_EMULATOR_HOST on a loopback host",
      );
    }
    return { target, projectId: env.GCLOUD_PROJECT?.trim() || "demo-bpt-jersey" };
  }
  if (target === "production") {
    if (env.FIRESTORE_EMULATOR_HOST !== undefined) {
      throw new SafeScriptError("Production reports must not run with FIRESTORE_EMULATOR_HOST set");
    }
    if (env.GCLOUD_PROJECT?.trim() !== productionProjectId) {
      throw new SafeScriptError("Production reports require the exact GCLOUD_PROJECT");
    }
    return { target, projectId: productionProjectId };
  }
  throw new SafeScriptError("S1_TARGET must be emulator or production");
}

export function reportCounters(data, today) {
  const queue = buildMemberMigrationQueue({ ...data, today });
  const normalizedIds = data.members.map((member) =>
    member.memberId.normalize("NFKC").trim().toUpperCase(),
  );
  const memberById = new Map(data.members.map((member) => [member.memberId, member]));
  const state = data.state;
  if (
    !state ||
    !["legacy-v1", "canonical-v1", "legacy-rollback-v1"].includes(state.readerVersion) ||
    !Number.isSafeInteger(state.rollbackEligibleStudentCount) ||
    state.rollbackEligibleStudentCount < 0 ||
    state.rollbackEligibleStudentCount > 400 ||
    state.rollbackCapacityLimit !== 400
  ) {
    throw new SafeScriptError("Missing or invalid directory state");
  }
  return {
    members: data.members.length,
    archiveRecords: data.records.length,
    decided: data.decidedMemberIds.size,
    ...Object.fromEntries(
      ["strong", "suggested", "ambiguous", "none"].map((category) => [
        category,
        queue.rows.filter((row) => row.category === category).length,
      ]),
    ),
    undated: queue.rows.filter((row) => row.isMinor === "unknown").length,
    invalidIdentifiers: data.members.filter((member) =>
      [member.membershipNumber, member.idCardNumber, member.vatNumber].some(
        (value) =>
          value !== undefined &&
          !/^[A-Z0-9][A-Z0-9 ./-]{0,63}$/.test(value.normalize("NFKC").trim().toUpperCase()),
      ),
    ).length,
    minorOrUndated: queue.rows.filter((row) => row.isMinor !== false).length,
    archiveOnly: queue.archiveOnly.length,
    invalidLegacyIds: normalizedIds.filter((id) => !/^[A-Z0-9][A-Z0-9 ./-]{0,63}$/.test(id)).length,
    legacyIdCaseCollisions: normalizedIds.length - new Set(normalizedIds).size,
    strongWithoutCentre: queue.rows.filter(
      (row) =>
        row.category === "strong" &&
        !["Town", "West"].includes(memberById.get(row.legacyMemberId)?.trainingCenter),
    ).length,
    readerVersion: state.readerVersion,
    rollbackEligibleStudentCount: state.rollbackEligibleStudentCount,
    rollbackCapacityLimit: state.rollbackCapacityLimit,
  };
}

export async function runReport(firestore, root, today) {
  const [members, records, decisions, officeLinks, memberLinks, state] = await Promise.all([
    ...[
      "members",
      "regyfitMemberRecords",
      "memberMigrationDecisions",
      "regyfitOfficeLinks",
      "regyfitMemberLinks",
    ].map((name) => firestore.collection(`${root}/${name}`).get()),
    firestore.doc(`${root}/memberDirectoryStates/current`).get(),
  ]);
  const parseDocuments = (snapshot, parse) => {
    const values = [];
    let unparsable = 0;
    for (const document of snapshot.docs) {
      const parsed = parse(document.data());
      if (parsed.ok) values.push(parsed.value);
      else unparsable += 1;
    }
    return { values, unparsable };
  };
  const parsedMembers = parseDocuments(members, parseMemberRecord);
  const parsedRecords = parseDocuments(records, parseStoredRegyfitMemberRecord);
  const counters = reportCounters(
    {
      members: parsedMembers.values,
      records: parsedRecords.values,
      decidedMemberIds: new Set(decisions.docs.map((document) => document.id)),
      linkedRecordIds: new Set(
        [...officeLinks.docs, ...memberLinks.docs].map((document) => document.id),
      ),
      state: state.data(),
    },
    today,
  );
  const output = {
    ...counters,
    members: members.docs.length,
    archiveRecords: records.docs.length,
    unparsableMembers: parsedMembers.unparsable,
    unparsableRecords: parsedRecords.unparsable,
  };
  for (const [key, value] of Object.entries(output)) console.log(`${key}: ${value}`);
  if (parsedMembers.unparsable > 0 || parsedRecords.unparsable > 0) {
    throw new SafeScriptError("Queue would fail: unparsable documents");
  }
}

async function main() {
  const academyId = process.env.S1_ACADEMY_ID?.trim();
  if (!academyId || academyId.includes("/")) throw new SafeScriptError("Invalid S1_ACADEMY_ID");
  const { projectId } = resolveTarget(process.env);
  const requireFromFunctions = createRequire(
    new URL("../../apps/functions/package.json", import.meta.url),
  );
  const { initializeApp } = requireFromFunctions("firebase-admin/app");
  const { getFirestore } = requireFromFunctions("firebase-admin/firestore");
  const firestore = getFirestore(initializeApp({ projectId }));
  await runReport(firestore, `academies/${academyId}`, new Date().toISOString().slice(0, 10));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.on("unhandledRejection", reportScriptError); // SDK retries can reject after main() settles
  main().catch(reportScriptError);
}
