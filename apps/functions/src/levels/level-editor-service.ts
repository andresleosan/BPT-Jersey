import { createHash, randomUUID } from "node:crypto";

import { parseAuditEventDraft, type AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  isCustomLevelSystemId,
  missingProgressKeys,
  type ActivateLevelCatalogResult,
  type LevelCatalogVersionContent,
  type LevelCatalogVersionSummary,
  type LevelDraftLevel,
  type LevelDraftRequirement,
  type LevelDraftSkill,
  type SaveLevelCatalogDraftInput,
} from "@bpt-jersey/domain/levels/editor";
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";

import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { hashLevelCatalogValue, levelCatalogStorageId } from "./level-catalog-integrity.js";
import { activeLevelCatalogSystemId } from "./level-service.js";

/**
 * T04: editable versions of the belt catalogue. A version is a `custom` system stored beside the
 * code versions (`ibjjf-v1..v3`) in the same collections. Drafts are rewritten freely; publishing
 * seals a draft with the sha256 of its content; activation moves the academy pointer and the
 * students' progress heads together, and refuses when any student holds a level the target lacks.
 */
export type LevelEditorErrorCode = "invalid" | "not-found" | "conflict" | "missing-levels";

export class LevelEditorError extends Error {
  public readonly code: LevelEditorErrorCode;
  public readonly missing: readonly { definitionKey: string; students: number }[];

  public constructor(
    code: LevelEditorErrorCode,
    message: string,
    missing: readonly { definitionKey: string; students: number }[] = [],
  ) {
    super(message);
    this.name = "LevelEditorError";
    this.code = code;
    this.missing = missing;
  }
}

type StoredData = Record<string, unknown>;
type EditorSnapshot = Readonly<{ exists: boolean; data: () => StoredData | undefined }>;
type EditorDocumentReference = Readonly<{ id: string; path?: string }>;
type EditorQuerySnapshot = Readonly<{
  docs: readonly Readonly<{ id: string; data: () => StoredData; ref: EditorDocumentReference }>[];
}>;
type EditorQuery = Readonly<{ get: () => Promise<EditorQuerySnapshot> }>;
type EditorFilteredQuery = EditorQuery & Readonly<{ limit: (count: number) => EditorQuery }>;
type EditorCollection = EditorQuery &
  Readonly<{ where: (field: string, operator: "==", value: unknown) => EditorFilteredQuery }>;
export type LevelEditorTransaction = Readonly<{
  get: {
    (reference: EditorDocumentReference): Promise<EditorSnapshot>;
    (query: EditorQuery): Promise<EditorQuerySnapshot>;
  };
  create: (reference: EditorDocumentReference, data: unknown) => void;
  set: (reference: EditorDocumentReference, data: unknown, options?: { merge: boolean }) => void;
  delete: (reference: EditorDocumentReference) => void;
}>;
export type LevelEditorFirestore = Readonly<{
  doc: (path: string) => EditorDocumentReference;
  collection: (path: string) => EditorCollection;
  runTransaction: <T>(callback: (transaction: LevelEditorTransaction) => Promise<T>) => Promise<T>;
}>;

