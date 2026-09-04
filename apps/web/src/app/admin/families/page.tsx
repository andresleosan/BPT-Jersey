"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";

import {
  createFamily,
  getFamily,
  updateFamily,
  type CreateFamilyClientInput,
  type StaffFamilyProjection,
  type UpdateFamilyClientInput,
} from "../../../lib/family-client";
import { FamilyAchievementAdminPanel } from "./family-achievement-admin-panel";

import "../admin.css";

type Preference = "morning" | "afternoon" | "evening";
type MinorRow = Readonly<{
  id: number;
  fullName: string;
  dateOfBirth: string;
  trainingCenter: "Town" | "West";
  trainingTimePreferences: readonly Preference[];
}>;
type RequestAttempt = Readonly<{ fingerprint: string; requestId: string }>;
type MaintenancePanel = "replaceTutor" | "addStudent" | "deactivateFamily" | null;
type BusyOperation =
  | "create"
  | "load"
  | "replaceTutor"
  | "addStudent"
  | "deactivateFamily"
  | `deactivateRelationship:${string}`;

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

function newFamilyRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("Secure request identity is unavailable");
  }
  return globalThis.crypto.randomUUID();
}

function requestAttempt(current: RequestAttempt | null, fingerprint: string): RequestAttempt {
  return current?.fingerprint === fingerprint
    ? current
    : Object.freeze({ fingerprint, requestId: newFamilyRequestId() });
}

function minorDraftError(row: MinorRow): string | undefined {
  if (!row.fullName.trim()) return "Minor full name is required.";
  if (!row.dateOfBirth) return "Date of birth is required.";
  if (row.trainingTimePreferences.length === 0) return "Choose at least one training time.";
  return undefined;
}

