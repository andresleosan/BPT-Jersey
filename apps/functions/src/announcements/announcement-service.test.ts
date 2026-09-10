import { describe, expect, it } from "vitest";

import { createInMemoryAnnouncementStore } from "./announcement-service";

describe("Announcement Service Store (T045)", () => {
  it("creates draft and published announcements with audit events", async () => {
    const store = createInMemoryAnnouncementStore();

    const draft = await store.createAnnouncement({
      academyId: "demo-academy",
      input: {
        channel: "academy",
        title: "Draft Announcement",
        content: "Will be published later.",
        publishImmediately: false,
      },
      authorId: "coach-1",
      authorRole: "coach",
      now: "2026-08-23T10:00:00Z",
    });

    expect(draft.status).toBe("draft");
    expect(draft.publishedAt).toBeNull();

    const published = await store.createAnnouncement({
      academyId: "demo-academy",
      input: {
        channel: "class",
        targetId: "class-101",
        title: "Class Location Change",
        content: "Please report to Studio B today.",
        priority: "urgent",
        publishImmediately: true,
      },
      authorId: "headcoach-1",
      authorRole: "headCoach",
      now: "2026-08-23T11:00:00Z",
    });

    expect(published.status).toBe("published");
    expect(published.publishedAt).toBe("2026-08-23T11:00:00Z");
    expect(published.priority).toBe("urgent");
  });

  it("updates, publishes and archives announcements", async () => {
    const store = createInMemoryAnnouncementStore();

    const ann = await store.createAnnouncement({
      academyId: "demo-academy",
      input: {
        channel: "academy",
        title: "Initial Title",
        content: "Initial Content.",
        publishImmediately: false,
      },
      authorId: "admin-1",
      authorRole: "administrator",
    });

    const updated = await store.updateAnnouncement({
      academyId: "demo-academy",
      input: {
        announcementId: ann.announcementId,
        title: "Updated Title",
        content: "Updated Content.",
        priority: "pinned",
      },
      updatedBy: "admin-1",
    });

    expect(updated.title).toBe("Updated Title");
    expect(updated.priority).toBe("pinned");

    const published = await store.publishAnnouncement({
      academyId: "demo-academy",
      announcementId: ann.announcementId,
      publishedBy: "admin-1",
      now: "2026-08-23T12:00:00Z",
    });

    expect(published.status).toBe("published");
    expect(published.publishedAt).toBe("2026-08-23T12:00:00Z");

    const archived = await store.archiveAnnouncement({
      academyId: "demo-academy",
      announcementId: ann.announcementId,
      archivedBy: "admin-1",
    });

    expect(archived.status).toBe("archived");
  });

  it("tracks in-app read status idempotently per user", async () => {
    const store = createInMemoryAnnouncementStore();

    const ann = await store.createAnnouncement({
      academyId: "demo-academy",
      input: {
        channel: "academy",
        title: "Read Tracking Test",
        content: "Important notice.",
        publishImmediately: true,
      },
      authorId: "coach-1",
      authorRole: "coach",
    });

    expect(ann.readBy).toEqual([]);

    const readOnce = await store.markAsRead({
      academyId: "demo-academy",
      announcementId: ann.announcementId,
      userId: "student-1",
    });
    expect(readOnce.readBy).toEqual(["student-1"]);

    // Idempotent second mark
    const readTwice = await store.markAsRead({
      academyId: "demo-academy",
      announcementId: ann.announcementId,
      userId: "student-1",
    });
    expect(readTwice.readBy).toEqual(["student-1"]);

    const readSecondUser = await store.markAsRead({
      academyId: "demo-academy",
      announcementId: ann.announcementId,
      userId: "student-2",
    });
    expect(readSecondUser.readBy).toEqual(["student-1", "student-2"]);
  });

  it("filters announcements by channel and status", async () => {
    const store = createInMemoryAnnouncementStore();

    await store.createAnnouncement({
      academyId: "demo-academy",
      input: {
        channel: "academy",
        title: "Academy Notice",
        content: "Content A",
        publishImmediately: true,
      },
      authorId: "coach-1",
      authorRole: "coach",
    });

    await store.createAnnouncement({
      academyId: "demo-academy",
      input: {
        channel: "class",
        targetId: "class-1",
        title: "Class 1 Notice",
        content: "Content C1",
        publishImmediately: true,
      },
      authorId: "coach-1",
      authorRole: "coach",
    });

    await store.createAnnouncement({
      academyId: "demo-academy",
      input: {
        channel: "academy",
        title: "Draft Notice",
        content: "Content D",
        publishImmediately: false,
      },
      authorId: "coach-1",
      authorRole: "coach",
    });

    const allPublished = await store.listAnnouncements("demo-academy", { status: "published" });
    expect(allPublished).toHaveLength(2);

    const classOnly = await store.listAnnouncements("demo-academy", { channel: "class" });
    expect(classOnly).toHaveLength(1);
    expect(classOnly[0]?.targetId).toBe("class-1");
  });

  it("safeguards minor notices by delivering to guardian with read tracking", async () => {
    const store = createInMemoryAnnouncementStore();

    const notice = await store.sendMinorNotice({
      academyId: "demo-academy",
      input: {
        minorStudentId: "minor-1",
        title: "Uniform check",
        content: "Please ensure official Gi for grading.",
        category: "progress",
      },
      authorId: "coach-1",
      authorRole: "coach",
      guardianId: "guardian-1",
    });

    expect(notice.minorStudentId).toBe("minor-1");
    expect(notice.guardianId).toBe("guardian-1");
    expect(notice.readAt).toBeNull();

    const list = await store.listNoticesForGuardian({
      academyId: "demo-academy",
      guardianId: "guardian-1",
    });
    expect(list).toHaveLength(1);
    expect(list[0]?.noticeId).toBe(notice.noticeId);

    const read = await store.markNoticeAsRead({
      academyId: "demo-academy",
      noticeId: notice.noticeId,
      guardianId: "guardian-1",
      now: "2026-08-23T12:00:00Z",
    });
    expect(read.readAt).toBe("2026-08-23T12:00:00Z");
  });
});
