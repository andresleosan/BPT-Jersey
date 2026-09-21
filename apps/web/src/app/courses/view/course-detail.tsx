"use client";

import { useEffect, useRef, useState } from "react";
import type { CoursePage, PublicCourse } from "@bpt-jersey/domain/courses";

import {
  courseDate,
  courseMoney,
  publicCourse,
  publicCourseSlots,
  type PublicCourseSlot,
} from "../../../lib/courses/course-public-client";

function courseEndTime(value: string): string {
  return new Date(value).toLocaleTimeString("en-GB", {
    timeZone: "Europe/Jersey",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function participantAges(course: PublicCourse): string {
  return course.maxAge === null ? `${course.minAge}+` : `${course.minAge}-${course.maxAge}`;
}

function slotStatus(slot: PublicCourseSlot): string {
  if (slot.status === "cancelled") return "Cancelled";
  return slot.startAt <= new Date().toISOString() ? "Started or finished" : "Upcoming";
}

export function CourseDetail() {
  const [course, setCourse] = useState<PublicCourse | null>(null);
  const [slots, setSlots] = useState<CoursePage<PublicCourseSlot> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const courseId = new URLSearchParams(window.location.search).get("course");
    if (!courseId || !/^[0-9a-f-]{36}$/iu.test(courseId)) {
      setError("Choose a course from the catalogue.");
      return;
    }

    const next = new AbortController();
    controller.current = next;
    void Promise.all([
      publicCourse(courseId, next.signal),
      publicCourseSlots(courseId, next.signal),
    ])
      .then(([courseValue, slotValue]) => {
        setCourse(courseValue);
        setSlots(slotValue);
      })
      .catch((failure: unknown) => {
        if (!next.signal.aborted) {
          setError(failure instanceof Error ? failure.message : "Unable to load course details.");
        }
      });

    return () => next.abort();
  }, []);

  async function loadMoreDates() {
    if (!course || !slots?.cursor) return;

    const next = new AbortController();
    controller.current?.abort();
    controller.current = next;
    setBusy(true);

    try {
      const value = await publicCourseSlots(course.courseId, next.signal, slots.cursor);
      if (!next.signal.aborted) {
        setSlots({ ...value, items: [...slots.items, ...value.items] });
      }
    } catch (failure) {
      if (!next.signal.aborted) {
        setError(failure instanceof Error ? failure.message : "Unable to load more dates.");
      }
    } finally {
      if (!next.signal.aborted) setBusy(false);
    }
  }

  if (!course) {
    return error ? (
      <div className="course-error" role="alert">
        <p>{error}</p>
        <a href="/courses">Return to all courses</a>
      </div>
    ) : (
      <div className="course-loading" role="status" aria-label="Loading course details">
        <span />
        <span />
        <span />
      </div>
    );
  }

  return (
    <>
      <header className="course-detail-hero">
        <p className="course-eyebrow">
          {course.kind === "seminar" ? "BPT Jersey seminar" : "BPT Jersey course"}
        </p>
        <h1>{course.title}</h1>
        <p className="course-intro">
          Led by {course.instructorName} at {course.locationName}. One payment covers the full
          programme.
        </p>
      </header>

      {error ? (
        <p className="course-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="course-detail">
        <div className="course-detail-content">
          <section aria-labelledby="course-learning-title">
            <h2 id="course-learning-title">What you will learn</h2>
            <p className="course-prose">{course.description}</p>
            <ul className="course-techniques">
              {course.techniques.map((technique) => (
                <li key={technique}>{technique}</li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="course-dates-title">
            <h2 id="course-dates-title">Programme dates</h2>
            <p className="course-prose">
              Times use Jersey local time. Joining after the programme starts covers the remaining
              dates at the full course price.
            </p>
            <ol className="course-slots">
              {slots?.items.map((slot) => (
                <li key={slot.sessionId}>
                  <span className="course-slot-number">Session {slot.ordinal}</span>
                  <strong>{courseDate(slot.startAt)}</strong>
                  <span>Ends {courseEndTime(slot.endAt)}</span>
                  <span className="course-slot-status">{slotStatus(slot)}</span>
                </li>
              ))}
            </ol>
            {slots?.cursor ? (
              <button
                className="course-button secondary"
                type="button"
                disabled={busy}
                onClick={() => void loadMoreDates()}
              >
                {busy ? "Loading more dates" : "Load more dates"}
              </button>
            ) : null}
          </section>

          <section aria-labelledby="course-cancellation-title">
            <h2 id="course-cancellation-title">Cancellation terms</h2>
            <p className="course-prose">{course.cancellationTerms}</p>
          </section>
        </div>

        <aside className="course-summary" aria-label="Course summary">
          <p className="course-summary-label">Programme fee</p>
          <p className="course-price">{courseMoney(course.priceMinor)}</p>
          <p>One payment for this course</p>
          <dl className="course-facts">
            <div>
              <dt>Sessions</dt>
              <dd>{course.sessionCount}</dd>
            </div>
            <div>
              <dt>Ages</dt>
              <dd>{participantAges(course)}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{course.locationName}</dd>
            </div>
            <div>
              <dt>Coach</dt>
              <dd>{course.instructorName}</dd>
            </div>
          </dl>
          {course.availability !== "closed" ? (
            <a className="course-button" href={`/account/courses?course=${course.courseId}`}>
              {course.availability === "waitlist" ? "Join the waitlist" : "Enrol in this course"}
            </a>
          ) : (
            <p className="course-notice">Enrolment is closed.</p>
          )}
          <p className="course-meta">
            {course.availability === "waitlist"
              ? "No payment is needed while you wait for a place."
              : "Reserve a place, transfer the payment and upload your receipt for office approval."}
          </p>
        </aside>
      </div>
    </>
  );
}
