"use client";

import { useEffect, useState } from "react";
import type { StudentProgressSummary } from "@bpt-jersey/domain/levels";

import { getStudentProgressSummary } from "../../../lib/levels-client";
import "./progress.css";

type PanelState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; progress: StudentProgressSummary }>
  | Readonly<{ status: "error" }>;

function formatHours(hours: number): string {
  return `${Math.round(hours * 10) / 10} h`;
}

/**
 * The signed-in adult's own progress, read from the canonical progress summary. Minors are never
 * shown here (guardians manage them from the family area) and no peer comparison is rendered:
 * comparison is restricted to adults who opt in, and no opt-in exists in the pilot.
 */
export function OwnProgressPanel() {
  const [state, setState] = useState<PanelState>({ status: "loading" });

  useEffect(() => {
    let mounted = true;
    void getStudentProgressSummary()
      .then((progress) => {
        if (mounted) setState({ status: "ready", progress });
      })
      .catch(() => {
        if (mounted) setState({ status: "error" });
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <section className="peer-comparison-container" aria-labelledby="own-progress-heading">
      <div className="peer-comparison-header">
        <h2 id="own-progress-heading" className="peer-comparison-title">
          Your progress
        </h2>
        <p className="peer-comparison-subtitle">
          Attendance, time on the mat and skill checklist as recorded by your coaches. Belts and
          stripes are proposals until the head coach approves them.
        </p>
      </div>

      {state.status === "loading" ? (
        <p role="status">Loading your progress…</p>
      ) : state.status === "error" ? (
        <p role="alert" className="peer-comparison-subtitle">
          Unable to load your progress right now. Please try again later.
        </p>
      ) : state.progress.state === "uninitialized" ? (
        <p role="status" className="peer-comparison-subtitle">
          Your level record has not been opened yet. A head coach sets your starting belt after your
          first classes; attendance is already being recorded.
        </p>
      ) : (
        <div className="peer-stats-right" data-testid="own-progress-stats">
          <div className="peer-stat-box">
            <span className="peer-stat-label">Current level</span>
            <span className="peer-stat-value">{state.progress.currentDefinition.name}</span>
          </div>
          <div className="peer-stat-box">
            <span className="peer-stat-label">Next level</span>
            <span className="peer-stat-value">
              {state.progress.targetDefinition?.name ?? "Top of the catalog"}
            </span>
          </div>
          <div className="peer-stat-box">
            <span className="peer-stat-label">Classes attended</span>
            <span className="peer-stat-value">
              {state.progress.totalAttendedClasses}
              {state.progress.criteria.classes.required === null
                ? ""
                : ` / ${state.progress.criteria.classes.required} towards the next level`}
            </span>
          </div>
          <div className="peer-stat-box">
            <span className="peer-stat-label">Time on the mat</span>
            <span className="peer-stat-value">{formatHours(state.progress.totalHours)}</span>
          </div>
          <div className="peer-stat-box">
            <span className="peer-stat-label">Skills completed</span>
            <span className="peer-stat-value">
              {state.progress.criteria.skills.completed} / {state.progress.criteria.skills.total}
            </span>
          </div>
        </div>
      )}

      <p className="peer-comparison-subtitle">
        Comparison with other members is available only to adults who opt in and is not enabled in
        the pilot.
      </p>
    </section>
  );
}
