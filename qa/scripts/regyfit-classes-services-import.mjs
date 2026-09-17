// Imports the Regyfit Classes / Services capture (types + scheduled classes) into Firestore.
//
// usage (dry run prints the plan, writes nothing):
//   REGYFIT_CAPTURE_DIR=/root/regyfit-capture/data \
//   REGYFIT_ACADEMY_ID=<academyId> \
//   REGYFIT_IMPORT_TARGET=emulator|production \
//   [REGYFIT_IMPORT_FROM=2026-09-14 REGYFIT_IMPORT_TO=2026-09-20] \
//   [REGYFIT_IMPORT_NOW=2026-09-17T12:00:00.000Z] \
//   [REGYFIT_IMPORT_APPLY=true] \
//   node qa/scripts/regyfit-classes-services-import.mjs
//
// Production additionally requires GCLOUD_PROJECT=bptjersey-f5a25 and
// REGYFIT_OPERATOR_CONFIRMATION=classes-services-types-sessions-production-v1, and is run only
// after the operator confirms in chat. The capture must stay outside the repository.
//
// Every run (dry run included) first reads the target read-only: types and locations that already
// exist are linked by name instead of written again, and the JSON line reports what is there.
//
// Apply is create-only: a document that already exists at a planned path is skipped, so a rerun
// never modifies existing documents (admin edits survive). The JSON line reports `created` and
// `skippedExisting`.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";

import { planImport, resolveTarget } from "./regyfit-classes-services-map.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const syntheticFixture = resolve(repositoryRoot, "qa/fixtures/regyfit-classes-services-synthetic");
const requireFromFunctions = createRequire(join(repositoryRoot, "apps/functions/package.json"));
const { getApps, initializeApp } = requireFromFunctions("firebase-admin/app");
const { getFirestore } = requireFromFunctions("firebase-admin/firestore");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment: ${name}`);
  return value;
}

function optionalDate(name) {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error(`${name} must be YYYY-MM-DD`);
  return value;
}

// Past classes are imported as completed relative to this instant; tests pin it.
function importNow() {
  const value = process.env.REGYFIT_IMPORT_NOW?.trim();
  if (!value) return new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new Error("REGYFIT_IMPORT_NOW must be an ISO instant like 2026-09-17T12:00:00.000Z");
  }
  return value;
}

function captureDirectory() {
  const directory = resolve(required("REGYFIT_CAPTURE_DIR"));
  const inside = !relative(repositoryRoot, directory).startsWith("..");
  if (inside && directory !== syntheticFixture) {
    throw new Error("The real capture must stay outside the repository");
  }
  return directory;
}

async function main() {
  const { target, projectId } = resolveTarget(process.env);
  const academyId = required("REGYFIT_ACADEMY_ID");
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/u.test(academyId)) {
    throw new Error("REGYFIT_ACADEMY_ID must be a lowercase slug");
  }
  const directory = captureDirectory();
  const read = (file) => JSON.parse(readFileSync(join(directory, file), "utf8"));
  const firestore = getFirestore(getApps()[0] ?? initializeApp({ projectId }));
  const academy = `academies/${academyId}`;
  const [existingPrograms, existingLocations, existingSessions] = await Promise.all(
    ["programs", "locations", "sessions"].map((name) =>
      firestore.collection(`${academy}/${name}`).get(),
    ),
  );
  const idsByName = (snapshot, idField) =>
    new Map(snapshot.docs.map((doc) => [doc.get("name"), doc.get(idField) ?? doc.id]));
  const plan = planImport(
    { types: read("class-service-types.json"), rows: read("scheduled-classes-list.json").rows },
    {
      academyId,
      now: importNow(),
      timezone: "Europe/Jersey",
      from: optionalDate("REGYFIT_IMPORT_FROM"),
      to: optionalDate("REGYFIT_IMPORT_TO"),
      existingProgramIdsByName: idsByName(existingPrograms, "programId"),
      existingLocationIdsByName: idsByName(existingLocations, "locationId"),
    },
  );
  const applied = process.env.REGYFIT_IMPORT_APPLY === "true";
  let created = 0;
  let skippedExisting = 0;

  if (applied) {
    const writes = [
      ...plan.programs.map((doc) => [`academies/${academyId}/programs/${doc.programId}`, doc]),
      ...plan.sessions.map((doc) => [`academies/${academyId}/sessions/${doc.sessionId}`, doc]),
    ];
    // Deterministic ids and create-only writes: a rerun neither duplicates nor overwrites.
    for (let index = 0; index < writes.length; index += 400) {
      const chunk = writes.slice(index, index + 400);
      const snapshots = await firestore.getAll(...chunk.map(([path]) => firestore.doc(path)));
      const batch = firestore.batch();
      chunk.forEach(([path, doc], position) => {
        if (snapshots[position].exists) {
          skippedExisting += 1;
        } else {
          batch.create(firestore.doc(path), doc);
          created += 1;
        }
      });
      await batch.commit();
    }
  }

  console.log(
    JSON.stringify({
      target,
      projectId,
      academyId,
      applied,
      before: {
        programs: existingPrograms.size,
        locations: existingLocations.size,
        sessions: existingSessions.size,
        importedSessions: existingSessions.docs.filter(
          (doc) => doc.get("createdBy") === "regyfit-import",
        ).length,
      },
      created,
      skippedExisting,
      programsToCreate: plan.programs.length,
      reusedPrograms: plan.reusedPrograms,
      sessions: plan.sessions.length,
      outsideWindow: plan.outsideWindow,
      duplicates: plan.duplicates,
      withoutTrainer: plan.withoutTrainer,
      trainers: plan.trainers,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