export type LevelEditorService = Readonly<{
  listVersions: (academyId: string) => Promise<{ versions: LevelCatalogVersionSummary[] }>;
  getVersion: (academyId: string, systemId: string) => Promise<LevelCatalogVersionContent>;
  createDraft: (input: {
    academyId: string;
    fromSystemId: string;
    actorId: string;
  }) => Promise<LevelCatalogVersionContent>;
  saveDraft: (input: {
    academyId: string;
    draft: SaveLevelCatalogDraftInput;
    actorId: string;
  }) => Promise<LevelCatalogVersionContent>;
  publishDraft: (input: {
    academyId: string;
    systemId: string;
    actorId: string;
  }) => Promise<{ systemId: string; contentHash: string }>;
  activate: (input: {
    academyId: string;
    systemId: string;
    actorId: string;
  }) => Promise<ActivateLevelCatalogResult>;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const activeStateId = "active";
// One transaction rewrites every progress head; beyond this the activation needs a batched job.
const maxProgressHeadsPerActivation = 450;

function assertIdentifier(value: string): void {
  if (!identifierPattern.test(value)) {
    throw new LevelEditorError("invalid", "Invalid level catalogue identifier.");
  }
}

function isRecord(value: unknown): value is StoredData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOr<T>(value: unknown, fallback: T): string | T {
  return typeof value === "string" ? value : fallback;
}

function numberOr<T>(value: unknown, fallback: T): number | T {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function storedSkills(system: StoredData): StoredData[] {
  return Array.isArray(system.skillCatalog) ? system.skillCatalog.filter(isRecord) : [];
}

function bySequence(left: StoredData, right: StoredData): number {
  return numberOr(left.sequence, 0) - numberOr(right.sequence, 0);
}

function criteriaOf(value: unknown): LevelDraftLevel["criteria"] {
  const criteria = isRecord(value) ? value : {};
  const time = isRecord(criteria.minimumTime) ? criteria.minimumTime : null;
  return {
    minAge: numberOr(criteria.minAge, null),
    maxAge: numberOr(criteria.maxAge, null),
    minClasses: numberOr(criteria.minClasses, null),
    minimumTime:
      time === null
        ? null
        : {
            years: numberOr(time.years, 0),
            months: numberOr(time.months, 0),
            days: numberOr(time.days, 0),
          },
  };
}

/** Stored definitions and requirements in editor form; a belt's stripe count is its children. */
function versionContent(
  systemId: string,
  system: StoredData,
  definitions: readonly StoredData[],
  requirements: readonly StoredData[],
): LevelCatalogVersionContent {
  const children = new Map<string, number>();
  for (const definition of definitions) {
    const parent = definition.parentDefinitionKey;
    if (definition.kind === "stripe" && typeof parent === "string") {
      children.set(parent, (children.get(parent) ?? 0) + 1);
    }
  }
  return {
    systemId,
    origin: isCustomLevelSystemId(systemId) ? "custom" : "code",
    status: system.status === "draft" ? "draft" : "published",
    displayName: stringOr(system.displayName, systemId),
    levels: [...definitions].sort(bySequence).map((definition) => {
      const visual = isRecord(definition.visual) ? definition.visual : {};
      const key = String(definition.definitionKey);
      return {
        definitionKey: key,
        kind: definition.kind === "stripe" ? "stripe" : "belt",
        parentDefinitionKey: stringOr(definition.parentDefinitionKey, null),
        name: String(definition.name ?? key),
        sequence: numberOr(definition.sequence, 1),
        stripeNumber: numberOr(definition.stripeNumber, null),
        criteria: criteriaOf(definition.criteria),
        visual: {
          colors: Array.isArray(visual.colors) ? visual.colors.map(String) : [],
          stripeColor: stringOr(visual.stripeColor, null),
          stripeCount: definition.kind === "stripe" ? 0 : (children.get(key) ?? 0),
        },
      };
    }),
    skills: storedSkills(system)
      .sort(bySequence)
      .map((skill) => ({
        key: String(skill.key),
        displayLabel: String(skill.displayLabel ?? skill.key),
        minimumRating: numberOr(skill.minimumRating, 3),
        sequence: numberOr(skill.sequence, 1),
      })),
    requirements: requirements
      .map((requirement) => ({
        definitionKey: String(requirement.definitionKey),
        skillKey: String(requirement.skillKey),
        minimumRating: numberOr(requirement.minimumRating, 3),
      }))
      .sort((left, right) =>
        `${left.definitionKey}__${left.skillKey}`.localeCompare(
          `${right.definitionKey}__${right.skillKey}`,
        ),
      ),
  };
}

/**
 * A belt's `stripeCount` is authoritative: its existing stripes are kept in order up to that count,
 * the rest are dropped, and missing ones are generated as `<beltKey>-stripe-<n>`. Every level is
 * then renumbered so each belt is followed by its stripes.
 */
export function reconcileDraftLevels(levels: readonly LevelDraftLevel[]): LevelDraftLevel[] {
  const usedKeys = new Set(levels.map((level) => level.definitionKey));
  const belts = levels
    .filter((level) => level.kind === "belt")
    .sort((left, right) => left.sequence - right.sequence);
  const result: LevelDraftLevel[] = [];
  for (const belt of belts) {
    result.push(belt);
    const stripes = levels
      .filter(
        (level) => level.kind === "stripe" && level.parentDefinitionKey === belt.definitionKey,
      )
      .sort((left, right) => left.sequence - right.sequence)
      .slice(0, belt.visual.stripeCount);
    result.push(...stripes);
    for (let number = stripes.length + 1; number <= belt.visual.stripeCount; number += 1) {
      let suffix = number;
      while (usedKeys.has(`${belt.definitionKey}-stripe-${suffix}`)) suffix += 1;
      const definitionKey = `${belt.definitionKey}-stripe-${suffix}`;
      if (!identifierPattern.test(definitionKey)) {
        throw new LevelEditorError("invalid", "Generated stripe key is invalid.");
      }
      usedKeys.add(definitionKey);
      result.push({
        definitionKey,
        kind: "stripe",
        parentDefinitionKey: belt.definitionKey,
        name: `${belt.name} · stripe ${number}`.slice(0, 80),
        sequence: 1,
        stripeNumber: number,
        criteria: belt.criteria,
        visual: {
          colors: belt.visual.colors,
          stripeColor: belt.visual.stripeColor,
          stripeCount: 0,
        },
      });
    }
  }
  return result.map((level, index) => ({ ...level, sequence: index + 1 }));
}

function sameColours(left: unknown, right: LevelDraftLevel["visual"]): boolean {
  if (!isRecord(left)) return false;
  return (
    JSON.stringify(left.colors) === JSON.stringify(right.colors) &&
    (left.stripeColor ?? null) === right.stripeColor
  );
}

function storedDefinition(
  academyId: string,
  systemId: string,
  level: LevelDraftLevel,
  previous: StoredData | undefined,
  beltColours: LevelDraftLevel["visual"] | undefined,
): StoredData {
  const previousVisual = isRecord(previous?.visual) ? previous.visual : {};
  // A stripe follows its belt's colours whenever the belt's colours were changed in this save.
  const colours = beltColours ?? level.visual;
  return {
    definitionKey: level.definitionKey,
    systemId,
    kind: level.kind,
    parentDefinitionKey: level.parentDefinitionKey,
    name: level.name,
    sequence: level.sequence,
    stripeNumber: level.stripeNumber,
    criteria: level.criteria,
    observedCriteria: isRecord(previous?.observedCriteria)
      ? previous.observedCriteria
      : level.criteria,
    visual: {
      colorMode: numberOr(previousVisual.colorMode, 1),
      colors: [...colours.colors],
      stripeColor: colours.stripeColor,
      stripeCenter: numberOr(previousVisual.stripeCenter, null),
      stripeWidth: numberOr(previousVisual.stripeWidth, null),
      stripePosition: numberOr(previousVisual.stripePosition, null),
    },
    observedSkillRequirementSetKey: stringOr(previous?.observedSkillRequirementSetKey, null),
    observedSkillRequirementsState: stringOr(previous?.observedSkillRequirementsState, "none"),
    anomalyFlags: Array.isArray(previous?.anomalyFlags) ? previous.anomalyFlags : [],
    schemaVersion: 1,
    academyId,
  };
}

function storedRequirement(
  academyId: string,
  systemId: string,
  requirement: LevelDraftRequirement,
  previous: StoredData | undefined,
): StoredData {
  return {
    requirementKey: `${requirement.definitionKey}__${requirement.skillKey}`,
    systemId,
    definitionKey: requirement.definitionKey,
    skillKey: requirement.skillKey,
    minimumRating: requirement.minimumRating,
    inheritance: stringOr(previous?.inheritance, "inherit"),
    schemaVersion: 1,
    academyId,
  };
}

function storedSkill(skill: LevelDraftSkill, previous: StoredData | undefined): StoredData {
  return {
    key: skill.key,
    displayLabel: skill.displayLabel,
    observedLabel: stringOr(previous?.observedLabel, null),
    minimumRating: skill.minimumRating,
    sequence: skill.sequence,
  };
}

function counts(definitions: readonly StoredData[]): StoredData {
  return {
    definitions: definitions.length,
    belts: definitions.filter((definition) => definition.kind === "belt").length,
    stripes: definitions.filter((definition) => definition.kind === "stripe").length,
  };
}

function catalogueCorrelationId(
  action: string,
  academyId: string,
  systemId: string,
  operationId: string,
): string {
  const digest = createHash("sha256");
  for (const value of [action, academyId, systemId, operationId]) {
    digest.update(`${Buffer.byteLength(value, "utf8")}:`, "utf8");
    digest.update(value, "utf8");
  }
  return `level-catalog-${digest.digest("hex")}`;
}

function auditDraft(value: Record<string, unknown>): AuditEventDraft {
  const parsed = parseAuditEventDraft(value);
  if (!parsed.ok) throw new LevelEditorError("invalid", "Invalid level catalogue audit event.");
  return parsed.value;
}

function isCustomDraft(system: StoredData | undefined, systemId: string): boolean {
  return (
    system !== undefined &&
    isCustomLevelSystemId(systemId) &&
    system.origin === "custom" &&
    system.status === "draft"
  );
}

export function createLevelEditorService({
  firestore,
  now = () => new Date().toISOString(),
  newOperationId = randomUUID,
}: {
  firestore: LevelEditorFirestore;
  now?: () => string;
  newOperationId?: () => string;
}): LevelEditorService {
  const systemsPath = (academyId: string) => `academies/${academyId}/levelSystems`;
  const definitionsOf = (academyId: string, systemId: string) =>
    firestore
      .collection(`academies/${academyId}/levelDefinitions`)
      .where("systemId", "==", systemId);
  const requirementsOf = (academyId: string, systemId: string) =>
    firestore
      .collection(`academies/${academyId}/levelRequirements`)
      .where("systemId", "==", systemId);
  const stateRef = (academyId: string) =>
    firestore.doc(`academies/${academyId}/levelCatalogState/${activeStateId}`);

  async function readVersion(
    transaction: LevelEditorTransaction,
    academyId: string,
    systemId: string,
  ) {
    const [system, definitions, requirements] = await Promise.all([
      transaction.get(firestore.doc(`${systemsPath(academyId)}/${systemId}`)),
      transaction.get(definitionsOf(academyId, systemId)),
      transaction.get(requirementsOf(academyId, systemId)),
    ]);
    const systemData = system.data();
    if (!system.exists || systemData === undefined || systemData.academyId !== academyId) {
      throw new LevelEditorError("not-found", "Level catalogue version does not exist.");
    }
    const own = (snapshot: EditorQuerySnapshot) =>
      snapshot.docs.filter((document) => document.data().academyId === academyId);
    return {
      system: systemData,
      definitions: own(definitions),
      requirements: own(requirements),
    };
  }

  return {
    async listVersions(academyId) {
      assertIdentifier(academyId);
      const [systems, state] = await firestore.runTransaction((transaction) =>
        Promise.all([
          transaction.get(firestore.collection(systemsPath(academyId))),
          transaction.get(stateRef(academyId)),
        ]),
      );
      const records = systems.docs.map((document) => ({ id: document.id, data: document.data() }));
      const activeId = activeLevelCatalogSystemId(academyId, records, state.data());
      const versions = records.map(({ id, data }) => ({
        systemId: id,
        displayName: stringOr(data.displayName, id).slice(0, 200),
        origin: isCustomLevelSystemId(id) ? ("custom" as const) : ("code" as const),
        status: data.status === "draft" ? ("draft" as const) : ("published" as const),
        active: id === activeId,
        publishedAt: stringOr(data.publishedAt, null),
      }));
      versions.sort((left, right) =>
        left.origin === right.origin
          ? right.systemId.localeCompare(left.systemId)
          : left.origin === "custom"
            ? -1
            : 1,
      );
      return { versions };
    },

    async getVersion(academyId, systemId) {
      assertIdentifier(academyId);
      assertIdentifier(systemId);
      return firestore.runTransaction(async (transaction) => {
        const version = await readVersion(transaction, academyId, systemId);
        return versionContent(
          systemId,
          version.system,
          version.definitions.map((document) => document.data()),
          version.requirements.map((document) => document.data()),
        );
      });
    },

    async createDraft({ academyId, fromSystemId, actorId }) {
      for (const value of [academyId, fromSystemId, actorId]) assertIdentifier(value);
      const at = now();
      const day = dateKeyInJersey(new Date(at)).replaceAll("-", "");
      return firestore.runTransaction(async (transaction) => {
        const [source, systems] = await Promise.all([
          readVersion(transaction, academyId, fromSystemId),
          transaction.get(firestore.collection(systemsPath(academyId))),
        ]);
        if (source.system.status !== "published" && fromSystemId !== "ibjjf-v1") {
          throw new LevelEditorError("conflict", "Only a published version can be copied.");
        }
        const sameDay = new RegExp(`^bpt-${day}-(\\d{1,3})$`, "u");
        const taken = systems.docs
          .map((document) => sameDay.exec(document.id)?.[1])
          .filter((value): value is string => value !== undefined)
          .map(Number);
        const next = (taken.length === 0 ? 0 : Math.max(...taken)) + 1;
        if (next > 999) throw new LevelEditorError("conflict", "Too many drafts today.");
        const systemId = `bpt-${day}-${next}`;
        const definitions: StoredData[] = source.definitions.map((document) => ({
          ...document.data(),
          systemId,
          academyId,
        }));
        const requirements: StoredData[] = source.requirements.map((document) => ({
          ...document.data(),
          systemId,
          academyId,
        }));
        const system: StoredData = {
          systemId,
          academyId,
          displayName: stringOr(source.system.displayName, systemId).slice(0, 80),
          schemaVersion: 1,
          precedence: {
            businessRules: "BPT catalogue editor",
            hierarchyVisualsAndObservedSkills: `Copied from ${fromSystemId}`,
            conflicts: "The published version is the record",
          },
          counts: counts(definitions),
          skillCatalog: storedSkills(source.system),
          origin: "custom",
          status: "draft",
          copiedFromSystemId: fromSystemId,
          createdAt: at,
          createdBy: actorId,
          updatedAt: at,
          updatedBy: actorId,
          publishedAt: null,
        };
        transaction.create(firestore.doc(`${systemsPath(academyId)}/${systemId}`), system);
        for (const definition of definitions) {
          transaction.create(
            firestore.doc(
              `academies/${academyId}/levelDefinitions/${levelCatalogStorageId(systemId, String(definition.definitionKey))}`,
            ),
            definition,
          );
        }
        for (const requirement of requirements) {
          transaction.create(
            firestore.doc(
              `academies/${academyId}/levelRequirements/${levelCatalogStorageId(systemId, String(requirement.requirementKey))}`,
            ),
            requirement,
          );
        }
        return versionContent(systemId, system, definitions, requirements);
      });
    },

    async saveDraft({ academyId, draft, actorId }) {
      for (const value of [academyId, draft.systemId, actorId]) assertIdentifier(value);
      const { systemId } = draft;
      const levels = reconcileDraftLevels(draft.levels);
      const levelKeys = new Set(levels.map((level) => level.definitionKey));
      return firestore.runTransaction(async (transaction) => {
        const current = await readVersion(transaction, academyId, systemId);
        if (!isCustomDraft(current.system, systemId)) {
          throw new LevelEditorError("conflict", "Only a draft version can be edited.");
        }
        const previousDefinitions = new Map(
          current.definitions.map((document) => [
            String(document.data().definitionKey),
            document.data(),
          ]),
        );
        const previousRequirements = new Map(
          current.requirements.map((document) => [
            String(document.data().requirementKey),
            document.data(),
          ]),
        );
        const previousSkills = new Map(
          storedSkills(current.system).map((skill) => [String(skill.key), skill]),
        );
        const recoloured = new Map<string, LevelDraftLevel["visual"]>();
        for (const level of levels) {
          if (
            level.kind === "belt" &&
            !sameColours(previousDefinitions.get(level.definitionKey)?.visual, level.visual)
          ) {
            recoloured.set(level.definitionKey, level.visual);
          }
        }
        const definitions = levels.map((level) =>
          storedDefinition(
            academyId,
            systemId,
            level,
            previousDefinitions.get(level.definitionKey),
            level.kind === "stripe" && level.parentDefinitionKey !== null
              ? recoloured.get(level.parentDefinitionKey)
              : undefined,
          ),
        );
        // Requirements of stripes the new stripe count dropped go with them.
        const requirements = draft.requirements
          .filter((requirement) => levelKeys.has(requirement.definitionKey))
          .map((requirement) =>
            storedRequirement(
              academyId,
              systemId,
              requirement,
              previousRequirements.get(`${requirement.definitionKey}__${requirement.skillKey}`),
            ),
          );
        const skills = draft.skills.map((skill) =>
          storedSkill(skill, previousSkills.get(skill.key)),
        );
        const keepDefinitionIds = new Set(
          definitions.map((definition) =>
            levelCatalogStorageId(systemId, String(definition.definitionKey)),
          ),
        );
        const keepRequirementIds = new Set(
          requirements.map((requirement) =>
            levelCatalogStorageId(systemId, String(requirement.requirementKey)),
          ),
        );
        for (const document of current.definitions) {
          if (!keepDefinitionIds.has(document.id)) transaction.delete(document.ref);
        }
        for (const document of current.requirements) {
          if (!keepRequirementIds.has(document.id)) transaction.delete(document.ref);
        }
        for (const definition of definitions) {
          transaction.set(
            firestore.doc(
              `academies/${academyId}/levelDefinitions/${levelCatalogStorageId(systemId, String(definition.definitionKey))}`,
            ),
            definition,
          );
        }
        for (const requirement of requirements) {
          transaction.set(
            firestore.doc(
              `academies/${academyId}/levelRequirements/${levelCatalogStorageId(systemId, String(requirement.requirementKey))}`,
            ),
            requirement,
          );
        }
        const system: StoredData = {
          ...current.system,
          displayName: draft.displayName,
          counts: counts(definitions),
          skillCatalog: skills,
          updatedAt: now(),
          updatedBy: actorId,
        };
        transaction.set(firestore.doc(`${systemsPath(academyId)}/${systemId}`), system);
        return versionContent(systemId, system, definitions, requirements);
      });
    },

    async publishDraft({ academyId, systemId, actorId }) {
      for (const value of [academyId, systemId, actorId]) assertIdentifier(value);
      const operationId = newOperationId();
      const at = now();
      return firestore.runTransaction(async (transaction) => {
        const current = await readVersion(transaction, academyId, systemId);
        if (!isCustomDraft(current.system, systemId)) {
          throw new LevelEditorError("conflict", "Only a draft version can be published.");
        }
        if (current.definitions.length === 0) {
          throw new LevelEditorError("conflict", "An empty version cannot be published.");
        }
        const definitions = current.definitions
          .map((document) => ({ id: document.id, data: document.data() }))
          .sort((left, right) => left.id.localeCompare(right.id));
        const requirements = current.requirements
          .map((document) => ({ id: document.id, data: document.data() }))
          .sort((left, right) => left.id.localeCompare(right.id));
        const contentHash = hashLevelCatalogValue({
          system: {
            systemId,
            displayName: current.system.displayName,
            counts: current.system.counts,
            skillCatalog: current.system.skillCatalog,
          },
          definitions,
          requirements,
        });
        const audit = auditDraft({
          academyId,
          actorId,
          action: "level.catalog.published",
          targetRef: `academies/${academyId}/levelSystems/${systemId}`,
          purpose: "level-catalog-maintenance",
          correlationId: catalogueCorrelationId(
            "level.catalog.published",
            academyId,
            systemId,
            operationId,
          ),
        });
        const auditEventId = `audit-${audit.correlationId}`;
        transaction.set(firestore.doc(`${systemsPath(academyId)}/${systemId}`), {
          ...current.system,
          status: "published",
          sourceHash: contentHash,
          contentHash,
          manifestId: systemId,
          publishedAt: at,
          publishedBy: actorId,
          updatedAt: at,
          updatedBy: actorId,
        });
        transaction.create(
          firestore.doc(`academies/${academyId}/levelCatalogManifests/${systemId}`),
          {
            manifestId: systemId,
            academyId,
            systemId,
            origin: "custom",
            status: "published",
            schemaVersion: 1,
            contentHash,
            definitionCount: definitions.length,
            requirementCount: requirements.length,
            publishedOperationId: operationId,
            publishedAuditEventId: auditEventId,
            publishedAt: at,
            publishedBy: actorId,
          },
        );
        appendAuditEventInTransaction(
          transaction,
          firestore.doc(`academies/${academyId}/auditEvents/${auditEventId}`),
          audit,
        );
        return { systemId, contentHash };
      });
    },

    async activate({ academyId, systemId, actorId }) {
      for (const value of [academyId, systemId, actorId]) assertIdentifier(value);
      const operationId = newOperationId();
      const activatedAt = now();
      return firestore.runTransaction(async (transaction) => {
        const [state, systems, heads, definitions] = await Promise.all([
          transaction.get(stateRef(academyId)),
          transaction.get(firestore.collection(systemsPath(academyId))),
          // Bounded read: one past the cap is enough to refuse an oversized activation.
          transaction.get(
            firestore
              .collection(`academies/${academyId}/studentLevelProgress`)
              .where("academyId", "==", academyId)
              .limit(maxProgressHeadsPerActivation + 1),
          ),
          transaction.get(definitionsOf(academyId, systemId)),
        ]);
        const records = systems.docs.map((document) => ({
          id: document.id,
          data: document.data(),
        }));
        const fromSystemId = activeLevelCatalogSystemId(academyId, records, state.data());
        if (fromSystemId === systemId) {
          throw new LevelEditorError("conflict", "That version is already active.");
        }
        const target = records.find(({ id }) => id === systemId)?.data;
        const contentHash = String(target?.contentHash ?? target?.sourceHash ?? "");
        if (target?.status !== "published" || !sha256Pattern.test(contentHash)) {
          throw new LevelEditorError("conflict", "Target level catalogue is not published.");
        }
        const ownHeads = heads.docs.filter((document) => document.data().academyId === academyId);
        if (ownHeads.length > maxProgressHeadsPerActivation) {
          throw new LevelEditorError("conflict", "Too many progress records for one activation.");
        }
        const targetKeys = new Set(
          definitions.docs
            .map((document) => document.data())
            .filter((definition) => definition.academyId === academyId)
            .map((definition) => String(definition.definitionKey)),
        );
        const missing = missingProgressKeys(
          targetKeys,
          ownHeads.map((document) => ({
            studentId: document.id,
            currentDefinitionKey: String(document.data().currentDefinitionKey ?? ""),
          })),
        );
        if (missing.length > 0) {
          throw new LevelEditorError(
            "missing-levels",
            "Students hold levels this version removes.",
            missing,
          );
        }
        const audit = auditDraft({
          academyId,
          actorId,
          action: "level.catalog.activated",
          targetRef: `academies/${academyId}/levelSystems/${systemId}`,
          purpose: "level-catalog-maintenance",
          correlationId: catalogueCorrelationId(
            "level.catalog.activated",
            academyId,
            systemId,
            operationId,
          ),
          fromSystemId,
          toSystemId: systemId,
        });
        transaction.set(stateRef(academyId), {
          academyId,
          activeSystemId: systemId,
          previousSystemId: fromSystemId,
          operationId,
          contentHash,
          activatedAt,
          activatedBy: actorId,
          schemaVersion: "1",
        });
        transaction.create(
          firestore.doc(`academies/${academyId}/levelCatalogActivations/${operationId}`),
          {
            academyId,
            fromSystemId,
            toSystemId: systemId,
            operationId,
            contentHash,
            actorId,
            activatedAt,
            movedStudents: ownHeads.length,
            schemaVersion: "1",
          },
        );
        // Only the version pointer changes: the held level and its start date stay as they are.
        for (const head of ownHeads) {
          transaction.set(head.ref, { systemId }, { merge: true });
        }
        appendAuditEventInTransaction(
          transaction,
          firestore.doc(`academies/${academyId}/auditEvents/audit-${audit.correlationId}`),
          audit,
        );
        return {
          activeSystemId: systemId,
          previousSystemId: fromSystemId,
          movedStudents: ownHeads.length,
        };
      });
    },
  };
}
