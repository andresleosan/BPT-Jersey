import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listGuardianNotices: vi.fn(),
  markNoticeAsRead: vi.fn(),
}));

vi.mock("../../lib/announcements-client", () => mocks);

import { GuardianNoticesPanel } from "./guardian-notices";

const notice = {
  noticeId: "notice-1",
  academyId: "academy-1",
  minorStudentId: "minor-secret-id",
  guardianId: "guardian-1",
  title: "Uniform check",
  content: "Please bring a clean Gi for grading next week.",
  category: "progress" as const,
  authorId: "coach-1",
  authorRole: "coach",
  readAt: null,
  createdAt: "2026-08-23T10:00:00Z",
  createdBy: "coach-1",
};

describe("GuardianNoticesPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows safeguarded notices without exposing the minor identifier", async () => {
    mocks.listGuardianNotices.mockResolvedValue([notice]);
    render(<GuardianNoticesPanel />);

    expect(await screen.findByRole("heading", { name: "Family notices" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Uniform check" })).toBeVisible();
    expect(screen.getByText(notice.content)).toBeVisible();
    expect(screen.queryByText("minor-secret-id")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as read" })).toBeVisible();
  });

  it("marks an unread notice as read", async () => {
    mocks.listGuardianNotices.mockResolvedValue([notice]);
    mocks.markNoticeAsRead.mockResolvedValue({
      ...notice,
      readAt: "2026-08-23T11:00:00Z",
    });
    const user = userEvent.setup();
    render(<GuardianNoticesPanel />);

    await user.click(await screen.findByRole("button", { name: "Mark as read" }));

    await waitFor(() => expect(mocks.markNoticeAsRead).toHaveBeenCalledWith("notice-1"));
    expect(screen.getByText("Read")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Mark as read" })).not.toBeInTheDocument();
  });
});
