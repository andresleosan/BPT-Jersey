import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { hashLevelCatalogValue } from "./level-catalog-integrity.js";
import {
  catalogueContentHash,
  catalogueCorrelationId,
  levelCatalogAuditDraft,
  type LevelEditorFirestore,
} from "./level-editor-service.js";

/**
 * One-off (2026-10-03): the active editable catalogue follows the academy's rules PDF. Kids 7-10
 * belts lose their 7th and 8th stripes (heads there move to the 6th, keeping their start date), the
 * teens and adult white belts and the adult white stripes 2-4 get the PDF's classes and time, and
 * every sequence is renumbered 1..n so the engine's `sequence + 1` still finds the next level.
 * Stored stripes may carry `stripeNumber: null`; a stripe's number is then its position under the
 * belt. Rerunning after success plans nothing.
 */
type Data = Record<string, unknown>;
type Write = Readonly<{ path: string; data: Data }>;
type Batch = Readonly<{
  set: (reference: unknown, data: unknown, options?: { merge: boolean }) => void;
  delete: (reference: unknown) => void;
  commit: () => Promise<unknown>;
}>;
export type AlignmentFirestore = LevelEditorFirestore & Readonly<{ batch: () => Batch }>;

type MinimumTime = Readonly<{ years: number; months: number; days: number }>;

export type HeadMove = Readonly<{
  path: string;
  studentId: string;
  fromDefinitionKey: string;
  toDefinitionKey: string;
}>;

export type AlignmentPlan = Readonly<{
  status: "ready" | "blocked" | "already-aligned";
  academyId: string;
  generatedAt: string;
  systemId: string;
  expectedUpdatedAt: string;
  updates: readonly Write[];
  deletes: readonly string[];
  headMoves: readonly HeadMove[];
  blockers: readonly string[];
  system: Data;
  contentHash: string;
  summary: readonly string[];
}>;

export type AlignmentResult = Readonly<{ updated: number; deleted: number; movedHeads: number }>;

const batchSize = 400;
const kidsBeltMarker = "7-8 and 8-10";
const teensWhiteBelt = "white belt teens 10-12 and 13-15 yo";
const adultWhiteBelt = "white belt";
const removedStripeNumbers = [7, 8];
const fallbackStripeNumber = 6;
const pdfCriteria = {
  teensWhite: { minClasses: 6, minimumTime: { years: 0, months: 1, days: 15 } },
  adultWhite: { minClasses: 20, minimumTime: { years: 0, months: 2, days: 0 } },
  adultWhiteStripes: { minClasses: 25, minimumTime: { years: 0, months: 3, days: 0 } },
} as const;
const adultWhiteStripeNumbers = [2, 3, 4];

