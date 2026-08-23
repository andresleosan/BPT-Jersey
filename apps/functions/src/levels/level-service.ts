import type {
  LevelCatalogProjection,
  LevelDefinitionRecord,
  LevelRequirementRecord,
  LevelSystemRecord,
} from "@bpt-jersey/domain/levels";
import type { NormalizedLevelCatalog } from "./level-source";

export class LevelStoreError extends Error {
  public readonly code: "invalid" | "tenant" | "not-found" | "conflict";

  public constructor(code: "invalid" | "tenant" | "not-found" | "conflict", message: string) {
    super(message);
    this.name = "LevelStoreError";
    this.code = code;
  }
}

export type LevelSeedResult = Readonly<{
  systemId: string;
  sourceHash: string;
  definitionCount: number;
  beltCount: number;
  stripeCount: number;
  skillCount: number;
  requirementCount: number;
  idempotent: boolean;
}>;

export type LevelRollbackResult = Readonly<{
  systemId: string;
  deletedDefinitions: number;
  deletedRequirements: number;
  deletedSystems: number;
}>;

export type LevelCatalogStore = Readonly<{
  listPublished: (academyId: string) => Promise<LevelCatalogProjection>;
  seed: (input: {
    academyId: string;
    normalized: NormalizedLevelCatalog;
  }) => Promise<LevelSeedResult>;
  rollback: (input: { academyId: string; systemId: string }) => Promise<LevelRollbackResult>;
}>;

const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function assertValidAcademyId(academyId: string): void {
  if (!safeIdentifierPattern.test(academyId)) {
    throw new LevelStoreError("invalid", `Invalid academyId: ${academyId}`);
  }
}

export type GenericFirestore = {
  doc: (path: string) => {
    get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
    set: (data: Record<string, unknown>) => Promise<unknown>;
    delete: () => Promise<unknown>;
  };
  collection: (path: string) => {
    get: () => Promise<{
      docs: readonly {
        id: string;
        data: () => Record<string, unknown>;
        ref: { delete: () => Promise<unknown> };
      }[];
    }>;
  };
  batch: () => {
    set: (ref: unknown, data: unknown) => void;
    delete: (ref: unknown) => void;
    commit: () => Promise<unknown>;
  };
};

