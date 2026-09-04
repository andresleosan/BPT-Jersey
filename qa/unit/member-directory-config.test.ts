import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

function readProjectFile(relativePath: string): string {
  return readFileSync(
    new URL(relativePath, `file:///${projectRoot.replaceAll("\\\\", "/")}/`),
    "utf8",
  );
}

function readProjectJson<T>(relativePath: string): T {
  return JSON.parse(readProjectFile(relativePath)) as T;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripRulesComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("T092 member-directory Firebase configuration", () => {
  it("declares every sensitive T092 collection as explicitly backend-only", () => {
    const rules = stripRulesComments(readProjectFile("firestore.rules")).replace(/\s+/g, " ");
    const backendOnlyPaths = [
      "/academies/{academyId}/members/{memberId}",
      "/academies/{academyId}/students/{studentId}",
      "/academies/{academyId}/studentAdminProfiles/{studentId}",
      "/academies/{academyId}/studentIdentityKeys/{keyId}",
      "/academies/{academyId}/studentRestrictedReadLimits/{actorId}",
      "/academies/{academyId}/memberDirectoryCursorStates/{cursorId}",
      "/academies/{academyId}/memberDirectoryStates/{stateId}",
      "/academies/{academyId}/memberDirectoryMigrations/{operationId}",
      "/academies/{academyId}/memberDirectoryMigrationChunks/{chunkId}",
      "/academies/{academyId}/memberDirectoryApprovals/{approvalId}",
      "/academies/{academyId}/memberDirectoryApprovalConsumptions/{approvalId}",
      "/academies/{academyId}/memberDirectoryWriteReceipts/{requestId}",
      "/academies/{academyId}/familyWriteReceipts/{requestId}",
      "/academies/{academyId}/profileWriteReceipts/{requestId}",
      "/academies/{academyId}/memberDirectoryImportReceipts/{receiptId}",
      "/academies/{academyId}/memberDirectoryImportSessions/{sessionId}",
      "/academies/{academyId}/auditEvents/{auditEventId}",
      "/memberDirectoryRestoreGuards/{academyId}",
      "/memberDirectoryRestoreGuards/{academyId}/events/{stateRevision}",
      "/memberDirectoryRestoreAttestations/{attestationId}",
      "/memberDirectoryRestoreAttestationConsumptions/{attestationId}",
    ] as const;

    for (const path of backendOnlyPaths) {
      expect(rules, `${path} must have its own backend-only match`).toMatch(
        new RegExp(`match ${escapeRegExp(path)} \\{ allow read, write: if false; \\}`),
      );
    }
  });

  it("disables single-field indexes for the exact 16 restricted directory fields", () => {
    const config = readProjectJson<{
      fieldOverrides: Array<{
        collectionGroup: string;
        fieldPath: string;
        indexes: unknown[];
      }>;
    }>("firestore.indexes.json");
    const actual = config.fieldOverrides
      .map(({ collectionGroup, fieldPath, indexes }) => ({
        key: `${collectionGroup}.${fieldPath}`,
        indexes,
      }))
      .sort((left, right) => left.key.localeCompare(right.key));

    expect(actual).toEqual([
      { key: "memberDirectoryCursorStates.afterLegacyDocumentId", indexes: [] },
      { key: "members.birthDate", indexes: [] },
      { key: "members.email", indexes: [] },
      { key: "members.frequency", indexes: [] },
      { key: "members.fullName", indexes: [] },
      { key: "members.idCardNumber", indexes: [] },
      { key: "members.importRunId", indexes: [] },
      { key: "members.membershipNumber", indexes: [] },
      { key: "members.mobileNumber", indexes: [] },
      { key: "members.source", indexes: [] },
      { key: "members.vatNumber", indexes: [] },
      { key: "studentAdminProfiles.frequencyNote", indexes: [] },
      { key: "studentAdminProfiles.idCardNumber", indexes: [] },
      { key: "studentAdminProfiles.legacyMemberId", indexes: [] },
      { key: "studentAdminProfiles.membershipNumber", indexes: [] },
      { key: "studentAdminProfiles.vatNumber", indexes: [] },
    ]);
  });

  it("allows the isolated source and restore Emulator project namespaces", () => {
    const config = readProjectJson<{ emulators: { singleProjectMode: boolean } }>("firebase.json");

    expect(config.emulators.singleProjectMode).toBe(false);
  });
});
