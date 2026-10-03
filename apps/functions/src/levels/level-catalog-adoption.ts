import { isCustomLevelSystemId } from "@bpt-jersey/domain/levels/editor";

import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { hashLevelCatalogValue, levelCatalogStorageId } from "./level-catalog-integrity.js";
import {
  catalogueContentHash,
  catalogueCorrelationId,
  levelCatalogAuditDraft,
  requirementDocument,
  type LevelEditorFirestore,
} from "./level-editor-service.js";

/**
 * One-off (2026-10-03): the active code catalogue (ibjjf-v3) becomes the academy's one editable
 * custom system. Techniques are unified per belt: the belt's own list wins; a belt with none takes
 * the union of its stripes' lists at the highest minimum. Then the pointer and every progress head
 * move to it and every other level system is deleted. Rerunning after success does nothing.
 */
type Data = Record<string, unknown>;
type Write = Readonly<{ path: string; data: Data }>;
type Batch = Readonly<{
  set: (reference: unknown, data: unknown) => void;
  delete: (reference: unknown) => void;
  commit: () => Promise<unknown>;
}>;
export type AdoptionFirestore = LevelEditorFirestore & Readonly<{ batch: () => Batch }>;

export type StripeChange = Readonly<{
  belt: string;
  stripe: string;
  added: readonly string[];
  removed: readonly string[];
}>;

export type AdoptionPlan = Readonly<{
  status: "ready" | "retire-only" | "already-adopted";
  academyId: string;
  generatedAt: string;
  fromSystemId: string;
  newSystemId: string;
  system: Data;
  definitions: readonly Write[];
  requirements: readonly Write[];
  retire: readonly string[];
  heads: number;
  stripeChanges: readonly StripeChange[];
  contentHash: string;
}>;

export type AdoptionResult = Readonly<{
  status: AdoptionPlan["status"];
  newSystemId: string;
  movedHeads: number;
  deletedDocuments: number;
}>;

const batchSize = 400;
const maxHeads = 450;

async function inBatches(
  firestore: AdoptionFirestore,
  items: readonly ((batch: Batch) => void)[],
): Promise<void> {
  for (let start = 0; start < items.length; start += batchSize) {
    const batch = firestore.batch();
    for (const item of items.slice(start, start + batchSize)) item(batch);
    await batch.commit();
  }
}

