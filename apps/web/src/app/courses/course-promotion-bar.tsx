"use client";
import { useEffect, useState } from "react";
import type { PublicCourse } from "@bpt-jersey/domain/courses";
import { publicCourses, courseMoney } from "../../lib/courses/course-public-client";
import "./courses.css";
export function CoursePromotionBar() {
  const [courses, setCourses] = useState<PublicCourse[]>([]); const [paused, setPaused] = useState(false);
  useEffect(() => {const controller = new AbortController(); void publicCourses(controller.signal).then(page => setCourses(page.items.filter(c => c.availability !== "closed").slice(0, 6))).catch(() => {}); return () => controller.abort();}, []);
  if (!courses.length) return null;
  return <aside className="course-promo" aria-label="Upcoming courses and seminars" data-paused={paused}><div className="course-promo-window"><div className="course-promo-track"><div className="course-promo-group">{courses.map(c => <a href={`/courses/view?course=${c.courseId}`} key={c.courseId}>{c.title} · {c.sessionCount} sessions · {courseMoney(c.priceMinor)} →</a>)}</div><div className="course-promo-group" aria-hidden="true" inert>{courses.map(c => <span key={c.courseId}>{c.title} · {c.sessionCount} sessions · {courseMoney(c.priceMinor)} →</span>)}</div></div></div><button type="button" aria-pressed={paused} onClick={() => setPaused(v => !v)}>{paused ? "Play" : "Pause"}</button></aside>;
}
