import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  parseCreateAnnouncementInput,
  parseSendMinorNoticeInput,
  parseUpdateAnnouncementInput,
  resolveSafeguardedRecipient,
  type AnnouncementAuthorRole,
  type AnnouncementChannel,
  type AnnouncementRecord,
  type AnnouncementStatus,
  type SafeguardingNoticeRecord,
} from "@bpt-jersey/domain/announcements";
import { requireUserActor } from "../auth/user-authorization.js";
import {
  createFirestoreAnnouncementStore,
  type AnnouncementStore,
} from "./announcement-service.js";

const staffRoles = ["owner", "administrator", "headCoach", "coach"] as const;

export type GuardianResolver = (params: {
  academyId: string;
  minorStudentId: string;
}) => Promise<readonly string[]>;

export function createCreateAnnouncementHandler({ store }: { store: AnnouncementStore }) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ announcement: AnnouncementRecord }> => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError(
        "permission-denied",
        "Staff role required to create announcements (owner, administrator, headCoach, coach)",
      );
    }

    const parsed = parseCreateAnnouncementInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError(
        "invalid-argument",
        `Invalid announcement payload: ${parsed.error.map((e) => e.code).join(", ")}`,
      );
    }

    const announcement = await store.createAnnouncement({
      academyId: actor.academyId,
      input: parsed.value,
      authorId: actor.userId,
      authorRole: actor.role as AnnouncementAuthorRole,
    });

    return {
      announcement,
    };
  };
}

export function createUpdateAnnouncementHandler({ store }: { store: AnnouncementStore }) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ announcement: AnnouncementRecord }> => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError(
        "permission-denied",
        "Staff role required to update announcements",
      );
    }

    const parsed = parseUpdateAnnouncementInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError(
        "invalid-argument",
        `Invalid announcement update payload: ${parsed.error.map((e) => e.code).join(", ")}`,
      );
    }

    const announcement = await store.updateAnnouncement({
      academyId: actor.academyId,
      input: parsed.value,
      updatedBy: actor.userId,
    });

    return {
      announcement,
    };
  };
}

export function createPublishAnnouncementHandler({ store }: { store: AnnouncementStore }) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ announcement: AnnouncementRecord }> => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError(
        "permission-denied",
        "Staff role required to publish announcements",
      );
    }

    const data = (request.data as { announcementId?: unknown }) ?? {};
    if (typeof data.announcementId !== "string" || !data.announcementId.trim()) {
      throw new HttpsError("invalid-argument", "announcementId is required to publish");
    }

    const announcement = await store.publishAnnouncement({
      academyId: actor.academyId,
      announcementId: data.announcementId.trim(),
      publishedBy: actor.userId,
    });

    return {
      announcement,
    };
  };
}

export function createArchiveAnnouncementHandler({ store }: { store: AnnouncementStore }) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ announcement: AnnouncementRecord }> => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError(
        "permission-denied",
        "Staff role required to archive announcements",
      );
    }

    const data = (request.data as { announcementId?: unknown }) ?? {};
    if (typeof data.announcementId !== "string" || !data.announcementId.trim()) {
      throw new HttpsError("invalid-argument", "announcementId is required to archive");
    }

    const announcement = await store.archiveAnnouncement({
      academyId: actor.academyId,
      announcementId: data.announcementId.trim(),
      archivedBy: actor.userId,
    });

    return {
      announcement,
    };
  };
}

export function createMarkAnnouncementAsReadHandler({ store }: { store: AnnouncementStore }) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ announcement: AnnouncementRecord }> => {
    const actor = requireUserActor(request);

    const data = (request.data as { announcementId?: unknown }) ?? {};
    if (typeof data.announcementId !== "string" || !data.announcementId.trim()) {
      throw new HttpsError("invalid-argument", "announcementId is required to mark as read");
    }

    const announcement = await store.markAsRead({
      academyId: actor.academyId,
      announcementId: data.announcementId.trim(),
      userId: actor.userId,
    });

    return {
      announcement,
    };
  };
}

export function createListAnnouncementsHandler({ store }: { store: AnnouncementStore }) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ announcements: readonly AnnouncementRecord[] }> => {
    const actor = requireUserActor(request);
    const data = (request.data as { channel?: unknown; targetId?: unknown; status?: unknown }) ?? {};

    const filter: {
      channel?: AnnouncementChannel;
      targetId?: string;
      status?: AnnouncementStatus;
    } = {};

    if (typeof data.channel === "string") {
      filter.channel = data.channel as AnnouncementChannel;
    }
    if (typeof data.targetId === "string") {
      filter.targetId = data.targetId.trim();
    }

    const isStaff = staffRoles.includes(actor.role as (typeof staffRoles)[number]);
    if (isStaff) {
      if (typeof data.status === "string") {
        filter.status = data.status as AnnouncementStatus;
      }
    } else {
      // Non-staff clients only ever see published announcements
      filter.status = "published";
    }

    const announcements = await store.listAnnouncements(actor.academyId, filter);
    return {
      announcements,
    };
  };
}

