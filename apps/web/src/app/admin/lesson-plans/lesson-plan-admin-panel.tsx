"use client";

import { useState, type FormEvent } from "react";

import {
  approveLessonPlan,
  getLessonPlan,
  type LessonPlanView,
} from "../../../lib/lesson-planning-client";

function statusLabel(status: LessonPlanView["plan"]["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function activityLabel(view: LessonPlanView, techniqueId: string | null, kind: string): string {
  if (techniqueId) {
    return (
      view.library.techniques.find((technique) => technique.techniqueId === techniqueId)?.label ??
      "Technique activity"
    );
  }
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function LessonPlanAdminPanel({ canApprove }: { canApprove: boolean }) {
  const [planId, setPlanId] = useState("");
  const [view, setView] = useState<LessonPlanView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setView(await getLessonPlan(planId.trim()));
    } catch {
      setView(undefined);
      setError("Unable to load the lesson plan. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function approve(): Promise<void> {
    if (!view || busy) return;
    setBusy(true);
    setError("");
    try {
      const plan = await approveLessonPlan(planId.trim(), view.library);
      setView({ ...view, plan });
    } catch {
      setError("Unable to approve the lesson plan. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="family-admin-card" aria-labelledby="lesson-plan-panel-title">
      <div className="admin-section-header">
        <div>
          <p className="admin-eyebrow">Versioned teaching content</p>
          <h3 id="lesson-plan-panel-title">Lesson plan review</h3>
        </div>
      </div>
      <form className="family-admin-form" onSubmit={(event) => void load(event)}>
        <label className="family-field" htmlFor="lesson-plan-reference">
          Plan reference
          <input
            id="lesson-plan-reference"
            onChange={(event) => setPlanId(event.target.value)}
            value={planId}
          />
        </label>
        <button className="admin-auth-button family-submit" disabled={busy} type="submit">
          {busy ? "Loading lesson plan..." : "Load lesson plan"}
        </button>
      </form>

      {error ? (
        <p aria-live="assertive" className="family-message family-message-error" role="alert">
          {error}
        </p>
      ) : null}

      {view ? (
        <div className="family-created-card" data-testid="lesson-plan-review">
          <p className="admin-eyebrow">{statusLabel(view.plan.status)}</p>
          <h3>{view.plan.title}</h3>
          <ul className="admin-action-list">
            {view.plan.activities.map((activity) => (
              <li key={activity.activityId}>
                <span>{activityLabel(view, activity.techniqueId, activity.kind)}</span>
                <small>{activity.durationMinutes} minutes</small>
              </li>
            ))}
          </ul>
          {canApprove && view.plan.status === "submitted" ? (
            <button
              className="admin-auth-button family-submit"
              disabled={busy}
              onClick={() => void approve()}
              type="button"
            >
              {busy ? "Approving lesson plan..." : "Approve lesson plan"}
            </button>
          ) : null}
          {view.plan.status === "approved" ? (
            <p className="family-message family-message-success" role="status">
              Approved
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
