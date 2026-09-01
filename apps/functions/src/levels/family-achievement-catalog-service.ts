import {
  buildFamilyAchievementSummary,
  type FamilyAchievementDefinition,
  type FamilyGoalDefinition,
} from "@bpt-jersey/domain/levels/achievements";

export class FamilyAchievementCatalogStoreError extends Error {
  public readonly code: "invalid" | "tenant" | "not-found" | "conflict";

  public constructor(code: "invalid" | "tenant" | "not-found" | "conflict", message: string) {
    super(message);
    this.name = "FamilyAchievementCatalogStoreError";
    this.code = code;
  }
}

export type FamilyAchievementCatalog = Readonly<{
  goals: readonly FamilyGoalDefinition[];
  achievements: readonly FamilyAchievementDefinition[];
}>;

export type FamilyAchievementCatalogWriteResult = Readonly<{
  goalCount: number;
  achievementCount: number;
  idempotent: boolean;
}>;

export type FamilyAchievementCatalogStore = Readonly<{
  getCatalog: (academyId: string) => Promise<FamilyAchievementCatalog>;
  saveCatalog: (input: {
    academyId: string;
    catalog: FamilyAchievementCatalog;
  }) => Promise<FamilyAchievementCatalogWriteResult>;
}>;

type CatalogRecord = Readonly<{
  academyId: string;
  schemaVersion: 1;
}>;

type GenericDocumentReference = Readonly<{
  id: string;
  get: () => Promise<{
    exists: boolean;
    data: () => Record<string, unknown> | undefined;
  }>;
}>;

export type GenericFamilyAchievementCatalogFirestore = Readonly<{
  doc: (path: string) => GenericDocumentReference;
  collection: (path: string) => Readonly<{
    get: () => Promise<{
      docs: readonly { id: string; data: () => Record<string, unknown> }[];
    }>;
  }>;
  runTransaction: <T>(
    update: (transaction: {
      get: (reference: GenericDocumentReference) => Promise<{
        exists: boolean;
        data: () => Record<string, unknown> | undefined;
      }>;
      create: (
        reference: GenericDocumentReference,
        data: Readonly<Record<string, unknown>>,
      ) => void;
    }) => Promise<T>,
  ) => Promise<T>;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) {
    throw new FamilyAchievementCatalogStoreError("invalid", label + " is invalid");
  }
}

function normalizeCatalog(catalog: FamilyAchievementCatalog): FamilyAchievementCatalog {
  if (!Array.isArray(catalog.goals) || !Array.isArray(catalog.achievements)) {
    throw new FamilyAchievementCatalogStoreError(
      "invalid",
      "Family achievement catalog is invalid",
    );
  }
  const parsed = buildFamilyAchievementSummary({
    familyId: "catalog-validation",
    now: "2026-01-01T00:00:00.000Z",
    goals: catalog.goals,
    achievements: catalog.achievements,
    members: [],
  });
  if (!parsed.ok) {
    throw new FamilyAchievementCatalogStoreError(
      "invalid",
      "Family achievement catalog is invalid",
    );
  }
  return Object.freeze({
    goals: Object.freeze(catalog.goals.map((goal) => Object.freeze({ ...goal }))),
    achievements: Object.freeze(
      catalog.achievements.map((achievement) => Object.freeze({ ...achievement })),
    ),
  });
}

function goalRecord(
  academyId: string,
  goal: FamilyGoalDefinition,
): CatalogRecord & FamilyGoalDefinition {
  return Object.freeze({ academyId, ...goal, schemaVersion: 1 });
}

