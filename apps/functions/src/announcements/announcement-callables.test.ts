import { describe, expect, it } from "vitest";

import { createInMemoryAnnouncementStore } from "./announcement-service";
import {
  createArchiveAnnouncementHandler,
  createCreateAnnouncementHandler,
  createListAnnouncementsHandler,
  createMarkAnnouncementAsReadHandler,
  createPublishAnnouncementHandler,
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
});
