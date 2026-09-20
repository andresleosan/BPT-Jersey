import type { CoursePage, CourseSlot, PublicCourse } from "@bpt-jersey/domain/courses";
export type PublicCourseSlot = CourseSlot & {status: string};
const endpoint = process.env.NEXT_PUBLIC_COURSES_API_URL ?? "";
type Entry = {data?: unknown; etag?: string | undefined; promise?: Promise<unknown> | undefined; controller?: AbortController | undefined; consumers: number};
const cache = new Map<string, Entry>();
/** Public JSON only. This module deliberately has no Firebase dependencies. */
function request<T>(parameters: Record<string, string>, signal: AbortSignal): Promise<T> {
  if (!endpoint) return Promise.reject(new Error("Courses are not available yet."));
  const url = new URL(endpoint); Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
  const key = url.href; const previous = cache.get(key); const entry: Entry = previous?.controller?.signal.aborted ? {consumers: 0} : previous ?? {consumers: 0}; cache.set(key, entry); entry.consumers++;
  if (!entry.promise) {
    entry.controller = new AbortController();
    entry.promise = fetch(key, {signal: entry.controller.signal, credentials: "omit", cache: "no-cache", headers: entry.etag ? {"If-None-Match": entry.etag} : {}}).then(async response => {
      if (response.status === 304 && entry.data) return entry.data;
      if (!response.ok) {entry.data = undefined; entry.etag = undefined; throw new Error(response.status === 404 ? "Courses are not available yet." : "Courses could not be loaded. Please try again.");}
      const data: unknown = await response.json(); entry.data = data; entry.etag = response.headers.get("ETag") ?? undefined; return data;
    }).finally(() => {entry.promise = undefined; entry.controller = undefined; if (cache.size > 40) for (const [oldKey, old] of cache) if (!old.promise && oldKey !== key) {cache.delete(oldKey); break;}});
  }
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const release = () => {if (finished) return; finished = true; signal.removeEventListener("abort", abort); entry.consumers--; if (!entry.consumers) entry.controller?.abort();};
    const abort = () => {release(); reject(new DOMException("Aborted", "AbortError"));};
    signal.addEventListener("abort", abort, {once: true});
    if (signal.aborted) {abort(); return;}
    entry.promise!.then(data => {if (!finished) {release(); resolve(data as T);}}, error => {if (!finished) {release(); reject(error);}});
  });
}
export const publicCourses = (signal: AbortSignal, cursor?: string) => request<CoursePage<PublicCourse>>({view: "list", ...(cursor ? {cursor} : {})}, signal);
export const publicCourse = (courseId: string, signal: AbortSignal) => request<PublicCourse>({view: "detail", courseId}, signal);
export const publicCourseSlots = (courseId: string, signal: AbortSignal, cursor?: string) => request<CoursePage<PublicCourseSlot>>({view: "sessions", courseId, ...(cursor ? {cursor} : {})}, signal);
export const courseMoney = (amount: number) => new Intl.NumberFormat("en-GB", {style: "currency", currency: "GBP"}).format(amount / 100);
export const courseDate = (date: string) => new Intl.DateTimeFormat("en-GB", {timeZone: "Europe/Jersey", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"}).format(new Date(date));
