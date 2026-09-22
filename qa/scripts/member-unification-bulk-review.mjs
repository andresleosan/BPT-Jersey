// Resolve, by rule, what the bulk migration left for review. Dry-run by default; counters only.
//
// 1. Queue: `none` rows → create-unlinked; `suggested` (same normalised name + birth date) and
//    strong-with-conflict rows → link, resolving each source conflict by policy:
//      · one side empty → the side with a value;
//      · email / mobile differ → the archive (later capture);
//      · full name differs only in case, accents or spacing → the archive spelling;
//      · identity fields really differ (name, birth date, gender, numbers) → left for the office.
// 2. Centres: every linked member still `trainingCenterStatus: "unconfirmed"` gets Town or West
//    inferred from its archive: plan label first ("strive"/"west" → West, "town" → Town), then
//    the majority of attended class names. No hint → left for Data review.
//
// Build first: node apps/functions/scripts/build-deploy-artifact.mjs
// usage (dry-run):
//   S1_ACADEMY_ID=<academyId> S1_TARGET=production GCLOUD_PROJECT=bptjersey-f5a25 \
//   S1_ACTOR_ID=<provisioned owner uid> node qa/scripts/member-unification-bulk-review.mjs
// apply: add BULK_REVIEW_APPLY=yes MEMBER_UNIFICATION_CONFIRMATION=member-unification-review-v1 and
//   MEMBER_DIRECTORY_IDENTITY_KEY_SECRET + MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET in the env.
// optional: BULK_REVIEW_SKIP_QUEUE=yes / BULK_REVIEW_SKIP_CENTRES=yes

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { reportScriptError, resolveTarget, SafeScriptError } from "./member-unification-s1-report.mjs";

const confirmationPhrase = "member-unification-review-v1";
const contactFields = new Set(["email", "mobileNumber"]);
const evidenceFor = {
  suggested: "Bulk review: same normalised full name and date of birth in census and archive (member-unification-review-v1).",
  strong: "Bulk review: single strong identifier match; source differences resolved by the documented policy (member-unification-review-v1).",
  none: "Bulk review: legacy census member with no archive record; created without a link (member-unification-review-v1).",
};

const normalizeName = (value) => String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Decide every conflicting field or return null when one needs a human. Pure. */
export function conflictChoices(legacy, archive, conflicts) {
  const choices = [];
  for (const field of conflicts) {
    const left = legacy[field];
    const right = archive[field];
    if (left === null || left === undefined) {
      choices.push({ field, source: "regyfit", evidence: "Census has no value; archive does.", reason: "Only source with a value" });
    } else if (right === null || right === undefined) {
      choices.push({ field, source: "legacy", evidence: "Archive has no value; census does.", reason: "Only source with a value" });
    } else if (contactFields.has(field)) {
      choices.push({ field, source: "regyfit", evidence: "Contact details differ; the archive is the later capture.", reason: "Later capture wins for contact fields" });
    } else if (field === "fullName" && normalizeName(left) === normalizeName(right)) {
      choices.push({ field, source: "regyfit", evidence: "Same name; only case, accents or spacing differ.", reason: "Archive spelling kept for a cosmetic difference" });
    } else {
      return null;
    }
  }
  return choices;
}

/** Town/West from an archive record, or undefined. Pure. */
export function inferCentre(record) {
  const centreOf = (text) => {
    const value = (text ?? "").toLowerCase();
    if (/\bwest\b|strive/u.test(value)) return "West";
    if (/\btown\b/u.test(value)) return "Town";
    return undefined;
  };
  const fromPlan = centreOf(record?.plan?.membershipPlan);
  if (fromPlan) return { centre: fromPlan, by: "plan" };
  const votes = { Town: 0, West: 0 };
  for (const item of record?.attendance?.records ?? []) {
    const centre = centreOf(item.className);
    if (centre) votes[centre] += 1;
  }
  if (votes.Town === votes.West) return undefined;
  return { centre: votes.Town > votes.West ? "Town" : "West", by: "attendance" };
}

