import { describe, expect, it } from "vitest";

import { deriveStudentIdentityKeyId, buildStudentIdentityKey } from "./member-directory-crypto.js";
import {
  createCanonicalMemberImportSessionMac,
  createCanonicalMemberImportFirestoreAdapter,
  type CanonicalMemberImportUploadingSession,
} from "./canonical-member-import-firestore.js";

const identitySecret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecret = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const now = "2026-09-03T20:10:00.000Z";
const expiresAt = "2026-09-03T20:20:00.000Z";

type Data = Record<string, unknown>;
type Ref = Readonly<{ kind: "document"; id: string; path: string }>;
type Query = Readonly<{
  kind: "query";
  path: string;
  order?: unknown;
  limitValue?: number;
  orderBy: (value: unknown) => Query;
  limit: (value: number) => Query;
}>;

function snapshot(id: string, data: Data | undefined) {
  return { id, exists: data !== undefined, data: () => data };
}

function firestoreHarness(
  input: Readonly<{
    documents?: Readonly<Record<string, Data>>;
    collections?: Readonly<Record<string, readonly Readonly<{ id: string; data: Data }>[]>>;
  }> = {},
) {
  const records = new Map(Object.entries(input.documents ?? {}));
  const queryPaths: string[] = [];
  const writes: Array<Readonly<{ kind: "create" | "set"; path: string; data: Data }>> = [];

  const doc = (path: string): Ref => ({ kind: "document", id: path.split("/").at(-1) ?? "", path });
  const query = (state: { path: string; order?: unknown; limitValue?: number }): Query => ({
    kind: "query",
    ...state,
    orderBy(value) {
      return query({ ...state, order: value });
    },
    limit(value) {
      return query({ ...state, limitValue: value });
    },
  });
  const transaction = {
    async get(target: Ref | Query) {
      if (target.kind === "document") {
        return snapshot(target.id, records.get(target.path));
      }
      queryPaths.push(target.path);
      const values = input.collections?.[target.path] ?? [];
      return {
        docs: values.slice(0, target.limitValue).map((value) => snapshot(value.id, value.data)),
      };
    },
    create(reference: Ref, data: Data) {
      if (records.has(reference.path)) throw new Error("already exists");
      records.set(reference.path, { ...data });
      writes.push({ kind: "create" as const, path: reference.path, data: { ...data } });
      return transaction;
    },
    set(reference: Ref, data: Data) {
      records.set(reference.path, { ...data });
      writes.push({ kind: "set" as const, path: reference.path, data: { ...data } });
      return transaction;
    },
  };
  const firestore = {
    doc,
    collection: (path: string) => query({ path }),
    runTransaction: async <T>(callback: (value: typeof transaction) => Promise<T>) =>
      callback(transaction),
  };
  return { firestore, records, queryPaths, writes };
}

function uploadingSession(): CanonicalMemberImportUploadingSession {
  const unsigned = {
    sessionId: `import-session-${"1".repeat(64)}`,
    operationId: "41cbb1aa-7020-4bb5-88a4-dbc73c5f0123",
    academyId: "academy-1",
    actorId: "owner-1",
    actorRole: "owner",
    projectId: "demo-bpt-jersey",
    targetProjectClassification: "emulator",
    uploadManifestMac: "2".repeat(64),
    uploads: [
      {
        objectKey: `academies/academy-1/member-imports/import-session-${"1".repeat(64)}/0.pdf`,
        sizeBytes: 128,
      },
    ],
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    operationWriteTime: now,
    expiresAt,
    createdAt: now,
    updatedAt: now,
    schemaVersion: "1",
  } as const;
  return {
    ...unsigned,
    sessionMac: createCanonicalMemberImportSessionMac(unsigned, integritySecret),
    status: "uploading",
  };
}

