const productionProjectId = "bptjersey-f5a25";
const emulatorProjectId = "demo-bpt-jersey";
const emulatorHost = "127.0.0.1:8080";

export const productionMembershipNumberApplyConfirmation =
  "T091-MEMBER-NUMBERS-PRODUCTION-APPLY";

function unsafeTarget() {
  throw new Error("Membership number reconciliation target is not safe.");
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

export function assertMembershipNumberReconciliationTarget(input) {
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
      input.productionConfirmation !== productionMembershipNumberApplyConfirmation)
  ) {
    unsafeTarget();
  }
  return Object.freeze({ target: input.target, projectId: input.projectId });
}
