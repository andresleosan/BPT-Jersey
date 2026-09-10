import {
  PLAN_CATALOG,
  parsePlanDraft,
  parsePlanRecord,
  planIds,
  type PlanDraft,
  type PlanId,
  type PlanRecord,
} from "@bpt-jersey/domain/memberships";

export type PlanDocumentData = Readonly<Record<string, unknown>>;
export type PlanDocumentReference = Readonly<{ id: string; path: string }>;
export type PlanDocumentSnapshot = Readonly<{
  id: string;
  exists: boolean;
  data: () => PlanDocumentData | undefined;
}>;
export type PlanQuerySnapshot = Readonly<{
  docs: readonly PlanDocumentSnapshot[];
}>;
export type PlanQuery = Readonly<{
  path: string;
  field: string;
  value: unknown;
  limit: number;
}>;
export type PlanCollectionReference = Readonly<{
  doc: (id?: string) => PlanDocumentReference;
  where: (
    field: string,
    operator: "==",
    value: unknown,
  ) => Readonly<{ limit: (count: number) => PlanQuery }>;
}>;
export type PlanTransaction = Readonly<{
  get: (
    target: PlanDocumentReference | PlanQuery,
  ) => Promise<PlanDocumentSnapshot | PlanQuerySnapshot>;
  create: (ref: PlanDocumentReference, data: PlanDocumentData) => PlanTransaction;
  set: (ref: PlanDocumentReference, data: PlanDocumentData) => PlanTransaction;
}>;
export type PlanFirestore = Readonly<{
  doc: (path: string) => PlanDocumentReference;
  collection: (path: string) => PlanCollectionReference;
  runTransaction: <T>(callback: (transaction: PlanTransaction) => Promise<T>) => Promise<T>;
}>;

export type SavePlanInput = Readonly<{
  academyId: string;
  actorId: string;
  now: string;
  draft: PlanDraft;
}>;
export type DeactivatePlanInput = Readonly<{
  academyId: string;
  actorId: string;
  planId: PlanId;
  now: string;
}>;
export type ActivatePlanInput = Readonly<{
  academyId: string;
  actorId: string;
  planId: PlanId;
  now: string;
}>;
export type SeedPlanCatalogInput = Readonly<{
  academyId: string;
  actorId: string;
  now: string;
}>;

export type PlanStore = Readonly<{
  listPlans: (academyId: string) => Promise<readonly PlanRecord[]>;
  getPlan: (academyId: string, planId: PlanId) => Promise<PlanRecord | undefined>;
  savePlan: (input: SavePlanInput) => Promise<PlanRecord>;
  deactivatePlan: (input: DeactivatePlanInput) => Promise<PlanRecord>;
  activatePlan: (input: ActivatePlanInput) => Promise<PlanRecord>;
  seedPlanCatalog: (input: SeedPlanCatalogInput) => Promise<readonly PlanRecord[]>;
}>;

export type PlanStoreDependencies = Readonly<{
  firestore: PlanFirestore;
}>;

export class PlanStoreError extends Error {
  public readonly code: "invalid" | "tenant" | "duplicate" | "not-found" | "conflict";

  public constructor(
    code: "invalid" | "tenant" | "duplicate" | "not-found" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "PlanStoreError";
    this.code = code;
  }
}

const safePathSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const PLAN_QUERY_LIMIT = 10;

function pathSegment(value: string, label: string): string {
  if (typeof value !== "string" || !safePathSegmentPattern.test(value)) {
    throw new PlanStoreError("tenant", `Invalid ${label}`);
  }
  return value;
}

