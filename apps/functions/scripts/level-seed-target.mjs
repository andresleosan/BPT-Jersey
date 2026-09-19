const demoProjectId = "demo-bpt-jersey";
const demoFirestoreEmulatorHost = "127.0.0.1:8080";
const knownProductionProjectIds = new Set(["bptjersey-f5a25"]);
// Operator decision 2026-09-19 (T051V2): production only in this project, no emulator host, and
// behind its own confirmation. Mirrors apps/functions/src/levels/level-seed.ts.
const productionProjectId = "bptjersey-f5a25";
// T099 must add an operator-approved, isolated project ID before staging is enabled.
const approvedStagingProjectIds = new Set();
const firebaseProjectIdPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u;
const allowedOptionNames = new Set([
  "target",
  "academy-id",
  "system-id",
  "confirmation",
  "rollback",
]);

function unsafeTarget() {
  throw new Error("Level seed target is not safe.");
}

function normalizeProjectId(value) {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!firebaseProjectIdPattern.test(normalized)) unsafeTarget();
  return normalized;
}

function getFirebaseConfigProjectId(value) {
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || !("projectId" in parsed)) {
      return unsafeTarget();
    }
    if (typeof parsed.projectId !== "string") return unsafeTarget();
    return normalizeProjectId(parsed.projectId);
  } catch {
    return unsafeTarget();
  }
}

function isKnownProductionProject(projectId) {
  return (
    knownProductionProjectIds.has(projectId) ||
    projectId === "production" ||
    projectId === "prod" ||
    projectId.includes("production") ||
    /(?:^|-)prod(?:-|$)/u.test(projectId)
  );
}

export function parseLevelSeedArguments(arguments_) {
  const options = {};
  for (const argument of arguments_) {
    if (!argument.startsWith("--")) throw new Error("Invalid level seed arguments.");
    const option = argument.slice(2);
    const equalsIndex = option.indexOf("=");
    if (equalsIndex !== option.lastIndexOf("=")) {
      throw new Error("Invalid level seed arguments.");
    }
    const key = equalsIndex === -1 ? option : option.slice(0, equalsIndex);
    if (!allowedOptionNames.has(key) || Object.hasOwn(options, key)) {
      throw new Error("Invalid level seed arguments.");
    }
    if (key === "rollback") {
      if (equalsIndex !== -1) throw new Error("Invalid level seed arguments.");
      options[key] = true;
      continue;
    }
    if (equalsIndex === -1) throw new Error("Invalid level seed arguments.");
    const value = option.slice(equalsIndex + 1);
    if (value.length === 0 || value.trim() !== value) {
      throw new Error("Invalid level seed arguments.");
    }
    options[key] = value;
  }

  const hasTarget = typeof options.target === "string";
  const hasAcademyId = typeof options["academy-id"] === "string";
  const hasSystemId = typeof options["system-id"] === "string";
  const isRollback = options.rollback === true;
  if (
    !hasTarget ||
    !hasAcademyId ||
    (isRollback && !hasSystemId) ||
    (hasSystemId && options["system-id"] !== "ibjjf-v1" && options["system-id"] !== "ibjjf-v2")
  ) {
    throw new Error("Invalid level seed arguments.");
  }
  return options;
}

export function assertLevelSeedConfirmation(target, isRollback, confirmation) {
  let expected;
  if (target === "staging") expected = isRollback ? "T083-LEVELS-ROLLBACK" : "T083-LEVELS-SEED";
  else if (target === "production") {
    expected = isRollback ? "T051V2-LEVELS-PRODUCTION-ROLLBACK" : "T051V2-LEVELS-PRODUCTION-SEED";
  } else return;
  if (confirmation !== expected) {
    throw new Error(`Confirmation required for ${target}: ${expected}`);
  }
}

export function assertLevelSeedTargetEnvironment(target, environment) {
  if (target !== "emulator" && target !== "staging" && target !== "production") unsafeTarget();
  if (environment.nodeEnvironment?.trim().toLowerCase() === "production") unsafeTarget();
  if (environment.existingAppPresent === true && environment.existingAppProjectId === undefined) {
    unsafeTarget();
  }

  const projectIds = [
    normalizeProjectId(environment.gcloudProjectId),
    getFirebaseConfigProjectId(environment.firebaseConfig),
    normalizeProjectId(environment.existingAppProjectId),
  ].filter((projectId) => projectId !== undefined);
  const [projectId] = projectIds;
  if (projectId === undefined) unsafeTarget();
  if (new Set(projectIds).size !== 1) unsafeTarget();
  if (target === "production") {
    if (projectId !== productionProjectId || environment.firestoreEmulatorHost !== undefined) {
      unsafeTarget();
    }
    return { target, projectId };
  }
  if (isKnownProductionProject(projectId)) unsafeTarget();

  if (
    target === "emulator" &&
    (projectId !== demoProjectId ||
      environment.firestoreEmulatorHost?.trim() !== demoFirestoreEmulatorHost)
  ) {
    unsafeTarget();
  }
  if (
    target === "staging" &&
    (environment.firestoreEmulatorHost !== undefined || !approvedStagingProjectIds.has(projectId))
  ) {
    unsafeTarget();
  }

  return { target, projectId };
}
