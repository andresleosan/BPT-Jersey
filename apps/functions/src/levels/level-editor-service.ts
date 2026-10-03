import { createHash, randomUUID } from "node:crypto";

import { parseAuditEventDraft, type AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  isCustomLevelSystemId,
  type CatalogLevel,
  type CatalogSkill,
  type EditableLevelCatalog,
  type SaveLevelCatalogInput,
} from "@bpt-jersey/domain/levels/editor";

import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { hashLevelCatalogValue, levelCatalogStorageId } from "./level-catalog-integrity.js";

/**
 * The academy's one belt catalogue, edited in place. The active system must be custom (the
 * adoption CLI makes it so). A save may change names, colours, criteria and techniques; the set
 * of belts and stripes is locked. Only documents whose content changed are written.
 */
export type LevelEditorErrorCode = "invalid" | "not-found" | "conflict" | "stale";

export class LevelEditorError extends Error {
  public readonly code: LevelEditorErrorCode;

  public constructor(code: LevelEditorErrorCode, message: string) {
    super(message);
    this.name = "LevelEditorError";
    this.code = code;
  }
}

type StoredData = Record<string, unknown>;
type EditorSnapshot = Readonly<{ exists: boolean; data: () => StoredData | undefined }>;
type EditorDocumentReference = Readonly<{ id: string; path?: string }>;
type EditorQueryDocument = Readonly<{
  id: string;
  data: () => StoredData;
  ref: EditorDocumentReference;
}>;
type EditorQuerySnapshot = Readonly<{ docs: readonly EditorQueryDocument[] }>;
type EditorQuery = Readonly<{ get: () => Promise<EditorQuerySnapshot> }>;
type EditorCollection = EditorQuery &
  Readonly<{ where: (field: string, operator: "==", value: unknown) => EditorQuery }>;
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
  getEditable: (academyId: string) => Promise<EditableLevelCatalog>;
  save: (input: {
    academyId: string;
    catalog: SaveLevelCatalogInput;
    actorId: string;
  }) => Promise<EditableLevelCatalog>;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const activeStateId = "active";
// ponytail: one transaction per save; a save touching more docs than this is refused, not split.
const maxWritesPerSave = 450;

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

