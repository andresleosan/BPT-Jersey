import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  confirmMemberImport: vi.fn(),
  createMemberImportSession: vi.fn(),
  previewMemberImport: vi.fn(),
  uploadMemberImportFiles: vi.fn(),
}));

vi.mock("../../../../lib/member-import-client", async () => {
  const actual = await vi.importActual<typeof import("../../../../lib/member-import-client")>(
    "../../../../lib/member-import-client",
  );
  return { ...actual, ...clientMocks };
});

import { MemberImportPage } from "./page";

function futureIso(minutes = 5): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function session(expiresAt = futureIso()) {
  return {
    sessionId: "session-1",
    uploads: [{ objectKey: "server/key.pdf", uploadUrl: "https://upload.example/key" }],
    expiresAt,
  };
}

function preview(expiresAt = futureIso()) {
  return {
    previewId: "preview-1",
    expiresAt,
    sourceReports: [{ source: "pdf-1", report: "active", rowCount: 2 }],
    additions: [{ stableKey: "new-member", rowNumbers: [2], fieldNames: ["fullName"] }],
    updates: [{ stableKey: "existing-member", rowNumbers: [3], fieldNames: ["email"] }],
    duplicates: [],
    conflicts: [],
  };
}

function chooseFiles(user: ReturnType<typeof userEvent.setup>) {
  return user.upload(screen.getByLabelText("Member report PDFs"), [
    new File(["synthetic pdf"], "members.pdf", { type: "application/pdf" }),
  ]);
}

