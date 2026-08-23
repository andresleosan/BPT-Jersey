import { err, ok, type Result } from "../result";

export const announcementChannels = ["academy", "class", "group"] as const;
export type AnnouncementChannel = (typeof announcementChannels)[number];

export const announcementPriorities = ["normal", "urgent", "pinned"] as const;
export type AnnouncementPriority = (typeof announcementPriorities)[number];

export const announcementStatuses = ["draft", "published", "archived"] as const;
export type AnnouncementStatus = (typeof announcementStatuses)[number];

export const announcementAuthorRoles = ["owner", "administrator", "headCoach", "coach"] as const;
export type AnnouncementAuthorRole = (typeof announcementAuthorRoles)[number];

export type AnnouncementRecord = Readonly<{
  announcementId: string;
  academyId: string;
  channel: AnnouncementChannel;
  targetId: string | null;
  title: string;
  content: string;
  priority: AnnouncementPriority;
  status: AnnouncementStatus;
  publishedAt: string | null;
  expiresAt: string | null;
  authorId: string;
  authorRole: AnnouncementAuthorRole;
  readBy: readonly string[];
  schemaVersion: "1";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export type ValidationIssue = Readonly<{
  path: readonly (string | number)[];
  code: string;
}>;

function issue(path: readonly (string | number)[], code: string): ValidationIssue {
  return { path, code };
}

export function buildAnnouncementId(academyId: string, timestamp: string, suffix?: string): string {
  return suffix ? `ann_${academyId}_${timestamp}_${suffix}` : `ann_${academyId}_${timestamp}`;
}

export type CreateAnnouncementInput = Readonly<{
  channel: AnnouncementChannel;
  targetId?: string | null;
  title: string;
  content: string;
  priority?: AnnouncementPriority;
  publishImmediately?: boolean;
  expiresAt?: string | null;
}>;

export function parseCreateAnnouncementInput(
  raw: unknown,
): Result<CreateAnnouncementInput, readonly ValidationIssue[]> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return err(Object.freeze([issue(["input"], "expected_object")]));
  }

  const record = raw as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  const channel = record["channel"];
  const targetId = record["targetId"];
  const title = record["title"];
  const content = record["content"];
  const priority = record["priority"];
  const publishImmediately = record["publishImmediately"];
  const expiresAt = record["expiresAt"];

  if (
    typeof channel !== "string" ||
    !announcementChannels.includes(channel as AnnouncementChannel)
  ) {
    issues.push(issue(["input", "channel"], "invalid_channel"));
  }

  if (channel === "class" || channel === "group") {
    if (typeof targetId !== "string" || !safeIdPattern.test(targetId)) {
      issues.push(issue(["input", "targetId"], "target_id_required_for_channel"));
    }
  }

  if (typeof title !== "string" || title.trim().length < 3 || title.trim().length > 120) {
    issues.push(issue(["input", "title"], "title_length_3_to_120"));
  }

  if (typeof content !== "string" || content.trim().length < 5 || content.trim().length > 5000) {
    issues.push(issue(["input", "content"], "content_length_5_to_5000"));
  }

  let parsedPriority: AnnouncementPriority = "normal";
  if (priority !== undefined && priority !== null) {
    if (
      typeof priority === "string" &&
      announcementPriorities.includes(priority as AnnouncementPriority)
    ) {
      parsedPriority = priority as AnnouncementPriority;
    } else {
      issues.push(issue(["input", "priority"], "invalid_priority"));
    }
  }

  let parsedExpiresAt: string | null = null;
  if (expiresAt !== undefined && expiresAt !== null) {
    if (typeof expiresAt === "string" && !Number.isNaN(new Date(expiresAt).getTime())) {
      parsedExpiresAt = expiresAt.trim();
    } else {
      issues.push(issue(["input", "expiresAt"], "invalid_expires_at_iso"));
    }
  }

  if (issues.length > 0) {
    return err(Object.freeze(issues));
  }

  return ok(
    Object.freeze({
      channel: channel as AnnouncementChannel,
      targetId: typeof targetId === "string" && targetId.trim() ? targetId.trim() : null,
      title: (title as string).trim(),
      content: (content as string).trim(),
      priority: parsedPriority,
      publishImmediately: publishImmediately === true,
      expiresAt: parsedExpiresAt,
    }),
  );
}

export type UpdateAnnouncementInput = Readonly<{
  announcementId: string;
  title?: string | undefined;
  content?: string | undefined;
  priority?: AnnouncementPriority | undefined;
  expiresAt?: string | null | undefined;
}>;

export function parseUpdateAnnouncementInput(
  raw: unknown,
): Result<UpdateAnnouncementInput, readonly ValidationIssue[]> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return err(Object.freeze([issue(["input"], "expected_object")]));
  }

  const record = raw as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  const announcementId = record["announcementId"];
  const title = record["title"];
  const content = record["content"];
  const priority = record["priority"];
  const expiresAt = record["expiresAt"];

  if (typeof announcementId !== "string" || !safeIdPattern.test(announcementId)) {
    issues.push(issue(["input", "announcementId"], "invalid_announcement_id"));
  }

  if (title !== undefined) {
    if (typeof title !== "string" || title.trim().length < 3 || title.trim().length > 120) {
      issues.push(issue(["input", "title"], "title_length_3_to_120"));
    }
  }

  if (content !== undefined) {
    if (typeof content !== "string" || content.trim().length < 5 || content.trim().length > 5000) {
      issues.push(issue(["input", "content"], "content_length_5_to_5000"));
    }
  }

  if (priority !== undefined && priority !== null) {
    if (
      typeof priority !== "string" ||
      !announcementPriorities.includes(priority as AnnouncementPriority)
    ) {
      issues.push(issue(["input", "priority"], "invalid_priority"));
    }
  }

  let parsedExpiresAt: string | null | undefined = undefined;
  if (expiresAt !== undefined) {
    if (expiresAt === null) {
      parsedExpiresAt = null;
    } else if (typeof expiresAt === "string" && !Number.isNaN(new Date(expiresAt).getTime())) {
      parsedExpiresAt = expiresAt.trim();
    } else {
      issues.push(issue(["input", "expiresAt"], "invalid_expires_at_iso"));
    }
  }

  if (issues.length > 0) {
    return err(Object.freeze(issues));
  }

  return ok(
    Object.freeze({
      announcementId: (announcementId as string).trim(),
      title: typeof title === "string" ? title.trim() : undefined,
      content: typeof content === "string" ? content.trim() : undefined,
      priority: priority as AnnouncementPriority | undefined,
      expiresAt: parsedExpiresAt,
    }),
  );
}
