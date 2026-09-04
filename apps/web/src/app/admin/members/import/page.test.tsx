import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  confirmMemberImport: vi.fn(),
  createMemberImportSession: vi.fn(),
  previewMemberImport: vi.fn(),
  reviewMemberImportMatches: vi.fn(),
  uploadMemberImportFiles: vi.fn(),
}));

vi.mock("../../../../lib/member-import-client", async () => {
  const actual = await vi.importActual<typeof import("../../../../lib/member-import-client")>(
    "../../../../lib/member-import-client",
  );
  return { ...actual, ...clientMocks };
});

import { MemberImportPage } from "./page";

const receiptId = `import-${"b".repeat(64)}`;

function futureIso(minutes = 5): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function session(operationId: string, expiresAt = futureIso()) {
  return {
    sessionId: `import-session-${"2".repeat(64)}`,
    operationId,
    uploads: [{ uploadUrl: "https://upload.example/key" }],
    expiresAt,
  };
}

function preview(
  operationId: string,
  options: Readonly<{ expiresAt?: string; confirmable?: boolean }> = {},
) {
  const expiresAt = options.expiresAt ?? futureIso();
  const confirmable = options.confirmable ?? true;
  return {
    classifications: [
      { rowMac: "a".repeat(64), classification: "createable-adult" },
      ...(confirmable
        ? [{ rowMac: "c".repeat(64), classification: "explicit-existing-student-match" }]
        : [{ rowMac: "c".repeat(64), classification: "identity-conflict" }]),
    ],
    reviewMatches: [],
    confirmable,
    receipt: {
      receiptId,
      operationId,
      expiresAt,
      classificationCounts: {
        "same-id-compatible": 0,
        "explicit-existing-student-match": confirmable ? 1 : 0,
        "createable-adult": 1,
        "minor-requires-family-match": 0,
        "missing-required-fields": 0,
        "identity-conflict": confirmable ? 0 : 1,
        "duplicate-membership-number": 0,
        "cross-tenant": 0,
        "invalid-record": 0,
      },
    },
  };
}

function chooseFiles(user: ReturnType<typeof userEvent.setup>) {
  return user.upload(screen.getByLabelText("Member report PDFs"), [
    new File(["synthetic pdf"], "members.pdf", { type: "application/pdf" }),
  ]);
}

function mockHappyFlow(): void {
  clientMocks.createMemberImportSession.mockImplementation(async (_files, options) =>
    session(options.operationId),
  );
  clientMocks.uploadMemberImportFiles.mockResolvedValue(undefined);
  clientMocks.previewMemberImport.mockImplementation(async (_sessionId, operationId) =>
    preview(operationId),
  );
}

