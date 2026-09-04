import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

import type { R2Client } from "../storage/r2-client.js";
import type {
  CanonicalMemberImportPrivateSession,
  CanonicalMemberImportSessionStore,
  CanonicalMemberImportUploadingSession,
} from "./canonical-member-import-firestore.js";
import type {
  CanonicalMemberImportPreview,
  CanonicalMemberImportReceipt,
} from "./canonical-member-import-service.js";
import { parseMemberReport } from "./member-pdf-import.js";
import {
  cleanupExpiredCanonicalMemberImportsHandler,
  confirmCanonicalMemberImportHandler,
  createCanonicalMemberImportActorActivityCheck,
  createCanonicalMemberImportSessionHandler,
  createCanonicalMemberImportSourceReader,
  previewCanonicalMemberImportHandler,
  reviewCanonicalMemberImportMatchesHandler,
  type CanonicalMemberImportCallableServices,
} from "./canonical-member-import-callables.js";
import { createCanonicalMemberImportSessionMac } from "./canonical-member-import-firestore.js";

const operationId = "41cbb1aa-7020-4bb5-88a4-dbc73c5f0123";
const sessionId = `import-session-${"1".repeat(64)}`;
const now = "2026-09-03T20:10:00.000Z";
const expiresAt = "2026-09-03T20:20:00.000Z";
const integritySecret = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const row = Object.freeze({
  sourceReport: "total" as const,
  sourceRowNumber: 1,
  membershipNumber: "BPT-0001",
  fullName: "Synthetic Adult",
  birthDate: "1990-01-02",
});

function request(
  data: unknown,
  input: Readonly<{ appCheck?: boolean; role?: string; uid?: string; academyId?: string }> = {},
) {
  const role = input.role ?? "owner";
  const uid = input.uid ?? "owner-1";
  const academyId = input.academyId ?? "academy-1";
  return {
    data,
    auth: role === "anonymous" ? undefined : { uid, token: { academyId, role } },
    ...(input.appCheck === false ? {} : { app: { appId: "web-app-1" } }),
  } as never;
}

function receipt(): CanonicalMemberImportReceipt {
  return {
    receiptId: `import-${"2".repeat(64)}`,
    operationId,
    academyId: "academy-1",
    actorId: "owner-1",
    projectId: "demo-bpt-jersey",
    targetProjectClassification: "emulator",
    codeVersion: "canonical-member-import-v1",
    schemaVersion: "1",
    operationWriteTime: now,
    expiresAt,
    sourceMac: "3".repeat(64),
    privateManifestMac: "4".repeat(64),
    planMac: "5".repeat(64),
    outputSetMac: "6".repeat(64),
    digestVersion: "hmac-sha256-v1",
    identitySecretVersion: "identity-v1",
    integrityMacVersion: "hmac-sha256-v1",
    integritySecretVersion: "integrity-v1",
    identityKeyBaselineMac: "7".repeat(64),
    classificationCounts: {
      "same-id-compatible": 0,
      "explicit-existing-student-match": 0,
      "createable-adult": 1,
      "minor-requires-family-match": 0,
      "missing-required-fields": 0,
      "identity-conflict": 0,
      "duplicate-membership-number": 0,
      "cross-tenant": 0,
      "invalid-record": 0,
    },
    preExistingAdmittedStudentCount: 0,
    plannedNewStudentCount: 1,
    postCutoverAdmittedStudentCount: 1,
    reportKeys: ["total"],
    maximumApprovedRows: 50,
    stateRevisionBefore: 0,
    stateRevisionAfter: 1,
    status: "planned",
  };
}

function preview(): CanonicalMemberImportPreview {
  return {
    classifications: [{ rowMac: "8".repeat(64), classification: "createable-adult" }],
    reviewMatches: [],
    confirmable: true,
    receipt: receipt(),
  };
}

