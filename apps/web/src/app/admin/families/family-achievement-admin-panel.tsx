"use client";

import { useState } from "react";

import { getFamilyAchievementSummary } from "../../../lib/family-achievement-client";
import type { AchievementMetric, FamilyAchievementSummary } from "@bpt-jersey/domain";

type FamilyAchievementAdminPanelProps = Readonly<{
  familyId: string;
  instanceId: string;
}>;

const metricLabels: Readonly<Record<AchievementMetric, string>> = {
  classes_attended: "classes attended",
  current_streak_weeks: "current streak weeks",
  longest_streak_weeks: "longest streak weeks",
};

function progressLabel(metric: AchievementMetric, progress: number, target: number): string {
  return `${progress} / ${target} ${metricLabels[metric]}`;
}

function SummaryContent({ summary }: { summary: FamilyAchievementSummary }) {
  return (
    <div className="family-achievement-summary">
      <div className="family-achievement-meta">
        <span>Active family members</span>
        <strong>{summary.members.length}</strong>
      </div>

      {summary.members.length === 0 ? (
        <p className="health-admin-muted">No active members are included in this snapshot.</p>
      ) : (
        <div className="family-achievement-members">
          {summary.members.map((member) => (
            <article className="family-achievement-member" key={member.studentId}>
              <div className="family-achievement-member-heading">
                <div>
                  <p className="admin-eyebrow">
                    {member.participantType === "adult" ? "Adult" : "Minor"}
                  </p>
                  <h4>{member.displayName}</h4>
                </div>
              </div>

              <ul className="family-achievement-goals">
                {member.goals.map((goal) => (
                  <li key={goal.goalId}>
                    <span>{goal.label}</span>
                    <strong>{progressLabel(goal.metric, goal.progress, goal.target)}</strong>
                    <em>{goal.status === "complete" ? "Complete" : "In progress"}</em>
                  </li>
                ))}
              </ul>

              {member.achievementCandidates.length > 0 ? (
                <div className="family-achievement-candidates">
                  <p className="admin-eyebrow">Recognition candidates</p>
                  <ul>
                    {member.achievementCandidates.map((candidate) => (
                      <li key={candidate.achievementId}>{candidate.label}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}

      <p className="family-achievement-disclaimer">
        Candidates are for staff review only. No award or promotion is applied automatically.
      </p>

      {summary.adultComparison.length > 0 ? (
        <p className="family-achievement-comparison">
          Adult comparison includes {summary.adultComparison.length} opted-in member
          {summary.adultComparison.length === 1 ? "" : "s"}.
        </p>
      ) : null}
    </div>
  );
}

export function FamilyAchievementAdminPanel({
  familyId,
  instanceId,
}: FamilyAchievementAdminPanelProps) {
  const [opened, setOpened] = useState(false);
  const [summary, setSummary] = useState<FamilyAchievementSummary | undefined>();
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");

  async function loadSummary(): Promise<void> {
    setOpened(true);
    setLoadState("loading");
    setError("");
    try {
      setSummary(await getFamilyAchievementSummary(familyId));
      setLoadState("ready");
    } catch {
      setLoadState("error");
      setError("Unable to load family achievements. Please try again.");
    }
  }

  return (
    <section className="family-achievement-admin-panel" aria-labelledby={instanceId}>
      <div className="family-achievement-heading">
        <div>
          <p className="admin-eyebrow">Family progress</p>
          <h3 id={instanceId}>Achievements snapshot</h3>
        </div>
        {!opened ? (
          <button className="family-text-button" onClick={() => void loadSummary()} type="button">
            Open achievement summary
          </button>
        ) : null}
      </div>

      {loadState === "loading" ? (
        <p aria-busy="true" className="health-admin-muted">
          Loading achievement summary...
        </p>
      ) : null}
      {loadState === "error" ? (
        <p className="family-message family-message-error" role="alert">
          {error}
        </p>
      ) : null}
      {loadState === "ready" && summary ? <SummaryContent summary={summary} /> : null}
    </section>
  );
}