export function FamilyAdminPage() {
  const [tutorUserId, setTutorUserId] = useState("");
  const [rows, setRows] = useState<readonly MinorRow[]>([newMinor(1)]);
  const [selectedFamily, setSelectedFamily] = useState<StaffFamilyProjection>();
  const [familyId, setFamilyId] = useState("");
  const [maintenancePanel, setMaintenancePanel] = useState<MaintenancePanel>(null);
  const [replacementTutorUserId, setReplacementTutorUserId] = useState("");
  const [newStudent, setNewStudent] = useState<MinorRow>(() => newMinor(0));
  const [newStudentError, setNewStudentError] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<
    Readonly<{
      tutor?: string;
      minors: Readonly<Record<number, string>>;
    }>
  >({ minors: {} });
  const [status, setStatus] = useState("");
  const [busyOperation, setBusyOperation] = useState<BusyOperation | null>(null);
  const [achievementFamilyId, setAchievementFamilyId] = useState("");
  const [reviewedFamilyId, setReviewedFamilyId] = useState("");
  const nextId = useRef(2);
  const createRequestAttempt = useRef<RequestAttempt | null>(null);
  const addStudentRequestAttempt = useRef<RequestAttempt | null>(null);
  const tutorRef = useRef<HTMLInputElement>(null);

  const busy = busyOperation !== null;

  function clearFeedback(): void {
    setError("");
    setStatus("");
  }

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

  function toggleNewStudentPreference(preference: Preference): void {
    setNewStudent((current) => ({
      ...current,
      trainingTimePreferences: current.trainingTimePreferences.includes(preference)
        ? current.trainingTimePreferences.filter((value) => value !== preference)
        : [...current.trainingTimePreferences, preference],
    }));
  }

  function addMinor(): void {
    setRows((current) => [...current, newMinor(nextId.current++)]);
  }

  function removeMinor(id: number): void {
    setRows((current) => (current.length === 1 ? current : current.filter((row) => row.id !== id)));
  }

  function validateCreate(): boolean {
    const minors: Record<number, string> = {};
    const tutorError = tutorUserId.trim() ? undefined : "Tutor user ID is required.";
    for (const row of rows) {
      const rowError = minorDraftError(row);
      if (rowError !== undefined) minors[row.id] = rowError;
    }
    const valid = tutorError === undefined && Object.keys(minors).length === 0;
    setFieldErrors({ ...(tutorError === undefined ? {} : { tutor: tutorError }), minors });
    if (!valid && tutorError !== undefined) tutorRef.current?.focus();
    return valid;
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !validateCreate()) return;
    const draft = {
      tutorUserId: tutorUserId.trim(),
      students: rows.map((row) => ({
        fullName: row.fullName.trim(),
        dateOfBirth: row.dateOfBirth,
        trainingCenter: row.trainingCenter,
        trainingTimePreferences: row.trainingTimePreferences,
      })),
    } as const;
    try {
      const attempt = requestAttempt(createRequestAttempt.current, JSON.stringify(draft));
      createRequestAttempt.current = attempt;
      clearFeedback();
      setFieldErrors({ minors: {} });
      setBusyOperation("create");
      const input: CreateFamilyClientInput = { requestId: attempt.requestId, ...draft };
      const result = await createFamily(input);
      setSelectedFamily(result);
      setMaintenancePanel(null);
      setStatus("Family created.");
      createRequestAttempt.current = null;
    } catch {
      setError("Unable to create the family. Please try again.");
    } finally {
      setBusyOperation(null);
    }
  }

  async function handleLoad(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const targetFamilyId = familyId.trim();
    clearFeedback();
    if (!targetFamilyId) {
      setError("Enter a family ID to load the record.");
      return;
    }
    setBusyOperation("load");
    try {
      const result = await getFamily(targetFamilyId);
      if (result === undefined) throw new Error("Family is unavailable");
      setSelectedFamily(result);
      setMaintenancePanel(null);
      setReplacementTutorUserId("");
      setNewStudent(newMinor(0));
      setNewStudentError("");
      addStudentRequestAttempt.current = null;
      setStatus("Family loaded.");
    } catch {
      setSelectedFamily(undefined);
      setError("Unable to load the family. Check the ID and try again.");
    } finally {
      setBusyOperation(null);
    }
  }

  async function runUpdate(
    operation: UpdateFamilyClientInput["operation"],
    operationKey: BusyOperation,
    successMessage: string,
    errorMessage: string,
  ): Promise<boolean> {
    if (busy || selectedFamily === undefined) return false;
    clearFeedback();
    setBusyOperation(operationKey);
    try {
      const result = await updateFamily({
        familyId: selectedFamily.family.familyId,
        operation,
      });
      setSelectedFamily(result);
      setStatus(successMessage);
      return true;
    } catch {
      setError(errorMessage);
      return false;
    } finally {
      setBusyOperation(null);
    }
  }

  function openMaintenancePanel(panel: Exclude<MaintenancePanel, null>): void {
    clearFeedback();
    setMaintenancePanel(panel);
    if (panel === "replaceTutor") setReplacementTutorUserId("");
    if (panel === "addStudent") {
      setNewStudent(newMinor(0));
      setNewStudentError("");
      addStudentRequestAttempt.current = null;
    }
  }

  function closeMaintenancePanel(): void {
    setMaintenancePanel(null);
    setNewStudentError("");
    addStudentRequestAttempt.current = null;
  }

  async function handleReplaceTutor(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const nextTutorUserId = replacementTutorUserId.trim();
    if (!nextTutorUserId) {
      setError("Enter the new tutor user ID.");
      return;
    }
    const updated = await runUpdate(
      { kind: "replaceTutor", tutorUserId: nextTutorUserId },
      "replaceTutor",
      "Tutor replaced.",
      "Unable to replace the tutor. Please try again.",
    );
    if (updated) {
      setReplacementTutorUserId("");
      setMaintenancePanel(null);
    }
  }

  async function handleAddStudent(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (selectedFamily === undefined) return;
    const validationError = minorDraftError(newStudent);
    if (validationError !== undefined) {
      setNewStudentError(validationError);
      return;
    }
    const student = {
      fullName: newStudent.fullName.trim(),
      dateOfBirth: newStudent.dateOfBirth,
      trainingCenter: newStudent.trainingCenter,
      trainingTimePreferences: newStudent.trainingTimePreferences,
    } as const;
    let attempt: RequestAttempt;
    try {
      attempt = requestAttempt(
        addStudentRequestAttempt.current,
        JSON.stringify({ familyId: selectedFamily.family.familyId, student }),
      );
      addStudentRequestAttempt.current = attempt;
    } catch {
      setError("Unable to add the minor. Please try again.");
      return;
    }
    setNewStudentError("");
    const updated = await runUpdate(
      { kind: "addStudent", requestId: attempt.requestId, student },
      "addStudent",
      "Minor added.",
      "Unable to add the minor. Please try again.",
    );
    if (updated) {
      addStudentRequestAttempt.current = null;
      setNewStudent(newMinor(0));
      setMaintenancePanel(null);
    }
  }

  async function handleDeactivateRelationship(studentId: string): Promise<void> {
    await runUpdate(
      { kind: "deactivateRelationship", studentId },
      `deactivateRelationship:${studentId}`,
      "Relationship deactivated.",
      "Unable to deactivate the relationship. Please try again.",
    );
  }

  async function handleDeactivateFamily(): Promise<void> {
    const updated = await runUpdate(
      { kind: "deactivateFamily" },
      "deactivateFamily",
      "Family deactivated.",
      "Unable to deactivate the family. Please try again.",
    );
    if (updated) setMaintenancePanel(null);
  }

  function handleAchievementReview(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const targetFamilyId = achievementFamilyId.trim();
    if (targetFamilyId) setReviewedFamilyId(targetFamilyId);
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

      <section
        className="family-admin-card family-lookup-card"
        aria-labelledby="family-lookup-title"
      >
        <p className="admin-eyebrow">Existing record</p>
        <h3 id="family-lookup-title">Open a family</h3>
        <p className="family-helper">
          Use the opaque family ID supplied by the administrative workflow. Search does not expose
          family records.
        </p>
        <form
          className="family-inline-form"
          noValidate
          onSubmit={(event) => void handleLoad(event)}
        >
          <label className="family-field" htmlFor="family-record-id">
            Family ID
            <input
              autoComplete="off"
              id="family-record-id"
              maxLength={128}
              onChange={(event) => setFamilyId(event.target.value)}
              value={familyId}
            />
          </label>
          <button className="family-text-button" disabled={busy} type="submit">
            {busyOperation === "load" ? "Loading family..." : "Load family"}
          </button>
        </form>
      </section>

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

      <section
        aria-labelledby="family-achievement-review-title"
        className="family-admin-card family-achievement-review-card"
      >
        <div className="family-achievement-heading">
          <div>
            <p className="admin-eyebrow">Family progress</p>
            <h3 id="family-achievement-review-title">Review achievement snapshot</h3>
            <p className="family-helper">
              Load a saved, read-only family snapshot for staff review.
            </p>
          </div>
        </div>
        <form
          className="family-admin-form"
          noValidate
          onSubmit={(event) => void handleAchievementReview(event)}
        >
          <label className="family-field" htmlFor="family-achievement-reference">
            Family reference
            <input
              id="family-achievement-reference"
              onChange={(event) => setAchievementFamilyId(event.target.value)}
              required
              value={achievementFamilyId}
            />
          </label>
          <button className="family-text-button" type="submit">
            Load achievement summary
          </button>
        </form>
        {reviewedFamilyId ? (
          <FamilyAchievementAdminPanel
            familyId={reviewedFamilyId}
            instanceId="family-achievement-review-title"
          />
        ) : null}
      </section>

      <form className="family-admin-form" noValidate onSubmit={(event) => void handleCreate(event)}>
        <div className="family-admin-card">
          <p className="admin-eyebrow">New family / Adult contact</p>
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

        <button className="admin-auth-button family-submit" disabled={busy} type="submit">
          {busyOperation === "create" ? "Creating family..." : "Create family"}
        </button>
      </form>

      {selectedFamily ? (
        <section
          className="family-created-card family-workspace"
          aria-labelledby="family-workspace-title"
        >
          <div className="family-workspace-heading">
            <div>
              <p className="admin-eyebrow">Selected family</p>
              <h3 id="family-workspace-title">Family workspace</h3>
            </div>
            <span
              className={`admin-status-badge ${
                selectedFamily.family.active ? "admin-status-active" : "admin-status-cancelled"
              }`}
            >
              {selectedFamily.family.active ? "Active" : "Inactive"}
            </span>
          </div>
          <p className="family-helper">
            Only the minimum operational profile is shown. Existing minor details are read-only;
            active tutor links can be deactivated.
          </p>
          <ul className="family-workspace-summary" aria-label="Family minors">
            {selectedFamily.students.map((student) => (
              <li key={student.studentId}>
                <strong>{student.fullName}</strong>
                <span>{student.trainingCenter} training centre</span>
              </li>
            ))}
          </ul>

          <div className="family-relationship-list">
            {selectedFamily.students.map((student) => {
              const relationship = selectedFamily.relationships.find(
                (candidate) => candidate.studentId === student.studentId,
              );
              const relationshipActive =
                relationship?.active === true && relationship.status === "active";
              const relationshipBusy =
                busyOperation === `deactivateRelationship:${student.studentId}`;
              return (
                <article className="family-relationship-row" key={student.studentId}>
                  <div>
                    <h4>{student.fullName}</h4>
                    <p>{student.trainingCenter} · Canonical student record</p>
                  </div>
                  <span
                    className={`admin-status-badge ${
                      relationshipActive ? "admin-status-active" : "admin-status-cancelled"
                    }`}
                  >
                    {relationshipActive ? "Tutor linked" : "Link inactive"}
                  </span>
                  {relationshipActive ? (
                    <>
                      <Link
                        aria-label={`Create membership for ${student.fullName}`}
                        className="family-text-button"
                        href={`/admin/memberships?familyId=${encodeURIComponent(selectedFamily.family.familyId)}&studentId=${encodeURIComponent(student.studentId)}`}
                      >
                        Create membership
                      </Link>
                      <button
                        aria-label={`Deactivate relationship for ${student.fullName}`}
                        className="family-text-button"
                        disabled={busy}
                        onClick={() => void handleDeactivateRelationship(student.studentId)}
                        type="button"
                      >
                        {relationshipBusy ? "Deactivating..." : "Deactivate link"}
                      </button>
                    </>
                  ) : null}
                </article>
              );
            })}
          </div>

          {selectedFamily.family.active ? (
            <div className="family-operation-actions" aria-label="Family operations">
              <button
                className="family-text-button"
                disabled={busy}
                onClick={() => openMaintenancePanel("replaceTutor")}
                type="button"
              >
                Replace tutor
              </button>
              <button
                className="family-text-button"
                disabled={busy}
                onClick={() => openMaintenancePanel("addStudent")}
                type="button"
              >
                Add minor
              </button>
              <button
                className="family-danger-button"
                disabled={busy}
                onClick={() => openMaintenancePanel("deactivateFamily")}
                type="button"
              >
                Deactivate family
              </button>
            </div>
          ) : (
            <p className="family-workspace-inactive">
              This family is inactive. No new tutor links or minors can be added here.
            </p>
          )}

          {maintenancePanel === "replaceTutor" ? (
            <form
              className="family-maintenance-form"
              onSubmit={(event) => void handleReplaceTutor(event)}
            >
              <div>
                <p className="admin-eyebrow">Tutor relationship</p>
                <h4>Replace the linked tutor</h4>
                <p>The new active tutor will replace the adult on every active relationship.</p>
              </div>
              <label className="family-field" htmlFor="family-replacement-tutor-id">
                New tutor user ID
                <input
                  autoComplete="off"
                  id="family-replacement-tutor-id"
                  maxLength={128}
                  onChange={(event) => setReplacementTutorUserId(event.target.value)}
                  value={replacementTutorUserId}
                />
              </label>
              <div className="family-maintenance-actions">
                <button className="admin-auth-button" disabled={busy} type="submit">
                  {busyOperation === "replaceTutor" ? "Saving tutor..." : "Save tutor"}
                </button>
                <button
                  className="family-text-button"
                  disabled={busy}
                  onClick={closeMaintenancePanel}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          {maintenancePanel === "addStudent" ? (
            <form
              className="family-maintenance-form"
              onSubmit={(event) => void handleAddStudent(event)}
            >
              <div>
                <p className="admin-eyebrow">Canonical student</p>
                <h4>Add one minor</h4>
                <p>A new student and its tutor relationship are created together.</p>
              </div>
              <div className="family-maintenance-grid">
                <label className="family-field" htmlFor="family-new-student-name">
                  New minor full name
                  <input
                    id="family-new-student-name"
                    onChange={(event) =>
                      setNewStudent((current) => ({ ...current, fullName: event.target.value }))
                    }
                    value={newStudent.fullName}
                  />
                </label>
                <label className="family-field" htmlFor="family-new-student-date">
                  New minor date of birth
                  <input
                    id="family-new-student-date"
                    onChange={(event) =>
                      setNewStudent((current) => ({ ...current, dateOfBirth: event.target.value }))
                    }
                    type="date"
                    value={newStudent.dateOfBirth}
                  />
                </label>
                <label className="family-field" htmlFor="family-new-student-center">
                  New minor training center
                  <select
                    id="family-new-student-center"
                    onChange={(event) =>
                      setNewStudent((current) => ({
                        ...current,
                        trainingCenter: event.target.value as "Town" | "West",
                      }))
                    }
                    value={newStudent.trainingCenter}
                  >
                    <option value="Town">Town</option>
                    <option value="West">West</option>
                  </select>
                </label>
              </div>
              <fieldset className="family-preferences">
                <legend>New minor training time preferences</legend>
                <div className="family-preference-list">
                  {preferenceOptions.map((option) => (
                    <label className="family-preference" key={option.value}>
                      <input
                        aria-label={`New minor ${option.label.toLowerCase()}`}
                        checked={newStudent.trainingTimePreferences.includes(option.value)}
                        onChange={() => toggleNewStudentPreference(option.value)}
                        type="checkbox"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              {newStudentError ? (
                <p className="family-field-error" role="alert">
                  {newStudentError}
                </p>
              ) : null}
              <div className="family-maintenance-actions">
                <button className="admin-auth-button" disabled={busy} type="submit">
                  {busyOperation === "addStudent" ? "Saving minor..." : "Save minor"}
                </button>
                <button
                  className="family-text-button"
                  disabled={busy}
                  onClick={closeMaintenancePanel}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          {maintenancePanel === "deactivateFamily" ? (
            <div className="family-maintenance-form family-deactivation-panel">
              <div>
                <p className="admin-eyebrow">Final check</p>
                <h4>Deactivate this family?</h4>
                <p>This also deactivates every active tutor relationship in the family.</p>
              </div>
              <div className="family-maintenance-actions">
                <button
                  className="family-danger-button"
                  disabled={busy}
                  onClick={() => void handleDeactivateFamily()}
                  type="button"
                >
                  {busyOperation === "deactivateFamily"
                    ? "Deactivating family..."
                    : "Confirm deactivation"}
                </button>
                <button
                  className="family-text-button"
                  disabled={busy}
                  onClick={closeMaintenancePanel}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          <FamilyAchievementAdminPanel
            familyId={selectedFamily.family.familyId}
            instanceId="family-achievements-title"
          />
        </section>
      ) : null}
    </section>
  );
}

export default function FamilyAdminRoute() {
  return <FamilyAdminPage />;
}