function uploading(): CanonicalMemberImportUploadingSession {
  const unsigned = {
    sessionId,
    operationId,
    academyId: "academy-1",
    actorId: "owner-1",
    actorRole: "owner",
    projectId: "demo-bpt-jersey",
    targetProjectClassification: "emulator",
    uploadManifestMac: "9".repeat(64),
    uploads: [
      { objectKey: `academies/academy-1/member-imports/${sessionId}/0.pdf`, sizeBytes: 128 },
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

function previewed(): CanonicalMemberImportPrivateSession {
  return {
    ...uploading(),
    sourceUploadMac: "a".repeat(64),
    privateManifest: { private: true },
    preview: preview(),
    previewMac: "b".repeat(64),
    status: "previewed",
  };
}

function store(initial?: CanonicalMemberImportPrivateSession) {
  let current = initial;
  const value: CanonicalMemberImportSessionStore = {
    createOrGet: vi.fn(async (candidate) => {
      current = candidate;
      return candidate;
    }),
    read: vi.fn(async () => current),
    persistPreview: vi.fn(async (input) => {
      const next = {
        ...(current as CanonicalMemberImportUploadingSession),
        sourceUploadMac: input.sourceUploadMac,
        privateManifest: input.privateManifest,
        preview: input.preview,
        previewMac: "b".repeat(64),
        updatedAt: input.now,
        status: "previewed" as const,
      };
      current = next;
      return next;
    }),
    persistReview: vi.fn(async (input) => {
      const next = {
        ...(current as Exclude<
          CanonicalMemberImportPrivateSession,
          CanonicalMemberImportUploadingSession
        >),
        privateManifest: input.privateManifest,
        preview: input.preview,
        previewMac: "c".repeat(64),
        updatedAt: input.now,
        status: "previewed" as const,
      };
      current = next;
      return next;
    }),
    persistResult: vi.fn(async (input) => {
      const next = {
        ...(current as Exclude<
          CanonicalMemberImportPrivateSession,
          CanonicalMemberImportUploadingSession
        >),
        result: input.result,
        completedAt: input.now,
        updatedAt: input.now,
        status: "confirmed" as const,
      };
      current = next;
      return next;
    }),
    listExpired: vi.fn(async () => []),
    deleteExpired: vi.fn(async () => undefined),
  };
  return value;
}

function r2(): R2Client {
  const pdfBytes = new Uint8Array(128);
  pdfBytes.set([37, 80, 68, 70, 45]);
  return {
    createPdfUploadUrl: vi.fn(async () => "https://upload.example.test/object"),
    createPdfDownloadUrl: vi.fn(async () => "https://download.example.test/object"),
    putObject: vi.fn(async () => undefined),
    readObject: vi.fn(async () => pdfBytes),
    deleteObject: vi.fn(async () => undefined),
  };
}

function services(
  initial?: CanonicalMemberImportPrivateSession,
): CanonicalMemberImportCallableServices {
  return {
    sessions: store(initial),
    core: {
      dryRun: vi.fn(async () => preview()),
      confirm: vi.fn(async () => ({ receiptId: receipt().receiptId, created: 1, matched: 0 })),
    },
    r2: r2(),
    sources: { read: vi.fn(async () => ({ rows: [row], sourceUploadMac: "a".repeat(64) })) },
    buildPrivateManifest: vi.fn(async () => ({
      manifest: { private: true },
      reviewCandidates: [],
    })),
    isActorActive: vi.fn(async () => true),
    sessionIdFor: vi.fn(() => sessionId),
    uploadManifestMacFor: vi.fn(() => "9".repeat(64)),
    sessionMacFor: vi.fn((input) => createCanonicalMemberImportSessionMac(input, integritySecret)),
    projectId: "demo-bpt-jersey",
    targetProjectClassification: "emulator",
    now: () => now,
  };
}

describe("canonical member import callables", () => {
  it("reopens the private source and persists only a server-built accepted match", async () => {
    const rowMac = "8".repeat(64);
    const pendingPreview = {
      ...preview(),
      confirmable: false,
      classifications: [{ rowMac, classification: "identity-conflict" as const }],
      reviewMatches: [
        {
          rowMac,
          sourceName: "Synthetic Adult",
          candidate: {
            studentId: "student-1",
            fullName: "Synthetic Adult",
            trainingCenter: "Town" as const,
            membershipReference: "****0001",
          },
          decision: "pending" as const,
        },
      ],
    };
    const initialMatch = pendingPreview.reviewMatches[0];
    if (!initialMatch) throw new Error("Missing initial match");
    const acceptedPreview = {
      ...pendingPreview,
      confirmable: true,
      classifications: [{ rowMac, classification: "explicit-existing-student-match" as const }],
      reviewMatches: [{ ...initialMatch, decision: "accepted" as const }],
    };
    const expectedCandidate = pendingPreview.reviewMatches[0]?.candidate;
    if (expectedCandidate === undefined) throw new Error("Synthetic review candidate is missing");
    const current = services({
      ...uploading(),
      sourceUploadMac: "a".repeat(64),
      privateManifest: { stage: "pending" },
      preview: pendingPreview,
      previewMac: "b".repeat(64),
      status: "previewed",
    } as never);
    vi.mocked(current.buildPrivateManifest)
      .mockResolvedValueOnce({
        manifest: { stage: "pending" },
        reviewCandidates: [
          {
            rowIndex: 0,
            sourceName: "Synthetic Adult",
            candidate: expectedCandidate,
          },
        ],
      })
      .mockResolvedValueOnce({
        manifest: { stage: "accepted" },
        reviewCandidates: [
          {
            rowIndex: 0,
            sourceName: "Synthetic Adult",
            candidate: expectedCandidate,
          },
        ],
      });
    vi.mocked(current.core.dryRun)
      .mockResolvedValueOnce(pendingPreview)
      .mockResolvedValueOnce(acceptedPreview);

    await expect(
      reviewCanonicalMemberImportMatchesHandler(
        request({
          sessionId,
          operationId,
          decisions: [{ rowMac, decision: "accept" }],
        }),
        current,
      ),
    ).resolves.toEqual(acceptedPreview);
    expect(current.sources.read).toHaveBeenCalled();
    expect(current.buildPrivateManifest).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reviews: [{ rowIndex: 0, decision: "accept", existingStudentId: "student-1" }],
      }),
    );
    expect(current.sessions.persistReview).toHaveBeenCalledWith(
      expect.objectContaining({
        privateManifest: { stage: "accepted" },
        preview: acceptedPreview,
      }),
    );
    expect(JSON.stringify(vi.mocked(current.sessions.persistReview).mock.calls)).not.toContain(
      "BPT-0001",
    );
  });

  it("creates a private path-bound session from claims and returns only upload metadata", async () => {
    const current = services();
    const data = {
      operationId,
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      files: [
        {
          fileName: "  Members (Town) 01.PDF  ",
          contentType: "application/pdf",
          sizeBytes: 128,
        },
      ],
    };

    const response = await createCanonicalMemberImportSessionHandler(request(data), current);

    expect(response).toEqual({
      sessionId,
      operationId,
      uploads: [{ uploadUrl: "https://upload.example.test/object" }],
      expiresAt,
    });
    expect(current.sessions.createOrGet).toHaveBeenCalledWith(uploading(), now);
    expect(current.uploadManifestMacFor).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          {
            fileName: "Members (Town) 01.PDF",
            contentType: "application/pdf",
            sizeBytes: 128,
          },
        ],
      }),
    );
    expect(response).not.toHaveProperty("academyId");
    expect(response).not.toHaveProperty("manifest");
    expect(JSON.stringify(response)).not.toContain("academies/academy-1/member-imports");
    expect(JSON.stringify(response)).not.toContain("members.pdf");
  });

  it("rejects missing App Check, stale actors and extra tenant/row fields before session or R2 I/O", async () => {
    const baseData = {
      operationId,
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      files: [{ fileName: "members.pdf", contentType: "application/pdf", sizeBytes: 128 }],
    };
    for (const [current, incoming] of [
      [services(), request(baseData, { appCheck: false })],
      [services(), request({ ...baseData, academyId: "academy-2" })],
      [services(), request({ ...baseData, rows: [row] })],
    ] as const) {
      await expect(
        createCanonicalMemberImportSessionHandler(incoming, current),
      ).rejects.toMatchObject({ code: expect.stringMatching(/unauthenticated|invalid-argument/u) });
      expect(current.sessions.createOrGet).not.toHaveBeenCalled();
      expect(current.r2.createPdfUploadUrl).not.toHaveBeenCalled();
    }
    const inactive = services();
    vi.mocked(inactive.isActorActive).mockResolvedValue(false);
    await expect(
      createCanonicalMemberImportSessionHandler(request(baseData), inactive),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(inactive.sessions.createOrGet).not.toHaveBeenCalled();
  });

  it("persists a metadata-only preview while rows and manifest remain server-side", async () => {
    const current = services(uploading());

    const response = await previewCanonicalMemberImportHandler(
      request({ sessionId, operationId }),
      current,
    );

    expect(response).toEqual(preview());
    expect(current.sources.read).toHaveBeenCalledWith(uploading());
    expect(current.buildPrivateManifest).toHaveBeenCalledWith(
      expect.objectContaining({ rows: [row], operationId }),
    );
    expect(current.core.dryRun).toHaveBeenCalledWith(
      expect.objectContaining({ rows: [row], manifest: { private: true }, operationId, now }),
    );
    expect(current.sessions.persistPreview).toHaveBeenCalledWith({
      academyId: "academy-1",
      sessionId,
      operationId,
      sourceUploadMac: "a".repeat(64),
      privateManifest: { private: true },
      preview: preview(),
      now,
    });
    expect(response).not.toHaveProperty("rows");
    expect(response).not.toHaveProperty("manifest");
    expect(JSON.stringify(response)).not.toContain("Synthetic Adult");
  });

  it("replays a persisted preview without reopening its private upload", async () => {
    const current = services(previewed());
    await expect(
      previewCanonicalMemberImportHandler(request({ sessionId, operationId }), current),
    ).resolves.toEqual(preview());
    expect(current.sources.read).not.toHaveBeenCalled();
    expect(current.core.dryRun).not.toHaveBeenCalled();
  });

  it("confirm reopens, reparses and reconstructs server-side, then closes the exact session", async () => {
    const current = services(previewed());

    const result = await confirmCanonicalMemberImportHandler(
      request({ sessionId, operationId, receipt: receipt() }),
      current,
    );

    expect(current.sources.read).toHaveBeenCalledWith(previewed());
    expect(current.buildPrivateManifest).toHaveBeenCalledWith(
      expect.objectContaining({ rows: [row], operationId }),
    );
    expect(current.core.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId,
        rows: [row],
        manifest: { private: true },
        receipt: receipt(),
        now,
      }),
    );
    expect(current.sessions.persistResult).toHaveBeenCalledWith({
      academyId: "academy-1",
      sessionId,
      operationId,
      sourceUploadMac: "a".repeat(64),
      preview: preview(),
      result,
      now,
    });
    expect(result).toEqual({ receiptId: receipt().receiptId, created: 1, matched: 0 });
  });

  it("rejects cross-actor sessions, source divergence and raw confirm payloads before canonical writes", async () => {
    const crossActor = services({ ...uploading(), actorId: "other-owner" });
    await expect(
      previewCanonicalMemberImportHandler(request({ sessionId, operationId }), crossActor),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(crossActor.sources.read).not.toHaveBeenCalled();

    const divergent = services(previewed());
    vi.mocked(divergent.sources.read).mockResolvedValue({
      rows: [row],
      sourceUploadMac: "b".repeat(64),
    });
    await expect(
      confirmCanonicalMemberImportHandler(
        request({ sessionId, operationId, receipt: receipt() }),
        divergent,
      ),
    ).rejects.toMatchObject({ code: "failed-precondition" });
    expect(divergent.core.confirm).not.toHaveBeenCalled();

    const raw = services(previewed());
    await expect(
      confirmCanonicalMemberImportHandler(
        request({ sessionId, operationId, receipt: receipt(), rows: [row] }),
        raw,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(raw.sessions.read).not.toHaveBeenCalled();
  });
});

describe("canonical member import source reader", () => {
  it("reads each private PDF, parses synthetic rows and returns only a keyed source MAC", async () => {
    const currentR2 = r2();
    const text = [
      "TOTAL MEMBERS IN DATABASE (1)",
      "Member No | Name | ID Card No | Birthdate | VAT Number | Mobile No",
      "BPT-0001 | Synthetic Adult | ID-1 | 02 Jan 1990 | VAT-1 | +447000000001",
      "Document produced by www.regyfit.com on 11-08-2026 at 10:30 Page 1/1",
    ].join("\n");
    const reader = createCanonicalMemberImportSourceReader({
      r2: currentR2,
      pdfTextExtractor: vi.fn(async () => text),
      integritySecretMaterial: "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8",
    });

    expect(() => parseMemberReport(text)).not.toThrow();

    const result = await reader.read(uploading());

    expect(currentR2.readObject).toHaveBeenCalledWith(uploading().uploads[0]?.objectKey);
    expect(result.rows).toEqual([
      {
        sourceReport: "total",
        sourceRowNumber: 1,
        membershipNumber: "BPT-0001",
        fullName: "Synthetic Adult",
        idCardNumber: "ID-1",
        birthDate: "1990-01-02",
        vatNumber: "VAT-1",
        mobileNumber: "+447000000001",
      },
    ]);
    expect(result.sourceUploadMac).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify({ sourceUploadMac: result.sourceUploadMac })).not.toContain(
      "Synthetic Adult",
    );
  });

  it("rejects a byte-length mismatch before parsing the private object", async () => {
    const currentR2 = r2();
    vi.mocked(currentR2.readObject).mockResolvedValue(new Uint8Array([37, 80, 68, 70, 45]));
    const extractor = vi.fn(async () => "must not parse");
    const reader = createCanonicalMemberImportSourceReader({
      r2: currentR2,
      pdfTextExtractor: extractor,
      integritySecretMaterial: integritySecret,
    });

    await expect(reader.read(uploading())).rejects.toMatchObject({ code: "invalid" });
    expect(extractor).not.toHaveBeenCalled();
  });
});

