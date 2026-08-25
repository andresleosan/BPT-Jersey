import {
  buildAnnouncementId,
  buildNoticeId,
  type AnnouncementAuthorRole,
  type AnnouncementChannel,
  type AnnouncementRecord,
  type AnnouncementStatus,
  type CreateAnnouncementInput,
  type SafeguardingNoticeRecord,
  type SendMinorNoticeInput,
  type UpdateAnnouncementInput,
} from "@bpt-jersey/domain/announcements";

export class AnnouncementStoreError extends Error {
  public readonly code: "invalid" | "tenant" | "not-found" | "conflict";

  public constructor(code: "invalid" | "tenant" | "not-found" | "conflict", message: string) {
    super(message);
    this.name = "AnnouncementStoreError";
    this.code = code;
  }
}

export type ListAnnouncementsFilter = Readonly<{
  channel?: AnnouncementChannel;
  targetId?: string;
  status?: AnnouncementStatus;
}>;

export type AnnouncementStore = Readonly<{
  createAnnouncement: (params: {
    academyId: string;
    input: CreateAnnouncementInput;
    authorId: string;
    authorRole: AnnouncementAuthorRole;
    now?: string;
  }) => Promise<AnnouncementRecord>;
  updateAnnouncement: (params: {
    academyId: string;
    input: UpdateAnnouncementInput;
    updatedBy: string;
    now?: string;
  }) => Promise<AnnouncementRecord>;
  publishAnnouncement: (params: {
    academyId: string;
    announcementId: string;
    publishedBy: string;
    now?: string;
  }) => Promise<AnnouncementRecord>;
  archiveAnnouncement: (params: {
    academyId: string;
    announcementId: string;
    archivedBy: string;
    now?: string;
  }) => Promise<AnnouncementRecord>;
  markAsRead: (params: {
    academyId: string;
    announcementId: string;
    userId: string;
  }) => Promise<AnnouncementRecord>;
  getAnnouncement: (
    academyId: string,
    announcementId: string,
  ) => Promise<AnnouncementRecord | null>;
  listAnnouncements: (
    academyId: string,
    filter?: ListAnnouncementsFilter,
  ) => Promise<readonly AnnouncementRecord[]>;
  sendMinorNotice: (params: {
    academyId: string;
    input: SendMinorNoticeInput;
    authorId: string;
    authorRole: string;
    guardianId: string;
    now?: string;
  }) => Promise<SafeguardingNoticeRecord>;
  listNoticesForGuardian: (params: {
    academyId: string;
    guardianId: string;
  }) => Promise<readonly SafeguardingNoticeRecord[]>;
  markNoticeAsRead: (params: {
    academyId: string;
    noticeId: string;
    guardianId: string;
    now?: string;
  }) => Promise<SafeguardingNoticeRecord>;
}>;

const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function assertValidAcademyId(academyId: string): void {
  if (!safeIdentifierPattern.test(academyId)) {
    throw new AnnouncementStoreError("invalid", `Invalid academyId: ${academyId}`);
  }
}

function assertValidIdentifier(value: string, field: string): void {
  if (!safeIdentifierPattern.test(value)) {
    throw new AnnouncementStoreError("invalid", `Invalid ${field}`);
  }
}

export type GenericFirestore = {
  doc: (path: string) => {
    get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
    set: (data: Record<string, unknown>, options?: unknown) => Promise<unknown>;
    delete: () => Promise<unknown>;
  };
  collection: (path: string) => {
    get: () => Promise<{
      docs: readonly {
        id: string;
        data: () => Record<string, unknown>;
        ref: { delete: () => Promise<unknown> };
      }[];
    }>;
  };
  batch: () => {
    set: (ref: unknown, data: unknown, options?: unknown) => void;
    delete: (ref: unknown) => void;
    commit: () => Promise<unknown>;
  };
};

