"use client";

import { useState, type FormEvent } from "react";

import {
  getHealthAdminProfile,
  listHealthReferences,
  saveHealthReferenceLabel,
  type HealthReferenceRow,
} from "../../../../lib/health-client";
import { useAdminOrStaffSession } from "../../admin-gate";

export function MedicalReviewSection() {
  const session = useAdminOrStaffSession();
  // ADR-010: the mat retypes the 25-character label; the medical record stays with the office.
  const office = session.role === "owner" || session.role === "administrator";
  const [studentId, setStudentId] = useState("");
  const [referenceLabel, setReferenceLabel] = useState("");
  const [historicalProfile, setHistoricalProfile] = useState<
    | Readonly<{ conditionSummary: string | null; staffReferenceLabel: string | null }>
    | null
    | undefined
  >(undefined);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [references, setReferences] = useState<
    | Readonly<{ status: "hidden" }>
    | Readonly<{ status: "loading" }>
    | Readonly<{ status: "ready"; rows: readonly HealthReferenceRow[] }>
    | Readonly<{ status: "error"; message: string }>
  >({ status: "hidden" });

  async function loadProfile(id: string): Promise<void> {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const profile = await getHealthAdminProfile(id);
      if (profile) {
        setHistoricalProfile({
          conditionSummary: profile.conditionSummary ?? null,
          staffReferenceLabel: profile.staffReferenceLabel ?? null,
        });
        setSuccess(`Loaded historical medical record for student ${id}.`);
      } else {
        setHistoricalProfile(null);
        setSuccess(`No historical medical profile exists for student ${id}.`);
      }
    } catch {
      setError("Unable to load student health record. Check student ID.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLoad(e: FormEvent) {
    e.preventDefault();
    const id = studentId.trim();
    if (id) await loadProfile(id);
  }

  async function handleSaveLabel(e: FormEvent) {
    e.preventDefault();
    const id = studentId.trim();
    if (!id) return;
    const label = referenceLabel.trim();
    if (label.length > 25) {
      setError("Staff reference label must be 25 characters or fewer.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await saveHealthReferenceLabel(id, label || null);
      setSuccess(`Reference label saved for student ${id}.`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to save the reference label. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleReferences(): Promise<void> {
    if (references.status === "ready") {
      setReferences({ status: "hidden" });
      return;
    }
    setReferences({ status: "loading" });
    try {
      const rows = await listHealthReferences();
      setReferences({
        status: "ready",
        rows: [...rows].sort((a, b) => a.displayName.localeCompare(b.displayName)),
      });
    } catch (error) {
      setReferences({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to load the reference labels. Please try again.",
      });
    }
  }

  function selectReference(row: HealthReferenceRow): void {
    setStudentId(row.studentId);
    if (office) {
      void loadProfile(row.studentId);
      return;
    }
    setReferenceLabel(row.staffReferenceLabel);
    setError("");
    setSuccess("");
  }

  return (
    <section className="admin-panel-card" aria-labelledby="medical-review-title">
      <div className="admin-panel-card-heading">
        <div>
          <p className="admin-eyebrow">Safeguarding &amp; Support</p>
          <h3 id="medical-review-title">Medical Conditions &amp; Staff Reference Review</h3>
        </div>
      </div>
      <p className="admin-medical-intro">
        {office
          ? "Historical medical declarations are read-only and visible to office roles only. Operational coach labels remain separate."
          : "Maintain the short staff reference label (max 25 characters) coaches read on the mat. Declared medical conditions stay with the office."}
      </p>

      {error && (
        <p aria-live="assertive" className="login-message login-message-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p aria-live="polite" className="login-message" role="status">
          {success}
        </p>
      )}

      {office ? (
        <form className="admin-medical-form" onSubmit={handleLoad}>
          <label className="admin-filter-control admin-medical-field" htmlFor="medical-student-id">
            Student ID
            <input
              id="medical-student-id"
              onChange={(e) => setStudentId(e.target.value)}
              placeholder="e.g. stu_12345"
              required
              type="text"
              value={studentId}
            />
          </label>
          <button
            className="admin-auth-button"
            disabled={loading || !studentId.trim()}
            type="submit"
          >
            {loading ? "Checking..." : "Look up Medical Record"}
          </button>
        </form>
      ) : null}

      {office ? (
        historicalProfile ? (
          <section className="admin-medical-form" aria-labelledby="historical-medical-title">
            <h4 id="historical-medical-title">Historical medical record</h4>
            <dl>
              <div>
                <dt>Condition summary</dt>
                <dd>{historicalProfile.conditionSummary ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>Staff reference label</dt>
                <dd>{historicalProfile.staffReferenceLabel ?? "Not recorded"}</dd>
              </div>
            </dl>
          </section>
        ) : null
      ) : (
        <form className="admin-medical-form" onSubmit={handleSaveLabel}>
          <label className="admin-filter-control admin-medical-field" htmlFor="medical-student-id">
            Student ID
            <input
              id="medical-student-id"
              onChange={(e) => setStudentId(e.target.value)}
              placeholder="e.g. stu_12345"
              required
              type="text"
              value={studentId}
            />
          </label>
          <label className="admin-filter-control admin-medical-field" htmlFor="medical-ref-label">
            Staff reference label (max 25 characters)
            <input
              id="medical-ref-label"
              maxLength={25}
              onChange={(e) => setReferenceLabel(e.target.value)}
              placeholder="e.g. ASTHMA-INHALER, KNEE-BRACE"
              type="text"
              value={referenceLabel}
            />
            <span className="admin-medical-count">{referenceLabel.length} / 25 characters</span>
          </label>
          <div>
            <button
              className="button button-primary text-sm"
              disabled={saving || !studentId.trim()}
              type="submit"
            >
              {saving ? "Saving..." : "Save reference label"}
            </button>
          </div>
        </form>
      )}

      <div className="admin-medical-references">
        <button
          className="button button-secondary"
          disabled={references.status === "loading"}
          onClick={() => void toggleReferences()}
          type="button"
        >
          {references.status === "loading"
            ? "Loading references..."
            : references.status === "ready"
              ? "Hide references"
              : "Show all references"}
        </button>
        {references.status === "error" ? (
          <p className="login-message login-message-error" role="alert">
            {references.message}
          </p>
        ) : null}
        {references.status === "ready" && references.rows.length === 0 ? (
          <p className="admin-empty-state">No reference labels recorded yet.</p>
        ) : null}
        {references.status === "ready" && references.rows.length > 0 ? (
          <table className="admin-medical-table" aria-label="Staff reference labels">
            <thead>
              <tr>
                <th scope="col">Student</th>
                <th scope="col">Reference</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {references.rows.map((row) => (
                <tr key={row.studentId}>
                  <td>{row.displayName}</td>
                  <td>{row.staffReferenceLabel}</td>
                  <td>
                    <button
                      aria-label={`Use ${row.studentId}`}
                      onClick={() => selectReference(row)}
                      type="button"
                    >
                      Use
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
}
