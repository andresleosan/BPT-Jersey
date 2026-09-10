import { httpsCallable } from "firebase/functions";

import {
  parseCreateAnnouncementInput,
  parseSendMinorNoticeInput,
  parseUpdateAnnouncementInput,
  type AnnouncementChannel,
  type AnnouncementRecord,
  type AnnouncementStatus,
  type CreateAnnouncementInput,
  type SafeguardingNoticeRecord,
  type SendMinorNoticeInput,
  type UpdateAnnouncementInput,
} from "@bpt-jersey/domain/announcements";
import { getFirebaseFunctions } from "./firebase-client";

const safeCreateError = "Unable to create announcement. Please try again.";
const safeUpdateError = "Unable to update announcement. Please try again.";
const safePublishError = "Unable to publish announcement. Please try again.";
const safeArchiveError = "Unable to archive announcement. Please try again.";
const safeMarkReadError = "Unable to mark announcement as read. Please try again.";
const safeListError = "Unable to load announcements. Please try again.";
const safeSendNoticeError = "Unable to send notice to minor. Please try again.";
const safeListNoticesError = "Unable to load guardian notices. Please try again.";
const safeMarkNoticeReadError = "Unable to mark notice as read. Please try again.";


export async function createAnnouncement(
  input: CreateAnnouncementInput,
): Promise<AnnouncementRecord> {
  const parsed = parseCreateAnnouncementInput(input);
  if (!parsed.ok) {
    throw new Error(safeCreateError);
  }

  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    CreateAnnouncementInput,
    { announcement: AnnouncementRecord }
  >(functions, "createAnnouncement");

  try {
    const response = await callable(parsed.value);
    return response.data.announcement;
  } catch (error) {
    if (error instanceof Error && error.message === safeCreateError) {
      throw error;
    }
    throw new Error(safeCreateError);
  }
}

export async function updateAnnouncement(
  input: UpdateAnnouncementInput,
): Promise<AnnouncementRecord> {
  const parsed = parseUpdateAnnouncementInput(input);
  if (!parsed.ok) {
    throw new Error(safeUpdateError);
  }

  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    UpdateAnnouncementInput,
    { announcement: AnnouncementRecord }
  >(functions, "updateAnnouncement");

  try {
    const response = await callable(parsed.value);
    return response.data.announcement;
  } catch (error) {
    if (error instanceof Error && error.message === safeUpdateError) {
      throw error;
    }
    throw new Error(safeUpdateError);
  }
}

export async function publishAnnouncement(
  announcementId: string,
): Promise<AnnouncementRecord> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    { announcementId: string },
    { announcement: AnnouncementRecord }
  >(functions, "publishAnnouncement");

  try {
    const response = await callable({ announcementId });
    return response.data.announcement;
  } catch (error) {
    if (error instanceof Error && error.message === safePublishError) {
      throw error;
    }
    throw new Error(safePublishError);
  }
}

export async function archiveAnnouncement(
  announcementId: string,
): Promise<AnnouncementRecord> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    { announcementId: string },
    { announcement: AnnouncementRecord }
  >(functions, "archiveAnnouncement");

  try {
    const response = await callable({ announcementId });
    return response.data.announcement;
  } catch (error) {
    if (error instanceof Error && error.message === safeArchiveError) {
      throw error;
    }
    throw new Error(safeArchiveError);
  }
}

export async function markAnnouncementAsRead(
  announcementId: string,
): Promise<AnnouncementRecord> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    { announcementId: string },
    { announcement: AnnouncementRecord }
  >(functions, "markAnnouncementAsRead");

  try {
    const response = await callable({ announcementId });
    return response.data.announcement;
  } catch (error) {
    if (error instanceof Error && error.message === safeMarkReadError) {
      throw error;
    }
    throw new Error(safeMarkReadError);
  }
}

export async function listAnnouncements(params?: {
  channel?: AnnouncementChannel;
  targetId?: string;
  status?: AnnouncementStatus;
}): Promise<readonly AnnouncementRecord[]> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    { channel?: AnnouncementChannel; targetId?: string; status?: AnnouncementStatus },
    { announcements: readonly AnnouncementRecord[] }
  >(functions, "listAnnouncements");

  try {
    const response = await callable(params ?? {});
    return response.data.announcements;
  } catch (error) {
    if (error instanceof Error && error.message === safeListError) {
      throw error;
    }
    throw new Error(safeListError);
  }
}

export async function sendMinorNotice(
  input: SendMinorNoticeInput,
): Promise<SafeguardingNoticeRecord> {
  const parsed = parseSendMinorNoticeInput(input);
  if (!parsed.ok) {
    throw new Error(safeSendNoticeError);
  }

  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    SendMinorNoticeInput,
    { notice: SafeguardingNoticeRecord }
  >(functions, "sendMinorNotice");

  try {
    const response = await callable(parsed.value);
    return response.data.notice;
  } catch (error) {
    if (error instanceof Error && error.message === safeSendNoticeError) {
      throw error;
    }
    throw new Error(safeSendNoticeError);
  }
}

export async function listGuardianNotices(
  guardianId?: string,
): Promise<readonly SafeguardingNoticeRecord[]> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    { guardianId?: string },
    { notices: readonly SafeguardingNoticeRecord[] }
  >(functions, "listGuardianNotices");

  try {
    const response = await callable(guardianId ? { guardianId } : {});
    return response.data.notices;
  } catch (error) {
    if (error instanceof Error && error.message === safeListNoticesError) {
      throw error;
    }
    throw new Error(safeListNoticesError);
  }
}

export async function markNoticeAsRead(
  noticeId: string,
): Promise<SafeguardingNoticeRecord> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    { noticeId: string },
    { notice: SafeguardingNoticeRecord }
  >(functions, "markNoticeAsRead");

  try {
    const response = await callable({ noticeId });
    return response.data.notice;
  } catch (error) {
    if (error instanceof Error && error.message === safeMarkNoticeReadError) {
      throw error;
    }
    throw new Error(safeMarkNoticeReadError);
  }
}

