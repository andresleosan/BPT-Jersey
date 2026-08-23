import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  parseCreateAnnouncementInput,
  parseUpdateAnnouncementInput,
  type AnnouncementAuthorRole,
  type AnnouncementChannel,
  type AnnouncementRecord,
  type AnnouncementStatus,
} from "@bpt-jersey/domain/announcements";
import { requireUserActor } from "../auth/user-authorization.js";
import {
  createFirestoreAnnouncementStore,
  type AnnouncementStore,
} from "./announcement-service.js";

const staffRoles = ["owner", "administrator", "headCoach", "coach"] as const;

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
      throw new HttpsError("permission-denied", "Staff role required to update announcements");
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
      throw new HttpsError("permission-denied", "Staff role required to publish announcements");
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
      throw new HttpsError("permission-denied", "Staff role required to archive announcements");
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
    const data =
      (request.data as { channel?: unknown; targetId?: unknown; status?: unknown }) ?? {};

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

let defaultStore: AnnouncementStore | undefined;

function getStore(): AnnouncementStore {
  if (!defaultStore) {
    const firestore = getFirestore();
    defaultStore = createFirestoreAnnouncementStore({
      firestore: firestore as unknown as Parameters<
        typeof createFirestoreAnnouncementStore
      >[0]["firestore"],
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
