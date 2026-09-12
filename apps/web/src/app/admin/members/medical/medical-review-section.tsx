"use client";

import { useState, type FormEvent } from "react";

import {
  getHealthAdminProfile,
  listHealthReferences,
  saveHealthProfile,
  type HealthReferenceRow,
} from "../../../../lib/health-client";

export function MedicalReviewSection() {
  const [studentId, setStudentId] = useState("");
  const [referenceLabel, setReferenceLabel] = useState("");
  const [conditionSummary, setConditionSummary] = useState("");
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
        setReferenceLabel(profile.staffReferenceLabel ?? "");
        setConditionSummary(profile.conditionSummary ?? "");
        setSuccess(`Loaded medical record for student ${id}.`);
      } else {
        setReferenceLabel("");
        setConditionSummary("");
        setSuccess(`No existing medical profile for student ${id}. You may assign one below.`);
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

  async function handleSave(e: FormEvent) {
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
      await saveHealthProfile({
        studentId: id,
        minimumOperationalSupport: ["none"],
        conditionSummary: conditionSummary.trim() || null,
        staffReferenceLabel: label || null,
        expiresAt: null,
      });
      setSuccess(`Staff reference label updated for student ${id}.`);
    } catch {
      setError("Unable to save staff reference. Please try again.");
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
    void loadProfile(row.studentId);
  }

  return (
    <section className="admin-panel-card" aria-labelledby="medical-review-title">
      <div className="admin-panel-card-heading">
        <div>
          <p className="admin-eyebrow">Safeguarding & Support</p>
          <h3 id="medical-review-title">Medical Conditions & Staff Reference Review</h3>
        </div>
      </div>
      <p className="admin-medical-intro">
        Review declared medical conditions for students and assign a short staff reference label
        (max 25 characters) for mat coaches.
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
        <button className="admin-auth-button" disabled={loading || !studentId.trim()} type="submit">
          {loading ? "Checking..." : "Look up Medical Record"}
        </button>
      </form>

      <form className="admin-medical-form" onSubmit={handleSave}>
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

        <label className="admin-filter-control admin-medical-field" htmlFor="medical-summary">
          Condition summary (max 1000 characters)
          <textarea
            id="medical-summary"
            maxLength={1000}
            onChange={(e) => setConditionSummary(e.target.value)}
            placeholder="Operational notes regarding member medical conditions or emergency precautions."
            rows={3}
            value={conditionSummary}
          />
        </label>

        <div>
          <button
            className="button button-primary text-sm"
            disabled={saving || !studentId.trim()}
            type="submit"
          >
            {saving ? "Saving..." : "Save Staff Reference Label"}
          </button>
        </div>
      </form>

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
