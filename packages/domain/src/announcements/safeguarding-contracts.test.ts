import { describe, expect, it } from "vitest";

import { type AnnouncementRecord } from "./announcement-contracts";
import {
  buildNoticeId,
  filterGuardianAnnouncements,
  noticeCategories,
  parseSendMinorNoticeInput,
  resolveSafeguardedRecipient,
} from "./safeguarding-contracts";

describe("Safeguarding Contracts (T047)", () => {
  it("exposes notice categories", () => {
    expect(noticeCategories).toEqual(["attendance", "payment", "progress", "general"]);
  });

  it("builds deterministic notice ID", () => {
    const id = buildNoticeId("bpt", "2026-08-23T10:00:00Z", "x1");
    expect(id).toBe("not_bpt_2026-08-23T10:00:00Z_x1");
  });

  describe("parseSendMinorNoticeInput", () => {
    it("parses valid minor notice input", () => {
      const result = parseSendMinorNoticeInput({
        minorStudentId: "student-minor-1",
        title: "Uniform Check Required",
        content: "Please ensure clean Gi for grading next week.",
        category: "progress",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected ok result");
      expect(result.value.minorStudentId).toBe("student-minor-1");
      expect(result.value.category).toBe("progress");
    });

    it("rejects invalid student ID or short content", () => {
      const invalid = parseSendMinorNoticeInput({
        minorStudentId: "",
        title: "Valid Title",
        content: "Bad",
      });
      expect(invalid.ok).toBe(false);
    });
  });

  describe("resolveSafeguardedRecipient", () => {
    it("redirects minor communications to guardian and sets isSafeguarded true", () => {
      const res = resolveSafeguardedRecipient({
        isMinor: true,
        studentId: "minor-123",
        guardianIds: ["guardian-456"],
      });

      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error("Expected ok result");
      expect(res.value.recipientUserId).toBe("guardian-456");
      expect(res.value.isSafeguarded).toBe(true);
    });

    it("rejects communication to minor when no guardian is registered", () => {
      const res = resolveSafeguardedRecipient({
        isMinor: true,
        studentId: "minor-123",
        guardianIds: [],
      });

      expect(res.ok).toBe(false);
      if (res.ok) throw new Error("Expected error result");
      expect(res.error).toBe("minor_student_missing_guardian");
    });

    it("keeps adult student as direct recipient with isSafeguarded false", () => {
      const res = resolveSafeguardedRecipient({
        isMinor: false,
        studentId: "adult-123",
        guardianIds: [],
      });

      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error("Expected ok result");
      expect(res.value.recipientUserId).toBe("adult-123");
      expect(res.value.isSafeguarded).toBe(false);
    });
  });

  describe("filterGuardianAnnouncements", () => {
    it("includes academy-wide announcements and matching minor classes/groups", () => {
      const announcements: readonly AnnouncementRecord[] = [
        {
          announcementId: "ann-1",
          academyId: "bpt",
          channel: "academy",
          targetId: null,
          title: "General News",
          content: "Open to all.",
          priority: "normal",
          status: "published",
          publishedAt: "2026-08-23T10:00:00Z",
          expiresAt: null,
          authorId: "coach-1",
          authorRole: "coach",
          readBy: [],
          schemaVersion: "1",
          createdAt: "2026-08-23T10:00:00Z",
          createdBy: "coach-1",
          updatedAt: "2026-08-23T10:00:00Z",
          updatedBy: "coach-1",
        },
        {
          announcementId: "ann-2",
          academyId: "bpt",
          channel: "class",
          targetId: "class-kids-1",
          title: "Kids Class Announcement",
          content: "Bring rashguard.",
          priority: "urgent",
          status: "published",
          publishedAt: "2026-08-23T10:00:00Z",
          expiresAt: null,
          authorId: "coach-1",
          authorRole: "coach",
          readBy: [],
          schemaVersion: "1",
          createdAt: "2026-08-23T10:00:00Z",
          createdBy: "coach-1",
          updatedAt: "2026-08-23T10:00:00Z",
          updatedBy: "coach-1",
        },
        {
          announcementId: "ann-3",
          academyId: "bpt",
          channel: "class",
          targetId: "class-adults-competition",
          title: "Adults Competition Camp",
          content: "Only for adults.",
          priority: "normal",
          status: "published",
          publishedAt: "2026-08-23T10:00:00Z",
          expiresAt: null,
          authorId: "coach-1",
          authorRole: "coach",
          readBy: [],
          schemaVersion: "1",
          createdAt: "2026-08-23T10:00:00Z",
          createdBy: "coach-1",
          updatedAt: "2026-08-23T10:00:00Z",
          updatedBy: "coach-1",
        },
      ];

      const visible = filterGuardianAnnouncements({
        announcements,
        minorClassIds: ["class-kids-1"],
        minorGroupIds: [],
      });

      expect(visible.map((a) => a.announcementId)).toEqual(["ann-1", "ann-2"]);
    });
  });
});
