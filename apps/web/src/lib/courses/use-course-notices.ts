"use client";
import { useEffect, useRef, useState } from "react";
import type { CourseNotice } from "@bpt-jersey/domain/courses";
import { courseApi, courseError } from "./course-client";
export function useCourseNotices(uid: string) {
  const [notices, setNotices] = useState<CourseNotice[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const generation = useRef(0); const loadingMore = useRef(false);
  useEffect(() => {
    let active = true; let pending: Promise<void> | null = null; setNotices([]); setCursor(null);
    const refresh = () => {
      if (pending) return;
      const ticket = ++generation.current;
      pending = courseApi.notices({}).then(page => {if (active && ticket === generation.current) {setNotices(page.items); setCursor(page.cursor); setError("");}}).catch(e => {if (active) setError(courseError(e));}).finally(() => {pending = null;});
    };
    refresh(); window.addEventListener("focus", refresh); window.addEventListener("bpt-course-update", refresh);
    return () => {active = false; generation.current++; window.removeEventListener("focus", refresh); window.removeEventListener("bpt-course-update", refresh);};
  }, [uid]);
  async function loadMore() {
    if (!cursor || loadingMore.current) return;
    const ticket = generation.current; loadingMore.current = true; setBusy(true);
    try {const page = await courseApi.notices({cursor}); if (ticket === generation.current) {setNotices(old => [...old, ...page.items].filter((n,i,all) => all.findIndex(a => a.noticeId === n.noticeId) === i)); setCursor(page.cursor); setError("");}}
    catch (e) {if (ticket === generation.current) setError(courseError(e));} finally {loadingMore.current = false; setBusy(false);}
  }
  async function read(noticeId: string) {await courseApi.readNotice({noticeId}); setNotices(old => old.map(n => n.noticeId === noticeId ? {...n, readAt: new Date().toISOString()} : n));}
  return {notices, read, cursor, loadMore, busy, error};
}