function validNow(value: string): string {
  if (
    typeof value !== "string" ||
    !dateTimePattern.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new PlanStoreError("invalid", "Invalid plan timestamp");
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  if (match === null) throw new PlanStoreError("invalid", "Invalid plan timestamp");
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  calendar.setUTCHours(0, 0, 0, 0);
  if (
    calendar.getUTCFullYear() !== Number(match[1]) ||
    calendar.getUTCMonth() !== Number(match[2]) - 1 ||
    calendar.getUTCDate() !== Number(match[3])
  ) {
    throw new PlanStoreError("invalid", "Invalid plan timestamp");
  }
  return value;
}

function validPlanId(value: string): PlanId {
  if (typeof value !== "string" || !planIds.includes(value as PlanId)) {
    throw new PlanStoreError("invalid", "Unknown plan ID");
  }
  return value as PlanId;
}

function plansPath(academyId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/plans`;
}

function planPath(academyId: string, planId: string): string {
  return `${plansPath(academyId)}/${pathSegment(validPlanId(planId), "plan")}`;
}

function isQuerySnapshot(
  value: PlanDocumentSnapshot | PlanQuerySnapshot,
): value is PlanQuerySnapshot {
  return "docs" in value;
}

function documentSnapshot(value: PlanDocumentSnapshot | PlanQuerySnapshot): PlanDocumentSnapshot {
  if (isQuerySnapshot(value))
    throw new PlanStoreError("invalid", "Expected plan document snapshot");
  return value;
}

function querySnapshot(value: PlanDocumentSnapshot | PlanQuerySnapshot): PlanQuerySnapshot {
  if (!isQuerySnapshot(value)) throw new PlanStoreError("invalid", "Expected plan query snapshot");
  return value;
}

function storedPlan(snapshot: PlanDocumentSnapshot, expectedPlanId?: PlanId): PlanRecord {
  if (!snapshot.exists) throw new PlanStoreError("not-found", "Plan is not available");
  if (expectedPlanId !== undefined && snapshot.id !== expectedPlanId) {
    throw new PlanStoreError("invalid", "Stored plan identity is invalid");
  }
  const parsed = parsePlanRecord(snapshot.data());
  if (!parsed.ok) throw new PlanStoreError("invalid", "Stored plan is invalid");
  if (snapshot.id !== parsed.value.planId) {
    throw new PlanStoreError("invalid", "Stored plan identity is invalid");
  }
  return parsed.value;
}

function checkTenant(plan: PlanRecord, academyId: string): PlanRecord {
  if (plan.academyId !== academyId) throw new PlanStoreError("tenant", "Plan tenant mismatch");
  return plan;
}

function parsedDraft(value: unknown): PlanDraft {
  const parsed = parsePlanDraft(value);
  if (!parsed.ok) throw new PlanStoreError("invalid", "Plan draft is invalid");
  return parsed.value;
}

function parseCreatedRecord(value: PlanRecord): PlanRecord {
  const parsed = parsePlanRecord(value);
  if (!parsed.ok) throw new PlanStoreError("invalid", "Plan creation is invalid");
  return parsed.value;
}

async function safely<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PlanStoreError) throw error;
    throw new PlanStoreError("invalid", "Plan store operation failed");
  }
}

function catalogIndex(planId: PlanId): number {
  return PLAN_CATALOG.findIndex((plan) => plan.planId === planId);
}

export function createPlanStore(dependencies: PlanStoreDependencies): PlanStore {
  return Object.freeze({
    async listPlans(academyIdInput) {
      return safely(async () => {
        const academyId = pathSegment(academyIdInput, "academy");
        const plans = await dependencies.firestore.runTransaction(async (transaction) => {
          const snapshot = querySnapshot(
            await transaction.get(
              dependencies.firestore
                .collection(plansPath(academyId))
                .where("active", "==", true)
                .limit(PLAN_QUERY_LIMIT),
            ),
          );
          return snapshot.docs
            .map((snapshot) => checkTenant(storedPlan(snapshot), academyId))
            .sort((left, right) => catalogIndex(left.planId) - catalogIndex(right.planId));
        });
        return Object.freeze([...plans]);
      });
    },

    async getPlan(academyIdInput, planIdInput) {
      return safely(async () => {
        const academyId = pathSegment(academyIdInput, "academy");
        const planId = validPlanId(planIdInput);
        return dependencies.firestore.runTransaction(async (transaction) => {
          const snapshot = documentSnapshot(
            await transaction.get(dependencies.firestore.doc(planPath(academyId, planId))),
          );
          if (!snapshot.exists) return undefined;
          const plan = checkTenant(storedPlan(snapshot, planId), academyId);
          return plan.active ? plan : undefined;
        });
      });
    },

    async savePlan(input) {
      return safely(async () => {
        const academyId = pathSegment(input.academyId, "academy");
        const actorId = pathSegment(input.actorId, "actor");
        const now = validNow(input.now);
        const draft = parsedDraft(input.draft);
        const reference = dependencies.firestore.doc(planPath(academyId, draft.planId));
        return dependencies.firestore.runTransaction(async (transaction) => {
          const snapshot = documentSnapshot(await transaction.get(reference));
          if (!snapshot.exists) {
            const created = parseCreatedRecord({
              ...draft,
              academyId,
              active: true,
              schemaVersion: "1",
              createdAt: now,
              createdBy: actorId,
              updatedAt: now,
              updatedBy: actorId,
            });
            transaction.create(reference, created);
            return created;
          }
          const current = checkTenant(storedPlan(snapshot, draft.planId), academyId);
          const updated = parseCreatedRecord({
            ...draft,
            academyId,
            active: current.active,
            schemaVersion: "1",
            createdAt: current.createdAt,
            createdBy: current.createdBy,
            updatedAt: now,
            updatedBy: actorId,
          });
          transaction.set(reference, updated);
          return updated;
        });
      });
    },

    async deactivatePlan(input) {
      return safely(async () => {
        const academyId = pathSegment(input.academyId, "academy");
        const actorId = pathSegment(input.actorId, "actor");
        const planId = validPlanId(input.planId);
        const now = validNow(input.now);
        const reference = dependencies.firestore.doc(planPath(academyId, planId));
        return dependencies.firestore.runTransaction(async (transaction) => {
          const snapshot = documentSnapshot(await transaction.get(reference));
          if (!snapshot.exists) throw new PlanStoreError("not-found", "Plan is not available");
          const current = checkTenant(storedPlan(snapshot, planId), academyId);
          if (!current.active) return current;
          const deactivated = parseCreatedRecord({
            ...current,
            active: false,
            updatedAt: now,
            updatedBy: actorId,
          });
          transaction.set(reference, deactivated);
          return deactivated;
        });
      });
    },

    async activatePlan(input) {
      return safely(async () => {
        const academyId = pathSegment(input.academyId, "academy");
        const actorId = pathSegment(input.actorId, "actor");
        const planId = validPlanId(input.planId);
        const now = validNow(input.now);
        const reference = dependencies.firestore.doc(planPath(academyId, planId));
        return dependencies.firestore.runTransaction(async (transaction) => {
          const snapshot = documentSnapshot(await transaction.get(reference));
          if (!snapshot.exists) throw new PlanStoreError("not-found", "Plan is not available");
          const current = checkTenant(storedPlan(snapshot, planId), academyId);
          if (current.active) return current;
          const activated = parseCreatedRecord({
            ...current,
            active: true,
            updatedAt: now,
            updatedBy: actorId,
          });
          transaction.set(reference, activated);
          return activated;
        });
      });
    },

    async seedPlanCatalog(input) {
      return safely(async () => {
        const academyId = pathSegment(input.academyId, "academy");
        const actorId = pathSegment(input.actorId, "actor");
        const now = validNow(input.now);
        return dependencies.firestore.runTransaction(async (transaction) => {
          const catalog = PLAN_CATALOG.map((draft) => {
            const plan = parsedDraft(draft);
            return {
              plan,
              reference: dependencies.firestore.doc(planPath(academyId, plan.planId)),
            };
          });
          const snapshots = await Promise.all(
            catalog.map(({ reference }) => transaction.get(reference)),
          );
          const seeded: PlanRecord[] = [];
          for (const [index, { plan, reference }] of catalog.entries()) {
            const snapshot = documentSnapshot(snapshots[index]!);
            if (snapshot.exists) {
              const existing = checkTenant(storedPlan(snapshot, plan.planId), academyId);
              const updated = parseCreatedRecord({
                ...plan,
                academyId,
                active: existing.active,
                schemaVersion: "1",
                createdAt: existing.createdAt,
                createdBy: existing.createdBy,
                updatedAt: now,
                updatedBy: actorId,
              });
              transaction.set(reference, updated);
              seeded.push(updated);
              continue;
            }
            const created = parseCreatedRecord({
              ...plan,
              academyId,
              active: true,
              schemaVersion: "1",
              createdAt: now,
              createdBy: actorId,
              updatedAt: now,
              updatedBy: actorId,
            });
            transaction.create(reference, created);
            seeded.push(created);
          }
          return Object.freeze(seeded);
        });
      });
    },
  });
}
