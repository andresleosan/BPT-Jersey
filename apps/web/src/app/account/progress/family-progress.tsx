"use client";

import { useEffect, useState } from "react";
import type { StudentProgressSummary } from "@bpt-jersey/domain/levels";

import { getFamily } from "../../../lib/family-client";
import { getStudentProgressSummary } from "../../../lib/levels-client";
import "./progress.css";

type ChildProgress = Readonly<{
  studentId: string;
  fullName: string;
  progress: StudentProgressSummary | undefined;
}>;

type PanelState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "empty" }>
  | Readonly<{ status: "ready"; children: readonly ChildProgress[] }>
  | Readonly<{ status: "error" }>;

function formatHours(hours: number): string {
  return `${Math.round(hours * 10) / 10} h`;
}

/**
 * A guardian's read-only view of their children's canonical progress. The roster comes from the
 * guardian family projection and every summary is read per child through
 * `getStudentProgressSummary`, which the backend authorizes against an active guardian
 * relationship. No peer comparison is rendered: minors are never compared.
 */
export function FamilyProgressPanel() {
  const [state, setState] = useState<PanelState>({ status: "loading" });

  useEffect(() => {
    let mounted = true;

    const load = async (): Promise<PanelState> => {
      const family = await getFamily();
      if (family === undefined || !("tutor" in family)) return { status: "empty" };
      const roster = family.students.filter(
        (student) => student.active && student.status === "active",
      );
      if (roster.length === 0) return { status: "empty" };
      const children = await Promise.all(
        roster.map(async (student) => ({
          studentId: student.studentId,
          fullName: student.fullName,
          progress: await getStudentProgressSummary(student.studentId).catch(() => undefined),
        })),
      );
      return { status: "ready", children: Object.freeze(children) };
    };

    void load()
      .then((next) => {
        if (mounted) setState(next);
      })
      .catch(() => {
        if (mounted) setState({ status: "error" });
      });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <section className="peer-comparison-container" aria-labelledby="family-progress-heading">
      <div className="peer-comparison-header">
        <h2 id="family-progress-heading" className="peer-comparison-title">
          Your family&apos;s progress
        </h2>
        <p className="peer-comparison-subtitle">
          Attendance, time on the mat and skill checklist for each child linked to your account, as
          recorded by their coaches. Belts and stripes are proposals until the head coach approves
          them.
        </p>
      </div>

      {state.status === "loading" ? (
        <p role="status">Loading your family&apos;s progress…</p>
      ) : state.status === "error" ? (
        <p role="alert" className="peer-comparison-subtitle">
          Unable to load your family&apos;s progress right now. Please try again later.
        </p>
      ) : state.status === "empty" ? (
        <p role="status" className="peer-comparison-subtitle">
          No active child is linked to your account yet.
        </p>
      ) : (
        <div className="peer-comparison-stack" data-testid="family-progress-children">
          {state.children.map((child) => (
            <article className="peer-card" key={child.studentId}>
              <div className="peer-info-left">
                <div className="peer-details">
                  <span className="peer-name">{child.fullName}</span>
                  {child.progress === undefined ? (
                    <span className="peer-comparison-subtitle" role="alert">
                      Unable to load this child&apos;s progress right now.
                    </span>
                  ) : child.progress.state === "uninitialized" ? (
                    <span className="peer-comparison-subtitle">
                      Level record not opened yet. A head coach sets the starting belt after the
                      first classes; attendance is already being recorded.
                    </span>
                  ) : (
                    <span className="peer-rank-row">
                      {child.progress.currentDefinition.name} →{" "}
                      {child.progress.targetDefinition?.name ?? "Top of the catalog"}
                    </span>
                  )}
                </div>
              </div>

              {child.progress !== undefined && child.progress.state === "initialized" ? (
                <div
                  className="peer-stats-right"
                  data-testid={`family-progress-stats-${child.studentId}`}
                >
                  <div className="peer-stat-box">
                    <span className="peer-stat-label">Classes attended</span>
                    <span className="peer-stat-value">
                      {child.progress.totalAttendedClasses}
                      {child.progress.criteria.classes.required === null
                        ? ""
                        : ` / ${child.progress.criteria.classes.required} towards the next level`}
                    </span>
                  </div>
                  <div className="peer-stat-box">
                    <span className="peer-stat-label">Time on the mat</span>
                    <span className="peer-stat-value">
                      {formatHours(child.progress.totalHours)}
                    </span>
                  </div>
                  <div className="peer-stat-box">
                    <span className="peer-stat-label">Skills completed</span>
                    <span className="peer-stat-value">
                      {child.progress.criteria.skills.completed} /{" "}
                      {child.progress.criteria.skills.total}
                    </span>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}

      <p className="peer-comparison-subtitle">
        Children are never compared with other members. Comparison is available only to adults who
        opt in and is not enabled in the pilot.
      </p>
    </section>
  );
}
