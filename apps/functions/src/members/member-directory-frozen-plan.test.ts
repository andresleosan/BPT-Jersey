import { memberDirectoryDryRunClassifications } from "@bpt-jersey/domain/members/directory-migration";
import { describe, expect, it } from "vitest";

import {
  createMemberDirectoryPrivateManifestMac,
  createMemberDirectoryPrivatePlanMac,
  createMemberDirectorySourceSetMac,
} from "./member-directory-crypto.js";
import {
  openMemberDirectoryFrozenPlan,
  requireMemberDirectoryManifestRow,
} from "./member-directory-frozen-plan.js";

const academyId = "academy-bpt-jersey";
const operationId = "op-forward-1";
const manifestId = "manifest-forward-1";
const integritySecretMaterial = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const now = "2026-09-08T12:00:00.000Z";
const mac = (seed: string) => seed.repeat(64).slice(0, 64);

function manifestValue(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    schemaVersion: "1",
    manifestId,
    operationId,
    academyId,
    targetProjectClassification: "emulator",
    codeVersion: "885c701",
    preparedAt: "2026-09-08T10:00:00.000Z",
    expiresAt: "2026-09-08T13:00:00.000Z",
    rows: [
      {
        sourceLegacyId: "LEGACY-8001",
        sourceUpdatedAt: "2026-09-01T00:00:00.000Z",
        sourceRowMac: mac("a"),
        classification: "createable-adult",
        targetStudentId: "student-new-8001",
        trainingTimePreferences: ["evening"],
      },
      {
        sourceLegacyId: "LEGACY-8002",
        sourceUpdatedAt: "2026-09-01T00:00:00.000Z",
        sourceRowMac: mac("b"),
        classification: "explicit-existing-student-match",
        targetStudentId: "student-existing-8002",
        reviewedReason: "Same person, confirmed against the enrolment record",
      },
    ],
    ...overrides,
  };
}

function planValue(
  manifest: Readonly<Record<string, unknown>>,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    schemaVersion: "1",
    planId: "plan-forward-1",
    operationId,
    academyId,
    manifestId,
    privateManifestMac: createMemberDirectoryPrivateManifestMac({
      manifest,
      secretMaterial: integritySecretMaterial,
    }),
    chunks: [
      {
        chunkNo: 1,
        sourceLegacyIds: ["LEGACY-8001", "LEGACY-8002"],
        targets: [
          {
            path: `academies/${academyId}/students/student-new-8001`,
            priorAbsence: true,
            contentMac: mac("d"),
          },
        ],
        expectedOutputSetMac: mac("f"),
      },
    ],
    ...overrides,
  };
}

function receiptValue(
  manifest: Readonly<Record<string, unknown>>,
  plan: Readonly<Record<string, unknown>>,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  const rows = manifest.rows as readonly Readonly<{
    sourceLegacyId: string;
    sourceRowMac: string;
  }>[];
  return {
    operationId,
    academyId,
    phase: "forward",
    targetProjectClassification: "emulator",
    codeVersion: "885c701",
    schemaVersion: "1",
    effectiveDate: "2026-09-08T10:00:00.000Z",
    expiresAt: "2026-09-08T13:00:00.000Z",
    sourceMac: createMemberDirectorySourceSetMac({
      academyId,
      operationId,
      rows: rows.map((row) => ({
        sourceId: row.sourceLegacyId,
        sourceRowMac: row.sourceRowMac,
      })),
      secretMaterial: integritySecretMaterial,
    }),
    privateManifestMac: createMemberDirectoryPrivateManifestMac({
      manifest,
      secretMaterial: integritySecretMaterial,
    }),
    planMac: createMemberDirectoryPrivatePlanMac({
      plan,
      secretMaterial: integritySecretMaterial,
    }),
    digestVersion: "hmac-sha256-v1",
    secretVersion: "identity-v1",
    identityKeyBaselineMac: mac("3"),
    expectedOutputSetMacRoots: (
      plan.chunks as readonly Readonly<{ expectedOutputSetMac: string }>[]
    ).map((chunk) => chunk.expectedOutputSetMac),
    classificationCounts: {
      ...Object.fromEntries(
        memberDirectoryDryRunClassifications.map((classification) => [classification, 0]),
      ),
      "createable-adult": 1,
      "explicit-existing-student-match": 1,
    },
    preExistingAdmittedStudentCount: 10,
    plannedNewStudentCount: 1,
    postCutoverAdmittedStudentCount: 11,
    maximumApprovedRows: 400,
    integrityMacVersion: "hmac-sha256-v1",
    integritySecretVersion: "integrity-v1",
    operationWriteTime: "2026-09-08T10:00:00.000Z",
    createdAt: "2026-09-08T10:00:00.000Z",
    createdBy: "reviewer-1",
    ...overrides,
  };
}

function frozenTriple(
  manifestOverrides: Readonly<Record<string, unknown>> = {},
  planOverrides: Readonly<Record<string, unknown>> = {},
  receiptOverrides: Readonly<Record<string, unknown>> = {},
) {
  const manifest = manifestValue(manifestOverrides);
  const plan = planValue(manifest, planOverrides);
  return {
    manifest,
    plan,
    receipt: receiptValue(manifest, plan, receiptOverrides),
    now,
    integritySecretMaterial,
  };
}

