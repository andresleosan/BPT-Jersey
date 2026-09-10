import { describe, expect, it } from "vitest";

import { validateRegyfitDiscoveryManifest, validateRegyfitMapping } from "../index";
import type {
  RegyfitDiscoveryManifest,
  RegyfitFieldSnapshot,
  RegyfitMapping,
  RegyfitModuleSnapshot,
} from "../index";
import type { UtcDateTime } from "../time";

const validField: RegyfitFieldSnapshot = {
  name: "displayName",
  label: "Student display name",
  dataType: "text",
  sensitivity: "confidential",
  required: false,
};

const validModule: RegyfitModuleSnapshot = {
  key: "students",
  label: "Students",
  route: "/admin/students",
  observedRoles: ["admin"],
  discoveryActions: ["list", "search", "view"],
  fields: [validField],
};

const validMapping: RegyfitMapping = {
  sourceEntity: "students",
  sourceField: "displayName",
  targetPath: "students.displayName",
  strategy: "direct",
  sensitivity: "confidential",
  reason: "Preserve the source field as domain metadata for review.",
};

const validManifest: RegyfitDiscoveryManifest = {
  schemaVersion: "1",
  sourceSystem: "regyfit",
  capturedAtUtc: "2026-08-07T12:00:00.000Z" as UtcDateTime,
  capabilities: {
    export: { available: false, formats: [] },
    api: { available: false, documented: false },
  },
  modules: [validModule],
  mappings: [validMapping],
  notes: ["Metadata-only inventory; row values are intentionally omitted."],
};

