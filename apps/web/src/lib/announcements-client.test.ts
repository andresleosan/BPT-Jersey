import { describe, expect, it, vi } from "vitest";

import {
  archiveAnnouncement,
  createAnnouncement,
  listAnnouncements,
  markAnnouncementAsRead,
  publishAnnouncement,
  updateAnnouncement,
} from "./announcements-client";

const mockAnnouncement = {
  announcementId: "ann-1",
  academyId: "demo-academy",
  channel: "academy",
  targetId: null,
  title: "Test Announcement",
  content: "This is a test announcement.",
  priority: "normal",
  status: "draft",
  publishedAt: null,
  expiresAt: null,
  authorId: "coach-1",
  authorRole: "coach",
  readBy: [],
  schemaVersion: "1",
  createdAt: "2026-08-23T10:00:00Z",
  createdBy: "coach-1",
  updatedAt: "2026-08-23T10:00:00Z",
  updatedBy: "coach-1",
};

let mockCallableResult: unknown = { data: { announcement: mockAnnouncement } };
let mockCallableError: Error | null = null;

vi.mock("firebase/functions", () => ({
  httpsCallable: () => async () => {
    if (mockCallableError) throw mockCallableError;
    return mockCallableResult;
  },
}));

vi.mock("./firebase-client", () => ({
  getFirebaseFunctions: () => ({}),
}));

describe("Announcements Web Client (T045)", () => {
  it("creates announcement with validation", async () => {
    mockCallableError = null;
    mockCallableResult = { data: { announcement: mockAnnouncement } };

    const result = await createAnnouncement({
      channel: "academy",
      title: "Test Announcement",
      content: "This is a test announcement.",
    });

    expect(result.announcementId).toBe("ann-1");
    expect(result.title).toBe("Test Announcement");
  });

  it("updates, publishes and archives announcement", async () => {
    mockCallableError = null;
    mockCallableResult = {
      data: {
        announcement: {
          ...mockAnnouncement,
          title: "Updated Announcement",
          status: "published",
          publishedAt: "2026-08-23T11:00:00Z",
        },
      },
    };

    const updated = await updateAnnouncement({
      announcementId: "ann-1",
      title: "Updated Announcement",
    });
    expect(updated.title).toBe("Updated Announcement");

    const published = await publishAnnouncement("ann-1");
    expect(published.status).toBe("published");

    mockCallableResult = {
      data: {
        announcement: {
          ...mockAnnouncement,
          status: "archived",
        },
      },
    };

    const archived = await archiveAnnouncement("ann-1");
    expect(archived.status).toBe("archived");
  });

  it("marks announcement as read and lists announcements", async () => {
    mockCallableError = null;
    mockCallableResult = {
      data: {
        announcement: {
          ...mockAnnouncement,
          readBy: ["user-1"],
        },
      },
    };

    const marked = await markAnnouncementAsRead("ann-1");
    expect(marked.readBy).toContain("user-1");

    mockCallableResult = {
      data: {
        announcements: [mockAnnouncement],
      },
    };

    const list = await listAnnouncements({ channel: "academy" });
    expect(list).toHaveLength(1);
    expect(list[0]?.announcementId).toBe("ann-1");
  });

  it("throws safe error on failure", async () => {
    mockCallableError = new Error("Backend exploded");

    await expect(
      createAnnouncement({
        channel: "academy",
        title: "Test Announcement",
        content: "This is a test announcement.",
      }),
    ).rejects.toThrow(/Unable to create announcement/);
  });
});
