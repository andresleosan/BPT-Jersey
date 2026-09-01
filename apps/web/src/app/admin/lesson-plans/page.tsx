"use client";

import { useAdminOrStaffSession } from "../admin-gate";
import { LessonPlanAdminPanel } from "./lesson-plan-admin-panel";

export default function LessonPlansAdminRoute() {
  const session = useAdminOrStaffSession();

  return (
    <section className="admin-module-page family-admin-page" aria-labelledby="lesson-plans-title">
      <header className="admin-section-header">
        <div>
          <p className="admin-eyebrow">Levels / Curriculum control</p>
          <h2 id="lesson-plans-title">Lesson plans</h2>
          <p>
            Review the published technique version before a head coach approves a submitted plan.
          </p>
        </div>
      </header>
      <LessonPlanAdminPanel canApprove={session.role === "headCoach"} />
    </section>
  );
}
