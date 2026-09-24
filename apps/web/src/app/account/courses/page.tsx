"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CourseEnrolment, CoursePage } from "@bpt-jersey/domain/courses";
import { CourseSessionGate, type CourseSession } from "../../../lib/courses/course-session";
import { courseApi, courseError } from "../../../lib/courses/course-client";
import { courseDate, courseMoney } from "../../../lib/courses/course-public-client";
import { useCourseNotices } from "../../../lib/courses/use-course-notices";
import { CourseLoading } from "../../courses/course-ui";
import { CourseCatalogue } from "../../courses/course-catalogue";
import { CourseStatus } from "../../courses/course-status";
import "../../courses/courses.css";
const CourseEnrolForm = dynamic(
  () => import("./course-enrol-form").then((m) => m.CourseEnrolForm),
  { loading: () => <CourseLoading label="Loading enrolment form" /> },
);
const CoursePaymentPanel = dynamic(
  () => import("./course-payment-panel").then((m) => m.CoursePaymentPanel),
  { loading: () => <CourseLoading label="Loading payment details" /> },
);
function MyCourses({ session }: { session: CourseSession }) {
  const [page, setPage] = useState<CoursePage<CourseEnrolment> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const {
    notices,
    read,
    cursor: noticeCursor,
    loadMore: moreNotices,
    busy: noticeBusy,
    error: noticeError,
  } = useCourseNotices(session.uid);
  async function load(cursor?: string) {
    setBusy(true);
    setError("");
    try {
      const p = await courseApi.enrolments({ ownOnly: true, ...(cursor ? { cursor } : {}) });
      setPage((old) => ({ ...p, items: cursor ? [...(old?.items ?? []), ...p.items] : p.items }));
    } catch (e) {
      setError(courseError(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("course");
    if (id && /^[0-9a-f-]{36}$/iu.test(id)) setCourseId(id);
    void load();
  }, [session.uid]);
  // A course chosen further down the page opens its panel at the top: bring it into view.
  useEffect(() => {
    if (courseId || selected) panel.current?.scrollIntoView({ block: "start" });
  }, [courseId, selected]);
  return (
    <>
      <div className="course-actions">
        <a href="#course-catalogue-title">Browse courses</a>
        <a href="/account/courses/calendar">My course calendar and history</a>
        <button className="course-link" disabled={busy} onClick={() => void load()}>
          {busy ? "Refreshing…" : "Refresh my requests"}
        </button>
        {["owner", "administrator"].includes(session.role) && (
          <a href="/admin/courses">Manage courses</a>
        )}
      </div>
      {error && (
        <p className="course-error" role="alert">
          {error}
        </p>
      )}
      {notices
        .filter((n) => !n.readAt)
        .map((n) => (
          <aside className="course-notice" key={n.noticeId}>
            <strong>{n.title}</strong>
            <p>{n.message}</p>
            <div className="course-actions">
              {n.enrolmentId && (
                <button
                  className="course-link"
                  onClick={() => {
                    setCourseId(null);
                    setSelected(n.enrolmentId);
                  }}
                >
                  View enrolment
                </button>
              )}
              <button
                className="course-link"
                onClick={() => void read(n.noticeId).catch((e) => setError(courseError(e)))}
              >
                Mark as read
              </button>
            </div>
          </aside>
        ))}
      {noticeError && (
        <p role="alert" className="course-error">
          {noticeError}
        </p>
      )}
      {noticeCursor && (
        <button className="course-link" disabled={noticeBusy} onClick={() => void moreNotices()}>
          Load earlier notices
        </button>
      )}
      <div ref={panel} className="course-account-panel" />
      {courseId && session.canApply && (
        <CourseEnrolForm
          key={courseId}
          courseId={courseId}
          onClose={() => setCourseId(null)}
          onEnrolled={(e) => {
            setCourseId(null);
            setSelected(e.enrolmentId);
            void load();
          }}
        />
      )}
      {!session.canApply && (
        <p className="course-notice">
          Your parent or guardian manages course enrolments and payments.
        </p>
      )}
      {selected && (
        <CoursePaymentPanel
          key={selected}
          enrolmentId={selected}
          onChanged={() => void load()}
          onClose={() => setSelected(null)}
        />
      )}
      {!selected && !(courseId && session.canApply) && (
        <section className="course-account-requests">
          <div className="course-list-heading">
            <h2>My enrolment requests</h2>
            <p>Open a request to see your next step, payment details and session dates.</p>
          </div>
          {!page && busy && <CourseLoading label="Loading your courses" />}
          {page?.items.length === 0 && (
            <div className="course-panel course-empty">
              <h3>No course enrolments yet</h3>
              <p>Explore the catalogue to find your next programme.</p>
              <a className="course-button" href="#course-catalogue-title">
                Browse courses
              </a>
            </div>
          )}
          <ul className="course-list" hidden={!page?.items.length}>
            {page?.items.map((e) => (
              <li className="course-row" key={e.enrolmentId}>
                <div>
                  <strong>{e.reference || `Course request ${e.enrolmentId.slice(0, 8)}`}</strong>
                  <p>
                    <CourseStatus status={e.status} />
                  </p>
                  <p>{courseMoney(e.priceMinor)}</p>
                  <p className="course-meta">Requested {courseDate(e.createdAt)}</p>
                </div>
                <button
                  className="course-button secondary"
                  onClick={() => setSelected(e.enrolmentId)}
                >
                  View course and payment
                </button>
              </li>
            ))}
          </ul>
          {page?.cursor && (
            <button
              className="course-button secondary"
              disabled={busy}
              onClick={() => void load(page.cursor!)}
            >
              Load more requests
            </button>
          )}
        </section>
      )}
      <CourseCatalogue
        onChoose={(id) => {
          setSelected(null);
          setCourseId(id);
        }}
      />
    </>
  );
}
export default function AccountCoursesPage() {
  return (
    <main className="course-page course-account">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <p className="account-eyebrow">
        <Link href="/account">← Back to Account</Link>
      </p>
      <header className="course-page-hero" id="main-content">
        <h1>Courses &amp; Seminars</h1>
        <p className="course-intro">
          Find a course, enrol, and follow your places, payments and updates in one place.
        </p>
      </header>
      <CourseSessionGate>{(session) => <MyCourses session={session} />}</CourseSessionGate>
    </main>
  );
}