export function createFirestoreAnnouncementStore({
  firestore,
}: {
  firestore: GenericFirestore;
}): AnnouncementStore {
  return {
    async createAnnouncement(params) {
      const { academyId, input, authorId, authorRole, now = new Date().toISOString() } = params;
      assertValidAcademyId(academyId);

      const suffix = Math.random().toString(36).substring(2, 7);
      const announcementId = buildAnnouncementId(academyId, now, suffix);
      const isPublished = input.publishImmediately === true;

      const record: AnnouncementRecord = Object.freeze({
        announcementId,
        academyId,
        channel: input.channel,
        targetId: input.targetId ?? null,
        title: input.title,
        content: input.content,
        priority: input.priority ?? "normal",
        status: isPublished ? "published" : "draft",
        publishedAt: isPublished ? now : null,
        expiresAt: input.expiresAt ?? null,
        authorId,
        authorRole,
        readBy: Object.freeze([]),
        schemaVersion: "1",
        createdAt: now,
        createdBy: authorId,
        updatedAt: now,
        updatedBy: authorId,
      });

      const batch = firestore.batch();
      batch.set(firestore.doc(`academies/${academyId}/announcements/${announcementId}`), record);

      const auditEventId = `evt_ann_${announcementId}`;
      batch.set(firestore.doc(`academies/${academyId}/auditEvents/${auditEventId}`), {
        eventId: auditEventId,
        academyId,
        action: isPublished ? "announcement_published" : "announcement_created",
        actorId: authorId,
        timestamp: now,
        details: { announcementId, channel: input.channel, title: input.title },
      });

      await batch.commit();
      return record;
    },

    async updateAnnouncement(params) {
      const { academyId, input, updatedBy, now = new Date().toISOString() } = params;
      assertValidAcademyId(academyId);

      const existing = await this.getAnnouncement(academyId, input.announcementId);
      if (!existing) {
        throw new AnnouncementStoreError(
          "not-found",
          `Announcement not found: ${input.announcementId}`,
        );
      }

      const updatedRecord: AnnouncementRecord = Object.freeze({
        ...existing,
        title: input.title ?? existing.title,
        content: input.content ?? existing.content,
        priority: input.priority ?? existing.priority,
        expiresAt: input.expiresAt !== undefined ? input.expiresAt : existing.expiresAt,
        updatedAt: now,
        updatedBy,
      });

      await firestore
        .doc(`academies/${academyId}/announcements/${input.announcementId}`)
        .set(updatedRecord);
      return updatedRecord;
    },

    async publishAnnouncement(params) {
      const { academyId, announcementId, publishedBy, now = new Date().toISOString() } = params;
      assertValidAcademyId(academyId);

      const existing = await this.getAnnouncement(academyId, announcementId);
      if (!existing) {
        throw new AnnouncementStoreError("not-found", `Announcement not found: ${announcementId}`);
      }

      const publishedRecord: AnnouncementRecord = Object.freeze({
        ...existing,
        status: "published",
        publishedAt: existing.publishedAt ?? now,
        updatedAt: now,
        updatedBy: publishedBy,
      });

      const batch = firestore.batch();
      batch.set(
        firestore.doc(`academies/${academyId}/announcements/${announcementId}`),
        publishedRecord,
      );

      const auditEventId = `evt_ann_pub_${announcementId}`;
      batch.set(firestore.doc(`academies/${academyId}/auditEvents/${auditEventId}`), {
        eventId: auditEventId,
        academyId,
        action: "announcement_published",
        actorId: publishedBy,
        timestamp: now,
        details: { announcementId, title: existing.title },
      });

      await batch.commit();
      return publishedRecord;
    },

    async archiveAnnouncement(params) {
      const { academyId, announcementId, archivedBy, now = new Date().toISOString() } = params;
      assertValidAcademyId(academyId);

      const existing = await this.getAnnouncement(academyId, announcementId);
      if (!existing) {
        throw new AnnouncementStoreError("not-found", `Announcement not found: ${announcementId}`);
      }

      const archivedRecord: AnnouncementRecord = Object.freeze({
        ...existing,
        status: "archived",
        updatedAt: now,
        updatedBy: archivedBy,
      });

      const batch = firestore.batch();
      batch.set(
        firestore.doc(`academies/${academyId}/announcements/${announcementId}`),
        archivedRecord,
      );

      const auditEventId = `evt_ann_arc_${announcementId}`;
      batch.set(firestore.doc(`academies/${academyId}/auditEvents/${auditEventId}`), {
        eventId: auditEventId,
        academyId,
        action: "announcement_archived",
        actorId: archivedBy,
        timestamp: now,
        details: { announcementId, title: existing.title },
      });

      await batch.commit();
      return archivedRecord;
    },

    async markAsRead(params) {
      const { academyId, announcementId, userId } = params;
      assertValidAcademyId(academyId);

      const existing = await this.getAnnouncement(academyId, announcementId);
      if (!existing) {
        throw new AnnouncementStoreError("not-found", `Announcement not found: ${announcementId}`);
      }

      if (existing.readBy.includes(userId)) {
        return existing;
      }

      const updatedReadBy = Object.freeze([...existing.readBy, userId]);
      const updatedRecord: AnnouncementRecord = Object.freeze({
        ...existing,
        readBy: updatedReadBy,
      });

      await firestore
        .doc(`academies/${academyId}/announcements/${announcementId}`)
        .set(updatedRecord);
      return updatedRecord;
    },

    async getAnnouncement(academyId, announcementId) {
      assertValidAcademyId(academyId);

      const snap = await firestore
        .doc(`academies/${academyId}/announcements/${announcementId}`)
        .get();
      if (!snap.exists) return null;
      return snap.data() as unknown as AnnouncementRecord;
    },

    async listAnnouncements(academyId, filter) {
      assertValidAcademyId(academyId);

      const snap = await firestore.collection(`academies/${academyId}/announcements`).get();
      let records = snap.docs.map((d) => d.data() as unknown as AnnouncementRecord);

      if (filter?.channel) {
        records = records.filter((r) => r.channel === filter.channel);
      }
      if (filter?.targetId) {
        records = records.filter((r) => r.targetId === filter.targetId);
      }
      if (filter?.status) {
        records = records.filter((r) => r.status === filter.status);
      }

      return records.sort((a, b) => {
        const dateA = a.publishedAt ?? a.createdAt;
        const dateB = b.publishedAt ?? b.createdAt;
        return dateB.localeCompare(dateA);
      });
    },

    async sendMinorNotice(params) {
      const {
        academyId,
        input,
        authorId,
        authorRole,
        guardianId,
        now = new Date().toISOString(),
      } = params;
      assertValidAcademyId(academyId);
      assertValidIdentifier(input.minorStudentId, "minorStudentId");
      assertValidIdentifier(authorId, "authorId");
      assertValidIdentifier(guardianId, "guardianId");

      const suffix = Math.random().toString(36).substring(2, 7);
      const noticeId = buildNoticeId(academyId, now, suffix);

      const record: SafeguardingNoticeRecord = Object.freeze({
        noticeId,
        academyId,
        minorStudentId: input.minorStudentId,
        guardianId,
        title: input.title,
        content: input.content,
        category: input.category ?? "general",
        authorId,
        authorRole,
        readAt: null,
        createdAt: now,
        createdBy: authorId,
      });

      const batch = firestore.batch();
      batch.set(
        firestore.doc(`academies/${academyId}/guardians/${guardianId}/notices/${noticeId}`),
        record,
      );

      const auditEventId = `evt_not_${noticeId}`;
      batch.set(firestore.doc(`academies/${academyId}/auditEvents/${auditEventId}`), {
        eventId: auditEventId,
        academyId,
        action: "minor_notice_safeguarded",
        actorId: authorId,
        timestamp: now,
        details: {
          noticeId,
          minorStudentId: input.minorStudentId,
          guardianId,
          category: input.category,
        },
      });

      await batch.commit();
      return record;
    },

    async listNoticesForGuardian(params) {
      const { academyId, guardianId } = params;
      assertValidAcademyId(academyId);
      assertValidIdentifier(guardianId, "guardianId");

      const snap = await firestore
        .collection(`academies/${academyId}/guardians/${guardianId}/notices`)
        .get();

      return snap.docs
        .map((d) => d.data() as unknown as SafeguardingNoticeRecord)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async markNoticeAsRead(params) {
      const { academyId, noticeId, guardianId, now = new Date().toISOString() } = params;
      assertValidAcademyId(academyId);
      assertValidIdentifier(noticeId, "noticeId");
      assertValidIdentifier(guardianId, "guardianId");

      const snap = await firestore
        .doc(`academies/${academyId}/guardians/${guardianId}/notices/${noticeId}`)
        .get();

      if (!snap.exists) {
        throw new AnnouncementStoreError("not-found", `Notice not found: ${noticeId}`);
      }

      const existing = snap.data() as unknown as SafeguardingNoticeRecord;
      if (existing.readAt) {
        return existing;
      }

      const updatedRecord: SafeguardingNoticeRecord = Object.freeze({
        ...existing,
        readAt: now,
      });

      await firestore
        .doc(`academies/${academyId}/guardians/${guardianId}/notices/${noticeId}`)
        .set(updatedRecord);

      return updatedRecord;
    },
  };
}

export function createInMemoryAnnouncementStore(): AnnouncementStore {
  const announcements = new Map<string, AnnouncementRecord>();
  const notices = new Map<string, SafeguardingNoticeRecord>();

  return {
    async createAnnouncement(params) {
      const { academyId, input, authorId, authorRole, now = new Date().toISOString() } = params;
      assertValidAcademyId(academyId);

      const suffix = Math.random().toString(36).substring(2, 7);
      const announcementId = buildAnnouncementId(academyId, now, suffix);
      const isPublished = input.publishImmediately === true;

      const record: AnnouncementRecord = Object.freeze({
        announcementId,
        academyId,
        channel: input.channel,
        targetId: input.targetId ?? null,
        title: input.title,
        content: input.content,
        priority: input.priority ?? "normal",
        status: isPublished ? "published" : "draft",
        publishedAt: isPublished ? now : null,
        expiresAt: input.expiresAt ?? null,
        authorId,
        authorRole,
        readBy: Object.freeze([]),
        schemaVersion: "1",
        createdAt: now,
        createdBy: authorId,
        updatedAt: now,
        updatedBy: authorId,
      });

      announcements.set(`${academyId}_${announcementId}`, record);
      return record;
    },

    async updateAnnouncement(params) {
      const { academyId, input, updatedBy, now = new Date().toISOString() } = params;
      assertValidAcademyId(academyId);

      const existing = await this.getAnnouncement(academyId, input.announcementId);
      if (!existing) {
        throw new AnnouncementStoreError(
          "not-found",
          `Announcement not found: ${input.announcementId}`,
        );
      }

      const updatedRecord: AnnouncementRecord = Object.freeze({
        ...existing,
        title: input.title ?? existing.title,
        content: input.content ?? existing.content,
        priority: input.priority ?? existing.priority,
        expiresAt: input.expiresAt !== undefined ? input.expiresAt : existing.expiresAt,
        updatedAt: now,
        updatedBy,
      });

      announcements.set(`${academyId}_${input.announcementId}`, updatedRecord);
      return updatedRecord;
    },

    async publishAnnouncement(params) {
      const { academyId, announcementId, publishedBy, now = new Date().toISOString() } = params;
      assertValidAcademyId(academyId);

      const existing = await this.getAnnouncement(academyId, announcementId);
      if (!existing) {
        throw new AnnouncementStoreError("not-found", `Announcement not found: ${announcementId}`);
      }

      const publishedRecord: AnnouncementRecord = Object.freeze({
        ...existing,
        status: "published",
        publishedAt: existing.publishedAt ?? now,
        updatedAt: now,
        updatedBy: publishedBy,
      });

      announcements.set(`${academyId}_${announcementId}`, publishedRecord);
      return publishedRecord;
    },

    async archiveAnnouncement(params) {
      const { academyId, announcementId, archivedBy, now = new Date().toISOString() } = params;
      assertValidAcademyId(academyId);

      const existing = await this.getAnnouncement(academyId, announcementId);
      if (!existing) {
        throw new AnnouncementStoreError("not-found", `Announcement not found: ${announcementId}`);
      }

      const archivedRecord: AnnouncementRecord = Object.freeze({
        ...existing,
        status: "archived",
        updatedAt: now,
        updatedBy: archivedBy,
      });

      announcements.set(`${academyId}_${announcementId}`, archivedRecord);
      return archivedRecord;
    },

    async markAsRead(params) {
      const { academyId, announcementId, userId } = params;
      assertValidAcademyId(academyId);

      const existing = await this.getAnnouncement(academyId, announcementId);
      if (!existing) {
        throw new AnnouncementStoreError("not-found", `Announcement not found: ${announcementId}`);
      }

      if (existing.readBy.includes(userId)) {
        return existing;
      }

      const updatedReadBy = Object.freeze([...existing.readBy, userId]);
      const updatedRecord: AnnouncementRecord = Object.freeze({
        ...existing,
        readBy: updatedReadBy,
      });

      announcements.set(`${academyId}_${announcementId}`, updatedRecord);
      return updatedRecord;
    },

    async getAnnouncement(academyId, announcementId) {
      assertValidAcademyId(academyId);
      return announcements.get(`${academyId}_${announcementId}`) ?? null;
    },

    async listAnnouncements(academyId, filter) {
      assertValidAcademyId(academyId);

      let records = Array.from(announcements.values()).filter((r) => r.academyId === academyId);

      if (filter?.channel) {
        records = records.filter((r) => r.channel === filter.channel);
      }
      if (filter?.targetId) {
        records = records.filter((r) => r.targetId === filter.targetId);
      }
      if (filter?.status) {
        records = records.filter((r) => r.status === filter.status);
      }

      return records.sort((a, b) => {
        const dateA = a.publishedAt ?? a.createdAt;
        const dateB = b.publishedAt ?? b.createdAt;
        return dateB.localeCompare(dateA);
      });
    },

    async sendMinorNotice(params) {
      const {
        academyId,
        input,
        authorId,
        authorRole,
        guardianId,
        now = new Date().toISOString(),
      } = params;
      assertValidAcademyId(academyId);
      assertValidIdentifier(input.minorStudentId, "minorStudentId");
      assertValidIdentifier(authorId, "authorId");
      assertValidIdentifier(guardianId, "guardianId");

      const suffix = Math.random().toString(36).substring(2, 7);
      const noticeId = buildNoticeId(academyId, now, suffix);

      const record: SafeguardingNoticeRecord = Object.freeze({
        noticeId,
        academyId,
        minorStudentId: input.minorStudentId,
        guardianId,
        title: input.title,
        content: input.content,
        category: input.category ?? "general",
        authorId,
        authorRole,
        readAt: null,
        createdAt: now,
        createdBy: authorId,
      });

      notices.set(`${academyId}_${guardianId}_${noticeId}`, record);
      return record;
    },

    async listNoticesForGuardian(params) {
      const { academyId, guardianId } = params;
      assertValidAcademyId(academyId);
      assertValidIdentifier(guardianId, "guardianId");

      return Array.from(notices.values())
        .filter((n) => n.academyId === academyId && n.guardianId === guardianId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async markNoticeAsRead(params) {
      const { academyId, noticeId, guardianId, now = new Date().toISOString() } = params;
      assertValidAcademyId(academyId);
      assertValidIdentifier(noticeId, "noticeId");
      assertValidIdentifier(guardianId, "guardianId");

      const key = `${academyId}_${guardianId}_${noticeId}`;
      const existing = notices.get(key);
      if (!existing) {
        throw new AnnouncementStoreError("not-found", `Notice not found: ${noticeId}`);
      }

      if (existing.readAt) {
        return existing;
      }

      const updatedRecord: SafeguardingNoticeRecord = Object.freeze({
        ...existing,
        readAt: now,
      });

      notices.set(key, updatedRecord);
      return updatedRecord;
    },
  };
}
