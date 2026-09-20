import { z } from "zod";

export const courseTimeZone = "Europe/Jersey" as const;
export const courseHoldMs = 24 * 60 * 60 * 1000;
export const coursePageSize = 30;
export const courseBatchSize = 100;
export const courseIdSchema = z.uuid();
export const courseRecordIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
export const courseLabel = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\u0000-\u001f\u007f]+$/u);
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const courseDraftSchema = z.strictObject({
  kind: z.enum(["course", "seminar"]), title: courseLabel(160),
  description: z.string().trim().min(1).max(6000),
  techniques: z.array(courseLabel(240)).min(1).max(40),
  instructor: z.discriminatedUnion("kind", [
    z.strictObject({kind: z.literal("staff"), staffId: courseRecordIdSchema, name: courseLabel(160)}),
    z.strictObject({kind: z.literal("guest"), name: courseLabel(160)}),
  ]),
  locationId: courseRecordIdSchema, minAge: z.number().int().min(0).max(120),
  maxAge: z.number().int().min(0).max(120).nullable(), priceMinor: positive, capacity: positive,
  cancellationTerms: z.string().trim().min(1).max(6000),
  startsOn: z.iso.date(), startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u), sessionCount: positive,
}).superRefine((v, ctx) => {
  if (v.endTime <= v.startTime) ctx.addIssue({code: "custom", path: ["endTime"], message: "Finish after the start on the same day."});
  if (v.maxAge !== null && v.maxAge < v.minAge) ctx.addIssue({code: "custom", path: ["maxAge"], message: "Maximum age must not be below minimum age."});
});
export type CourseDraft = z.infer<typeof courseDraftSchema>;
export type Instructor = CourseDraft["instructor"];
export type CourseStatus = "draft" | "published" | "completed" | "cancelled";
export type Course = CourseDraft & {
  courseId: string; academyId: string; revision: number; status: CourseStatus;
  timezone: typeof courseTimeZone; currency: "GBP"; committedSeats: number;
  nextSessionAt: string | null; publicationRevision: number | null;
  createdAt: string; updatedAt: string;
};
export type CourseSlot = {sessionId: string; courseId: string; ordinal: number; startAt: string; endAt: string};
export type CoursePage<T> = {items: T[]; cursor: string | null};
export type PublicCourse = Pick<Course, "courseId" | "revision" | "kind" | "title" | "description" | "techniques" | "minAge" | "maxAge" | "priceMinor" | "currency" | "sessionCount" | "nextSessionAt" | "cancellationTerms" | "timezone"> & {
  instructorName: string; locationName: string; status: "published" | "completed";
  availability: "available" | "waitlist" | "closed";
};
export type CourseErrorCode = "invalid" | "forbidden" | "not_found" | "conflict" | "full" | "expired" | "age_ineligible" | "payment_instructions_missing" | "no_future_session" | "rate_limited" | "unavailable";
