import { describe, expect, it } from "vitest";

import {
  announcementChannels,
  announcementPriorities,
  announcementStatuses,
  buildAnnouncementId,
  parseCreateAnnouncementInput,
  parseUpdateAnnouncementInput,
} from "./announcement-contracts";

describe("Announcement Contracts (T045)", () => {
  it("exposes approved announcement enums and constants", () => {
    expect(announcementChannels).toEqual(["academy", "class", "group"]);
    expect(announcementPriorities).toEqual(["normal", "urgent", "pinned"]);
    expect(announcementStatuses).toEqual(["draft", "published", "archived"]);
  });

  it("builds deterministic announcement ID", () => {
    const id = buildAnnouncementId("bpt-jersey", "2026-08-23T10:00:00Z");
    expect(id).toBe("ann_bpt-jersey_2026-08-23T10:00:00Z");
  });

  describe("parseCreateAnnouncementInput", () => {
    it("validates and parses valid academy announcement", () => {
      const result = parseCreateAnnouncementInput({
        channel: "academy",
        title: "Holiday Schedule Notice",
        content: "The academy will operate with an open-mat schedule on bank holiday Monday.",
        priority: "pinned",
        publishImmediately: true,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected ok result");
      expect(result.value.channel).toBe("academy");
      expect(result.value.title).toBe("Holiday Schedule Notice");
      expect(result.value.priority).toBe("pinned");
      expect(result.value.publishImmediately).toBe(true);
    });

    it("validates and requires targetId for class channel", () => {
      const missingTarget = parseCreateAnnouncementInput({
        channel: "class",
        title: "No-Gi Seminar on Friday",
        content: "Please remember to bring your regulation rashguards.",
      });
      expect(missingTarget.ok).toBe(false);

      const withTarget = parseCreateAnnouncementInput({
        channel: "class",
        targetId: "class-adults-nogi",
        title: "No-Gi Seminar on Friday",
        content: "Please remember to bring your regulation rashguards.",
      });
      expect(withTarget.ok).toBe(true);
    });

    it("rejects title or content with invalid lengths", () => {
      const shortTitle = parseCreateAnnouncementInput({
        channel: "academy",
        title: "Hi",
        content: "Valid content here.",
      });
      expect(shortTitle.ok).toBe(false);

      const shortContent = parseCreateAnnouncementInput({
        channel: "academy",
        title: "Valid Title",
        content: "no",
      });
      expect(shortContent.ok).toBe(false);
    });
  });

  describe("parseUpdateAnnouncementInput", () => {
    it("validates and parses valid announcement update", () => {
      const result = parseUpdateAnnouncementInput({
        announcementId: "ann-123",
        title: "Updated Schedule Notice",
        content: "Revised open-mat timetable starting at 10am.",
        priority: "urgent",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected ok result");
      expect(result.value.announcementId).toBe("ann-123");
      expect(result.value.title).toBe("Updated Schedule Notice");
      expect(result.value.priority).toBe("urgent");
    });

    it("rejects missing or invalid announcement ID", () => {
      const invalid = parseUpdateAnnouncementInput({
        announcementId: "",
        title: "Valid Title",
      });
      expect(invalid.ok).toBe(false);
    });
  });
});
