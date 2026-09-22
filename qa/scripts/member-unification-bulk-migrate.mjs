// Bulk migration of legacy members into the canonical directory through the existing, audited
// migration decision service. Dry-run by default; output is counters only.
//
// What it decides: every queue row whose match is `strong` with zero identity conflicts → `link`.
// Suggested, ambiguous, conflicting and unmatched rows are left for Data review. The centre is
// left unconfirmed (placeholder + `trainingCenterStatus: "unconfirmed"`, no booking) unless
// BULK_MIGRATE_USE_LEGACY_CENTRE=yes and the legacy census already says Town or West.
//
// Build first (from the repo root):
//   node apps/functions/scripts/build-deploy-artifact.mjs
// usage (dry-run):
//   S1_ACADEMY_ID=<academyId> S1_TARGET=production GCLOUD_PROJECT=bptjersey-f5a25 \
//   S1_ACTOR_ID=<provisioned owner uid> node qa/scripts/member-unification-bulk-migrate.mjs
// apply: add BULK_MIGRATE_APPLY=yes MEMBER_UNIFICATION_CONFIRMATION=member-unification-bulk-v1 and
//   MEMBER_DIRECTORY_IDENTITY_KEY_SECRET + MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET in the env.
// optional: BULK_MIGRATE_WAVES=1,2,3 (default all, applied in that order) BULK_MIGRATE_LIMIT=<n>

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { reportScriptError, resolveTarget, SafeScriptError } from "./member-unification-s1-report.mjs";
import { waveOf } from "./member-unification-plan-breakdown.mjs";

const confirmationPhrase = "member-unification-bulk-v1";
const batchSize = 50;
const identityEvidence =
  "Bulk migration: single strong identifier match with no identity conflicts (member-unification-bulk-v1).";

export function legacyCentre(value) {
  const centre = (value ?? "").trim().toLowerCase();
  return centre === "town" ? "Town" : centre === "west" ? "West" : undefined;
}

/**
 * Plan the bulk decisions from a queue response plus the archive records (for the wave) and the
 * legacy census (for a known centre). Pure: no I/O, so it can be self-checked.
 */
export function planBulkDecisions({ queue, recordsById, membersById, today, waves, limit, useLegacyCentre }) {
  const planned = [];
  const skipped = { suggested: 0, ambiguous: 0, none: 0, strongWithConflicts: 0, outsideWaves: 0 };
  for (const row of queue.rows) {
    if (row.category !== "strong") {
      skipped[row.category] += 1;
      continue;
    }
    const candidate = row.candidates[0];
    if (row.candidates.length !== 1 || candidate.conflicts.length > 0) {
      skipped.strongWithConflicts += 1;
      continue;
    }
    const record = recordsById.get(candidate.recordId);
    const wave = record ? waveOf(record, today) : 3;
    if (!waves.includes(wave)) {
      skipped.outsideWaves += 1;
      continue;
    }
    const centre = useLegacyCentre ? legacyCentre(membersById.get(row.legacyMemberId)?.trainingCenter) : undefined;
    planned.push({
      wave,
      decision: {
        kind: "link",
        legacyMemberId: row.legacyMemberId,
        recordId: candidate.recordId,
        requestId: randomUUID(),
        review: {
          legacyVersion: row.sourceVersion,
          recordVersion: candidate.sourceVersion,
          identityEvidence,
          choices: [],
        },
        ...(centre ? { trainingCenter: centre } : {}),
      },
    });
  }
  planned.sort((a, b) => a.wave - b.wave);
  return { planned: limit === undefined ? planned : planned.slice(0, limit), skipped };
}

function counters(plan) {
  const byWave = { 1: 0, 2: 0, 3: 0 };
  let centreKnown = 0;
  for (const item of plan.planned) {
    byWave[item.wave] += 1;
    if (item.decision.trainingCenter) centreKnown += 1;
  }
  return {
    plannedLinks: plan.planned.length,
    plannedWave1: byWave[1],
    plannedWave2: byWave[2],
    plannedWave3: byWave[3],
    plannedWithCentre: centreKnown,
    plannedCentreUnconfirmed: plan.planned.length - centreKnown,
    leftForReview_suggested: plan.skipped.suggested,
    leftForReview_ambiguous: plan.skipped.ambiguous,
    leftForReview_none: plan.skipped.none,
    leftForReview_strongWithConflicts: plan.skipped.strongWithConflicts,
    outsideSelectedWaves: plan.skipped.outsideWaves,
  };
}

async function loadArtifact() {
  const base = new URL("../../.firebase-functions/lib/src/members/", import.meta.url);
  try {
    const [migrationService, migrationStore, directoryService, directoryFirestore] = await Promise.all([
      import(new URL("member-migration-service.js", base)),
      import(new URL("member-migration-firestore.js", base)),
      import(new URL("canonical-member-directory-service.js", base)),
      import(new URL("member-directory-firestore.js", base)),
    ]);
    return { migrationService, migrationStore, directoryService, directoryFirestore };
  } catch {
    throw new SafeScriptError("Deploy artifact missing: run node apps/functions/scripts/build-deploy-artifact.mjs first");
  }
}

