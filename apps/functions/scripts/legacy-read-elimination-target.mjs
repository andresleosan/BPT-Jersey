const productionProjectId = "bptjersey-f5a25";
const emulatorProjectId = "demo-bpt-jersey";
const emulatorHost = "127.0.0.1:8080";

export const productionLegacyReadEliminationApplyConfirmation =
  "T097-GLOBAL-LEGACY-ELIMINATE-PRODUCTION-APPLY";

const allowedOptions = new Set([
  "project",
  "target",
  "academy-id",
  "apply",
  "confirmation",
  "actor-id",
  "production-confirmation",
]);

export class LegacyReadEliminationCliError extends Error {}

function unsafeTarget() {
  throw new LegacyReadEliminationCliError("Legacy-read elimination target is not safe.");
}

function firebaseConfigProjectId(value) {
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || typeof parsed.projectId !== "string") {
      return unsafeTarget();
    }
    return parsed.projectId;
  } catch {
    return unsafeTarget();
  }
}

/** Strict `--name value` / `--name=value` flags; `--apply` alone takes no value. */
export function parseLegacyReadEliminationArguments(values) {
  const options = Object.create(null);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--apply") {
      if (options.apply === true) throw new LegacyReadEliminationCliError("Duplicate --apply.");
      options.apply = true;
      continue;
    }
    if (!value.startsWith("--")) {
      throw new LegacyReadEliminationCliError("Unexpected positional argument.");
    }
    const separator = value.indexOf("=");
    const name = separator > 2 ? value.slice(2, separator) : value.slice(2);
    if (!allowedOptions.has(name) || name === "apply") {
      throw new LegacyReadEliminationCliError(`Unknown --${name}.`);
    }
    let optionValue;
    if (separator > 2) {
      optionValue = value.slice(separator + 1);
    } else {
      optionValue = values[index + 1];
      if (optionValue !== undefined && optionValue.startsWith("--")) optionValue = undefined;
      else index += 1;
    }
    if (optionValue === undefined || optionValue.length === 0) {
      throw new LegacyReadEliminationCliError(`Missing value for --${name}.`);
    }
    if (Object.hasOwn(options, name)) {
      throw new LegacyReadEliminationCliError(`Duplicate --${name}.`);
    }
    options[name] = optionValue;
  }
  return { ...options };
}

export function assertLegacyReadEliminationTarget(input) {
  if (input.target !== "emulator" && input.target !== "production") unsafeTarget();
  const boundProjectIds = [
    input.projectId,
    input.environment.gcloudProjectId,
    input.environment.googleCloudProjectId,
    firebaseConfigProjectId(input.environment.firebaseConfig),
  ].filter((value) => value !== undefined);
  if (new Set(boundProjectIds).size !== 1) unsafeTarget();

  if (input.target === "emulator") {
    if (
      input.projectId !== emulatorProjectId ||
      input.environment.firestoreEmulatorHost !== emulatorHost ||
      input.productionConfirmation !== undefined
    ) {
      unsafeTarget();
    }
    return Object.freeze({ target: input.target, projectId: input.projectId });
  }

  if (
    input.projectId !== productionProjectId ||
    input.environment.firestoreEmulatorHost !== undefined ||
    (input.apply === true &&
      input.productionConfirmation !== productionLegacyReadEliminationApplyConfirmation)
  ) {
    unsafeTarget();
  }
  return Object.freeze({ target: input.target, projectId: input.projectId });
}