describe("Regyfit migration contracts", () => {
  it("accepts a metadata-only discovery manifest", () => {
    const result = validateRegyfitDiscoveryManifest(validManifest);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.modules[0]).not.toHaveProperty("values");
    }
  });

  it("rejects values that could contain live student data", () => {
    const result = validateRegyfitDiscoveryManifest({
      ...validManifest,
      modules: [{ ...validManifest.modules[0]!, values: ["real-looking value"] }],
    });

    expect(result.ok).toBe(false);
  });

  it("rejects duplicate module keys and source mapping pairs", () => {
    const duplicateModules = validateRegyfitDiscoveryManifest({
      ...validManifest,
      modules: [validModule, validModule],
    });
    const duplicateMappings = validateRegyfitDiscoveryManifest({
      ...validManifest,
      mappings: [validMapping, { ...validMapping, strategy: "normalize" }],
    });

    expect(duplicateModules.ok).toBe(false);
    expect(duplicateMappings.ok).toBe(false);
  });

  it("allows only explicit mapping strategies", () => {
    const strategies = ["direct", "normalize", "lookup", "exclude", "manual-review"] as const;

    for (const strategy of strategies) {
      expect(validateRegyfitMapping({ ...validMapping, strategy }).ok).toBe(true);
    }
    expect(validateRegyfitMapping({ ...validMapping, strategy: "execute-code" as never }).ok).toBe(
      false,
    );
  });

  it("rejects unsafe routes, payload properties, and unknown enum values", () => {
    expect(
      validateRegyfitDiscoveryManifest({
        ...validManifest,
        modules: [{ ...validModule, route: "/admin/students?search=secret" }],
      }).ok,
    ).toBe(false);
    expect(validateRegyfitMapping({ ...validMapping, targetPath: "students.payload" }).ok).toBe(
      false,
    );
    expect(validateRegyfitMapping({ ...validMapping, sensitivity: "top-secret" as never }).ok).toBe(
      false,
    );
  });

  it("allows credential-like source fields only when excluded", () => {
    const excluded = validateRegyfitMapping({
      ...validMapping,
      sourceField: "password",
      strategy: "exclude",
      reason: "Credential field is never migrated.",
    });
    const direct = validateRegyfitMapping({
      ...validMapping,
      sourceField: "token",
      strategy: "direct",
    });

    expect(excluded.ok).toBe(true);
    expect(direct.ok).toBe(false);
  });

  it("rejects credential variants and mutating discovery actions", () => {
    const credentialVariant = validateRegyfitMapping({
      ...validMapping,
      sourceField: "passwordHash",
      strategy: "direct",
    });
    const mutatingAction = validateRegyfitDiscoveryManifest({
      ...validManifest,
      modules: [{ ...validModule, discoveryActions: ["delete", "new"] }],
    });

    expect(credentialVariant.ok).toBe(false);
    expect(mutatingAction.ok).toBe(false);
  });

  it("rejects control and newline characters in free-form metadata", () => {
    expect(
      validateRegyfitDiscoveryManifest({
        ...validManifest,
        notes: ["Metadata-only inventory\ncontinued."],
      }).ok,
    ).toBe(false);
    expect(
      validateRegyfitMapping({
        ...validMapping,
        reason: "Preserve metadata\u0007for review.",
      }).ok,
    ).toBe(false);
  });

  it("rejects oversized and dump-like free-form metadata", () => {
    expect(
      validateRegyfitDiscoveryManifest({
        ...validManifest,
        notes: ["x".repeat(513)],
      }).ok,
    ).toBe(false);
    expect(
      validateRegyfitMapping({
        ...validMapping,
        reason: '{"displayName":"Student","status":"active"}',
      }).ok,
    ).toBe(false);
  });

  it("rejects obvious address and proper-name metadata without rejecting field labels", () => {
    expect(
      validateRegyfitDiscoveryManifest({
        ...validManifest,
        notes: ["John Smith"],
      }).ok,
    ).toBe(false);
    expect(
      validateRegyfitMapping({
        ...validMapping,
        reason: "Address: 10 Example Street, St Helier",
      }).ok,
    ).toBe(false);

    const metadataLabel = validateRegyfitDiscoveryManifest({
      ...validManifest,
      modules: [
        {
          ...validModule,
          fields: [{ ...validField, label: "Medical support needs" }],
        },
      ],
    });
    expect(metadataLabel.ok).toBe(true);
    expect(validateRegyfitMapping(validMapping).ok).toBe(true);
  });

  it("rejects encoded traversal, dot segments, and duplicate empty route segments", () => {
    for (const route of [
      "/admin/%2e%2e/students",
      "/admin/%252e%252e/students",
      "/admin/./students",
      "/admin//students",
    ]) {
      expect(
        validateRegyfitDiscoveryManifest({
          ...validManifest,
          modules: [{ ...validModule, route }],
        }).ok,
      ).toBe(false);
    }
  });

  it("accepts only documented Firestore collection roots with a field segment", () => {
    const roots = [
      "users",
      "families",
      "students",
      "staff",
      "relationships",
      "locations",
      "programs",
      "classes",
      "sessions",
      "plans",
      "bookings",
      "attendance",
      "checkouts",
      "memberships",
      "invoices",
      "payments",
      "paymentEvents",
      "assessments",
      "skillProgress",
      "recognitions",
      "leads",
      "messages",
      "deliveryEvents",
      "healthProfiles",
      "safeguardingCases",
      "consents",
      "documents",
      "auditEvents",
      "exports",
    ];

    for (const root of roots) {
      expect(validateRegyfitMapping({ ...validMapping, targetPath: `${root}.id` }).ok).toBe(true);
    }
    expect(validateRegyfitMapping({ ...validMapping, targetPath: "unknown.id" }).ok).toBe(false);
    expect(validateRegyfitMapping({ ...validMapping, targetPath: "students" }).ok).toBe(false);
    for (const reserved of ["constructor", "prototype", "__proto__"]) {
      expect(
        validateRegyfitMapping({ ...validMapping, targetPath: `students.${reserved}.id` }).ok,
      ).toBe(false);
    }
  });

  it("canonicalizes padded module keys and source mapping pairs before duplicate checks", () => {
    const duplicateModule = validateRegyfitDiscoveryManifest({
      ...validManifest,
      modules: [validModule, { ...validModule, key: " Students " }],
    });
    const duplicateMapping = validateRegyfitDiscoveryManifest({
      ...validManifest,
      mappings: [validMapping, { ...validMapping, sourceField: " displayName " }],
    });

    expect(duplicateModule.ok).toBe(false);
    expect(duplicateMapping.ok).toBe(false);
  });

  it("rejects impossible UTC calendar dates with a round-trip component check", () => {
    const impossibleDate = validateRegyfitDiscoveryManifest({
      ...validManifest,
      capturedAtUtc: "2026-02-29T12:00:00.000Z",
    });
    const leapDate = validateRegyfitDiscoveryManifest({
      ...validManifest,
      capturedAtUtc: "2024-02-29T12:00:00.000Z",
    });

    expect(impossibleDate.ok).toBe(false);
    expect(leapDate.ok).toBe(true);
  });
});
