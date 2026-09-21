"use client";

import { useEffect, useRef, useState } from "react";
import type { CoursePage, PublicCourse } from "@bpt-jersey/domain/courses";

import { courseDate, courseMoney, publicCourses } from "../../lib/courses/course-public-client";

function participantAges(course: PublicCourse): string {
  return course.maxAge === null ? `${course.minAge}+` : `${course.minAge}-${course.maxAge}`;
}

function courseAvailability(course: PublicCourse): string {
  if (course.availability === "waitlist") return "Waitlist open";
  if (course.availability === "closed") return "Enrolment closed";
  return "Places available";
}

export function CourseCatalogue() {
  const [page, setPage] = useState<CoursePage<PublicCourse> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);

  async function load(cursor?: string) {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setBusy(true);
    setError("");

    try {
      const value = await publicCourses(next.signal, cursor);
      if (next.signal.aborted) return;
      setPage((current) => ({
        ...value,
        items: cursor ? [...(current?.items ?? []), ...value.items] : value.items,
      }));
    } catch (failure) {
      if (!next.signal.aborted) {
        setError(failure instanceof Error ? failure.message : "Unable to load courses.");
      }
    } finally {
      if (!next.signal.aborted) setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, []);

  return (
    <section className="course-catalogue" aria-labelledby="course-catalogue-title">
      <header className="course-section-heading">
        <h2 id="course-catalogue-title">Upcoming programmes</h2>
        <p>Choose the dates and focus that fit your training.</p>
      </header>

      {error ? (
        <div className="course-error" role="alert">
          <p>{error}</p>
          <button className="course-link" type="button" onClick={() => void load()}>
            Try loading courses again
          </button>
        </div>
      ) : null}

      {!page && busy ? (
        <div className="course-loading" role="status" aria-label="Loading upcoming courses">
          <span />
          <span />
          <span />
        </div>
      ) : null}

      {page?.items.length === 0 ? (
        <div className="course-panel course-empty">
          <h2>New courses are on the way</h2>
          <p>Ask the academy about the next programme.</p>
          <a className="course-button" href="/#contact">
            Contact the academy
          </a>
        </div>
      ) : null}

      <ul className="course-list">
        {page?.items.map((course) => (
          <li className="course-row" key={course.courseId}>
            <article>
              <div className="course-row-copy">
                <p className="course-meta">
                  <span>{course.kind === "seminar" ? "Seminar" : "Weekly course"}</span>
                  <span>Ages {participantAges(course)}</span>
                </p>
                <h3>
                  <a href={`/courses/view?course=${course.courseId}`}>{course.title}</a>
                </h3>
                <p className="course-byline">
                  {course.instructorName}
                  <span aria-hidden="true">/</span>
                  {course.locationName}
                </p>
                <p className="course-schedule">
                  {course.nextSessionAt
                    ? `Next session: ${courseDate(course.nextSessionAt)}`
                    : "No future session is scheduled"}
                  <span>{course.sessionCount} sessions</span>
                </p>
              </div>

              <div className="course-row-action">
                <p className="course-availability">{courseAvailability(course)}</p>
                <p className="course-price">{courseMoney(course.priceMinor)}</p>
                <p className="course-meta">One payment</p>
                <a
                  className="course-button secondary"
                  href={`/courses/view?course=${course.courseId}`}
                >
                  {course.availability === "waitlist" ? "View waitlist" : "View programme"}
                </a>
              </div>
            </article>
          </li>
        ))}
      </ul>

      {page?.cursor ? (
        <button
          className="course-button secondary"
          type="button"
          disabled={busy}
          onClick={() => void load(page.cursor!)}
        >
          {busy ? "Loading more courses" : "Load more courses"}
        </button>
      ) : null}
    </section>
  );
}