function achievementRecord(
  academyId: string,
  achievement: FamilyAchievementDefinition,
): CatalogRecord & FamilyAchievementDefinition {
  return Object.freeze({ academyId, ...achievement, schemaVersion: 1 });
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseGoal(
  academyId: string,
  id: string,
  data: Record<string, unknown>,
): FamilyGoalDefinition {
  const value = {
    goalId: data.goalId,
    label: data.label,
    metric: data.metric,
    target: data.target,
  };
  if (
    Object.keys(data).length !== 6 ||
    data.schemaVersion !== 1 ||
    data.academyId !== academyId ||
    data.goalId !== id
  ) {
    throw new FamilyAchievementCatalogStoreError("invalid", "Persisted family goal is invalid");
  }
  const normalized = normalizeCatalog({ goals: [value as FamilyGoalDefinition], achievements: [] });
  return normalized.goals[0]!;
}

function parseAchievement(
  academyId: string,
  id: string,
  data: Record<string, unknown>,
): FamilyAchievementDefinition {
  const value = {
    achievementId: data.achievementId,
    label: data.label,
    metric: data.metric,
    target: data.target,
  };
  if (
    Object.keys(data).length !== 6 ||
    data.schemaVersion !== 1 ||
    data.academyId !== academyId ||
    data.achievementId !== id
  ) {
    throw new FamilyAchievementCatalogStoreError(
      "invalid",
      "Persisted family achievement is invalid",
    );
  }
  const normalized = normalizeCatalog({
    goals: [],
    achievements: [value as FamilyAchievementDefinition],
  });
  return normalized.achievements[0]!;
}

function validateAcademyCatalog(
  academyId: string,
  catalog: FamilyAchievementCatalog,
): FamilyAchievementCatalog {
  assertIdentifier(academyId, "academyId");
  return normalizeCatalog(catalog);
}

export function createInMemoryFamilyAchievementCatalogStore(): FamilyAchievementCatalogStore {
  const goals = new Map<string, CatalogRecord & FamilyGoalDefinition>();
  const achievements = new Map<string, CatalogRecord & FamilyAchievementDefinition>();

  return {
    async getCatalog(academyId) {
      assertIdentifier(academyId, "academyId");
      const storedGoals = [...goals.values()]
        .filter((goal) => goal.academyId === academyId)
        .sort((left, right) => left.goalId.localeCompare(right.goalId))
        .map((goal) => ({
          goalId: goal.goalId,
          label: goal.label,
          metric: goal.metric,
          target: goal.target,
        }));
      const storedAchievements = [...achievements.values()]
        .filter((achievement) => achievement.academyId === academyId)
        .sort((left, right) => left.achievementId.localeCompare(right.achievementId))
        .map((achievement) => ({
          achievementId: achievement.achievementId,
          label: achievement.label,
          metric: achievement.metric,
          target: achievement.target,
        }));
      if (storedGoals.length === 0 && storedAchievements.length === 0) {
        throw new FamilyAchievementCatalogStoreError(
          "not-found",
          "Family achievement catalog not found",
        );
      }
      return Object.freeze({
        goals: Object.freeze(storedGoals),
        achievements: Object.freeze(storedAchievements),
      });
    },

    async saveCatalog(input) {
      const catalog = validateAcademyCatalog(input.academyId, input.catalog);
      const goalRecords = catalog.goals.map((goal) => goalRecord(input.academyId, goal));
      const achievementRecords = catalog.achievements.map((achievement) =>
        achievementRecord(input.academyId, achievement),
      );
      const existingGoals = goalRecords.map((goal) =>
        goals.get(input.academyId + "/" + goal.goalId),
      );
      const existingAchievements = achievementRecords.map((achievement) =>
        achievements.get(input.academyId + "/" + achievement.achievementId),
      );
      const allExisting = [...existingGoals, ...existingAchievements].every(
        (existing) => existing !== undefined,
      );
      if (allExisting) {
        if (
          existingGoals.some((existing, index) => !same(existing, goalRecords[index])) ||
          existingAchievements.some((existing, index) => !same(existing, achievementRecords[index]))
        ) {
          throw new FamilyAchievementCatalogStoreError(
            "conflict",
            "Family achievement catalog differs",
          );
        }
        return Object.freeze({
          goalCount: goalRecords.length,
          achievementCount: achievementRecords.length,
          idempotent: true,
        });
      }
      if ([...existingGoals, ...existingAchievements].some((existing) => existing !== undefined)) {
        throw new FamilyAchievementCatalogStoreError(
          "conflict",
          "Family achievement catalog is incomplete",
        );
      }
      goalRecords.forEach((goal) => goals.set(input.academyId + "/" + goal.goalId, goal));
      achievementRecords.forEach((achievement) =>
        achievements.set(input.academyId + "/" + achievement.achievementId, achievement),
      );
      return Object.freeze({
        goalCount: goalRecords.length,
        achievementCount: achievementRecords.length,
        idempotent: false,
      });
    },
  };
}

export function createFirestoreFamilyAchievementCatalogStore({
  firestore,
}: {
  firestore: GenericFamilyAchievementCatalogFirestore;
}): FamilyAchievementCatalogStore {
  return {
    async getCatalog(academyId) {
      assertIdentifier(academyId, "academyId");
      const [goalSnapshot, achievementSnapshot] = await Promise.all([
        firestore.collection("academies/" + academyId + "/familyGoals").get(),
        firestore.collection("academies/" + academyId + "/familyAchievements").get(),
      ]);
      const goals = goalSnapshot.docs
        .map((document) => parseGoal(academyId, document.id, document.data()))
        .sort((left, right) => left.goalId.localeCompare(right.goalId));
      const achievements = achievementSnapshot.docs
        .map((document) => parseAchievement(academyId, document.id, document.data()))
        .sort((left, right) => left.achievementId.localeCompare(right.achievementId));
      if (goals.length === 0 && achievements.length === 0) {
        throw new FamilyAchievementCatalogStoreError(
          "not-found",
          "Family achievement catalog not found",
        );
      }
      return Object.freeze({
        goals: Object.freeze(goals),
        achievements: Object.freeze(achievements),
      });
    },

    async saveCatalog(input) {
      const catalog = validateAcademyCatalog(input.academyId, input.catalog);
      const goalRecords = catalog.goals.map((goal) => goalRecord(input.academyId, goal));
      const achievementRecords = catalog.achievements.map((achievement) =>
        achievementRecord(input.academyId, achievement),
      );
      const entries = [
        ...goalRecords.map((goal) => ({
          record: goal,
          reference: firestore.doc("academies/" + input.academyId + "/familyGoals/" + goal.goalId),
        })),
        ...achievementRecords.map((achievement) => ({
          record: achievement,
          reference: firestore.doc(
            "academies/" + input.academyId + "/familyAchievements/" + achievement.achievementId,
          ),
        })),
      ];
      return firestore.runTransaction(async (transaction) => {
        const states = await Promise.all(
          entries.map(async (entry) => ({
            ...entry,
            state: await transaction.get(entry.reference),
          })),
        );
        if (states.every((entry) => entry.state.exists)) {
          if (states.some((entry) => !same(entry.state.data(), entry.record))) {
            throw new FamilyAchievementCatalogStoreError(
              "conflict",
              "Family achievement catalog differs",
            );
          }
          return Object.freeze({
            goalCount: goalRecords.length,
            achievementCount: achievementRecords.length,
            idempotent: true,
          });
        }
        if (states.some((entry) => entry.state.exists)) {
          throw new FamilyAchievementCatalogStoreError(
            "conflict",
            "Family achievement catalog is incomplete",
          );
        }
        entries.forEach((entry) => transaction.create(entry.reference, entry.record));
        return Object.freeze({
          goalCount: goalRecords.length,
          achievementCount: achievementRecords.length,
          idempotent: false,
        });
      });
    },
  };
}
