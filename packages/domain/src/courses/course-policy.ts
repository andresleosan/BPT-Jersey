import type { Course, CourseSlot } from "./course-contracts";
import type { CourseEnrolment } from "./enrolment-contracts";
export function occupiesCourseSeat(e: CourseEnrolment, nowMs: number): boolean {
  if (["review", "approved", "withdrawal_requested"].includes(e.status)) return true;
  return ["held", "offered", "correction"].includes(e.status) && e.expiresAt !== null && Date.parse(e.expiresAt) > nowMs;
}
export function courseAge(dateOfBirth: string, onDate: string): number {
  const age = Number(onDate.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  return age - (onDate.slice(5, 10) < dateOfBirth.slice(5, 10) ? 1 : 0);
}
export function isCourseAgeEligible(course: Pick<Course, "minAge" | "maxAge">, birth: string, date: string): boolean {
  const age = courseAge(birth, date);
  return Number.isInteger(age) && age >= course.minAge && (course.maxAge === null || age <= course.maxAge);
}
export function canAccessCourseSession(e: CourseEnrolment, s: Pick<CourseSlot, "courseId" | "startAt"> & {status: string}): boolean {
  return ["approved", "withdrawal_requested"].includes(e.status) && e.studentId !== null
    && s.courseId === e.courseId && e.accessFrom !== null && Date.parse(s.startAt) >= Date.parse(e.accessFrom)
    && s.status !== "cancelled";
}