describe("canonical member import page", () => {
  beforeEach(() => {
    clientMocks.confirmMemberImport.mockReset();
    clientMocks.createMemberImportSession.mockReset();
    clientMocks.previewMemberImport.mockReset();
    clientMocks.reviewMemberImportMatches.mockReset();
    clientMocks.uploadMemberImportFiles.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders accessible upload and training controls and blocks confirmation before preview", () => {
    render(<MemberImportPage />);

    expect(screen.getByRole("heading", { name: "Import member reports" })).toBeVisible();
    expect(screen.getByLabelText("Member report PDFs")).toHaveAttribute(
      "accept",
      ".pdf,application/pdf",
    );
    expect(screen.getByLabelText("Training center")).toHaveValue("Town");
    expect(screen.getByLabelText("Evening")).toBeChecked();
    expect(screen.getByRole("button", { name: "Preview import" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Confirm import" })).toBeDisabled();
  });

  it("uploads with one stable operation UUID and renders only canonical classification counts", async () => {
    const user = userEvent.setup();
    mockHappyFlow();
    render(<MemberImportPage />);

    await chooseFiles(user);
    await user.click(screen.getByRole("button", { name: "Preview import" }));

    await waitFor(() => expect(clientMocks.previewMemberImport).toHaveBeenCalled());
    const options = clientMocks.createMemberImportSession.mock.calls[0]?.[1];
    expect(options).toMatchObject({
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      operationId: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
    });
    expect(clientMocks.previewMemberImport).toHaveBeenCalledWith(
      session(options.operationId).sessionId,
      options.operationId,
    );
    expect(screen.getByText("1 new adult")).toBeVisible();
    expect(screen.getByText("1 existing match")).toBeVisible();
    expect(screen.queryByText("Synthetic Adult")).toBeNull();
    expect(screen.getByRole("button", { name: "Confirm import" })).toBeEnabled();
  });

  it("keeps the operation UUID stable across preparation retries", async () => {
    const user = userEvent.setup();
    mockHappyFlow();
    clientMocks.createMemberImportSession.mockRejectedValueOnce(new Error("private"));
    render(<MemberImportPage />);

    await chooseFiles(user);
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to prepare member import");
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await screen.findByText("Preview ready");

    expect(clientMocks.createMemberImportSession).toHaveBeenCalledTimes(2);
    expect(clientMocks.createMemberImportSession.mock.calls[0]?.[1].operationId).toBe(
      clientMocks.createMemberImportSession.mock.calls[1]?.[1].operationId,
    );
  });

  it("rotates the operation UUID when training defaults change between retries", async () => {
    const user = userEvent.setup();
    mockHappyFlow();
    clientMocks.createMemberImportSession
      .mockRejectedValueOnce(new Error("private"))
      .mockRejectedValueOnce(new Error("private"));
    render(<MemberImportPage />);

    await chooseFiles(user);
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await screen.findByRole("alert");
    const firstOperationId = clientMocks.createMemberImportSession.mock.calls[0]?.[1].operationId;

    await user.selectOptions(screen.getByLabelText("Training center"), "West");
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await waitFor(() => expect(clientMocks.createMemberImportSession).toHaveBeenCalledTimes(2));
    await screen.findByRole("alert");
    const secondOperationId = clientMocks.createMemberImportSession.mock.calls[1]?.[1].operationId;

    await user.click(screen.getByLabelText("Morning"));
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await screen.findByText("Preview ready");
    const thirdCall = clientMocks.createMemberImportSession.mock.calls[2]?.[1];

    expect(new Set([firstOperationId, secondOperationId, thirdCall.operationId])).toHaveProperty(
      "size",
      3,
    );
    expect(thirdCall).toMatchObject({
      trainingCenter: "West",
      trainingTimePreferences: ["evening", "morning"],
    });
  });

  it("blocks every non-confirmable classification and never calls confirm", async () => {
    const user = userEvent.setup();
    mockHappyFlow();
    clientMocks.previewMemberImport.mockImplementation(async (_sessionId, operationId) =>
      preview(operationId, { confirmable: false }),
    );
    render(<MemberImportPage />);

    await chooseFiles(user);
    await user.click(screen.getByRole("button", { name: "Preview import" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("cannot be confirmed");
    expect(screen.getByText("1 identity conflict")).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm import" })).toBeDisabled();
    expect(clientMocks.confirmMemberImport).not.toHaveBeenCalled();
  });

  it("requires an explicit complete match review before enabling confirmation", async () => {
    const user = userEvent.setup();
    mockHappyFlow();
    const pending = {
      ...preview("41cbb1aa-7020-4bb5-88a4-dbc73c5f0123", { confirmable: false }),
      reviewMatches: [
        {
          rowMac: "c".repeat(64),
          sourceName: "Synthetic Adult",
          candidate: {
            studentId: "student-1",
            fullName: "Synthetic Adult",
            trainingCenter: "Town",
            membershipReference: "****0001",
          },
          decision: "pending",
        },
      ],
    };
    clientMocks.previewMemberImport.mockResolvedValue(pending);
    clientMocks.reviewMemberImportMatches.mockResolvedValue({
      ...pending,
      classifications: [
        { rowMac: "a".repeat(64), classification: "createable-adult" },
        { rowMac: "c".repeat(64), classification: "explicit-existing-student-match" },
      ],
      reviewMatches: [{ ...pending.reviewMatches[0], decision: "accepted" }],
      confirmable: true,
    });
    render(<MemberImportPage />);

    await chooseFiles(user);
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByRole("heading", { name: "Review existing matches" })).toBeVisible();
    expect(screen.getByText("****0001")).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm import" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Accept match for Synthetic Adult" }));
    await user.click(screen.getByRole("button", { name: "Review matches" }));

    const operationId = clientMocks.createMemberImportSession.mock.calls[0]?.[1].operationId;
    await waitFor(() =>
      expect(clientMocks.reviewMemberImportMatches).toHaveBeenCalledWith(
        session(operationId).sessionId,
        operationId,
        [{ rowMac: "c".repeat(64), decision: "accept" }],
      ),
    );
    expect(screen.getByRole("button", { name: "Confirm import" })).toBeEnabled();
  });

  it("confirms only with sessionId, operationId and the signed receipt", async () => {
    const user = userEvent.setup();
    mockHappyFlow();
    clientMocks.confirmMemberImport.mockResolvedValue({ receiptId, created: 1, matched: 1 });
    render(<MemberImportPage />);

    await chooseFiles(user);
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await screen.findByText("Preview ready");
    const operationId = clientMocks.createMemberImportSession.mock.calls[0]?.[1].operationId;
    const preparedPreview = await clientMocks.previewMemberImport.mock.results[0]?.value;
    await user.click(screen.getByRole("button", { name: "Confirm import" }));

    await waitFor(() =>
      expect(clientMocks.confirmMemberImport).toHaveBeenCalledWith(
        session(operationId).sessionId,
        operationId,
        preparedPreview.receipt,
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Import complete");
    expect(screen.getByText("1 created")).toBeVisible();
    expect(screen.getByText("1 matched")).toBeVisible();
  });

  it("disables confirmation when the signed receipt expires", async () => {
    vi.useFakeTimers();
    try {
      const selected = new File(["synthetic pdf"], "members.pdf", { type: "application/pdf" });
      clientMocks.createMemberImportSession.mockImplementation(async (_files, options) =>
        session(options.operationId),
      );
      clientMocks.uploadMemberImportFiles.mockResolvedValue(undefined);
      clientMocks.previewMemberImport.mockImplementation(async (_sessionId, operationId) =>
        preview(operationId, { expiresAt: new Date(Date.now() + 1_000).toISOString() }),
      );
      render(<MemberImportPage />);

      fireEvent.change(screen.getByLabelText("Member report PDFs"), {
        target: { files: [selected] },
      });
      fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByRole("button", { name: "Confirm import" })).toBeEnabled();
      await act(async () => {
        vi.advanceTimersByTime(1_001);
      });
      expect(screen.getByRole("button", { name: "Confirm import" })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects invalid files and ignores stale preparation after a new selection", async () => {
    const user = userEvent.setup();
    let resolveSession: ((value: ReturnType<typeof session>) => void) | undefined;
    clientMocks.createMemberImportSession.mockImplementation(
      (_files, options) =>
        new Promise((resolve) => {
          resolveSession = resolve;
          void options;
        }),
    );
    render(<MemberImportPage />);

    await chooseFiles(user);
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await user.upload(screen.getByLabelText("Member report PDFs"), [
      new File(["bad"], "members.txt", { type: "text/plain" }),
    ]);
    resolveSession?.(session("51cbb1aa-7020-4bb5-88a4-dbc73c5f0123"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Choose between one and five PDF files");
    expect(screen.queryByText("Preview ready")).toBeNull();
  });
});