export function planQueueDecisions({ queue, valuesFor }) {
  const planned = [];
  const left = { suggestedIdentityConflict: 0, strongIdentityConflict: 0, ambiguous: 0, suggestedSeveralCandidates: 0 };
  const leftFields = {};
  for (const row of queue.rows) {
    if (row.category === "none") {
      planned.push({ kind: "create-unlinked", legacyMemberId: row.legacyMemberId, requestId: randomUUID(), review: { legacyVersion: row.sourceVersion, identityEvidence: evidenceFor.none, choices: [] } });
      continue;
    }
    if (row.category === "ambiguous") {
      left.ambiguous += 1;
      continue;
    }
    if (row.candidates.length !== 1) {
      left.suggestedSeveralCandidates += 1;
      continue;
    }
    const candidate = row.candidates[0];
    const { legacy, archive } = valuesFor(row.legacyMemberId, candidate.recordId);
    const choices = conflictChoices(legacy, archive, candidate.conflicts);
    if (choices === null) {
      left[row.category === "strong" ? "strongIdentityConflict" : "suggestedIdentityConflict"] += 1;
      for (const field of candidate.conflicts) {
        if (legacy[field] != null && archive[field] != null && !contactFields.has(field)) leftFields[field] = (leftFields[field] ?? 0) + 1;
      }
      continue;
    }
    if (row.category === "strong" && choices.length === 0) continue; // the bulk migration's job, not ours
    planned.push({
      kind: "link", legacyMemberId: row.legacyMemberId, recordId: candidate.recordId, requestId: randomUUID(),
      review: { legacyVersion: row.sourceVersion, recordVersion: candidate.sourceVersion, identityEvidence: evidenceFor[row.category], choices },
    });
  }
  return { planned, left, leftFields };
}