function byId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function criteriaOf(value: unknown): CatalogLevel["criteria"] {
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

/** Stored documents in editor form. A belt's techniques are the requirements on the belt itself. */
export function editableContent(
  systemId: string,
  system: StoredData,
  definitions: readonly StoredData[],
  requirements: readonly StoredData[],
): EditableLevelCatalog {
  const children = new Map<string, number>();
  const belts = new Set<string>();
  for (const definition of definitions) {
    const parent = definition.parentDefinitionKey;
    if (definition.kind === "stripe" && typeof parent === "string") {
      children.set(parent, (children.get(parent) ?? 0) + 1);
    } else {
      belts.add(String(definition.definitionKey));
    }
  }
  return {
    systemId,
    updatedAt: stringOr(system.updatedAt, "never"),
    displayName: stringOr(system.displayName, systemId),
    levels: [...definitions].sort(bySequence).map((definition) => {
      const visual = isRecord(definition.visual) ? definition.visual : {};
      const key = String(definition.definitionKey);
      return {
        definitionKey: key,
        kind: definition.kind === "stripe" ? ("stripe" as const) : ("belt" as const),
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
        minimumRating: numberOr(skill.minimumRating, 1),
        sequence: numberOr(skill.sequence, 1),
      })),
    beltTechniques: requirements
      .filter((requirement) => belts.has(String(requirement.definitionKey)))
      .map((requirement) => ({
        beltKey: String(requirement.definitionKey),
        skillKey: String(requirement.skillKey),
        minimumRating: numberOr(requirement.minimumRating, 1),
      }))
      .sort((left, right) =>
        `${left.beltKey}__${left.skillKey}`.localeCompare(`${right.beltKey}__${right.skillKey}`),
      ),
  };
}

function sameStructure(stored: StoredData, level: CatalogLevel): boolean {
  return (
    stored.kind === level.kind &&
    (stored.parentDefinitionKey ?? null) === level.parentDefinitionKey &&
    stored.sequence === level.sequence &&
    (stored.stripeNumber ?? null) === level.stripeNumber
  );
}

/** A stripe always wears its belt's colours. */
function nextDefinition(
  previous: StoredData,
  level: CatalogLevel,
  colours: CatalogLevel["visual"],
): StoredData {
  const visual = isRecord(previous.visual) ? previous.visual : {};
  return {
    ...previous,
    name: level.name,
    criteria: level.criteria,
    visual: { ...visual, colors: [...colours.colors], stripeColor: colours.stripeColor },
  };
}

export function requirementDocument(
  academyId: string,
  systemId: string,
  definitionKey: string,
  skillKey: string,
  minimumRating: number,
  previous: StoredData | undefined,
): StoredData {
  return {
    requirementKey: `${definitionKey}__${skillKey}`,
    systemId,
    definitionKey,
    skillKey,
    minimumRating,
    inheritance: stringOr(previous?.inheritance, "inherit"),
    schemaVersion: 1,
    academyId,
  };
}

function storedSkill(skill: CatalogSkill, sequence: number, previous: StoredData | undefined) {
  return {
    key: skill.key,
    displayLabel: skill.displayLabel,
    observedLabel: stringOr(previous?.observedLabel, null),
    minimumRating: skill.minimumRating,
    sequence,
  };
}

/** sha256 of a catalogue's content, the same shape `publishDraft` sealed before. */
export function catalogueContentHash(
  systemId: string,
  system: StoredData,
  definitions: readonly { id: string; data: StoredData }[],
  requirements: readonly { id: string; data: StoredData }[],
): string {
  return hashLevelCatalogValue({
    system: {
      systemId,
      displayName: system.displayName,
      counts: system.counts,
      skillCatalog: system.skillCatalog,
    },
    definitions: [...definitions].sort(byId),
    requirements: [...requirements].sort(byId),
  });
}

export function catalogueCorrelationId(
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

export function levelCatalogAuditDraft(value: Record<string, unknown>): AuditEventDraft {
  const parsed = parseAuditEventDraft(value);
  if (!parsed.ok) throw new LevelEditorError("invalid", "Invalid level catalogue audit event.");
  return parsed.value;
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
  const ofSystem = (academyId: string, collection: string, systemId: string) =>
    firestore.collection(`academies/${academyId}/${collection}`).where("systemId", "==", systemId);

  async function readActive(transaction: LevelEditorTransaction, academyId: string) {
    const state = await transaction.get(
      firestore.doc(`academies/${academyId}/levelCatalogState/${activeStateId}`),
    );
    const systemId = state.data()?.activeSystemId;
    if (!isCustomLevelSystemId(systemId)) {
      throw new LevelEditorError("conflict", "Run the catalogue adoption first.");
    }
    const systemRef = firestore.doc(`academies/${academyId}/levelSystems/${systemId}`);
    const [system, definitions, requirements] = await Promise.all([
      transaction.get(systemRef),
      transaction.get(ofSystem(academyId, "levelDefinitions", systemId)),
      transaction.get(ofSystem(academyId, "levelRequirements", systemId)),
    ]);
    const systemData = system.data();
    if (!system.exists || systemData?.academyId !== academyId) {
      throw new LevelEditorError("not-found", "The belt catalogue does not exist.");
    }
    const own = (snapshot: EditorQuerySnapshot) =>
      snapshot.docs.filter((document) => document.data().academyId === academyId);
    return {
      systemId,
      systemRef,
      system: systemData,
      definitions: own(definitions),
      requirements: own(requirements),
    };
  }

  return {
    async getEditable(academyId) {
      assertIdentifier(academyId);
      return firestore.runTransaction(async (transaction) => {
        const active = await readActive(transaction, academyId);
        return editableContent(
          active.systemId,
          active.system,
          active.definitions.map((document) => document.data()),
          active.requirements.map((document) => document.data()),
        );
      });
    },

    async save({ academyId, catalog, actorId }) {
      for (const value of [academyId, actorId]) assertIdentifier(value);
      const operationId = newOperationId();
      const at = now();
      return firestore.runTransaction(async (transaction) => {
        const { systemId, systemRef, system, definitions, requirements } = await readActive(
          transaction,
          academyId,
        );
        if (stringOr(system.updatedAt, "never") !== catalog.expectedUpdatedAt) {
          throw new LevelEditorError("stale", "The belt catalogue changed since it was loaded.");
        }
        const stored = new Map(
          definitions.map((document) => [String(document.data().definitionKey), document]),
        );
        if (
          stored.size !== catalog.levels.length ||
          catalog.levels.some((level) => {
            const document = stored.get(level.definitionKey);
            return document === undefined || !sameStructure(document.data(), level);
          })
        ) {
          throw new LevelEditorError("invalid", "Belts and stripes cannot be added or removed.");
        }

        const writes: (() => void)[] = [];
        const levels = new Map(catalog.levels.map((level) => [level.definitionKey, level]));
        const stripesOf = new Map<string, string[]>();
        const nextDefinitions: { id: string; data: StoredData }[] = [];
        for (const level of catalog.levels) {
          const document = stored.get(level.definitionKey)!;
          const belt =
            level.kind === "stripe" ? levels.get(level.parentDefinitionKey ?? "")! : level;
          if (level.kind === "stripe") {
            const list = stripesOf.get(belt.definitionKey) ?? [];
            list.push(level.definitionKey);
            stripesOf.set(belt.definitionKey, list);
          }
          const next = nextDefinition(document.data(), level, belt.visual);
          nextDefinitions.push({ id: document.id, data: next });
          if (hashLevelCatalogValue(next) !== hashLevelCatalogValue(document.data())) {
            writes.push(() => transaction.set(document.ref, next));
          }
        }

        const previous = new Map(requirements.map((document) => [document.id, document]));
        const desired = new Map<string, StoredData>();
        for (const technique of catalog.beltTechniques) {
          for (const key of [technique.beltKey, ...(stripesOf.get(technique.beltKey) ?? [])]) {
            const id = levelCatalogStorageId(systemId, `${key}__${technique.skillKey}`);
            desired.set(
              id,
              requirementDocument(
                academyId,
                systemId,
                key,
                technique.skillKey,
                technique.minimumRating,
                previous.get(id)?.data(),
              ),
            );
          }
        }
        for (const document of requirements) {
          if (!desired.has(document.id)) writes.push(() => transaction.delete(document.ref));
        }
        for (const [id, data] of desired) {
          const before = previous.get(id)?.data();
          if (
            before === undefined ||
            hashLevelCatalogValue(before) !== hashLevelCatalogValue(data)
          ) {
            writes.push(() =>
              transaction.set(
                firestore.doc(`academies/${academyId}/levelRequirements/${id}`),
                data,
              ),
            );
          }
        }
        // +2: the system document and the audit event.
        if (writes.length + 2 > maxWritesPerSave) {
          throw new LevelEditorError("conflict", "Too many changes in one save.");
        }

        const previousSkills = new Map(
          storedSkills(system).map((skill) => [String(skill.key), skill]),
        );
        const nextSystem: StoredData = {
          ...system,
          displayName: catalog.displayName,
          skillCatalog: catalog.skills.map((skill, index) =>
            storedSkill(skill, index + 1, previousSkills.get(skill.key)),
          ),
          updatedAt: at,
          updatedBy: actorId,
        };
        const nextRequirements = [...desired].map(([id, data]) => ({ id, data }));
        const contentHash = catalogueContentHash(
          systemId,
          nextSystem,
          nextDefinitions,
          nextRequirements,
        );
        nextSystem.contentHash = contentHash;
        nextSystem.sourceHash = contentHash;
        const audit = levelCatalogAuditDraft({
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

        for (const write of writes) write();
        transaction.set(systemRef, nextSystem);
        appendAuditEventInTransaction(
          transaction,
          firestore.doc(`academies/${academyId}/auditEvents/audit-${audit.correlationId}`),
          audit,
        );
        return editableContent(
          systemId,
          nextSystem,
          nextDefinitions.map(({ data }) => data),
          nextRequirements.map(({ data }) => data),
        );
      });
    },
  };
}
