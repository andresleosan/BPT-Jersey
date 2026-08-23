import { httpsCallable } from "firebase/functions";

import {
  parseCreateAnnouncementInput,
  parseUpdateAnnouncementInput,
  type AnnouncementChannel,
  type AnnouncementRecord,
  type AnnouncementStatus,
  type CreateAnnouncementInput,
  type UpdateAnnouncementInput,
} from "@bpt-jersey/domain/announcements";
import { getFirebaseFunctions } from "./firebase-client";

const safeCreateError = "Unable to create announcement. Please try again.";
const safeUpdateError = "Unable to update announcement. Please try again.";
const safePublishError = "Unable to publish announcement. Please try again.";
const safeArchiveError = "Unable to archive announcement. Please try again.";
const safeMarkReadError = "Unable to mark announcement as read. Please try again.";
const safeListError = "Unable to load announcements. Please try again.";

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