export async function planLevelCatalogAdoption(
  firestore: AdoptionFirestore,
  { academyId, generatedAt }: { academyId: string; generatedAt: string },
): Promise<AdoptionPlan> {
  const base = `academies/${academyId}`;
  const [state, systems, heads] = await Promise.all([
    firestore.runTransaction((transaction) =>
      transaction.get(firestore.doc(`${base}/levelCatalogState/active`)),
    ),
    firestore.collection(`${base}/levelSystems`).get(),
    firestore.collection(`${base}/studentLevelProgress`).where("academyId", "==", academyId).get(),
  ]);
  const fromSystemId = String(state.data()?.activeSystemId ?? "");
  const others = systems.docs.map((document) => document.id).filter((id) => id !== fromSystemId);
  const empty = {
    academyId,
    generatedAt,
    fromSystemId,
    newSystemId: fromSystemId,
    system: {},
    definitions: [],
    requirements: [],
    retire: others,
    heads: heads.docs.length,
    stripeChanges: [],
  };
  if (isCustomLevelSystemId(fromSystemId)) {
    const status = others.length === 0 ? "already-adopted" : "retire-only";
    return { ...empty, status, contentHash: hashLevelCatalogValue({ ...empty, status }) };
  }
  const source = systems.docs.find((document) => document.id === fromSystemId)?.data();
  if (source === undefined) throw new Error("Active level system is missing.");

  const day = generatedAt.slice(0, 10).replaceAll("-", "");
  let n = 1;
  while (systems.docs.some((document) => document.id === `bpt-${day}-${n}`)) n += 1;
  const newSystemId = `bpt-${day}-${n}`;

  const [definitionsSnapshot, requirementsSnapshot] = await Promise.all([
    firestore.collection(`${base}/levelDefinitions`).where("systemId", "==", fromSystemId).get(),
    firestore.collection(`${base}/levelRequirements`).where("systemId", "==", fromSystemId).get(),
  ]);
  const sourceDefinitions = definitionsSnapshot.docs
    .map((document) => document.data())
    .filter((data) => data.academyId === academyId);
  const definitionKeys = new Set(sourceDefinitions.map((data) => String(data.definitionKey)));
  const stranded = heads.docs.filter(
    (document) => !definitionKeys.has(String(document.data().currentDefinitionKey ?? "")),
  );
  if (stranded.length > 0) {
    throw new Error(`${stranded.length} progress heads hold levels the active system lacks.`);
  }
  if (heads.docs.length > maxHeads) throw new Error("Too many progress heads for one adoption.");

  const ratings = new Map<string, Map<string, number>>();
  for (const document of requirementsSnapshot.docs) {
    const data = document.data();
    if (data.academyId !== academyId) continue;
    const list = ratings.get(String(data.definitionKey)) ?? new Map<string, number>();
    list.set(String(data.skillKey), Number(data.minimumRating));
    ratings.set(String(data.definitionKey), list);
  }
  const belts = sourceDefinitions.filter((data) => data.kind !== "stripe");
  const stripesOf = (beltKey: string) =>
    sourceDefinitions.filter(
      (data) => data.kind === "stripe" && data.parentDefinitionKey === beltKey,
    );
  const requirements: Write[] = [];
  const stripeChanges: StripeChange[] = [];
  for (const belt of belts) {
    const beltKey = String(belt.definitionKey);
    let unified = ratings.get(beltKey) ?? new Map<string, number>();
    if (unified.size === 0) {
      unified = new Map();
      for (const stripe of stripesOf(beltKey)) {
        for (const [skill, rating] of ratings.get(String(stripe.definitionKey)) ?? []) {
          unified.set(skill, Math.max(rating, unified.get(skill) ?? 0));
        }
      }
    }
    for (const level of [belt, ...stripesOf(beltKey)]) {
      const key = String(level.definitionKey);
      if (level !== belt) {
        const had = ratings.get(key) ?? new Map<string, number>();
        const added = [...unified.keys()].filter((skill) => !had.has(skill)).sort();
        const removed = [...had.keys()].filter((skill) => !unified.has(skill)).sort();
        if (added.length > 0 || removed.length > 0) {
          stripeChanges.push({
            belt: String(belt.name),
            stripe: String(level.name),
            added,
            removed,
          });
        }
      }
      for (const [skill, rating] of unified) {
        requirements.push({
          path: `${base}/levelRequirements/${levelCatalogStorageId(newSystemId, `${key}__${skill}`)}`,
          data: requirementDocument(academyId, newSystemId, key, skill, rating, undefined),
        });
      }
    }
  }
  const definitions: Write[] = sourceDefinitions.map((data) => ({
    path: `${base}/levelDefinitions/${levelCatalogStorageId(newSystemId, String(data.definitionKey))}`,
    data: { ...data, systemId: newSystemId, academyId },
  }));
  const idOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  const system: Data = {
    ...source,
    systemId: newSystemId,
    academyId,
    origin: "custom",
    status: "published",
    publishedAt: generatedAt,
    updatedAt: generatedAt,
  };
  delete system.manifestId;
  const contentHash = catalogueContentHash(
    newSystemId,
    system,
    definitions.map((write) => ({ id: idOf(write.path), data: write.data })),
    requirements.map((write) => ({ id: idOf(write.path), data: write.data })),
  );
  system.contentHash = contentHash;
  system.sourceHash = contentHash;
  return {
    ...empty,
    status: "ready",
    newSystemId,
    system,
    definitions,
    requirements,
    retire: systems.docs.map((document) => document.id).filter((id) => id !== newSystemId),
    stripeChanges,
    contentHash,
  };
}

export function expectedAdoptionConfirmation(plan: AdoptionPlan): string {
  // Pins the systems to delete and the head count too, not only the catalogue content.
  const pinned = hashLevelCatalogValue({
    contentHash: plan.contentHash,
    retire: plan.retire,
    heads: plan.heads,
  });
  return `ADOPT-${plan.academyId}-${plan.newSystemId}-${pinned.slice(0, 12)}`;
}

