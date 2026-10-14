#!/usr/bin/env node
// E4 back-fill: members who already had special access before the level move existed are moved
// to their reference-age ladder, exactly as saveStudentGroupAccess now does on save. Dry-run by
// default; only `--apply --actor-id=<owner uid>` writes. Needs the built artifact
// (node apps/functions/scripts/build-deploy-artifact.mjs) and GCLOUD_PROJECT.
//   GCLOUD_PROJECT=bptjersey-f5a25 node apps/functions/scripts/apply-special-access-ladder.mjs [--academy-id=demo-academy] [--apply --actor-id=<uid>]

import { createRequire } from "node:module";

const args = process.argv.slice(2);
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = args.includes("--apply");
const academyId = option("academy-id") ?? "demo-academy";
const actorId = option("actor-id");
const projectId = process.env.GCLOUD_PROJECT;
if (!projectId) throw new Error("Set GCLOUD_PROJECT.");
if (apply && !actorId) throw new Error("--apply needs --actor-id=<owner uid>.");

const lib = "../../../.firebase-functions/lib/src/levels/";
const domain = "../../../.firebase-functions/lib/domain/";
const { ladderEquivalent } = await import(`${domain}levels/level-progress.js`);
const { parseEffectiveStudentProfileAt } = await import(`${domain}profiles/profile-contracts.js`);
const { dateKeyInJersey, storedReferenceAge } = await import(`${domain}schedule/member-calendar-contracts.js`);
const artifactRequire = createRequire(new URL(`${lib}level-service.js`, import.meta.url));
const firebaseApp = artifactRequire("firebase-admin/app");
const app = firebaseApp.initializeApp({ projectId });
const db = artifactRequire("firebase-admin/firestore").getFirestore(app);
const { createLevelCatalogStore, realAgeOf, referencePrograms } = await import(`${lib}level-service.js`);
// Same write as the save path; without `level` the head keeps its start date and counters.
const { writeOwnerSetLevel } = await import(`${lib}progress-management-callables.js`);

try {
  const now = new Date().toISOString();
  const today = dateKeyInJersey(new Date(now));
  const base = `academies/${academyId}`;
  const [accessDocs, programs, catalog] = await Promise.all([
    db.collection(`${base}/studentGroupAccess`).get(),
    referencePrograms(db, academyId),
    createLevelCatalogStore({ firestore: db }).listPublished(academyId),
  ]);
  const nameOf = (key) => catalog.definitions.find((d) => d.definitionKey === key)?.name ?? key;
  let moves = 0;
  for (const access of accessDocs.docs) {
    const studentId = access.id;
    const [student, head] = await db.getAll(
      db.doc(`${base}/students/${studentId}`),
      db.doc(`${base}/studentLevelProgress/${studentId}`),
    );
    const id = studentId.slice(0, 8);
    if (head.get("academyId") !== academyId || head.get("state") !== "initialized") {
      console.log(`${id}  skipped: level not initialized`);
      continue;
    }
    const profile = parseEffectiveStudentProfileAt(student.data(), today);
    const real = realAgeOf(profile.ok ? profile.value.dateOfBirth : undefined, now);
    const ref = storedReferenceAge(access.data(), academyId, studentId, real, programs, today);
    const from = String(head.get("currentDefinitionKey"));
    const target = ref === null ? null : ladderEquivalent(catalog.definitions, from, ref, real);
    console.log(`${id}  age ${real ?? "-"}  ref ${ref ?? "-"}  ${nameOf(from)} -> ${target ? target.name : "no move"}`);
    if (!target) continue;
    moves += 1;
    if (!apply) continue;
    try {
      await writeOwnerSetLevel(db, {
        office: { userId: actorId, academyId, name: actorId, role: "owner" },
        studentId, target, systemId: catalog.system.systemId,
        note: `Special access: measured as age ${ref}`, now, fromDefinitionKey: from,
      });
      console.log(`${id}  moved`);
    } catch (error) {
      console.log(`${id}  not moved: ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(`${apply ? "apply" : "dry-run"}: ${accessDocs.size} with access, ${moves} to move`);
} finally {
  await firebaseApp.deleteApp(app);
}
