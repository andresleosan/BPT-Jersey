"use client";
import { useEffect, useState } from "react";
import { courseApi, courseError } from "../../../lib/courses/course-client";
import { CourseLoading } from "../../courses/course-ui";
import { courseDate } from "../../../lib/courses/course-public-client";
export function CourseIncidents({ onReview }: { onReview: (enrolmentId: string) => void }) {
  const [page, setPage] = useState<Awaited<ReturnType<typeof courseApi.incidents>> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function load(cursor?: string) {
    setLoading(true);
    setError("");
    try {
      const p = await courseApi.incidents({ openOnly: true, ...(cursor ? { cursor } : {}) });
      setPage((old) => ({ ...p, items: cursor ? [...(old?.items ?? []), ...p.items] : p.items }));
    } catch (e) {
      setError(courseError(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const refresh = () => {
      void load();
    };
    window.addEventListener("bpt-course-update", refresh);
    return () => window.removeEventListener("bpt-course-update", refresh);
  }, []);
  return (
    <section>
      <h3>Payments needing a decision</h3>
      <p>Late payments and cancelled courses remain here until the office records an outcome.</p>
      <button className="course-link" disabled={loading} onClick={() => void load()}>
        Refresh incidents
      </button>
      {error && (
        <p role="alert" className="course-error">
          {error}
        </p>
      )}
      <ul className="course-list" hidden={!page?.items.length}>
        {page?.items.map((i) => (
          <li className="course-row" key={i.incidentId}>
            <div>
              <strong>
                {i.participantName} · {i.courseTitle}
              </strong>
              <p>
                {i.reason.replaceAll("_", " ")} · {i.reference}
              </p>
              <p className="course-meta">{courseDate(i.createdAt)}</p>
            </div>
            <button className="course-button secondary" onClick={() => onReview(i.enrolmentId)}>
              Review payment incident
            </button>
          </li>
        ))}
      </ul>
      {page?.items.length === 0 && (
        <div className="course-empty-state">
          <h3>No payments need attention</h3>
          <p>Late transfers and other payment incidents will appear here for review.</p>
        </div>
      )}
      {loading && !page && <CourseLoading label="Loading payment incidents" />}
      {page?.cursor && (
        <button
          className="course-button secondary"
          disabled={loading}
          onClick={() => void load(page.cursor!)}
        >
          Load more incidents
        </button>
      )}
    </section>
  );
}