async function loadArtifact() {
  const base = new URL("../../.firebase-functions/lib/src/members/", import.meta.url);
  const domain = new URL("../../.firebase-functions/lib/domain/members/", import.meta.url);
  try {
    const [migrationService, migrationStore, directoryService, directoryFirestore, contracts] = await Promise.all([
      import(new URL("member-migration-service.js", base)),
      import(new URL("member-migration-firestore.js", base)),
      import(new URL("canonical-member-directory-service.js", base)),
      import(new URL("member-directory-firestore.js", base)),
      import(new URL("member-migration-contracts.js", domain)),
    ]);
    return { migrationService, migrationStore, directoryService, directoryFirestore, contracts };
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
  const apply = env.BULK_REVIEW_APPLY === "yes";
  if (apply && env.MEMBER_UNIFICATION_CONFIRMATION !== confirmationPhrase) {
    throw new SafeScriptError("Apply requires MEMBER_UNIFICATION_CONFIRMATION=" + confirmationPhrase);
  }
  const identitySecret = env.MEMBER_DIRECTORY_IDENTITY_KEY_SECRET ?? "";
  const integritySecret = env.MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET ?? "";
  if (apply && (identitySecret.length === 0 || integritySecret.length === 0)) {
    throw new SafeScriptError("Apply requires both member directory secrets in the environment");
  }
  const skipQueue = env.BULK_REVIEW_SKIP_QUEUE === "yes";
  const skipCentres = env.BULK_REVIEW_SKIP_CENTRES === "yes";

  const { migrationService, migrationStore, directoryService, directoryFirestore, contracts } = await loadArtifact();
  const requireFromArtifact = createRequire(new URL("../../.firebase-functions/package.json", import.meta.url));
  const { initializeApp } = requireFromArtifact("firebase-admin/app");
  const { getFirestore } = requireFromArtifact("firebase-admin/firestore");
  const firestore = getFirestore(initializeApp({ projectId }));
  const actor = Object.freeze({ actorId, academyId, role: "owner", active: true, appCheckVerified: true });
  const store = migrationStore.createFirestoreMemberMigrationStore(firestore);
  const refuse = () => {
    throw new SafeScriptError("Dry-run must not write");
  };
  const writer = apply
    ? directoryService.createCanonicalMemberDirectoryService({
        firestore: directoryFirestore.createMemberDirectoryFirestoreAdapters(firestore).writer,
        projectId,
        identitySecretMaterial: identitySecret,
        identitySecretVersion: "identity-v1",
        integritySecretMaterial: integritySecret,
        integritySecretVersion: "integrity-v1",
      })
    : { registerLegacyMember: refuse, skipLegacyMember: refuse, reviewMember: refuse };
  const now = () => new Date().toISOString();
  const service = migrationService.createMemberMigrationService({ store, writer, now });
  console.log(`mode: ${apply ? "APPLY" : "dry-run"}`);

  // ---- 1. Queue ----
  if (!skipQueue) {
    const [queue, snapshot] = await Promise.all([service.listQueue(actor), store.load(academyId)]);
    const membersById = new Map(snapshot.members.map((member) => [member.memberId, member]));
    const recordsById = new Map(snapshot.records.map((record) => [record.recordId, record]));
    const plan = planQueueDecisions({
      queue,
      valuesFor: (memberId, recordId) => contracts.migrationIdentityValues(membersById.get(memberId), recordsById.get(recordId)),
    });
    const byKind = { link: 0, "create-unlinked": 0 };
    for (const decision of plan.planned) byKind[decision.kind] += 1;
    console.log(`queueRows: ${queue.rows.length}`);
    console.log(`queuePlannedLinks: ${byKind.link}`);
    console.log(`queuePlannedCreateUnlinked: ${byKind["create-unlinked"]}`);
    for (const [key, value] of Object.entries(plan.left)) console.log(`queueLeftForOffice_${key}: ${value}`);
    for (const [field, value] of Object.entries(plan.leftFields)) console.log(`queueLeftConflictField_${field}: ${value}`);
    if (apply) {
      const results = { applied: 0, rejected: {} };
      for (const decision of plan.planned) {
        // Non-strong rows must go one per call (the service's batch rule).
        const result = await service.decide(actor, { decisions: [decision] });
        for (const entry of result.results) {
          if (entry.status === "applied") results.applied += 1;
          else results.rejected[entry.code] = (results.rejected[entry.code] ?? 0) + 1;
        }
        if (results.applied % 20 === 0 && results.applied > 0) console.log(`progress: queue applied ${results.applied}`);
      }
      console.log(`queueApplied: ${results.applied}`);
      for (const [code, count] of Object.entries(results.rejected)) console.log(`queueRejected_${code}: ${count}`);
    }
  }

  // ---- 2. Centres ----
  if (!skipCentres) {
    const root = `academies/${academyId}`;
    const [decisions, students, records] = await Promise.all(
      ["memberMigrationDecisions", "students", "regyfitMemberRecords"].map((name) => firestore.collection(`${root}/${name}`).get()),
    );
    const recordByStudent = new Map();
    for (const document of decisions.docs) {
      const data = document.data();
      if (data.kind === "link" && data.studentId && data.recordId) recordByStudent.set(data.studentId, data.recordId);
    }
    const recordsById = new Map(records.docs.map((document) => [document.id, document.data()]));
    const planned = [];
    const counts = { unconfirmed: 0, byPlan: 0, byAttendance: 0, noArchive: 0, noHint: 0 };
    for (const document of students.docs) {
      if (document.get("trainingCenterStatus") !== "unconfirmed") continue;
      counts.unconfirmed += 1;
      const recordId = recordByStudent.get(document.id);
      const record = recordId ? recordsById.get(recordId) : undefined;
      if (!record) {
        counts.noArchive += 1;
        continue;
      }
      const inferred = inferCentre(record);
      if (!inferred) {
        counts.noHint += 1;
        continue;
      }
      counts[inferred.by === "plan" ? "byPlan" : "byAttendance"] += 1;
      planned.push({ studentId: document.id, trainingCenter: inferred.centre });
    }
    for (const [key, value] of Object.entries(counts)) console.log(`centres_${key}: ${value}`);
    console.log(`centresPlanned: ${planned.length}`);
    if (apply) {
      let applied = 0;
      let failed = 0;
      for (const item of planned) {
        try {
          await writer.reviewMember({ actor, value: { kind: "confirm-training-centre", studentId: item.studentId, requestId: randomUUID(), trainingCenter: item.trainingCenter }, now: now() });
          applied += 1;
          if (applied % 20 === 0) console.log(`progress: centres applied ${applied}`);
        } catch (error) {
          failed += 1;
          if (env.BPT_OPERATOR_DEBUG === "1") console.error(`centreFailed: ${error?.constructor?.name ?? "Error"}: ${String(error?.message ?? "").slice(0, 200)}`);
        }
      }
      console.log(`centresApplied: ${applied}`);
      console.log(`centresFailed: ${failed}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.on("unhandledRejection", reportScriptError);
  main().catch(reportScriptError);
}
