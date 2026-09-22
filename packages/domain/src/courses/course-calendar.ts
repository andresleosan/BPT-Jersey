import { localInstant } from "../schedule/classes-services-contracts";
import type { Course, CourseSlot } from "./course-contracts";
const formatter = new Intl.DateTimeFormat("en-GB", {timeZone: "Europe/Jersey", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"});
function wallTime(ms: number): string {
  const parts = Object.fromEntries(formatter.formatToParts(ms).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function checkedCourseInstant(date: string, time: string): string {
  const ms = localInstant(date, time, "Europe/Jersey");
  const expected = `${date}T${time}`;
  if (!Number.isFinite(ms) || wallTime(ms) !== expected
    || wallTime(ms - 3600000) === expected || wallTime(ms + 3600000) === expected)
    throw new Error(`Choose an unambiguous Jersey time: ${date} at ${time}.`);
  return new Date(ms).toISOString();
}
export function courseSlot(course: Pick<Course, "courseId" | "startsOn" | "startTime" | "endTime" | "sessionCount" | "weeklySchedule">, ordinal: number): CourseSlot {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > course.sessionCount || course.endTime <= course.startTime)
    throw new Error("Invalid course session number or time.");
  // Each week is the seven-day period beginning on startsOn, including that date.
  // Recur in civil dates, then convert each actual session to Jersey time (including DST).
  const civilDate = new Date(`${course.startsOn}T12:00:00Z`);
  const firstWeekday = civilDate.getUTCDay();
  const slots = course.weeklySchedule?.slots.map(slot => ({...slot, offset: (slot.weekday - firstWeekday + 7) % 7}))
    .sort((a, b) => a.offset - b.offset || a.startTime.localeCompare(b.startTime));
  const slot = slots?.[(ordinal - 1) % slots.length];
  const days = slots ? Math.floor((ordinal - 1) / slots.length) * 7 + slot!.offset : (ordinal - 1) * 7;
  if (!Number.isSafeInteger(days)) throw new Error("Course date is outside the supported calendar.");
  civilDate.setUTCDate(civilDate.getUTCDate() + days);
  if (!Number.isFinite(civilDate.getTime()) || civilDate.getUTCFullYear() > 9999)
    throw new Error("Course date is outside the supported calendar.");
  const date = civilDate.toISOString().slice(0, 10);
  const startAt = checkedCourseInstant(date, slot?.startTime ?? course.startTime);
  const endAt = checkedCourseInstant(date, slot?.endTime ?? course.endTime);
  return {sessionId: `course_${course.courseId}_${ordinal}`, courseId: course.courseId, ordinal, startAt, endAt};
}
