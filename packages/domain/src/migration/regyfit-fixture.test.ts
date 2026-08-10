import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { validateRegyfitDiscoveryManifest } from "../index";

const manifest = JSON.parse(
  readFileSync(
    new URL(
      "../../../../docs/data/migrations/regyfit/discovery-manifest.example.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as unknown;
const observedManifest = JSON.parse(
  readFileSync(
    new URL(
      "../../../../docs/data/migrations/regyfit/discovery-manifest.observed.sanitized.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as unknown;
const migrationRegisterText = readFileSync(
  new URL("../../../../docs/data/migrations/regyfit/migration-run.example.yaml", import.meta.url),
  "utf8",
);

describe("Regyfit migration artifacts", () => {
  it("validates the metadata-only discovery manifest", () => {
    const result = validateRegyfitDiscoveryManifest(manifest);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sourceSystem).toBe("regyfit");
      expect(result.value.modules.map((module) => module.key)).toEqual(
        expect.arrayContaining([
          "students",
          "families",
          "classes",
          "attendance",
          "memberships",
          "payments",
          "assessments",
          "crm",
          "documents",
          "audit",
        ]),
      );
      expect(new Set(result.value.mappings?.map((mapping) => mapping.strategy))).toEqual(
        new Set(["direct", "normalize", "lookup", "exclude", "manual-review"]),
      );
    }
    expect(JSON.stringify(manifest)).not.toMatch(/@|\+44|password|token|card|cvv/i);
  });

  it("keeps the migration register complete and pending", () => {
    for (const field of [
      "migrationId:",
      "modelVersion:",
      "author:",
      "createdAt:",
      "scope:",
      "up:",
      "downOrRestore:",
      "verificationQueries:",
      "backupReference:",
      "operatorApproval:",
    ]) {
      expect(migrationRegisterText).toContain(field);
    }
    expect(migrationRegisterText).toContain('status: "pending"');
    expect(migrationRegisterText).not.toMatch(/@|\+44|password|token|card|cvv/i);
  });

  it("validates the observed sanitized manifest without source values", () => {
    const result = validateRegyfitDiscoveryManifest(observedManifest);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.modules.map((module) => module.key)).toEqual([
        "admin2",
        "mail_editor",
        "quest_manager-php",
        "image_manager-php",
        "video_tutoriais-php",
      ]);
      expect(result.value.modules.every((module) => module.fields.length === 0)).toBe(true);
    }
    expect(JSON.stringify(observedManifest)).not.toMatch(/@|\+44|password|token|card|cvv/i);
  });
});
