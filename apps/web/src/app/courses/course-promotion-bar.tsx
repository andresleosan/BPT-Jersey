"use client";

import { useEffect, useState } from "react";
import type { PublicCourse } from "@bpt-jersey/domain/courses";

import { courseDate, courseMoney, publicCourses } from "../../lib/courses/course-public-client";
import "./courses.css";

function promotionText(course: PublicCourse): string {
  const date = course.nextSessionAt ? courseDate(course.nextSessionAt) : "Dates coming soon";
  const action = course.availability === "waitlist" ? "Join waitlist" : "View programme";
  return `${course.title} | ${course.sessionCount} sessions | ${courseMoney(course.priceMinor)} | ${date} | ${action}`;
}

export function CoursePromotionBar() {
  const [courses, setCourses] = useState<PublicCourse[]>([]);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void publicCourses(controller.signal)
      .then((page) =>
        setCourses(page.items.filter((course) => course.availability !== "closed").slice(0, 6)),
      )
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (!courses.length) return null;

  return (
    <aside className="course-promo" aria-label="Upcoming courses and seminars" data-paused={paused}>
      <div className="course-promo-window">
        <div className="course-promo-track">
          <div className="course-promo-group">
            {courses.map((course) => (
              <a href={`/courses/view?course=${course.courseId}`} key={course.courseId}>
                {promotionText(course)}
              </a>
            ))}
          </div>
          <div className="course-promo-group" aria-hidden="true" inert>
            {courses.map((course) => (
              <span key={course.courseId}>{promotionText(course)}</span>
            ))}
          </div>
        </div>
      </div>
      <button type="button" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>
        {paused ? "Play" : "Pause"}
      </button>
    </aside>
  );
}
