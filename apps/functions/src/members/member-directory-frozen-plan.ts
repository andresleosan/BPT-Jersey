import {
  memberDirectoryOperationReceiptSchema,
  type MemberDirectoryOperationReceipt,
} from "@bpt-jersey/domain/members/directory-migration";
import {
  assertMemberDirectoryManifestUnexpired,
  assertMemberDirectoryPlanCoversManifest,
  assertMemberDirectoryReceiptMatchesManifest,
  memberDirectoryPrivateManifestSchema,
  memberDirectoryPrivateOutputPlanSchema,
  type MemberDirectoryPrivateManifest,
  type MemberDirectoryPrivateOutputPlan,
} from "@bpt-jersey/domain/members/directory-private-plan";

import {
  constantTimeMacEquals,
  createMemberDirectoryPrivateManifestMac,
  createMemberDirectoryPrivatePlanMac,
  createMemberDirectorySourceSetMac,
} from "./member-directory-crypto.js";

/**
 * The frozen private plan of a directory-forward operation, opened and proven (T108).
 *
 * The reviewed manifest and the output plan live outside Firestore. What the database holds is the
 * operation receipt, and the receipt is only evidence if the artifacts handed to a runner are the
 * artifacts it was frozen against. This is the one place that decides that, so the forward runner,
 * compensation and any later reader all ask the same question in the same words.
 *
 * **Why it is not enough to check one MAC.** The receipt binds three: the manifest, the plan and the
 * source set. Each covers something the others do not - the mapping a human reviewed, the documents
 * that mapping produces, and the state of the legacy rows at the moment of review - and dropping any
 * one of them leaves a way to execute against an artifact nobody approved. The plan carries the
 * manifest's MAC as well, so the pair is also self-binding: a plan cannot be re-paired with a
 * different manifest even by a caller that holds both.
 *
 * **What it deliberately does not do.** It never opens the store and never reads Firestore. The
 * artifacts arrive as values, so the same proof runs in a unit test and in production against
 * whatever the approved artifact store hands back.
 */

export type MemberDirectoryFrozenPlan = Readonly<{
  receipt: MemberDirectoryOperationReceipt;
  manifest: MemberDirectoryPrivateManifest;
  plan: MemberDirectoryPrivateOutputPlan;
}>;

export type MemberDirectoryFrozenPlanInput = Readonly<{
  receipt: unknown;
  manifest: unknown;
  plan: unknown;
  /** The operation clock, against which the manifest window is judged. */
  now: string;
  integritySecretMaterial: string;
}>;

function frozenPlanFailure(reason: string): never {
  throw new Error(`Member directory frozen plan refused: ${reason}`);
}

/**
 * The artifact store hands back a port-shaped pair. It is declared here rather than in the runner
 * that first needs it, because the manifest and the plan are always opened together: a runner that
 * could fetch one without the other would be able to prove half of what it needs.
 */
export type MemberDirectoryFrozenPlanArtifacts = Readonly<{
  manifest: unknown;
  plan: unknown;
}>;

export type MemberDirectoryFrozenPlanStore = Readonly<{
  open(
    input: Readonly<{ academyId: string; operationId: string }>,
  ): Promise<MemberDirectoryFrozenPlanArtifacts>;
}>;

/**
 * Parses and proves a frozen manifest and output plan against the operation receipt that named
 * them, and returns the three as one value nothing downstream needs to re-verify.
 */
export function openMemberDirectoryFrozenPlan(
  input: MemberDirectoryFrozenPlanInput,
): MemberDirectoryFrozenPlan {
  const receipt = memberDirectoryOperationReceiptSchema.parse(input.receipt);
  const manifest = memberDirectoryPrivateManifestSchema.parse(input.manifest);
  const plan = memberDirectoryPrivateOutputPlanSchema.parse(input.plan);

  if (receipt.phase !== "forward") {
    // Only the forward phase has a reviewed manifest. Accepting another phase's receipt here would
    // prove a mapping against evidence that was never about one.
    frozenPlanFailure("only a forward receipt has a reviewed manifest");
  }

  assertMemberDirectoryPlanCoversManifest(manifest, plan);
  assertMemberDirectoryReceiptMatchesManifest(receipt, manifest);
  assertMemberDirectoryManifestUnexpired(manifest, input.now);

  const manifestMac = createMemberDirectoryPrivateManifestMac({
    manifest,
    secretMaterial: input.integritySecretMaterial,
  });
  if (!constantTimeMacEquals(manifestMac, receipt.privateManifestMac)) {
    frozenPlanFailure("the reviewed manifest is not the one this receipt was frozen against");
  }
  if (!constantTimeMacEquals(manifestMac, plan.privateManifestMac)) {
    // The pair is self-binding as well as receipt-bound: this catches a plan built over a manifest
    // that the receipt would have accepted for other reasons.
    frozenPlanFailure("the output plan was built over a different manifest");
  }

  const planMac = createMemberDirectoryPrivatePlanMac({
    plan,
    secretMaterial: input.integritySecretMaterial,
  });
  if (!constantTimeMacEquals(planMac, receipt.planMac)) {
    frozenPlanFailure("the output plan is not the one this receipt was frozen against");
  }

  const sourceSetMac = createMemberDirectorySourceSetMac({
    academyId: manifest.academyId,
    operationId: manifest.operationId,
    rows: manifest.rows.map((row) => ({
      sourceId: row.sourceLegacyId,
      sourceRowMac: row.sourceRowMac,
    })),
    secretMaterial: input.integritySecretMaterial,
  });
  if (!constantTimeMacEquals(sourceSetMac, receipt.sourceMac)) {
    frozenPlanFailure("the manifest describes a different set of source rows than the receipt");
  }

  /**
   * The receipt's expected roots are the plan's, chunk for chunk and in order. Without this the
   * receipt could approve a set of output roots that no chunk of this plan will ever produce, and
   * the mismatch would only surface at the last chunk - after the earlier ones had already written.
   */
  const expectedRoots = plan.chunks.map((chunk) => chunk.expectedOutputSetMac);
  if (receipt.expectedOutputSetMacRoots.length !== expectedRoots.length) {
    frozenPlanFailure("the receipt expects a different number of chunk output roots than the plan");
  }
  expectedRoots.forEach((root, index) => {
    const approved = receipt.expectedOutputSetMacRoots[index];
    if (approved === undefined || !constantTimeMacEquals(approved, root)) {
      frozenPlanFailure(
        `the receipt does not approve the output root of chunk ${String(index + 1)}`,
      );
    }
  });

  return Object.freeze({ receipt, manifest, plan });
}

/**
 * The manifest row a given source ID maps to, refusing anything the plan does not cover.
 *
 * Executors take their rows through this rather than by scanning the manifest themselves, so the
 * "one source mapped once" rule is read where it is used and not only where it is declared.
 */
export function requireMemberDirectoryManifestRow(
  frozen: MemberDirectoryFrozenPlan,
  sourceLegacyId: string,
): MemberDirectoryPrivateManifest["rows"][number] {
  const matches = frozen.manifest.rows.filter((row) => row.sourceLegacyId === sourceLegacyId);
  const row = matches[0];
  if (row === undefined || matches.length !== 1) {
    frozenPlanFailure(`the manifest does not map exactly one row for ${sourceLegacyId}`);
  }
  return row;
}