describe("canonical member import Firestore adapter", () => {
  it("scans students and admin profiles in the same transaction and never queries members", async () => {
    const harness = firestoreHarness({
      collections: {
        "academies/academy-1/students": [
          { id: "student-1", data: { studentId: "student-1", academyId: "academy-1" } },
        ],
        "academies/academy-1/studentAdminProfiles": [
          { id: "student-1", data: { studentId: "student-1", academyId: "academy-1" } },
        ],
      },
    });
    const adapter = createCanonicalMemberImportFirestoreAdapter(harness.firestore as never, {
      identitySecretMaterial: identitySecret,
      identitySecretVersion: "identity-v1",
      integritySecretMaterial: integritySecret,
    });

    const result = await adapter.firestore.runTransaction((transaction) =>
      adapter.scanExistingStudents(transaction, "academy-1", 401),
    );

    expect(result).toEqual([
      {
        studentId: "student-1",
        student: { studentId: "student-1", academyId: "academy-1" },
        profileId: "student-1",
        adminProfile: { studentId: "student-1", academyId: "academy-1" },
      },
    ]);
    expect(harness.queryPaths).toEqual([
      "academies/academy-1/students",
      "academies/academy-1/studentAdminProfiles",
    ]);
    expect(harness.queryPaths.some((path) => path.endsWith("/members"))).toBe(false);
  });

  it("rejects orphan administrative profiles before planning and without writes", async () => {
    const harness = firestoreHarness({
      collections: {
        "academies/academy-1/students": [],
        "academies/academy-1/studentAdminProfiles": [
          {
            id: "orphan-profile",
            data: { studentId: "orphan-profile", academyId: "academy-1" },
          },
        ],
      },
    });
    const adapter = createCanonicalMemberImportFirestoreAdapter(harness.firestore as never, {
      identitySecretMaterial: identitySecret,
      identitySecretVersion: "identity-v1",
      integritySecretMaterial: integritySecret,
    });

    await expect(
      adapter.buildPrivateManifest({
        actor: {
          actorId: "owner-1",
          academyId: "academy-1",
          role: "owner",
          active: true,
          appCheckVerified: true,
        },
        operationId: uploadingSession().operationId,
        rows: [
          {
            sourceReport: "total",
            sourceRowNumber: 1,
            fullName: "Synthetic Adult",
            birthDate: "1990-01-02",
          },
        ],
        operationWriteTime: now,
        expiresAt,
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
      }),
    ).rejects.toThrow("Orphan student administrative profile");
    expect(harness.writes).toEqual([]);
  });

  it("rejects 401 administrative profiles even when fewer students exist and writes nothing", async () => {
    const harness = firestoreHarness({
      collections: {
        "academies/academy-1/students": [
          { id: "student-0", data: { studentId: "student-0", academyId: "academy-1" } },
        ],
        "academies/academy-1/studentAdminProfiles": Array.from({ length: 401 }, (_, index) => ({
          id: `student-${index}`,
          data: { studentId: `student-${index}`, academyId: "academy-1" },
        })),
      },
    });
    const adapter = createCanonicalMemberImportFirestoreAdapter(harness.firestore as never, {
      identitySecretMaterial: identitySecret,
      identitySecretVersion: "identity-v1",
      integritySecretMaterial: integritySecret,
    });

    await expect(
      adapter.buildPrivateManifest({
        actor: {
          actorId: "owner-1",
          academyId: "academy-1",
          role: "owner",
          active: true,
          appCheckVerified: true,
        },
        operationId: uploadingSession().operationId,
        rows: [
          {
            sourceReport: "total",
            sourceRowNumber: 1,
            fullName: "Synthetic Adult",
            birthDate: "1990-01-02",
          },
        ],
        operationWriteTime: now,
        expiresAt,
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
      }),
    ).rejects.toThrow("Existing admin profile scan limit exceeded");
    expect(harness.writes).toEqual([]);
  });

  it("creates and replays only the exact path-bound metadata session, rejecting divergence", async () => {
    const harness = firestoreHarness();
    const adapter = createCanonicalMemberImportFirestoreAdapter(harness.firestore as never, {
      identitySecretMaterial: identitySecret,
      identitySecretVersion: "identity-v1",
      integritySecretMaterial: integritySecret,
    });
    const candidate = uploadingSession();

    await expect(adapter.sessions.createOrGet(candidate, now)).resolves.toEqual(candidate);
    const retry = {
      ...candidate,
      createdAt: "2026-09-03T20:11:00.000Z",
      updatedAt: "2026-09-03T20:11:00.000Z",
    };
    retry.sessionMac = createCanonicalMemberImportSessionMac(retry, integritySecret);
    await expect(adapter.sessions.createOrGet(retry, now)).resolves.toEqual(candidate);
    const divergent = { ...candidate, uploadManifestMac: "3".repeat(64) };
    divergent.sessionMac = createCanonicalMemberImportSessionMac(divergent, integritySecret);
    await expect(adapter.sessions.createOrGet(divergent, now)).rejects.toThrow(
      "Canonical member import session replay is invalid",
    );
    expect(harness.writes).toHaveLength(1);
    expect(harness.writes[0]?.path).toBe(
      `academies/academy-1/memberDirectoryImportSessions/${candidate.sessionId}`,
    );
    expect(harness.writes[0]?.data.sessionId).toBe(candidate.sessionId);

    harness.records.set(
      `academies/academy-1/memberDirectoryImportSessions/${candidate.sessionId}`,
      { ...candidate, sessionId: "different-session" },
    );
    await expect(adapter.sessions.read("academy-1", candidate.sessionId)).rejects.toThrow(
      "Canonical member import session is invalid",
    );

    harness.records.set(
      `academies/academy-1/memberDirectoryImportSessions/${candidate.sessionId}`,
      { ...candidate, expiresAt: "2026-09-03T20:19:00.000Z" },
    );
    await expect(adapter.sessions.read("academy-1", candidate.sessionId)).rejects.toThrow(
      "Canonical member import session is invalid",
    );
  });

  it("blocks an unreviewed server-side identity match instead of manufacturing approval", async () => {
    const keyId = deriveStudentIdentityKeyId({
      academyId: "academy-1",
      kind: "membership-number",
      value: "BPT-0001",
      secretMaterial: identitySecret,
    });
    const identityKey = buildStudentIdentityKey({
      academyId: "academy-1",
      kind: "membership-number",
      value: "BPT-0001",
      ownerStudentId: "student-1",
      secretMaterial: identitySecret,
      secretVersion: "identity-v1",
      now,
      actorId: "owner-1",
    });
    const harness = firestoreHarness({
      documents: { [`academies/academy-1/studentIdentityKeys/${keyId}`]: identityKey },
      collections: {
        "academies/academy-1/students": [
          {
            id: "student-1",
            data: {
              studentId: "student-1",
              academyId: "academy-1",
              fullName: "Synthetic Adult",
              dateOfBirth: "1990-01-02",
              trainingCenter: "Town",
              trainingTimePreferences: ["evening"],
              participantType: "adult",
              active: true,
              status: "active",
              schemaVersion: "1",
              createdAt: now,
              createdBy: "owner-1",
              updatedAt: now,
              updatedBy: "owner-1",
            },
          },
        ],
        "academies/academy-1/studentAdminProfiles": [
          {
            id: "student-1",
            data: {
              studentId: "student-1",
              academyId: "academy-1",
              membershipNumber: "BPT-0001",
              gender: "unknown",
              source: "admin",
              schemaVersion: "1",
              createdAt: now,
              createdBy: "owner-1",
              updatedAt: now,
              updatedBy: "owner-1",
            },
          },
        ],
      },
    });
    const adapter = createCanonicalMemberImportFirestoreAdapter(harness.firestore as never, {
      identitySecretMaterial: identitySecret,
      identitySecretVersion: "identity-v1",
      integritySecretMaterial: integritySecret,
    });
    const rows = [
      {
        sourceReport: "total" as const,
        sourceRowNumber: 1,
        membershipNumber: "BPT-0001",
        fullName: "Synthetic Adult",
        birthDate: "1990-01-02",
      },
    ];

    const built = await adapter.buildPrivateManifest({
      actor: {
        actorId: "owner-1",
        academyId: "academy-1",
        role: "owner",
        active: true,
        appCheckVerified: true,
      },
      operationId: uploadingSession().operationId,
      rows,
      operationWriteTime: now,
      expiresAt,
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
    });

    expect(built.manifest).toEqual({
      operationId: uploadingSession().operationId,
      academyId: "academy-1",
      operationWriteTime: now,
      expiresAt,
      rows: [
        {
          sourceReport: "total",
          sourceRowNumber: 1,
          targetAcademyId: "academy-1",
          classification: "identity-conflict",
          trainingCenter: "Town",
          trainingTimePreferences: ["evening"],
        },
      ],
      schemaVersion: "1",
    });
    expect(built.reviewCandidates).toEqual([
      {
        rowIndex: 0,
        sourceName: "Synthetic Adult",
        candidate: {
          studentId: "student-1",
          fullName: "Synthetic Adult",
          trainingCenter: "Town",
          membershipReference: "****0001",
        },
      },
    ]);
    const manifestRows = (
      built.manifest as {
        rows: readonly Readonly<{ classification: string }>[];
      }
    ).rows;
    expect(
      manifestRows.filter((entry) =>
        ["same-id-compatible", "explicit-existing-student-match", "createable-adult"].includes(
          entry.classification,
        ),
      ),
    ).toEqual([]);
    expect(JSON.stringify(built.manifest)).not.toContain("Synthetic Adult");
    expect(JSON.stringify(built.manifest)).not.toContain("reviewedReason");

    const reviewed = await adapter.buildPrivateManifest({
      actor: {
        actorId: "owner-1",
        academyId: "academy-1",
        role: "owner",
        active: true,
        appCheckVerified: true,
      },
      operationId: uploadingSession().operationId,
      rows,
      operationWriteTime: now,
      expiresAt,
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      reviews: [{ rowIndex: 0, decision: "accept", existingStudentId: "student-1" }],
    });
    expect(reviewed.manifest).toEqual(
      expect.objectContaining({
        rows: [
          expect.objectContaining({
            classification: "explicit-existing-student-match",
            existingStudentId: "student-1",
            adminProfileDisposition: "existing-compatible",
            reviewedReason: expect.any(String),
          }),
        ],
      }),
    );
    expect(harness.queryPaths.some((path) => path.endsWith("/members"))).toBe(false);
  });
});