async function main() {
  const env = process.env;
  const academyId = env.S1_ACADEMY_ID?.trim();
  if (!academyId || academyId.includes("/")) throw new SafeScriptError("Invalid S1_ACADEMY_ID");
  const actorId = env.S1_ACTOR_ID?.trim();
  if (!actorId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(actorId)) throw new SafeScriptError("Invalid S1_ACTOR_ID");
  const { projectId } = resolveTarget(env);
  const apply = env.BULK_MIGRATE_APPLY === "yes";
  if (apply && env.MEMBER_UNIFICATION_CONFIRMATION !== confirmationPhrase) {
    throw new SafeScriptError("Apply requires MEMBER_UNIFICATION_CONFIRMATION=" + confirmationPhrase);
  }
  const identitySecret = env.MEMBER_DIRECTORY_IDENTITY_KEY_SECRET ?? "";
  const integritySecret = env.MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET ?? "";
  if (apply && (identitySecret.length === 0 || integritySecret.length === 0)) {
    throw new SafeScriptError("Apply requires both member directory secrets in the environment");
  }
  const waves = (env.BULK_MIGRATE_WAVES ?? "1,2,3").split(",").map(Number);
  if (waves.some((wave) => ![1, 2, 3].includes(wave))) throw new SafeScriptError("BULK_MIGRATE_WAVES must list 1, 2 or 3");
  const limit = env.BULK_MIGRATE_LIMIT === undefined ? undefined : Number(env.BULK_MIGRATE_LIMIT);
  if (limit !== undefined && !(Number.isSafeInteger(limit) && limit > 0)) throw new SafeScriptError("Invalid BULK_MIGRATE_LIMIT");
  const useLegacyCentre = env.BULK_MIGRATE_USE_LEGACY_CENTRE === "yes";

  const { migrationService, migrationStore, directoryService, directoryFirestore } = await loadArtifact();
  const requireFromArtifact = createRequire(new URL("../../.firebase-functions/package.json", import.meta.url));
  const { initializeApp } = requireFromArtifact("firebase-admin/app");
  const { getFirestore } = requireFromArtifact("firebase-admin/firestore");
  const firestore = getFirestore(initializeApp({ projectId }));
  const actor = Object.freeze({ actorId, academyId, role: "owner", active: true, appCheckVerified: true });
  const store = migrationStore.createFirestoreMemberMigrationStore(firestore);
  const writer = directoryService.createCanonicalMemberDirectoryService({
    firestore: directoryFirestore.createMemberDirectoryFirestoreAdapters(firestore).writer,
    projectId,
    identitySecretMaterial: identitySecret || "dry-run",
    identitySecretVersion: "identity-v1",
    integritySecretMaterial: integritySecret || "dry-run",
    integritySecretVersion: "integrity-v1",
  });
  const service = migrationService.createMemberMigrationService({ store, writer, now: () => new Date().toISOString() });
  const today = new Date().toISOString().slice(0, 10);

  const [queue, snapshot] = await Promise.all([service.listQueue(actor), store.load(academyId)]);
  const plan = planBulkDecisions({
    queue,
    recordsById: new Map(snapshot.records.map((record) => [record.recordId, record])),
    membersById: new Map(snapshot.members.map((member) => [member.memberId, member])),
    today,
    waves,
    limit,
    useLegacyCentre,
  });
  console.log(`mode: ${apply ? "APPLY" : "dry-run"}`);
  console.log(`queueRows: ${queue.rows.length}`);
  console.log(`alreadyDecided: ${queue.decided}`);
  console.log(`archiveOnly: ${queue.archiveOnly}`);
  for (const [key, value] of Object.entries(counters(plan))) console.log(`${key}: ${value}`);
  if (!apply) return;

  const results = { applied: 0, rejected: {} };
  for (let index = 0; index < plan.planned.length; index += batchSize) {
    const decisions = plan.planned.slice(index, index + batchSize).map((item) => item.decision);
    const result = await service.decide(actor, { decisions });
    for (const entry of result.results) {
      if (entry.status === "applied") results.applied += 1;
      else results.rejected[entry.code] = (results.rejected[entry.code] ?? 0) + 1;
    }
    console.log(`batch ${Math.floor(index / batchSize) + 1}: applied so far ${results.applied}`);
  }
  console.log(`applied: ${results.applied}`);
  for (const [code, count] of Object.entries(results.rejected)) console.log(`rejected_${code}: ${count}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.on("unhandledRejection", reportScriptError);
  main().catch(reportScriptError);
}