export function createLevelCatalogStore({
  firestore,
}: {
  firestore: GenericFirestore;
}): LevelCatalogStore {
  return {
    async listPublished(academyId: string): Promise<LevelCatalogProjection> {
      assertValidAcademyId(academyId);

      const systemsSnapshot = await firestore
        .collection(`academies/${academyId}/levelSystems`)
        .get();

      const publishedDoc = systemsSnapshot.docs.find(
        (d) => d.data()["status"] === "published" || d.id === "ibjjf-v1",
      );

      if (!publishedDoc) {
        throw new LevelStoreError(
          "not-found",
          `No published level system found for academy: ${academyId}`,
        );
      }

      const systemData = publishedDoc.data();
      const systemId = publishedDoc.id;
      const sourceHash = String(systemData["sourceHash"] ?? "");

      const definitionsSnapshot = await firestore
        .collection(`academies/${academyId}/levelDefinitions`)
        .get();

      const definitions: LevelDefinitionRecord[] = definitionsSnapshot.docs
        .map((d) => d.data() as unknown as LevelDefinitionRecord)
        .filter((d) => d.systemId === systemId)
        .sort((a, b) => a.sequence - b.sequence);

      const requirementsSnapshot = await firestore
        .collection(`academies/${academyId}/levelRequirements`)
        .get();

      const requirements: LevelRequirementRecord[] = requirementsSnapshot.docs
        .map((d) => d.data() as unknown as LevelRequirementRecord)
        .filter((d) => d.systemId === systemId);

      const systemRecord: LevelSystemRecord = {
        systemId,
        displayName: String(systemData["displayName"] ?? "JIU-JITSU - IBJJF"),
        schemaVersion: 1,
        precedence: systemData["precedence"] as LevelSystemRecord["precedence"],
        counts: systemData["counts"] as LevelSystemRecord["counts"],
        skillCatalog: (systemData["skillCatalog"] ?? []) as LevelSystemRecord["skillCatalog"],
      };

      return Object.freeze({
        system: systemRecord,
        definitions: Object.freeze(definitions),
        skills: systemRecord.skillCatalog,
        requirements: Object.freeze(requirements),
        sourceHash,
      });
    },

    async seed(input: {
      academyId: string;
      normalized: NormalizedLevelCatalog;
    }): Promise<LevelSeedResult> {
      assertValidAcademyId(input.academyId);
      const { academyId, normalized } = input;
      const systemId = normalized.system.systemId;

      const systemRef = firestore.doc(`academies/${academyId}/levelSystems/${systemId}`);
      const systemSnap = await systemRef.get();

      if (systemSnap.exists) {
        const existingData = systemSnap.data();
        const existingHash = existingData?.["sourceHash"];
        if (existingHash === normalized.sourceHash) {
          return {
            systemId,
            sourceHash: normalized.sourceHash,
            definitionCount: normalized.definitions.length,
            beltCount: normalized.definitions.filter((d) => d.kind === "belt").length,
            stripeCount: normalized.definitions.filter((d) => d.kind === "stripe").length,
            skillCount: normalized.skills.length,
            requirementCount: normalized.requirements.length,
            idempotent: true,
          };
        } else {
          throw new LevelStoreError(
            "conflict",
            `System ${systemId} already exists with a different source hash.`,
          );
        }
      }

      // Write system document
      await systemRef.set({
        ...normalized.system,
        academyId,
        sourceHash: normalized.sourceHash,
        status: "published",
      });

      // Write definitions and requirements in chunks if needed
      for (const def of normalized.definitions) {
        const defRef = firestore.doc(
          `academies/${academyId}/levelDefinitions/${def.definitionKey}`,
        );
        await defRef.set({ ...def, academyId });
      }

      for (const req of normalized.requirements) {
        const reqRef = firestore.doc(
          `academies/${academyId}/levelRequirements/${req.requirementKey}`,
        );
        await reqRef.set({ ...req, academyId });
      }

      return {
        systemId,
        sourceHash: normalized.sourceHash,
        definitionCount: normalized.definitions.length,
        beltCount: normalized.definitions.filter((d) => d.kind === "belt").length,
        stripeCount: normalized.definitions.filter((d) => d.kind === "stripe").length,
        skillCount: normalized.skills.length,
        requirementCount: normalized.requirements.length,
        idempotent: false,
      };
    },

    async rollback(input: { academyId: string; systemId: string }): Promise<LevelRollbackResult> {
      assertValidAcademyId(input.academyId);
      const { academyId, systemId } = input;

      const systemRef = firestore.doc(`academies/${academyId}/levelSystems/${systemId}`);
      const systemSnap = await systemRef.get();
      if (!systemSnap.exists) {
        throw new LevelStoreError(
          "not-found",
          `Level system ${systemId} does not exist in academy ${academyId}`,
        );
      }

      const defsSnap = await firestore.collection(`academies/${academyId}/levelDefinitions`).get();
      let deletedDefs = 0;
      for (const doc of defsSnap.docs) {
        if (doc.data()["systemId"] === systemId) {
          await doc.ref.delete();
          deletedDefs++;
        }
      }

      const reqsSnap = await firestore.collection(`academies/${academyId}/levelRequirements`).get();
      let deletedReqs = 0;
      for (const doc of reqsSnap.docs) {
        if (doc.data()["systemId"] === systemId) {
          await doc.ref.delete();
          deletedReqs++;
        }
      }

      await systemRef.delete();

      return {
        systemId,
        deletedDefinitions: deletedDefs,
        deletedRequirements: deletedReqs,
        deletedSystems: 1,
      };
    },
  };
}

