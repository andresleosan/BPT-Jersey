"use client";
import { useEffect, useState } from "react";
import type { CourseNotice } from "@bpt-jersey/domain/courses";
import { courseApi } from "./course-client";
export function useCourseNotices(uid: string) {
  const [notices, setNotices] = useState<CourseNotice[]>([]);
  useEffect(() => {
    let active = true; let pending: Promise<void> | null = null; setNotices([]);
    const refresh = () => {if (pending) return; pending = courseApi.notices({}).then(page => {if (active) setNotices(page.items);}).catch(() => {}).finally(() => {pending = null;});};
    refresh(); window.addEventListener("focus", refresh); window.addEventListener("bpt-course-update", refresh);
    return () => {active = false; window.removeEventListener("focus", refresh); window.removeEventListener("bpt-course-update", refresh);};
  }, [uid]);
  async function read(noticeId: string) {await courseApi.readNotice({noticeId}); setNotices(old => old.map(n => n.noticeId === noticeId ? {...n, readAt: new Date().toISOString()} : n));}
  return {notices, read};
}
