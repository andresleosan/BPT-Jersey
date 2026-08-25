"use client";

import { useRef, useState, type FormEvent } from "react";

import { createFamily, type CreateFamilyClientInput } from "../../../lib/family-client";
import { HealthSupportAdminPanel } from "./health-support-admin-panel";

import "../admin.css";

type Preference = "morning" | "afternoon" | "evening";
type MinorRow = Readonly<{
  id: number;
  fullName: string;
  dateOfBirth: string;
  trainingCenter: "Town" | "West";
  trainingTimePreferences: readonly Preference[];
}>;

const preferenceOptions: readonly { value: Preference; label: string }[] = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
];

function newMinor(id: number): MinorRow {
  return {
    id,
    fullName: "",
    dateOfBirth: "",
    trainingCenter: "Town",
    trainingTimePreferences: [],
  };
}

export function FamilyAdminPage() {
  const [tutorUserId, setTutorUserId] = useState("");
  const [rows, setRows] = useState<readonly MinorRow[]>([newMinor(1)]);
  const [createdFamily, setCreatedFamily] = useState<
    Awaited<ReturnType<typeof createFamily>> | undefined
  >();
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<
    Readonly<{
      tutor?: string;
      minors: Readonly<Record<number, string>>;
    }>
  >({ minors: {} });
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(2);
  const tutorRef = useRef<HTMLInputElement>(null);

  function updateRow(id: number, update: Partial<MinorRow>): void {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...update } : row)));
  }

  function togglePreference(id: number, preference: Preference): void {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id) return row;
        const preferences = row.trainingTimePreferences.includes(preference)
          ? row.trainingTimePreferences.filter((value) => value !== preference)
          : [...row.trainingTimePreferences, preference];
        return { ...row, trainingTimePreferences: preferences };
      }),
    );
  }

  function addMinor(): void {
    setRows((current) => [...current, newMinor(nextId.current++)]);
  }

  function removeMinor(id: number): void {
    setRows((current) => (current.length === 1 ? current : current.filter((row) => row.id !== id)));
  }

  function validate(): boolean {
    const minors: Record<number, string> = {};
    if (!tutorUserId.trim()) {
      minors[-1] = "Tutor user ID is required.";
    }
    for (const row of rows) {
      if (!row.fullName.trim()) minors[row.id] = "Minor full name is required.";
      else if (!row.dateOfBirth) minors[row.id] = "Date of birth is required.";
      else if (row.trainingTimePreferences.length === 0) {
        minors[row.id] = "Choose at least one training time.";
      }
    }
    const tutorError = minors[-1];
    delete minors[-1];
    const valid = tutorError === undefined && Object.keys(minors).length === 0;
    setFieldErrors({ ...(tutorError === undefined ? {} : { tutor: tutorError }), minors });
    if (!valid && tutorError !== undefined) tutorRef.current?.focus();
    return valid;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !validate()) return;
    setError("");
    setFieldErrors({ minors: {} });
    setStatus("");
    setBusy(true);
    const input: CreateFamilyClientInput = {
      tutorUserId: tutorUserId.trim(),
      students: rows.map((row) => ({
        fullName: row.fullName.trim(),
        dateOfBirth: row.dateOfBirth,
        trainingCenter: row.trainingCenter,
        trainingTimePreferences: row.trainingTimePreferences,
      })),
    };
    try {
      const result = await createFamily(input);
      setCreatedFamily(result);
      setStatus("Family created.");
    } catch {
      setError("Unable to create the family. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-module-page family-admin-page" aria-labelledby="family-admin-title">
      <header className="admin-section-header">
        <div>
          <p className="admin-eyebrow">Families / Connected records</p>
          <h2 id="family-admin-title">Family management</h2>
          <p>Link one existing tutor to one or more minors without exposing restricted records.</p>
        </div>
      </header>

      <form className="family-admin-form" noValidate onSubmit={(event) => void handleSubmit(event)}>
        <div className="family-admin-card">
          <p className="admin-eyebrow">Adult contact</p>
          <h3>Tutor account</h3>
          <label className="family-field" htmlFor="family-tutor-user-id">
            Tutor user ID
            <input
              id="family-tutor-user-id"
              name="tutorUserId"
              onChange={(event) => setTutorUserId(event.target.value)}
              ref={tutorRef}
              value={tutorUserId}
            />
            {fieldErrors.tutor ? (
              <span className="family-field-error" role="alert">
                {fieldErrors.tutor}
              </span>
            ) : null}
          </label>
        </div>

        <fieldset className="family-admin-card family-minors-fieldset">
          <legend>Minors in this family</legend>
          <p className="family-helper">Add every child who belongs to this tutor before saving.</p>
          <div className="family-minor-list">
            {rows.map((row, index) => (
              <article className="family-minor-row" key={row.id}>
                <div className="family-minor-row-heading">
                  <h3>Minor {index + 1}</h3>
                  <button
                    className="family-text-button"
                    disabled={rows.length === 1}
                    onClick={() => removeMinor(row.id)}
                    type="button"
                  >
                    Remove minor
                  </button>
                </div>
                <label className="family-field" htmlFor={`minor-${row.id}-name`}>
                  Minor full name
                  <input
                    id={`minor-${row.id}-name`}
                    onChange={(event) => updateRow(row.id, { fullName: event.target.value })}
                    value={row.fullName}
                  />
                  {fieldErrors.minors[row.id]?.includes("full name") ? (
                    <span className="family-field-error" role="alert">
                      {fieldErrors.minors[row.id]}
                    </span>
                  ) : null}
                </label>
                <label className="family-field" htmlFor={`minor-${row.id}-date`}>
                  Date of birth
                  <input
                    id={`minor-${row.id}-date`}
                    onChange={(event) => updateRow(row.id, { dateOfBirth: event.target.value })}
                    type="date"
                    value={row.dateOfBirth}
                  />
                  {fieldErrors.minors[row.id] &&
                  !fieldErrors.minors[row.id]?.includes("full name") ? (
                    <span className="family-field-error" role="alert">
                      {fieldErrors.minors[row.id]}
                    </span>
                  ) : null}
                </label>
                <label className="family-field" htmlFor={`minor-${row.id}-center`}>
                  Training center
                  <select
                    id={`minor-${row.id}-center`}
                    onChange={(event) =>
                      updateRow(row.id, { trainingCenter: event.target.value as "Town" | "West" })
                    }
                    value={row.trainingCenter}
                  >
                    <option value="Town">Town</option>
                    <option value="West">West</option>
                  </select>
                </label>
                <fieldset className="family-preferences">
                  <legend>Training time preferences</legend>
                  <div className="family-preference-list">
                    {preferenceOptions.map((option) => (
                      <label className="family-preference" key={option.value}>
                        <input
                          checked={row.trainingTimePreferences.includes(option.value)}
                          onChange={() => togglePreference(row.id, option.value)}
                          type="checkbox"
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </article>
            ))}
          </div>
          <button className="family-add-button" onClick={addMinor} type="button">
            Add another minor
          </button>
        </fieldset>

        {error ? (
          <p aria-live="assertive" className="family-message family-message-error" role="alert">
            {error}
          </p>
        ) : null}
        {status ? (
          <p aria-live="polite" className="family-message family-message-success" role="status">
            {status}
          </p>
        ) : null}
        <button className="admin-auth-button family-submit" disabled={busy} type="submit">
          {busy ? "Creating family..." : "Create family"}
        </button>
      </form>

      {createdFamily ? (
        <section className="family-created-card" aria-labelledby="family-created-title">
          <p className="admin-eyebrow">Saved family</p>
          <h3 id="family-created-title">Connected children</h3>
          <ul>
            {createdFamily.students.map((student) => (
              <li key={student.studentId}>{student.fullName}</li>
            ))}
          </ul>
          <div className="health-admin-review-list">
            {createdFamily.students.map((student, index) => (
              <HealthSupportAdminPanel
                key={student.studentId}
                instanceId={"health-admin-" + (index + 1)}
                studentId={student.studentId}
                studentName={student.fullName}
              />
            ))}
          </div>
          <div className="family-operation-actions">
            <button className="family-text-button" disabled type="button">
              Replace tutor
            </button>
            <button className="family-text-button" disabled type="button">
              Deactivate family
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
}

export default function FamilyAdminRoute() {
  return <FamilyAdminPage />;
}
