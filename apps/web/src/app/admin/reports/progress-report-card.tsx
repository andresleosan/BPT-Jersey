"use client";

import { useEffect, useState } from "react";
import type { ProgressReport } from "@bpt-jersey/domain/levels";
import { getProgressReport } from "../../../lib/levels-client";

function ReportMetric({ label, value }: Readonly<{ label: string; value: string | number }>) {
  return (
    <div className="admin-progress-report-metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function ProgressReportCard() {
  const [report, setReport] = useState<ProgressReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function loadReport(): void {
    setLoading(true);
    setError(null);
    void getProgressReport()
      .then((nextReport) => {
        setReport(nextReport);
        setLoading(false);
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Unable to load progress report.");
        setLoading(false);
      });
  }

  useEffect(() => {
    let cancelled = false;

    void getProgressReport()
      .then((nextReport) => {
        if (cancelled) return;
        setReport(nextReport);
        setError(null);
        setLoading(false);
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "Unable to load progress report.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <article
      className="admin-panel-card admin-progress-report-card"
      aria-label="Progress coverage report"
    >
      <p className="admin-eyebrow">Progress / Live aggregate</p>
      <h3>Progress coverage</h3>
      <p>Assessment coverage and promotion readiness from active students only.</p>

      {loading && (
        <p className="admin-report-state" role="status" aria-live="polite">
          Loading progress coverage...
        </p>
      )}

      {error && !loading && (
        <div className="admin-report-state" role="alert">
          <p>{error}</p>
          <button className="admin-home-link" onClick={loadReport} type="button">
            Retry progress report
          </button>
        </div>
      )}

      {report && !loading && !error && (
        <>
          <dl className="admin-progress-report-metrics" aria-label="Progress report metrics">
            <ReportMetric label="Active students" value={report.activeStudentCount} />
            <ReportMetric
              label="Assessment coverage"
              value={`${report.assessmentCoveragePercentage}%`}
            />
            <ReportMetric label="Recognition candidates" value={report.recognitionCandidateCount} />
            <ReportMetric label="Ready for review" value={report.eligibleForPromotionCount} />
          </dl>

          <div className="admin-progress-report-detail-grid">
            <section aria-labelledby="progress-level-breakdown-title">
              <h4 id="progress-level-breakdown-title">By current level</h4>
              {report.levelBreakdown.length === 0 ? (
                <p className="admin-report-muted">No active students to report.</p>
              ) : (
                <ul className="admin-progress-report-list">
                  {report.levelBreakdown.map((level) => (
                    <li key={level.definitionKey}>
                      <span>{level.definitionName}</span>
                      <strong>{level.studentCount}</strong>
                      <small>{level.assessedStudentCount} assessed</small>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="progress-skill-coverage-title">
              <h4 id="progress-skill-coverage-title">Skill assessment coverage</h4>
              {report.skillCoverage.length === 0 ? (
                <p className="admin-report-muted">No skills in the published catalog.</p>
              ) : (
                <ul className="admin-progress-report-list">
                  {report.skillCoverage.map((skill) => (
                    <li key={skill.skillKey}>
                      <span>{skill.displayLabel}</span>
                      <strong>{skill.coveragePercentage}%</strong>
                      <small>{skill.assessedStudentCount} assessed</small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </article>
  );
}