export function createInMemoryLevelStore(): LevelCatalogStore {
  const systems = new Map<string, Record<string, unknown>>();
  const definitions = new Map<string, Record<string, unknown>>();
  const requirements = new Map<string, Record<string, unknown>>();

  return {
    async listPublished(academyId: string): Promise<LevelCatalogProjection> {
      assertValidAcademyId(academyId);

      const publishedSystem = Array.from(systems.values()).find(
        (s) =>
          s["academyId"] === academyId &&
          (s["status"] === "published" || s["systemId"] === "ibjjf-v1"),
      );

      if (!publishedSystem) {
        throw new LevelStoreError(
          "not-found",
          `No published level system found for academy: ${academyId}`,
        );
      }

      const systemId = publishedSystem["systemId"] as string;
      const systemDefs = Array.from(definitions.values())
        .filter((d) => d["academyId"] === academyId && d["systemId"] === systemId)
        .map((d) => d as unknown as LevelDefinitionRecord)
        .sort((a, b) => a.sequence - b.sequence);

      const systemReqs = Array.from(requirements.values())
        .filter((r) => r["academyId"] === academyId && r["systemId"] === systemId)
        .map((r) => r as unknown as LevelRequirementRecord);

      return Object.freeze({
        system: publishedSystem as unknown as LevelSystemRecord,
        definitions: Object.freeze(systemDefs),
        skills: (publishedSystem["skillCatalog"] ?? []) as LevelSystemRecord["skillCatalog"],
        requirements: Object.freeze(systemReqs),
        sourceHash: publishedSystem["sourceHash"] as string,
      });
    },

    async seed(input: {
      academyId: string;
      normalized: NormalizedLevelCatalog;
    }): Promise<LevelSeedResult> {
      assertValidAcademyId(input.academyId);
      const { academyId, normalized } = input;
      const systemKey = `${academyId}__${normalized.system.systemId}`;

      const existing = systems.get(systemKey);
      if (existing) {
        if (existing["sourceHash"] === normalized.sourceHash) {
          return {
            systemId: normalized.system.systemId,
            sourceHash: normalized.sourceHash,
            definitionCount: normalized.definitions.length,
            beltCount: normalized.definitions.filter((d) => d.kind === "belt").length,
            stripeCount: normalized.definitions.filter((d) => d.kind === "stripe").length,
            skillCount: normalized.skills.length,
            requirementCount: normalized.requirements.length,
            idempotent: true,
          };
        } else {
          throw new LevelStoreError(
            "conflict",
            `System ${normalized.system.systemId} already exists with a different source hash.`,
          );
        }
      }

      systems.set(systemKey, {
        ...normalized.system,
        academyId,
        sourceHash: normalized.sourceHash,
        status: "published",
      });

      for (const def of normalized.definitions) {
        const defKey = `${academyId}__${def.definitionKey}`;
        definitions.set(defKey, { ...def, academyId });
      }

      for (const req of normalized.requirements) {
        const reqKey = `${academyId}__${req.requirementKey}`;
        requirements.set(reqKey, { ...req, academyId });
      }

      return {
        systemId: normalized.system.systemId,
        sourceHash: normalized.sourceHash,
        definitionCount: normalized.definitions.length,
        beltCount: normalized.definitions.filter((d) => d.kind === "belt").length,
        stripeCount: normalized.definitions.filter((d) => d.kind === "stripe").length,
        skillCount: normalized.skills.length,
        requirementCount: normalized.requirements.length,
        idempotent: false,
      };
    },

    async rollback(input: { academyId: string; systemId: string }): Promise<LevelRollbackResult> {
      assertValidAcademyId(input.academyId);
      const { academyId, systemId } = input;
      const systemKey = `${academyId}__${systemId}`;

      if (!systems.has(systemKey)) {
        throw new LevelStoreError(
          "not-found",
          `Level system ${systemId} not found for academy ${academyId}`,
        );
      }

      systems.delete(systemKey);

      let deletedDefs = 0;
      for (const [key, def] of definitions.entries()) {
        if (def["academyId"] === academyId && def["systemId"] === systemId) {
          definitions.delete(key);
          deletedDefs++;
        }
      }

      let deletedReqs = 0;
      for (const [key, req] of requirements.entries()) {
        if (req["academyId"] === academyId && req["systemId"] === systemId) {
          requirements.delete(key);
          deletedReqs++;
        }
      }

      return {
        systemId,
        deletedDefinitions: deletedDefs,
        deletedRequirements: deletedReqs,
        deletedSystems: 1,
      };
    },
  };
}