describe("canonical member import cleanup", () => {
  it("deletes every expired private object before deleting its MAC-validated session", async () => {
    const current = services();
    const expired = { ...uploading(), expiresAt: "2026-09-03T20:09:00.000Z" };
    vi.mocked(current.sessions.listExpired).mockResolvedValue([expired]);

    await expect(cleanupExpiredCanonicalMemberImportsHandler(current, now)).resolves.toEqual({
      examined: 1,
      deleted: 1,
      failed: 0,
    });

    expect(current.r2.deleteObject).toHaveBeenCalledWith(expired.uploads[0]?.objectKey);
    expect(current.sessions.deleteExpired).toHaveBeenCalledWith({
      academyId: expired.academyId,
      sessionId: expired.sessionId,
      sessionMac: expired.sessionMac,
      now,
    });
    expect(vi.mocked(current.r2.deleteObject).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(current.sessions.deleteExpired).mock.invocationCallOrder[0] ?? 0,
    );
  });
});

describe("canonical import actor activity gate", () => {
  it("requires current Auth claims, an exact provisioned document and no role lock", async () => {
    const getAuthUser = vi.fn(async () => ({
      uid: "owner-1",
      disabled: false,
      customClaims: { academyId: "academy-1", role: "owner" },
    }));
    const getDocument = vi.fn(async (path: string) =>
      path.includes("adminRoleLocks")
        ? { exists: false, data: () => undefined }
        : {
            exists: true,
            data: () => ({
              userId: "owner-1",
              academyId: "academy-1",
              accountType: "staff",
              displayName: "Synthetic Owner",
              email: "owner@example.test",
              authProvider: "google",
              active: true,
              adminRole: "owner",
              lastRoleChangeAuditId: "audit-role-1",
              createdAt: Timestamp.fromMillis(1_700_000_000_000),
              createdBy: "bootstrap-owner",
              updatedAt: Timestamp.fromMillis(1_700_000_001_000),
              updatedBy: "bootstrap-owner",
              status: "active",
              schemaVersion: 1,
            }),
          },
    );
    const check = createCanonicalMemberImportActorActivityCheck({ getAuthUser, getDocument });

    await expect(check({ uid: "owner-1", academyId: "academy-1", role: "owner" })).resolves.toBe(
      true,
    );
    expect(getDocument).toHaveBeenCalledTimes(2);
  });
});