export async function applyLevelCatalogAdoption(
  firestore: AdoptionFirestore,
  plan: AdoptionPlan,
  { actorId, confirmation }: { actorId: string; confirmation: string },
): Promise<AdoptionResult> {
  if (confirmation !== expectedAdoptionConfirmation(plan)) {
    throw new Error("The exact dry-run confirmation is required.");
  }
  const base = `academies/${plan.academyId}`;
  let movedHeads = 0;
  if (plan.status === "ready") {
    await inBatches(
      firestore,
      [...plan.definitions, ...plan.requirements].map(
        (write) => (batch) => batch.set(firestore.doc(write.path), write.data),
      ),
    );
    await inBatches(firestore, [
      (batch) =>
        batch.set(firestore.doc(`${base}/levelSystems/${plan.newSystemId}`), {
          ...plan.system,
          publishedBy: actorId,
          updatedBy: actorId,
        }),
    ]);
    movedHeads = await firestore.runTransaction(async (transaction) => {
      const stateRef = firestore.doc(`${base}/levelCatalogState/active`);
      const [state, heads] = await Promise.all([
        transaction.get(stateRef),
        transaction.get(
          firestore
            .collection(`${base}/studentLevelProgress`)
            .where("academyId", "==", plan.academyId),
        ),
      ]);
      if (state.data()?.activeSystemId !== plan.fromSystemId) {
        throw new Error("The active level system changed since the dry-run.");
      }
      const operationId = `adopt-${plan.newSystemId}`;
      const audit = levelCatalogAuditDraft({
        academyId: plan.academyId,
        actorId,
        action: "level.catalog.activated",
        targetRef: `${base}/levelSystems/${plan.newSystemId}`,
        purpose: "level-catalog-maintenance",
        correlationId: catalogueCorrelationId(
          "level.catalog.activated",
          plan.academyId,
          plan.newSystemId,
          operationId,
        ),
        fromSystemId: plan.fromSystemId,
        toSystemId: plan.newSystemId,
      });
      transaction.set(stateRef, {
        academyId: plan.academyId,
        activeSystemId: plan.newSystemId,
        previousSystemId: plan.fromSystemId,
        operationId,
        contentHash: plan.contentHash,
        activatedAt: plan.generatedAt,
        activatedBy: actorId,
        schemaVersion: "1",
      });
      transaction.set(firestore.doc(`${base}/levelCatalogActivations/${operationId}`), {
        academyId: plan.academyId,
        fromSystemId: plan.fromSystemId,
        toSystemId: plan.newSystemId,
        operationId,
        contentHash: plan.contentHash,
        actorId,
        activatedAt: plan.generatedAt,
        movedStudents: heads.docs.length,
        schemaVersion: "1",
      });
      // Only the version pointer changes: the held level and its start date stay as they are.
      for (const head of heads.docs) {
        transaction.set(head.ref, { systemId: plan.newSystemId }, { merge: true });
      }
      appendAuditEventInTransaction(
        transaction,
        firestore.doc(`${base}/auditEvents/audit-${audit.correlationId}`),
        audit,
      );
      return heads.docs.length;
    });
  }

  if (plan.status === "already-adopted") {
    return {
      status: plan.status,
      newSystemId: plan.newSystemId,
      movedHeads: 0,
      deletedDocuments: 0,
    };
  }
  const heads = await firestore
    .collection(`${base}/studentLevelProgress`)
    .where("academyId", "==", plan.academyId)
    .get();
  if (heads.docs.some((head) => head.data().systemId !== plan.newSystemId)) {
    throw new Error("A progress head still points at an old level system; nothing was deleted.");
  }
  const deletions: ((batch: Batch) => void)[] = [];
  for (const systemId of plan.retire) {
    const [definitions, requirements] = await Promise.all([
      firestore.collection(`${base}/levelDefinitions`).where("systemId", "==", systemId).get(),
      firestore.collection(`${base}/levelRequirements`).where("systemId", "==", systemId).get(),
    ]);
    for (const document of [...definitions.docs, ...requirements.docs]) {
      if (document.data().academyId === plan.academyId) {
        deletions.push((batch) => batch.delete(document.ref));
      }
    }
    deletions.push((batch) =>
      batch.delete(firestore.doc(`${base}/levelCatalogManifests/${systemId}`)),
    );
    deletions.push((batch) => batch.delete(firestore.doc(`${base}/levelSystems/${systemId}`)));
  }
  await inBatches(firestore, deletions);
  return {
    status: plan.status,
    newSystemId: plan.newSystemId,
    movedHeads,
    deletedDocuments: deletions.length,
  };
}
