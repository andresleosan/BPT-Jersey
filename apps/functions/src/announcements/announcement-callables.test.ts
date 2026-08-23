import { describe, expect, it } from "vitest";

import { createInMemoryAnnouncementStore } from "./announcement-service";
import {
  createArchiveAnnouncementHandler,
  createCreateAnnouncementHandler,
  createListAnnouncementsHandler,
  createListGuardianNoticesHandler,
  createMarkAnnouncementAsReadHandler,
  createMarkNoticeAsReadHandler,
  createPublishAnnouncementHandler,
  createSendMinorNoticeHandler,
  createUpdateAnnouncementHandler,
} from "./announcement-callables";

function fakeRequest(
  data: unknown,
  role = "coach",
  uid: string | null = "user-1",
  academyId = "demo-academy",
) {
  return {
    auth: uid ? { uid, token: { academyId, role } } : undefined,
    data,
  } as never;
}

describe("Announcement Callables (T045)", () => {
  it("allows staff to create, update, publish and archive announcements", async () => {
    const store = createInMemoryAnnouncementStore();
    const createHandler = createCreateAnnouncementHandler({ store });
    const updateHandler = createUpdateAnnouncementHandler({ store });
    const publishHandler = createPublishAnnouncementHandler({ store });
    const archiveHandler = createArchiveAnnouncementHandler({ store });

    const createRes = await createHandler(
      fakeRequest(
        {
          channel: "academy",
          title: "New Gi Policy",
          content: "White, Royal Blue or Black Gi allowed.",
          priority: "normal",
          publishImmediately: false,
        },
        "administrator",
        "admin-1",
      ),
    );

    expect(createRes.announcement.status).toBe("draft");
    expect(createRes.announcement.title).toBe("New Gi Policy");

    const updateRes = await updateHandler(
      fakeRequest(
        {
          announcementId: createRes.announcement.announcementId,
          title: "Official Gi Policy 2026",
          priority: "pinned",
        },
        "administrator",
        "admin-1",
      ),
    );

    expect(updateRes.announcement.title).toBe("Official Gi Policy 2026");
    expect(updateRes.announcement.priority).toBe("pinned");

    const pubRes = await publishHandler(
      fakeRequest(
        { announcementId: createRes.announcement.announcementId },
        "headCoach",
        "headcoach-1",
      ),
    );

    expect(pubRes.announcement.status).toBe("published");
    expect(pubRes.announcement.publishedAt).toBeDefined();

    const arcRes = await archiveHandler(
      fakeRequest({ announcementId: createRes.announcement.announcementId }, "owner", "owner-1"),
    );

    expect(arcRes.announcement.status).toBe("archived");
  });

  it("blocks non-staff users from creating or modifying announcements", async () => {
    const store = createInMemoryAnnouncementStore();
    const createHandler = createCreateAnnouncementHandler({ store });

    await expect(
      createHandler(
        fakeRequest(
          {
            channel: "academy",
            title: "Unauthorized Notice",
            content: "Should not be created.",
          },
          "adultStudent",
          "student-1",
        ),
      ),
    ).rejects.toThrow(/Staff role required to create announcements/);
  });

  it("allows students and guardians to view published announcements and mark as read", async () => {
    const store = createInMemoryAnnouncementStore();
    const createHandler = createCreateAnnouncementHandler({ store });
    const markHandler = createMarkAnnouncementAsReadHandler({ store });
    const listHandler = createListAnnouncementsHandler({ store });

    const created = await createHandler(
      fakeRequest(
        {
          channel: "academy",
          title: "Public Open Mat",
          content: "Every Saturday at 11am.",
          publishImmediately: true,
        },
        "coach",
        "coach-1",
      ),
    );

    // Student lists announcements (only published)
    const listRes = await listHandler(fakeRequest({}, "adultStudent", "student-1"));

    expect(listRes.announcements).toHaveLength(1);
    expect(listRes.announcements[0]?.title).toBe("Public Open Mat");

    // Student marks as read
    const markRes = await markHandler(
      fakeRequest(
        { announcementId: created.announcement.announcementId },
        "adultStudent",
        "student-1",
      ),
    );

    expect(markRes.announcement.readBy).toContain("student-1");
  });

  describe("Safeguarding Callables (T047)", () => {
    it("safeguards notice delivery by resolving to registered guardian", async () => {
      const store = createInMemoryAnnouncementStore();
      const sendHandler = createSendMinorNoticeHandler({
        store,
        resolveGuardians: async () => ["guardian-bob"],
      });
      const listHandler = createListGuardianNoticesHandler({ store });
      const markNoticeHandler = createMarkNoticeAsReadHandler({ store });

      const sendRes = await sendHandler(
        fakeRequest(
          {
            minorStudentId: "minor-timmy",
            title: "Belt promotion ceremony",
            content: "Timmy is eligible for his grey-white belt.",
            category: "progress",
          },
          "headCoach",
          "coach-1",
        ),
      );

      expect(sendRes.notice.minorStudentId).toBe("minor-timmy");
      expect(sendRes.notice.guardianId).toBe("guardian-bob");

      // Guardian views their notices
      const listRes = await listHandler(
        fakeRequest({}, "guardian", "guardian-bob"),
      );
      expect(listRes.notices).toHaveLength(1);
      expect(listRes.notices[0]?.title).toBe("Belt promotion ceremony");

      // Guardian marks notice as read
      const markRes = await markNoticeHandler(
        fakeRequest(
          { noticeId: sendRes.notice.noticeId },
          "guardian",
          "guardian-bob",
        ),
      );
      expect(markRes.notice.readAt).toBeDefined();
    });

    it("blocks notice to minor when guardian cannot be resolved", async () => {
      const store = createInMemoryAnnouncementStore();
      const sendHandler = createSendMinorNoticeHandler({
        store,
        resolveGuardians: async () => [],
      });

      await expect(
        sendHandler(
          fakeRequest(
            {
              minorStudentId: "orphan-minor",
              title: "Notice",
              content: "Content test.",
            },
            "coach",
            "coach-1",
          ),
        ),
      ).rejects.toThrow(/Safeguarding violation/);
    });
  });
});