export function createSendMinorNoticeHandler({
  store,
  resolveGuardians,
}: {
  store: AnnouncementStore;
  resolveGuardians?: GuardianResolver;
}) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ notice: SafeguardingNoticeRecord }> => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError(
        "permission-denied",
        "Staff role required to send notices to minors (owner, administrator, headCoach, coach)",
      );
    }

    const parsed = parseSendMinorNoticeInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError(
        "invalid-argument",
        `Invalid minor notice payload: ${parsed.error.map((e) => e.code).join(", ")}`,
      );
    }

    // Resolve guardian list for the minor student
    const defaultResolver: GuardianResolver = async ({ academyId, minorStudentId }) => {
      const firestore = getFirestore();
      const snap = await firestore
        .collection(`academies/${academyId}/families`)
        .where("minorStudentIds", "array-contains", minorStudentId)
        .get();

      const guardianIds: string[] = [];
      for (const doc of snap.docs) {
        const data = doc.data() as { primaryGuardianId?: string; guardianIds?: string[] };
        if (data.primaryGuardianId) guardianIds.push(data.primaryGuardianId);
        if (Array.isArray(data.guardianIds)) guardianIds.push(...data.guardianIds);
      }
      return Array.from(new Set(guardianIds));
    };

    const resolver = resolveGuardians ?? defaultResolver;
    const guardianIds = await resolver({
      academyId: actor.academyId,
      minorStudentId: parsed.value.minorStudentId,
    });

    const resolution = resolveSafeguardedRecipient({
      isMinor: true,
      studentId: parsed.value.minorStudentId,
      guardianIds,
    });

    if (!resolution.ok) {
      throw new HttpsError(
        "failed-precondition",
        `Safeguarding violation: Minor student has no registered guardian (${resolution.error})`,
      );
    }

    const notice = await store.sendMinorNotice({
      academyId: actor.academyId,
      input: parsed.value,
      authorId: actor.userId,
      authorRole: actor.role,
      guardianId: resolution.value.recipientUserId,
    });

    return {
      notice,
    };
  };
}

export function createListGuardianNoticesHandler({ store }: { store: AnnouncementStore }) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ notices: readonly SafeguardingNoticeRecord[] }> => {
    const actor = requireUserActor(request);

    const isStaff = staffRoles.includes(actor.role as (typeof staffRoles)[number]);
    const data = (request.data as { guardianId?: unknown }) ?? {};

    let targetGuardianId = actor.userId;
    if (isStaff && typeof data.guardianId === "string" && data.guardianId.trim()) {
      targetGuardianId = data.guardianId.trim();
    } else if (actor.role !== "guardian" && !isStaff) {
      throw new HttpsError("permission-denied", "Guardian or staff role required to view notices");
    }

    const notices = await store.listNoticesForGuardian({
      academyId: actor.academyId,
      guardianId: targetGuardianId,
    });

    return {
      notices,
    };
  };
}

export function createMarkNoticeAsReadHandler({ store }: { store: AnnouncementStore }) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ notice: SafeguardingNoticeRecord }> => {
    const actor = requireUserActor(request);

    const data = (request.data as { noticeId?: unknown }) ?? {};
    if (typeof data.noticeId !== "string" || !data.noticeId.trim()) {
      throw new HttpsError("invalid-argument", "noticeId is required to mark as read");
    }

    const notice = await store.markNoticeAsRead({
      academyId: actor.academyId,
      noticeId: data.noticeId.trim(),
      guardianId: actor.userId,
    });

    return {
      notice,
    };
  };
}

let defaultStore: AnnouncementStore | undefined;

function getStore(): AnnouncementStore {
  if (!defaultStore) {
    const firestore = getFirestore();
    defaultStore = createFirestoreAnnouncementStore({
      firestore: firestore as unknown as Parameters<typeof createFirestoreAnnouncementStore>[0]["firestore"],
    });
  }
  return defaultStore;
}

export const createAnnouncement = onCall(
  {
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => {
    const handler = createCreateAnnouncementHandler({ store: getStore() });
    return handler(request);
  },
);

export const updateAnnouncement = onCall(
  {
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => {
    const handler = createUpdateAnnouncementHandler({ store: getStore() });
    return handler(request);
  },
);

export const publishAnnouncement = onCall(
  {
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => {
    const handler = createPublishAnnouncementHandler({ store: getStore() });
    return handler(request);
  },
);

export const archiveAnnouncement = onCall(
  {
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => {
    const handler = createArchiveAnnouncementHandler({ store: getStore() });
    return handler(request);
  },
);

export const markAnnouncementAsRead = onCall(
  {
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => {
    const handler = createMarkAnnouncementAsReadHandler({ store: getStore() });
    return handler(request);
  },
);

export const listAnnouncements = onCall(
  {
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => {
    const handler = createListAnnouncementsHandler({ store: getStore() });
    return handler(request);
  },
);

export const sendMinorNotice = onCall(
  {
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => {
    const handler = createSendMinorNoticeHandler({ store: getStore() });
    return handler(request);
  },
);

export const listGuardianNotices = onCall(
  {
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => {
    const handler = createListGuardianNoticesHandler({ store: getStore() });
    return handler(request);
  },
);

export const markNoticeAsRead = onCall(
  {
    enforceAppCheck: false,
    consumeAppCheckToken: false,
  },
  async (request) => {
    const handler = createMarkNoticeAsReadHandler({ store: getStore() });
    return handler(request);
  },
);