describe("member import page", () => {
  beforeEach(() => {
    clientMocks.confirmMemberImport.mockReset();
    clientMocks.createMemberImportSession.mockReset();
    clientMocks.previewMemberImport.mockReset();
    clientMocks.uploadMemberImportFiles.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders accessible upload landmarks and blocks confirmation before preview", () => {
    render(<MemberImportPage />);

    expect(screen.getByRole("heading", { name: "Import member reports" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Import member reports" })).toBeVisible();
    expect(screen.getByLabelText("Member report PDFs")).toHaveAttribute(
      "accept",
      ".pdf,application/pdf",
    );
    expect(screen.getByRole("button", { name: "Preview import" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Confirm import" })).toBeDisabled();
    expect(clientMocks.confirmMemberImport).not.toHaveBeenCalled();
  });

  it("selects files, uploads with status, and renders preview counts", async () => {
    const user = userEvent.setup();
    clientMocks.createMemberImportSession.mockResolvedValue(session());
    clientMocks.uploadMemberImportFiles.mockResolvedValue(undefined);
    clientMocks.previewMemberImport.mockResolvedValue(preview());
    render(<MemberImportPage />);

    await chooseFiles(user);
    expect(screen.getByText("members.pdf")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Preview import" }));

    await waitFor(() => expect(clientMocks.previewMemberImport).toHaveBeenCalledWith("session-1"));
    expect(screen.getByText("1 addition")).toBeVisible();
    expect(screen.getByText("1 update")).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm import" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("Preview ready");
  });

  it("blocks conflicts and requires an explicit confirmation action", async () => {
    const user = userEvent.setup();
    clientMocks.createMemberImportSession.mockResolvedValue(session());
    clientMocks.uploadMemberImportFiles.mockResolvedValue(undefined);
    const conflictPreview = preview();
    clientMocks.previewMemberImport.mockResolvedValue({
      ...conflictPreview,
      conflicts: [conflictPreview.updates[0]],
    });
    render(<MemberImportPage />);

    await chooseFiles(user);
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Resolve 1 conflict");
    expect(screen.getByRole("button", { name: "Confirm import" })).toBeDisabled();
    expect(clientMocks.confirmMemberImport).not.toHaveBeenCalled();
  });

  it("confirms only after the user action and shows the server result", async () => {
    const user = userEvent.setup();
    clientMocks.createMemberImportSession.mockResolvedValue(session());
    clientMocks.uploadMemberImportFiles.mockResolvedValue(undefined);
    clientMocks.previewMemberImport.mockResolvedValue(preview());
    clientMocks.confirmMemberImport.mockResolvedValue({ imported: 1, updated: 2, conflicts: 0 });
    render(<MemberImportPage />);

    await chooseFiles(user);
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await screen.findByText("Preview ready");
    expect(clientMocks.confirmMemberImport).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm import" }));

    await waitFor(() =>
      expect(clientMocks.confirmMemberImport).toHaveBeenCalledWith("session-1", "preview-1"),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Import complete");
    expect(screen.getByText("1 imported")).toBeVisible();
    expect(screen.getByText("2 updated")).toBeVisible();
  });

  it("uses real file validation and rejects invalid selections", async () => {
    const user = userEvent.setup();
    render(<MemberImportPage />);

    await user.upload(screen.getByLabelText("Member report PDFs"), [
      new File([], "empty.pdf", { type: "application/pdf" }),
    ]);

    expect(screen.getByRole("alert")).toHaveTextContent("Choose between one and five PDF files");
    expect(screen.getByRole("button", { name: "Preview import" })).toBeDisabled();
    expect(clientMocks.createMemberImportSession).not.toHaveBeenCalled();
  });

  it("ignores a stale operation after a new invalid selection", async () => {
    const user = userEvent.setup();
    let resolveSession: ((value: ReturnType<typeof session>) => void) | undefined;
    clientMocks.createMemberImportSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );
    render(<MemberImportPage />);

    await chooseFiles(user);
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await user.upload(screen.getByLabelText("Member report PDFs"), [
      new File(["bad"], "members.txt", { type: "text/plain" }),
    ]);
    resolveSession?.(session());

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Choose between one and five PDF files");
    expect(screen.queryByText("Preview ready")).toBeNull();
    expect(screen.getByRole("button", { name: "Confirm import" })).toBeDisabled();
  });

  it("disables confirmation automatically when the preview expires", async () => {
    vi.useFakeTimers();
    try {
      const selected = new File(["synthetic pdf"], "members.pdf", { type: "application/pdf" });
      const importSession = session();
      const importPreview = preview(new Date(Date.now() + 1_000).toISOString());
      clientMocks.createMemberImportSession.mockResolvedValue(importSession);
      clientMocks.uploadMemberImportFiles.mockResolvedValue(undefined);
      clientMocks.previewMemberImport.mockResolvedValue(importPreview);
      render(<MemberImportPage />);

      fireEvent.change(screen.getByLabelText("Member report PDFs"), {
        target: { files: [selected] },
      });
      fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText("Preview ready")).toBeVisible();
      expect(screen.getByRole("button", { name: "Confirm import" })).toBeEnabled();
      await act(async () => {
        vi.advanceTimersByTime(1_001);
      });
      expect(screen.getByRole("button", { name: "Confirm import" })).toBeDisabled();
      expect(clientMocks.confirmMemberImport).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks Date.now directly when the expiry timer is stale", async () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      const selected = new File(["synthetic pdf"], "members.pdf", { type: "application/pdf" });
      const importSession = session(new Date(now + 60_000).toISOString());
      const importPreview = preview(new Date(now + 60_000).toISOString());
      clientMocks.createMemberImportSession.mockResolvedValue(importSession);
      clientMocks.uploadMemberImportFiles.mockResolvedValue(undefined);
      clientMocks.previewMemberImport.mockResolvedValue(importPreview);
      clientMocks.confirmMemberImport.mockResolvedValue({ imported: 1, updated: 0, conflicts: 0 });
      render(<MemberImportPage />);

      fireEvent.change(screen.getByLabelText("Member report PDFs"), {
        target: { files: [selected] },
      });
      fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText("Preview ready")).toBeVisible();
      expect(screen.getByRole("button", { name: "Confirm import" })).toBeEnabled();

      vi.setSystemTime(now + 61_000);
      fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));

      expect(clientMocks.confirmMemberImport).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent("expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["session", "createMemberImportSession"],
    ["upload", "uploadMemberImportFiles"],
    ["preview", "previewMemberImport"],
  ] as const)("shows a safe %s error and allows retry", async (_label, operation) => {
    const user = userEvent.setup();
    clientMocks.createMemberImportSession.mockResolvedValue(session());
    clientMocks.uploadMemberImportFiles.mockResolvedValue(undefined);
    clientMocks.previewMemberImport.mockResolvedValue(preview());
    if (operation === "createMemberImportSession") {
      clientMocks.createMemberImportSession
        .mockRejectedValueOnce(new Error("private detail"))
        .mockResolvedValue(session());
    } else if (operation === "uploadMemberImportFiles") {
      clientMocks.uploadMemberImportFiles
        .mockRejectedValueOnce(new Error("private detail"))
        .mockResolvedValue(undefined);
    } else {
      clientMocks.previewMemberImport
        .mockRejectedValueOnce(new Error("private detail"))
        .mockResolvedValue(preview());
    }
    render(<MemberImportPage />);

    await chooseFiles(user);
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to prepare member import");
    expect(screen.getByRole("alert")).not.toHaveTextContent("private detail");
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await waitFor(() => expect(clientMocks.createMemberImportSession).toHaveBeenCalledTimes(2));
  });

  it("keeps controls disabled while loading and ignores duplicate confirm clicks", async () => {
    const user = userEvent.setup();
    let resolveConfirm:
      ((value: { imported: number; updated: number; conflicts: number }) => void) | undefined;
    clientMocks.createMemberImportSession.mockResolvedValue(session());
    clientMocks.uploadMemberImportFiles.mockResolvedValue(undefined);
    clientMocks.previewMemberImport.mockResolvedValue(preview());
    clientMocks.confirmMemberImport.mockReturnValue(
      new Promise((resolve) => {
        resolveConfirm = resolve;
      }),
    );
    render(<MemberImportPage />);

    await chooseFiles(user);
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await screen.findByText("Preview ready");
    const confirm = screen.getByRole("button", { name: "Confirm import" });
    await user.click(confirm);
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(clientMocks.confirmMemberImport).toHaveBeenCalledOnce();
    resolveConfirm?.({ imported: 1, updated: 0, conflicts: 0 });
    await waitFor(() => expect(screen.getByText("1 imported")).toBeVisible());
  });

  it("shows a safe confirmation error and allows confirmation retry", async () => {
    const user = userEvent.setup();
    clientMocks.createMemberImportSession.mockResolvedValue(session());
    clientMocks.uploadMemberImportFiles.mockResolvedValue(undefined);
    clientMocks.previewMemberImport.mockResolvedValue(preview());
    clientMocks.confirmMemberImport
      .mockRejectedValueOnce(new Error("private confirmation detail"))
      .mockResolvedValue({ imported: 1, updated: 0, conflicts: 0 });
    render(<MemberImportPage />);

    await chooseFiles(user);
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await screen.findByText("Preview ready");
    await user.click(screen.getByRole("button", { name: "Confirm import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to confirm member import. Please try again.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("private confirmation detail");
    await user.click(screen.getByRole("button", { name: "Confirm import" }));
    await waitFor(() => expect(screen.getByText("1 imported")).toBeVisible());
  });

  it("does not restore a stale confirmation result after a new selection", async () => {
    const user = userEvent.setup();
    let resolveConfirm:
      ((value: { imported: number; updated: number; conflicts: number }) => void) | undefined;
    clientMocks.createMemberImportSession.mockResolvedValue(session());
    clientMocks.uploadMemberImportFiles.mockResolvedValue(undefined);
    clientMocks.previewMemberImport.mockResolvedValue(preview());
    clientMocks.confirmMemberImport.mockReturnValue(
      new Promise((resolve) => {
        resolveConfirm = resolve;
      }),
    );
    render(<MemberImportPage />);

    await chooseFiles(user);
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await screen.findByText("Preview ready");
    await user.click(screen.getByRole("button", { name: "Confirm import" }));
    await user.upload(screen.getByLabelText("Member report PDFs"), [
      new File(["new synthetic pdf"], "new-members.pdf", { type: "application/pdf" }),
    ]);
    resolveConfirm?.({ imported: 1, updated: 0, conflicts: 0 });

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("Import complete")).toBeNull();
    expect(screen.getByText("new-members.pdf")).toBeVisible();
  });
});