describe("member directory frozen plan", () => {
  it("opens a manifest and plan that the receipt was frozen against", () => {
    const frozen = openMemberDirectoryFrozenPlan(frozenTriple());
    expect(frozen.manifest.rows).toHaveLength(2);
    expect(frozen.plan.chunks).toHaveLength(1);
    expect(frozen.receipt.phase).toBe("forward");
  });

  /**
   * The three MACs cover three different things - the mapping a human reviewed, the documents it
   * produces, and the state of the legacy rows at review time. Dropping any one leaves a way to
   * execute against an artifact nobody approved, so each is proved on its own.
   */
  it("refuses a manifest, a plan or a source set the receipt did not name", () => {
    const tampered = frozenTriple({ codeVersion: "885c701" });
    // The manifest is re-signed by the fixture, so change it *after* the receipt was built.
    const alteredManifest = {
      ...tampered.manifest,
      expiresAt: "2026-09-08T14:00:00.000Z",
    };
    expect(() => openMemberDirectoryFrozenPlan({ ...tampered, manifest: alteredManifest })).toThrow(
      /not the one this receipt was frozen against/u,
    );

    const alteredPlan = { ...tampered.plan, planId: "plan-other" };
    expect(() => openMemberDirectoryFrozenPlan({ ...tampered, plan: alteredPlan })).toThrow(
      /output plan is not the one this receipt was frozen against/u,
    );

    expect(() =>
      openMemberDirectoryFrozenPlan(frozenTriple({}, {}, { sourceMac: mac("9") })),
    ).toThrow(/different set of source rows/u);
  });

  /**
   * The pair is self-binding as well as receipt-bound: a plan built over another manifest is caught
   * even when the receipt would have accepted both on their own.
   */
  it("refuses a plan built over a different manifest than the one supplied", () => {
    const base = frozenTriple();
    const otherManifest = manifestValue({ preparedAt: "2026-09-08T09:00:00.000Z" });
    const plan = {
      ...base.plan,
      privateManifestMac: createMemberDirectoryPrivateManifestMac({
        manifest: otherManifest,
        secretMaterial: integritySecretMaterial,
      }),
    };
    expect(() =>
      openMemberDirectoryFrozenPlan({
        ...base,
        plan,
        receipt: receiptValue(base.manifest, plan),
      }),
    ).toThrow(/built over a different manifest/u);
  });

  /**
   * Without this the receipt could approve output roots no chunk of this plan will ever produce,
   * and the mismatch would surface only at the last chunk, after the earlier ones had written.
   */
  it("requires the receipt to approve every chunk output root of the plan", () => {
    expect(() =>
      openMemberDirectoryFrozenPlan(
        frozenTriple({}, {}, { expectedOutputSetMacRoots: [mac("9")] }),
      ),
    ).toThrow(/does not approve the output root of chunk 1/u);

    expect(() =>
      openMemberDirectoryFrozenPlan(
        frozenTriple({}, {}, { expectedOutputSetMacRoots: [mac("f"), mac("e")] }),
      ),
    ).toThrow(/different number of chunk output roots/u);
  });

  it("refuses a receipt from a phase that has no reviewed manifest", () => {
    expect(() =>
      openMemberDirectoryFrozenPlan(frozenTriple({}, {}, { phase: "bootstrap" })),
    ).toThrow(/only a forward receipt has a reviewed manifest/u);
  });

  it("refuses a manifest that has expired by the operation clock", () => {
    expect(() =>
      openMemberDirectoryFrozenPlan({ ...frozenTriple(), now: "2026-09-08T13:00:00.000Z" }),
    ).toThrow(/has expired/u);
  });

  it("resolves exactly one manifest row per source and refuses an unmapped one", () => {
    const frozen = openMemberDirectoryFrozenPlan(frozenTriple());
    expect(requireMemberDirectoryManifestRow(frozen, "LEGACY-8002").targetStudentId).toBe(
      "student-existing-8002",
    );
    expect(() => requireMemberDirectoryManifestRow(frozen, "LEGACY-9999")).toThrow(
      /does not map exactly one row/u,
    );
  });

  /**
   * The source-set MAC is a proof about a set: the same rows discovered in another order must give
   * the same answer, or a manifest could never be reordered without invalidating its own receipt.
   */
  it("folds the source set independently of row order and refuses a repeated row", () => {
    const rows = [
      { sourceId: "LEGACY-8001", sourceRowMac: mac("a") },
      { sourceId: "LEGACY-8002", sourceRowMac: mac("b") },
    ];
    const forward = createMemberDirectorySourceSetMac({
      academyId,
      operationId,
      rows,
      secretMaterial: integritySecretMaterial,
    });
    const reversed = createMemberDirectorySourceSetMac({
      academyId,
      operationId,
      rows: [...rows].reverse(),
      secretMaterial: integritySecretMaterial,
    });
    expect(reversed).toBe(forward);

    expect(() =>
      createMemberDirectorySourceSetMac({
        academyId,
        operationId,
        rows: [rows[0]!, rows[0]!],
        secretMaterial: integritySecretMaterial,
      }),
    ).toThrow(/same row twice/u);
  });
});
