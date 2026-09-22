"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { Course, CourseEnrolment, CourseJob, CoursePage } from "@bpt-jersey/domain/courses";
import { courseApi, courseError } from "../../../lib/courses/course-client";
import { courseDate, courseMoney } from "../../../lib/courses/course-public-client";
import { useCourseAction } from "../../../lib/courses/use-course-action";
import { AdminSectionHeader } from "../admin-ui";
import { CourseLoading, CourseProgrammeStatus } from "../../courses/course-ui";
import { CourseStatus } from "../../courses/course-status";
import "../../courses/courses.css";
const CourseEditor = dynamic(() => import("./course-editor").then((m) => m.CourseEditor), {
  loading: () => <CourseLoading label="Loading editor" />,
});
const CourseReview = dynamic(() => import("./course-review").then((m) => m.CourseReview), {
  loading: () => <CourseLoading label="Loading review" />,
});
const CourseIncidents = dynamic(() => import("./course-incidents").then((m) => m.CourseIncidents));
const CourseSessions = dynamic(() => import("./course-sessions").then((m) => m.CourseSessions));
export default function AdminCoursesPage() {
  const [tab, setTab] = useState<"courses" | "requests" | "jobs" | "incidents">("courses");
  const [courses, setCourses] = useState<CoursePage<Course> | null>(null);
  const [requests, setRequests] = useState<CoursePage<CourseEnrolment> | null>(null);
  const [jobs, setJobs] = useState<CoursePage<CourseJob> | null>(null);
  const [jobState, setJobState] = useState<"failed" | "queued" | "running">("failed");
  const [filter, setFilter] = useState<CourseEnrolment["status"] | "all">("review");
  const [selected, setSelected] = useState<Course | null>(null);
  const [editor, setEditor] = useState(false);
  const [request, setRequest] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const action = useCourseAction();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const initialView = useRef(true);
  useEffect(() => {
    if (initialView.current) {
      initialView.current = false;
      return;
    }
    workspaceRef.current?.focus();
  }, [tab, editor, selected?.courseId, request]);
  useEffect(() => {
    let active = true;
    const query = new URLSearchParams(window.location.search);
    if (query.get("create") === "1") setEditor(true);
    const courseId = query.get("course");
    if (courseId) {
      void courseApi.course({courseId}).then(course => {
        if (active) {setSelected(course); setEditor(false);}
      }).catch(error => {if (active) setError(courseError(error));});
    }
    return () => {active = false;};
  }, []);
  const loadGeneration = useRef(0);
  const [failedCount, setFailedCount] = useState(0);
  useEffect(() => {
    let active = true;
    let pending = false;
    const refresh = () => {
      if (pending) return;
      pending = true;
      void courseApi
        .jobs({ state: "failed" })
        .then((p) => {
          if (active) setFailedCount(p.items.length);
        })
        .catch(() => {})
        .finally(() => {
          pending = false;
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("bpt-course-update", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("bpt-course-update", refresh);
    };
  }, []);
  async function load(cursor?: string) {
    const ticket = ++loadGeneration.current;
    setLoading(true);
    setError("");
    try {
      if (tab === "courses") {
        const p = await courseApi.courses(cursor ? { cursor } : {});
        if (ticket !== loadGeneration.current) return;
        setCourses((old) => ({
          ...p,
          items: cursor ? [...(old?.items ?? []), ...p.items] : p.items,
        }));
      } else if (tab === "requests") {
        const p = await courseApi.enrolments({
          ...(cursor ? { cursor } : {}),
          ...(filter !== "all" ? { status: filter } : {}),
        });
        if (ticket !== loadGeneration.current) return;
        setRequests((old) => ({
          ...p,
          items: cursor ? [...(old?.items ?? []), ...p.items] : p.items,
        }));
      } else if (tab === "jobs") {
        const p = await courseApi.jobs({ state: jobState, ...(cursor ? { cursor } : {}) });
        if (ticket !== loadGeneration.current) return;
        setJobs((old) => ({ ...p, items: cursor ? [...(old?.items ?? []), ...p.items] : p.items }));
      }
    } catch (e) {
      if (ticket === loadGeneration.current) setError(courseError(e));
    } finally {
      if (ticket === loadGeneration.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [tab, filter, jobState]);
  async function refreshSelected() {
    if (selected) {
      try {
        setSelected(await courseApi.course({ courseId: selected.courseId }));
      } catch (e) {
        setError(courseError(e));
      }
    }
    void load();
  }
  async function publish(course: Course) {
    const result = await action.run(
      `publish:${course.courseId}:${course.revision}`,
      (requestId) =>
        courseApi.publish({
          courseId: course.courseId,
          expectedRevision: course.revision,
          requestId,
        }),
      "Publication queued. Refresh shortly to see the published course.",
    );
    if (result) void load();
  }
  async function cancel() {
    if (!selected || !cancelReason.trim()) return;
    const input = {
      courseId: selected.courseId,
      expectedRevision: selected.revision,
      reason: cancelReason,
    };
    const result = await action.run(
      JSON.stringify(input),
      (requestId) => courseApi.cancel({ ...input, requestId }),
      "Course cancelled. Future access is closed; payment history is retained.",
    );
    if (result) {
      setSelected(result);
      setCancelReason("");
      void load();
    }
  }
  const activePage =
    tab === "courses" ? courses : tab === "requests" ? requests : tab === "jobs" ? jobs : null;
  const inspecting =
    editor ||
    (tab === "courses" && selected !== null) ||
    ((tab === "requests" || tab === "incidents") && request !== null);
  const cursor =
    tab === "courses"
      ? courses?.cursor
      : tab === "requests"
        ? requests?.cursor
        : tab === "jobs"
          ? jobs?.cursor
          : null;
  return (
    <div
      className="course-workspace"
      ref={workspaceRef}
      tabIndex={-1}
      aria-label="Courses and seminars"
    >
      <AdminSectionHeader
        eyebrow="Academy programmes"
        title="Courses & seminars"
        description="Plan weekly sessions, publish your programme and review enrolments."
        actions={
          !inspecting && (
            <button
              className="course-button"
              onClick={() => {
                setSelected(null);
                setEditor(true);
                setTab("courses");
              }}
            >
              Create course
            </button>
          )
        }
      />
      {!inspecting && (
        <>
          <nav className="course-tabs" aria-label="Course management">
            <button aria-pressed={tab === "courses"} onClick={() => setTab("courses")}>
              Courses
            </button>
            <button aria-pressed={tab === "requests"} onClick={() => setTab("requests")}>
              Enrolment requests
            </button>
            <button aria-pressed={tab === "jobs"} onClick={() => setTab("jobs")}>
              Processing
            </button>
            <button aria-pressed={tab === "incidents"} onClick={() => setTab("incidents")}>
              Payment incidents
            </button>
          </nav>
          <div className="course-toolbar">
            <div className="course-actions">
              <a href="/admin/classes-services/classes">Open academy calendar</a>
              <a href="/courses">View public catalogue</a>
              <a href="/account/courses">My course enrolments</a>
            </div>
            {tab !== "incidents" && (
              <button
                className="course-link"
                disabled={loading}
                onClick={() => void refreshSelected()}
              >
                {loading ? "Refreshing…" : "Refresh list"}
              </button>
            )}
          </div>
        </>
      )}
      {failedCount > 0 && !inspecting && (
        <aside className="course-notice" role="status">
          <strong>Course processing needs attention</strong>
          <p>
            {failedCount === 30 ? "30 or more" : failedCount} tasks stopped after repeated failures.
            Their progress is retained.
          </p>
          <button
            className="course-link"
            onClick={() => {
              setJobState("failed");
              setTab("jobs");
            }}
          >
            Review processing issues
          </button>
        </aside>
      )}
      {(error || action.error) && (
        <p role="alert" className="course-error">
          {error || action.error}
        </p>
      )}
      {action.message && (
        <p role="status" className="course-feedback">
          {action.message}
        </p>
      )}
      {editor && (
        <CourseEditor
          key={`${selected?.courseId ?? "new"}:${selected?.revision ?? 0}`}
          course={selected}
          onClose={() => setEditor(false)}
          onSaved={(c) => {
            setSelected(c);
            setEditor(false);
            void load();
          }}
        />
      )}
      {tab === "courses" &&
        !editor &&
        (selected ? (
          <section className="course-panel course-inspector" aria-label="Manage programme">
            <div className="course-panel-heading">
              <div>
                <CourseProgrammeStatus status={selected.status} />
                <h3>{selected.title}</h3>
                <p>{selected.instructor.name}</p>
              </div>
              <button className="course-link" onClick={() => setSelected(null)}>
                Back to courses
              </button>
            </div>
            <dl className="course-facts course-facts-inline">
              <div>
                <dt>Programme</dt>
                <dd>{selected.sessionCount} sessions{selected.weeklySchedule
                  ? ` over ${selected.weeklySchedule.weeks} weeks (${selected.weeklySchedule.slots.length} per week)`
                  : " (one per week)"}</dd>
              </div>
              <div>
                <dt>One-time price</dt>
                <dd>{courseMoney(selected.priceMinor)}</dd>
              </div>
              <div>
                <dt>Places committed</dt>
                <dd>
                  {selected.committedSeats} of {selected.capacity}
                </dd>
              </div>
            </dl>
            <div className="course-toolbar">
              <div className="course-actions">
                {["draft", "published"].includes(selected.status) && (
                  <button className="course-button secondary" onClick={() => setEditor(true)}>
                    Edit programme
                  </button>
                )}
                {selected.status === "draft" && (
                  <button
                    className="course-button"
                    disabled={action.busy}
                    onClick={() => void publish(selected)}
                  >
                    Publish course
                  </button>
                )}
                {selected.status === "published" && (
                  <a
                    className="course-button secondary"
                    href={`/courses/view?course=${selected.courseId}`}
                  >
                    View public page
                  </a>
                )}
              </div>
              <button
                className="course-link"
                disabled={loading}
                onClick={() => void refreshSelected()}
              >
                Refresh programme
              </button>
            </div>
            {selected.status === "draft" && (
              <p className="course-guidance">
                This draft is private and does not appear on the homepage. Check the dates below,
                then choose Publish course. Once all sessions are prepared, it appears on the
                homepage, in the public catalogue and in the academy calendar.
              </p>
            )}
            <CourseSessions
              key={selected.courseId}
              course={selected}
              onChanged={() => void refreshSelected()}
            />
            {["draft", "published"].includes(selected.status) && (
              <details className="course-danger-zone">
                <summary>Cancel this course</summary>
                <p>
                  This closes future access immediately. Refunds are reviewed and recorded
                  separately.
                </p>
                <label>
                  Cancellation reason
                  <textarea
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    maxLength={1000}
                  />
                </label>
                <button
                  className="course-button secondary"
                  disabled={action.busy || !cancelReason.trim()}
                  onClick={() => void cancel()}
                >
                  Confirm course cancellation
                </button>
              </details>
            )}
          </section>
        ) : (
          <>
            <div className="course-list-heading">
              <h3>Your programmes</h3>
              <p>Drafts stay private until you publish them.</p>
            </div>
            <ul className="course-list" hidden={!courses?.items.length}>
              {courses?.items.map((c) => (
                <li key={c.courseId} className="course-row">
                  <div>
                    <CourseProgrammeStatus status={c.status} />
                    <h3>{c.title}</h3>
                    <p className="course-meta">
                      {c.kind === "seminar" ? "Seminar" : "Course"} with {c.instructor.name}
                    </p>
                    <dl className="course-row-facts">
                      <div>
                        <dt>Sessions</dt>
                        <dd>{c.sessionCount}</dd>
                      </div>
                      <div>
                        <dt>One payment</dt>
                        <dd>{courseMoney(c.priceMinor)}</dd>
                      </div>
                      <div>
                        <dt>Places committed</dt>
                        <dd>
                          {c.committedSeats} / {c.capacity}
                        </dd>
                      </div>
                    </dl>
                    {c.nextSessionAt && (
                      <p className="course-meta">Next session: {courseDate(c.nextSessionAt)}</p>
                    )}
                  </div>
                  <button
                    className="course-button secondary"
                    onClick={() => {
                      setSelected(c);
                      setCancelReason("");
                    }}
                  >
                    Manage course
                  </button>
                </li>
              ))}
            </ul>
            {courses?.items.length === 0 && (
              <div className="course-empty-state">
                <h3>Create your first programme</h3>
                <p>
                  Set the coach, price and weekly schedule. Preview every date before making it
                  public.
                </p>
                <p className="course-meta">Use Create course above to get started.</p>
              </div>
            )}
          </>
        ))}
      {(tab === "requests" || tab === "incidents") && request && (
        <CourseReview
          key={request}
          enrolmentId={request}
          onChanged={() => void load()}
          onClose={() => setRequest(null)}
        />
      )}
      {tab === "incidents" && !request && <CourseIncidents onReview={setRequest} />}
      {tab === "requests" && !request && (
        <>
          <div className="course-queue-heading">
            <div>
              <h3>Enrolment requests</h3>
              <p>Open a request to review the participant and payment evidence.</p>
            </div>
            <label>
              Show requests
              <select
                value={filter}
                onChange={(e) => {
                  setRequests(null);
                  setFilter(e.target.value as typeof filter);
                }}
              >
                <option value="review">Payment review</option>
                <option value="withdrawal_requested">Withdrawal requests</option>
                <option value="correction">Correction requested</option>
                <option value="waitlisted">Waitlist</option>
                <option value="approved">Approved</option>
                <option value="expired">Expired reservations</option>
                <option value="all">All enrolments</option>
              </select>
            </label>
          </div>
          <ul className="course-list" hidden={!requests?.items.length}>
            {requests?.items.map((e) => (
              <li className="course-row" key={e.enrolmentId}>
                <div>
                  <CourseStatus status={e.status} />
                  <h3 className="course-reference">
                    {e.reference || `Request ${e.enrolmentId.slice(0, 8)}`}
                  </h3>
                  <p>{courseMoney(e.priceMinor)}</p>
                  <p className="course-meta">
                    Submitted {courseDate(e.submittedAt ?? e.createdAt)}
                  </p>
                </div>
                <button
                  className="course-button secondary"
                  onClick={() => setRequest(e.enrolmentId)}
                >
                  Review request
                </button>
              </li>
            ))}
          </ul>
          {requests?.items.length === 0 && (
            <div className="course-empty-state">
              <h3>No requests to review</h3>
              <p>
                Requests matching this filter will appear here. Choose another status to see other
                enrolments.
              </p>
            </div>
          )}
        </>
      )}
      {tab === "jobs" && (
        <>
          <div className="course-queue-heading">
            <div>
              <h3>Programme processing</h3>
              <p>
                Every date is prepared before publication. Failed tasks keep their progress so you
                can retry.
              </p>
            </div>
            <label>
              Processing status
              <select
                value={jobState}
                onChange={(e) => {
                  setJobs(null);
                  setJobState(e.target.value as typeof jobState);
                }}
              >
                <option value="failed">Needs attention</option>
                <option value="queued">Queued</option>
                <option value="running">Running</option>
              </select>
            </label>
          </div>
          {jobs?.items.map((job) => (
            <div className="course-row" key={job.jobId}>
              <div>
                <strong>{job.kind.replaceAll("_", " ")}</strong>
                <p className="course-meta">
                  {job.state} · {Math.max(0, job.nextOrdinal - 1)} sessions processed
                </p>
                <p className="course-meta">
                  {job.attempts} attempts{job.lastError ? `: ${job.lastError}` : ""}
                </p>
              </div>
              {job.state === "failed" && (
                <button
                  className="course-button secondary"
                  disabled={action.busy}
                  onClick={() =>
                    void action
                      .run(
                        `retry:${job.jobId}`,
                        (requestId) => courseApi.retryJob({ jobId: job.jobId, requestId }),
                        "Task queued for retry.",
                      )
                      .then((result) => {
                        if (result) void load();
                      })
                  }
                >
                  Retry task
                </button>
              )}
            </div>
          ))}
          {jobs?.items.length === 0 && (
            <div className="course-empty-state">
              <h3>
                {jobState === "failed" ? "No processing issues" : "No tasks with this status"}
              </h3>
              <p>
                {jobState === "failed"
                  ? "There are no failed tasks waiting for your attention."
                  : "Refresh this list to check for updates."}
              </p>
            </div>
          )}
        </>
      )}
      {loading && !activePage && !inspecting && tab !== "incidents" && (
        <CourseLoading
          label={
            tab === "requests"
              ? "Loading enrolment requests"
              : tab === "jobs"
                ? "Loading processing tasks"
                : "Loading courses"
          }
        />
      )}
      {cursor && !inspecting && (
        <button
          className="course-button secondary"
          disabled={loading}
          onClick={() => void load(cursor)}
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