function isRecord(value: unknown): value is Data {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalized(name: unknown): string {
  return String(name ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function sequenceOf(data: Data): number {
  return typeof data.sequence === "number" ? data.sequence : 0;
}

function describeCriteria(criteria: unknown): string {
  const value = isRecord(criteria) ? criteria : {};
  const classes = typeof value.minClasses === "number" ? value.minClasses : "-";
  const time = isRecord(value.minimumTime) ? value.minimumTime : null;
  const days =
    time === null
      ? "-"
      : Number(time.years ?? 0) * 365 + Number(time.months ?? 0) * 30 + Number(time.days ?? 0);
  return `${classes} classes/${days} days`;
}

async function inBatches(
  firestore: AlignmentFirestore,
  items: readonly ((batch: Batch) => void)[],
): Promise<void> {
  for (let start = 0; start < items.length; start += batchSize) {
    const batch = firestore.batch();
    for (const item of items.slice(start, start + batchSize)) item(batch);
    await batch.commit();
  }
}

export async function planPdfAlignment(
  firestore: AlignmentFirestore,
  { academyId, generatedAt }: { academyId: string; generatedAt: string },
): Promise<AlignmentPlan> {
  const base = `academies/${academyId}`;
  const state = await firestore.runTransaction((transaction) =>
    transaction.get(firestore.doc(`${base}/levelCatalogState/active`)),
  );
  const systemId = String(state.data()?.activeSystemId ?? "");
  if (systemId.length === 0) throw new Error("No active level system.");
  const [systemSnapshot, definitionsSnapshot, requirementsSnapshot, heads, promotions] =
    await Promise.all([
      firestore.runTransaction((transaction) =>
        transaction.get(firestore.doc(`${base}/levelSystems/${systemId}`)),
      ),
      firestore.collection(`${base}/levelDefinitions`).where("systemId", "==", systemId).get(),
      firestore.collection(`${base}/levelRequirements`).where("systemId", "==", systemId).get(),
      firestore
        .collection(`${base}/studentLevelProgress`)
        .where("academyId", "==", academyId)
        .get(),
      firestore.collection(`${base}/levelPromotions`).get(),
    ]);
  const source = systemSnapshot.data();
  if (!systemSnapshot.exists || source === undefined || source.academyId !== academyId) {
    throw new Error("Active level system is missing.");
  }
  const definitions = definitionsSnapshot.docs
    .filter((document) => document.data().academyId === academyId)
    .map((document) => ({ id: document.id, data: document.data() }))
    .sort((left, right) => sequenceOf(left.data) - sequenceOf(right.data));
  const requirements = requirementsSnapshot.docs
    .filter((document) => document.data().academyId === academyId)
    .map((document) => ({ id: document.id, data: document.data() }));

  const blockers: string[] = [];
  const summary: string[] = [];
  const belts = definitions.filter((definition) => definition.data.kind !== "stripe");
  /** Stripes of a belt by number: the stored `stripeNumber`, else the position under the belt. */
  const stripesOf = (beltKey: unknown) => {
    const byNumber = new Map<number, (typeof definitions)[number]>();
    definitions
      .filter(
        (definition) =>
          definition.data.kind === "stripe" && definition.data.parentDefinitionKey === beltKey,
      )
      .forEach((definition, index) => {
        const stored = definition.data.stripeNumber;
        byNumber.set(typeof stored === "number" ? stored : index + 1, definition);
      });
    return byNumber;
  };
  const oneBelt = (label: string, matches: typeof belts) => {
    if (matches.length !== 1) {
      blockers.push(
        matches.length === 0
          ? `Belt not found: ${label}.`
          : `More than one belt matches ${label}: ${matches.map((m) => m.data.name).join(", ")}.`,
      );
      return undefined;
    }
    return matches[0];
  };

  // Kids 7-10 belts: stripes 7 and 8 go; heads on them move to stripe 6.
  const removed = new Map<string, string>();
  const fallbackOf = new Map<string, string>();
  const kidsBelts = belts.filter((belt) => normalized(belt.data.name).includes(kidsBeltMarker));
  if (kidsBelts.length === 0) blockers.push(`No belt name contains "${kidsBeltMarker}".`);
  for (const belt of kidsBelts) {
    const stripes = stripesOf(belt.data.definitionKey);
    const doomed = removedStripeNumbers.flatMap((n) => stripes.get(n) ?? []);
    if (doomed.length === 0) continue;
    if ([...stripes.keys()].some((n) => n > Math.max(...removedStripeNumbers))) {
      blockers.push(`${String(belt.data.name)} has stripes after the 8th.`);
    }
    const fallback = stripes.get(fallbackStripeNumber);
    if (fallback === undefined) {
      blockers.push(`${String(belt.data.name)} has no 6th stripe to move members to.`);
    }
    for (const stripe of doomed) {
      const key = String(stripe.data.definitionKey);
      removed.set(key, String(stripe.data.name));
      if (fallback !== undefined) fallbackOf.set(key, String(fallback.data.definitionKey));
    }
  }

  // Criteria from the PDF.
  const criteriaFor = new Map<string, (typeof pdfCriteria)[keyof typeof pdfCriteria]>();
  const teens = oneBelt(
    "WHITE BELT TEENS 10-12 AND 13-15 YO",
    belts.filter((belt) => normalized(belt.data.name) === teensWhiteBelt),
  );
  if (teens !== undefined) criteriaFor.set(teens.id, pdfCriteria.teensWhite);
  const adult = oneBelt(
    "WHITE BELT",
    belts.filter((belt) => normalized(belt.data.name) === adultWhiteBelt),
  );
  if (adult !== undefined) {
    criteriaFor.set(adult.id, pdfCriteria.adultWhite);
    const stripes = stripesOf(adult.data.definitionKey);
    for (const n of adultWhiteStripeNumbers) {
      const stripe = stripes.get(n);
      if (stripe === undefined) blockers.push(`WHITE BELT has no stripe ${n}.`);
      else criteriaFor.set(stripe.id, pdfCriteria.adultWhiteStripes);
    }
  }

  const survivors = definitions.filter(
    (definition) => !removed.has(String(definition.data.definitionKey)),
  );
  const updates: Write[] = [];
  const finalDefinitions = survivors.map((definition, index) => {
    const next: Data = { ...definition.data, sequence: index + 1 };
    const pdf = criteriaFor.get(definition.id);
    if (pdf !== undefined) {
      const criteria = isRecord(definition.data.criteria) ? definition.data.criteria : {};
      next.criteria = {
        ...criteria,
        minClasses: pdf.minClasses,
        minimumTime: { ...pdf.minimumTime } satisfies MinimumTime,
      };
      if (hashLevelCatalogValue(next.criteria) !== hashLevelCatalogValue(criteria)) {
        summary.push(
          `${String(definition.data.name)}: ${describeCriteria(criteria)} → ${describeCriteria(next.criteria)}`,
        );
      }
    }
    if (hashLevelCatalogValue(next) !== hashLevelCatalogValue(definition.data)) {
      updates.push({ path: `${base}/levelDefinitions/${definition.id}`, data: next });
    }
    return { id: definition.id, data: next };
  });
  for (const name of removed.values()) summary.push(`Removed stripe: ${name}`);

  const deletes = [
    ...definitions
      .filter((definition) => removed.has(String(definition.data.definitionKey)))
      .map((definition) => `${base}/levelDefinitions/${definition.id}`),
    ...requirements
      .filter((requirement) => removed.has(String(requirement.data.definitionKey)))
      .map((requirement) => `${base}/levelRequirements/${requirement.id}`),
  ];
  const finalRequirements = requirements.filter(
    (requirement) => !removed.has(String(requirement.data.definitionKey)),
  );

  const headMoves: HeadMove[] = [];
  for (const head of heads.docs) {
    const data = head.data();
    const studentId = String(data.studentId ?? head.id);
    const from = String(data.currentDefinitionKey ?? "");
    if (removed.has(from)) {
      const to = fallbackOf.get(from);
      if (to !== undefined) {
        headMoves.push({
          path: `${base}/studentLevelProgress/${head.id}`,
          studentId,
          fromDefinitionKey: from,
          toDefinitionKey: to,
        });
        summary.push(`Moved head: ${studentId}`);
      }
    }
    // The opening row of the member's history would name a deleted level.
    if (typeof data.openedDefinitionKey === "string" && removed.has(data.openedDefinitionKey)) {
      blockers.push(`Head ${studentId} was opened on a removed stripe.`);
    }
  }
  for (const promotion of promotions.docs) {
    const data = promotion.data();
    if (
      removed.has(String(data.fromDefinitionKey ?? "")) ||
      removed.has(String(data.toDefinitionKey ?? ""))
    ) {
      blockers.push(`Promotion ${promotion.id} names a removed stripe.`);
    }
  }
  for (const blocker of blockers) summary.push(`BLOCKER: ${blocker}`);

  const kinds = finalDefinitions.map((definition) => definition.data.kind);
  const system: Data = {
    ...source,
    counts: {
      definitions: finalDefinitions.length,
      belts: kinds.filter((kind) => kind !== "stripe").length,
      stripes: kinds.filter((kind) => kind === "stripe").length,
    },
    updatedAt: generatedAt,
  };
  const contentHash = catalogueContentHash(systemId, system, finalDefinitions, finalRequirements);
  system.contentHash = contentHash;
  system.sourceHash = contentHash;

  const nothing = updates.length === 0 && deletes.length === 0 && headMoves.length === 0;
  return {
    status: blockers.length > 0 ? "blocked" : nothing ? "already-aligned" : "ready",
    academyId,
    generatedAt,
    systemId,
    expectedUpdatedAt: String(source.updatedAt ?? "never"),
    updates,
    deletes,
    headMoves,
    blockers,
    system,
    contentHash,
    summary,
  };
}

export function expectedAlignmentConfirmation(plan: AlignmentPlan): string {
  const pinned = hashLevelCatalogValue({
    contentHash: plan.contentHash,
    headMoves: plan.headMoves,
    deletes: plan.deletes,
  });
  return `ALIGN-${plan.academyId}-${plan.systemId}-${pinned.slice(0, 12)}`;
}

export async function applyPdfAlignment(
  firestore: AlignmentFirestore,
  plan: AlignmentPlan,
  { actorId, confirmation }: { actorId: string; confirmation: string },
): Promise<AlignmentResult> {
  if (confirmation !== expectedAlignmentConfirmation(plan)) {
    throw new Error("The exact dry-run confirmation is required.");
  }
  if (plan.status === "already-aligned") return { updated: 0, deleted: 0, movedHeads: 0 };
  if (plan.status !== "ready") throw new Error("The plan is blocked; nothing was written.");
  const base = `academies/${plan.academyId}`;
  const systemRef = firestore.doc(`${base}/levelSystems/${plan.systemId}`);
  const stored = await firestore.runTransaction((transaction) => transaction.get(systemRef));
  if (String(stored.data()?.updatedAt ?? "never") !== plan.expectedUpdatedAt) {
    throw new Error("The belt catalogue changed since the dry run.");
  }
  // Heads and promotions can move without touching the catalogue: the plan must still be the same.
  const fresh = await planPdfAlignment(firestore, {
    academyId: plan.academyId,
    generatedAt: plan.generatedAt,
  });
  if (fresh.status !== "ready" || expectedAlignmentConfirmation(fresh) !== confirmation) {
    throw new Error("Level progress changed since the dry run.");
  }

  await inBatches(firestore, [
    ...plan.headMoves.map(
      (move) => (batch: Batch) =>
        batch.set(
          firestore.doc(move.path),
          {
            currentDefinitionKey: move.toDefinitionKey,
            updatedAt: plan.generatedAt,
            updatedBy: actorId,
          },
          { merge: true },
        ),
    ),
    ...plan.updates.map(
      (write) => (batch: Batch) => batch.set(firestore.doc(write.path), write.data),
    ),
    ...plan.deletes.map((path) => (batch: Batch) => batch.delete(firestore.doc(path))),
  ]);

  const operationId = `pdf-alignment-${plan.contentHash.slice(0, 12)}`;
  const audit = levelCatalogAuditDraft({
    academyId: plan.academyId,
    actorId,
    action: "level.catalog.published",
    targetRef: `${base}/levelSystems/${plan.systemId}`,
    purpose: "level-catalog-maintenance",
    correlationId: catalogueCorrelationId(
      "level.catalog.published",
      plan.academyId,
      plan.systemId,
      operationId,
    ),
  });
  await firestore.runTransaction(async (transaction) => {
    transaction.set(systemRef, { ...plan.system, updatedBy: actorId });
    appendAuditEventInTransaction(
      transaction,
      firestore.doc(`${base}/auditEvents/audit-${audit.correlationId}`),
      audit,
    );
  });
  return {
    updated: plan.updates.length,
    deleted: plan.deletes.length,
    movedHeads: plan.headMoves.length,
  };
}
