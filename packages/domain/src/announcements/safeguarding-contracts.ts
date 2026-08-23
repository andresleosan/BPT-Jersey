import { err, ok, type Result } from "../result";
import { type AnnouncementRecord } from "./announcement-contracts";

export const noticeCategories = [
  "attendance",
  "payment",
  "progress",
  "general",
] as const;
export type NoticeCategory = (typeof noticeCategories)[number];

export type SafeguardingNoticeRecord = Readonly<{
  noticeId: string;
  academyId: string;
  minorStudentId: string;
  guardianId: string;
  title: string;
  content: string;
  category: NoticeCategory;
  authorId: string;
  authorRole: string;
  readAt: string | null;
  createdAt: string;
  createdBy: string;
}>;

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export type ValidationIssue = Readonly<{
  path: readonly (string | number)[];
  code: string;
}>;

function issue(path: readonly (string | number)[], code: string): ValidationIssue {
  return { path, code };
}

export function buildNoticeId(academyId: string, timestamp: string, suffix?: string): string {
  return suffix ? `not_${academyId}_${timestamp}_${suffix}` : `not_${academyId}_${timestamp}`;
}

export type SendMinorNoticeInput = Readonly<{
  minorStudentId: string;
  title: string;
  content: string;
  category?: NoticeCategory;
}>;

export function parseSendMinorNoticeInput(
  raw: unknown,
): Result<SendMinorNoticeInput, readonly ValidationIssue[]> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return err(Object.freeze([issue(["input"], "expected_object")]));
  }

  const record = raw as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  const minorStudentId = record["minorStudentId"];
  const title = record["title"];
  const content = record["content"];
  const category = record["category"];

  if (typeof minorStudentId !== "string" || !safeIdPattern.test(minorStudentId)) {
    issues.push(issue(["input", "minorStudentId"], "invalid_minor_student_id"));
  }

  if (typeof title !== "string" || title.trim().length < 3 || title.trim().length > 120) {
    issues.push(issue(["input", "title"], "title_length_3_to_120"));
  }

  if (typeof content !== "string" || content.trim().length < 5 || content.trim().length > 5000) {
    issues.push(issue(["input", "content"], "content_length_5_to_5000"));
  }

  let parsedCategory: NoticeCategory = "general";
  if (category !== undefined && category !== null) {
    if (typeof category === "string" && noticeCategories.includes(category as NoticeCategory)) {
      parsedCategory = category as NoticeCategory;
    } else {
      issues.push(issue(["input", "category"], "invalid_category"));
    }
  }

  if (issues.length > 0) {
    return err(Object.freeze(issues));
  }

  return ok(
    Object.freeze({
      minorStudentId: (minorStudentId as string).trim(),
      title: (title as string).trim(),
      content: (content as string).trim(),
      category: parsedCategory,
    }),
  );
}

export type RecipientResolution = Readonly<{
  recipientUserId: string;
  isSafeguarded: boolean;
}>;

export function resolveSafeguardedRecipient(params: {
  isMinor: boolean;
  studentId: string;
  guardianIds: readonly string[];
}): Result<RecipientResolution, string> {
  const { isMinor, studentId, guardianIds } = params;

  if (isMinor) {
    if (!guardianIds || guardianIds.length === 0) {
      return err("minor_student_missing_guardian");
    }
    const primaryGuardian = guardianIds[0];
    if (!primaryGuardian || !safeIdPattern.test(primaryGuardian)) {
      return err("invalid_guardian_id");
    }
    return ok(
      Object.freeze({
        recipientUserId: primaryGuardian,
        isSafeguarded: true,
      }),
    );
  }

  return ok(
    Object.freeze({
      recipientUserId: studentId,
      isSafeguarded: false,
    }),
  );
}

export function filterGuardianAnnouncements(params: {
  announcements: readonly AnnouncementRecord[];
  minorClassIds: readonly string[];
  minorGroupIds: readonly string[];
}): readonly AnnouncementRecord[] {
  const { announcements, minorClassIds, minorGroupIds } = params;

  return announcements.filter((ann) => {
    if (ann.status !== "published") return false;
    if (ann.channel === "academy") return true;
    if (ann.channel === "class" && ann.targetId && minorClassIds.includes(ann.targetId)) {
      return true;
    }
    if (ann.channel === "group" && ann.targetId && minorGroupIds.includes(ann.targetId)) {
      return true;
    }
    return false;
  });
}
