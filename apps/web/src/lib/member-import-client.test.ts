import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  getFirebaseFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(),
}));

vi.mock("./firebase-client", () => ({
  getFirebaseFunctions: mocks.getFirebaseFunctions,
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mocks.httpsCallable,
}));

import {
  confirmMemberImport,
  createMemberImportSession,
  previewMemberImport,
  reviewMemberImportMatches,
  uploadMemberImportFiles,
  validateMemberImportFiles,
  type CanonicalMemberImportReceipt,
  type MemberImportFile,
} from "./member-import-client";

const operationId = "41cbb1aa-7020-4bb5-88a4-dbc73c5f0123";
const rowMac = "a".repeat(64);

function pdf(name = "members.pdf", size = 100): File {
  return new File([new Uint8Array(size)], name, { type: "application/pdf" });
}

function futureIso(minutes = 5): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function deferredResponse() {
  let resolvePromise!: (response: Response) => void;
  return {
    promise: new Promise<Response>((resolve) => {
      resolvePromise = resolve;
    }),
    resolve: (response: Response) => resolvePromise(response),
  };
}

function receipt(expiresAt = futureIso()): CanonicalMemberImportReceipt {
  return {
    receiptId: `import-${"b".repeat(64)}`,
    operationId,
    academyId: "academy-1",
    actorId: "owner-1",
    projectId: "demo-bpt-jersey",
    targetProjectClassification: "emulator",
    codeVersion: "canonical-member-import-v1",
    schemaVersion: "1",
    operationWriteTime: new Date(Date.now() - 1_000).toISOString(),
    expiresAt,
    sourceMac: "c".repeat(64),
    privateManifestMac: "d".repeat(64),
    planMac: "e".repeat(64),
    outputSetMac: "f".repeat(64),
    digestVersion: "hmac-sha256-v1",
    identitySecretVersion: "identity-v1",
    integrityMacVersion: "hmac-sha256-v1",
    integritySecretVersion: "integrity-v1",
    identityKeyBaselineMac: "1".repeat(64),
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

function preview(expiresAt = futureIso()) {
  return {
    classifications: [{ rowMac, classification: "createable-adult" }],
    reviewMatches: [],
    confirmable: true,
    receipt: receipt(expiresAt),
  };
}

function reviewPreview(decision: "pending" | "accepted") {
  const accepted = decision === "accepted";
  const currentReceipt = receipt();
  return {
    classifications: [
      {
        rowMac,
        classification: accepted
          ? "explicit-existing-student-match"
          : "identity-conflict",
      },
    ],
    reviewMatches: [
      {
        rowMac,
        sourceName: "Synthetic Adult",
        candidate: {
          studentId: "student-1",
          fullName: "Synthetic Adult",
          trainingCenter: "Town",
          membershipReference: "****0001",
        },
        decision,
      },
    ],
    confirmable: accepted,
    receipt: {
      ...currentReceipt,
      classificationCounts: {
        ...currentReceipt.classificationCounts,
        "createable-adult": 0,
        "identity-conflict": accepted ? 0 : 1,
        "explicit-existing-student-match": accepted ? 1 : 0,
      },
      plannedNewStudentCount: 0,
      postCutoverAdmittedStudentCount: 0,
    },
  } as const;
}

describe("canonical member import client", () => {
  beforeEach(() => {
    mocks.callable.mockReset();
    mocks.httpsCallable.mockReset();
  });

  it("validates only non-empty PDF files up to five and 10 MiB each", () => {
    expect(validateMemberImportFiles([pdf("one.pdf"), pdf("two.pdf")])).toHaveLength(2);
    expect(
      validateMemberImportFiles(Array.from({ length: 6 }, (_, index) => pdf(`${index}.pdf`))),
    ).toEqual([]);
    expect(validateMemberImportFiles([pdf("large.pdf", 10 * 1024 * 1024 + 1)])).toEqual([]);
    expect(
      validateMemberImportFiles([new File(["text"], "members.txt", { type: "text/plain" })]),
    ).toEqual([]);
    expect(validateMemberImportFiles([pdf("  Ｍembers （Town） 01.PDF  ")])[0]?.fileName).toBe(
      "Members (Town) 01.PDF",
    );
    for (const unsafeName of ["folder/members.pdf", "folder\\members.pdf", "member\u0000.pdf", ".pdf"]) {
      expect(validateMemberImportFiles([pdf(unsafeName)])).toEqual([]);
    }
  });

  it("sends the exact operation and training metadata without rows, tenant or manifest", async () => {
    const response = {
      sessionId: `import-session-${"2".repeat(64)}`,
      operationId,
      uploads: [{ uploadUrl: "https://upload.example/key" }],
      expiresAt: futureIso(),
    };
    mocks.httpsCallable.mockReturnValue(mocks.callable);
    mocks.callable.mockResolvedValue({ data: response });

    const file = validateMemberImportFiles([pdf("  Members (Town) 01.PDF  ", 12)])[0];
    if (file === undefined) throw new Error("Test file was not accepted");
    await expect(
      createMemberImportSession([file], {
        operationId,
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
      }),
    ).resolves.toEqual(response);
    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "createMemberPdfImportSession");
    const payload = {
      operationId,
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      files: [
        {
          fileName: "Members (Town) 01.PDF",
          contentType: "application/pdf",
          sizeBytes: 12,
        },
      ],
    };
    expect(mocks.callable).toHaveBeenCalledWith(payload);
    expect(payload).not.toHaveProperty("academyId");
    expect(payload).not.toHaveProperty("rows");
    expect(payload).not.toHaveProperty("manifest");
  });

  it("uploads only to returned HTTPS URLs and reports progress", async () => {
    const open = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const progress = vi.fn();
    const files = validateMemberImportFiles([pdf("members.pdf")]);
    const file = files[0];
    if (file === undefined) throw new Error("Test file was not accepted");
    const session = {
      sessionId: `import-session-${"2".repeat(64)}`,
      operationId,
      uploads: [{ uploadUrl: "https://upload.example/key" }],
      expiresAt: futureIso(),
    };

    await uploadMemberImportFiles(files, session, progress);

    expect(open).toHaveBeenCalledWith(session.uploads[0]?.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.contentType },
      body: file.file,
    });
    expect(progress).toHaveBeenCalledWith(1, 1);
    open.mockRestore();
  });

  it("reports concurrent upload progress by monotonically completed count", async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    const open = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      return url.endsWith("/0") ? first.promise : second.promise;
    });
    const progress = vi.fn();
    const files = validateMemberImportFiles([pdf("first.pdf"), pdf("second.pdf")]);
    const session = {
      sessionId: `import-session-${"2".repeat(64)}`,
      operationId,
      uploads: [
        { uploadUrl: "https://upload.example/0" },
        { uploadUrl: "https://upload.example/1" },
      ],
      expiresAt: futureIso(),
    };

    const pending = uploadMemberImportFiles(files, session, progress);
    second.resolve(new Response(null, { status: 200 }));
    await vi.waitFor(() => expect(progress).toHaveBeenCalledWith(1, 2));
    first.resolve(new Response(null, { status: 200 }));
    await pending;

    expect(progress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
    open.mockRestore();
  });

  it("previews by opaque IDs and confirms using only the stored signed receipt", async () => {
    const canonicalPreview = preview();
    const result = { receiptId: canonicalPreview.receipt.receiptId, created: 1, matched: 0 };
    mocks.httpsCallable.mockReturnValue(mocks.callable);
    mocks.callable.mockResolvedValueOnce({ data: canonicalPreview }).mockResolvedValueOnce({ data: result });

    await expect(previewMemberImport("session-1", operationId)).resolves.toEqual(canonicalPreview);
    await expect(
      confirmMemberImport("session-1", operationId, canonicalPreview.receipt),
    ).resolves.toEqual(result);
    expect(mocks.callable).toHaveBeenNthCalledWith(1, { sessionId: "session-1", operationId });
    expect(mocks.callable).toHaveBeenNthCalledWith(2, {
      sessionId: "session-1",
      operationId,
      receipt: canonicalPreview.receipt,
    });
    expect(mocks.callable.mock.calls[1]?.[0]).not.toHaveProperty("rows");
    expect(mocks.callable.mock.calls[1]?.[0]).not.toHaveProperty("manifest");
  });

  it("reviews matches using only rowMac decisions and rejects extra candidate fields", async () => {
    const accepted = reviewPreview("accepted");
    mocks.httpsCallable.mockReturnValue(mocks.callable);
    mocks.callable.mockResolvedValue({ data: accepted });

    await expect(
      reviewMemberImportMatches("session-1", operationId, [
        { rowMac, decision: "accept" },
      ]),
    ).resolves.toEqual(accepted);
    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "reviewMemberPdfImportMatches");
    expect(mocks.callable).toHaveBeenCalledWith({
      sessionId: "session-1",
      operationId,
      decisions: [{ rowMac, decision: "accept" }],
    });

    mocks.callable.mockResolvedValue({
      data: {
        ...accepted,
        reviewMatches: [
          { ...accepted.reviewMatches[0], candidate: { ...accepted.reviewMatches[0].candidate, email: "blocked@example.test" } },
        ],
      },
    });
    await expect(
      reviewMemberImportMatches("session-1", operationId, [
        { rowMac, decision: "accept" },
      ]),
    ).rejects.toThrow("Unable to review member matches. Please try again.");
  });

  it("rejects a preview containing raw rows, private manifest or an expired receipt", async () => {
    mocks.httpsCallable.mockReturnValue(mocks.callable);
    for (const data of [
      { ...preview(), rows: [{ fullName: "must-not-cross-boundary" }] },
      { ...preview(), manifest: { rows: [] } },
      preview(new Date(Date.now() - 1).toISOString()),
    ]) {
      mocks.callable.mockResolvedValueOnce({ data });
      await expect(previewMemberImport("session-1", operationId)).rejects.toThrow(
        "Unable to prepare member import. Please try again.",
      );
    }
  });

  it("rejects expired sessions and sanitizes callable, upload and malformed response errors", async () => {
    mocks.httpsCallable.mockReturnValue(mocks.callable);
    mocks.callable.mockResolvedValueOnce({
      data: {
        sessionId: "session-1",
        operationId,
        uploads: [{ uploadUrl: "https://upload.example/key" }],
        expiresAt: new Date(Date.now() - 1).toISOString(),
      },
    });
    const file = validateMemberImportFiles([pdf()])[0];
    if (!file) throw new Error("Test file was not accepted");
    await expect(
      createMemberImportSession([file], {
        operationId,
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
      }),
    ).rejects.toThrow("Unable to start member import. Please try again.");

    mocks.callable.mockRejectedValueOnce(new Error("private callable details"));
    await expect(previewMemberImport("session-1", operationId)).rejects.toThrow(
      "Unable to prepare member import. Please try again.",
    );

    const validFiles = validateMemberImportFiles([pdf()]);
    await expect(
      uploadMemberImportFiles(validFiles as readonly MemberImportFile[], {
        sessionId: "session-1",
        operationId,
        uploads: [{ uploadUrl: "http://not-https.example/key" }],
        expiresAt: futureIso(),
      }),
    ).rejects.toThrow("Unable to upload member reports. Please try again.");
  });
});
