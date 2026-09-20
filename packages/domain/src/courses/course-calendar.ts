import { localInstant, shiftIsoInZone } from "../schedule/classes-services-contracts";
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
export function courseSlot(course: Pick<Course, "courseId" | "startsOn" | "startTime" | "endTime" | "sessionCount">, ordinal: number): CourseSlot {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > course.sessionCount || course.endTime <= course.startTime)
    throw new Error("Invalid course session number or time.");
  const days = (ordinal - 1) * 7;
  if (!Number.isSafeInteger(days)) throw new Error("Course date is outside the supported calendar.");
  const initial = checkedCourseInstant(course.startsOn, course.startTime);
  const shifted = shiftIsoInZone(initial, days, "Europe/Jersey");
  const date = wallTime(Date.parse(shifted)).slice(0, 10);
  const startAt = checkedCourseInstant(date, course.startTime);
  const endAt = checkedCourseInstant(date, course.endTime);
  return {sessionId: `course_${course.courseId}_${ordinal}`, courseId: course.courseId, ordinal, startAt, endAt};
}
