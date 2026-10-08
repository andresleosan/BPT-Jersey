"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import {
  replaceStaffAssignments,
  replaceStaffAvailability,
  setStaffActive,
  type StaffAssignmentInput,
  type StaffAvailabilityWindowInput,
} from "../../../lib/staff-client";
import {
  listStaffPermissionGrants,
  permissionGrantLabel,
  permissionGrantStatusLabel,
  revokeStaffPermission,
  type PermissionGrantView,
} from "../../../lib/staff-permissions-client";
import type { TeamDirectoryPerson } from "@bpt-jersey/domain/staff/team-access";
import { coachBeltLabels, teamRoleLabels } from "@bpt-jersey/domain/staff/team-access";

import { useAdminGateSession } from "../admin-gate";
import { AdminSectionHeader } from "../admin-ui";

import { CoachWebsiteCard } from "./coach-website-card";
import { CoachWebsiteControls } from "./coach-website-controls";
import { TeamDirectory } from "./team-directory";

import "../admin.css";

type Mutation = "active" | "availability" | "assignment" | "revoke" | "";
type AssignmentType = StaffAssignmentInput["targetType"];
type StaffField = "startLocal" | "endLocal" | "timezone" | "targetId";
type StaffFieldElement = HTMLInputElement | HTMLSelectElement;

const assignmentOptions: readonly { value: AssignmentType; label: string }[] = [
  { value: "location", label: "Location" },
  { value: "program", label: "Program" },
  { value: "class", label: "Class" },
];

const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function StaffAdminPage() {
  const session = useAdminGateSession();
  const [selected, setSelected] = useState<TeamDirectoryPerson>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [weekday, setWeekday] = useState("1");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [timezone, setTimezone] = useState("");
  const [targetType, setTargetType] = useState<AssignmentType>("location");
  const [targetId, setTargetId] = useState("");
  const [mutation, setMutation] = useState<Mutation>("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [grants, setGrants] = useState<readonly PermissionGrantView[]>([]);
  const [grantsError, setGrantsError] = useState("");
  const [invalidField, setInvalidField] = useState<StaffField>();
  const fieldRefs = useRef<Partial<Record<StaffField, StaffFieldElement | null>>>({});

  const selectedProfile = selected?.coach ?? undefined;
  const busy = mutation !== "";

  const refreshGrants = useCallback(async () => {
    try {
      setGrants(await listStaffPermissionGrants());
      setGrantsError("");
    } catch (cause) {
      setGrants([]);
      setGrantsError(cause instanceof Error ? cause.message : "Unable to load permission grants.");
    }
  }, []);

  useEffect(() => {
    void refreshGrants();
  }, [refreshGrants]);

  async function handleRevoke(grantId: string): Promise<void> {
    if (busy) return;
    setMutation("revoke");
    setError("");
    setStatus("");
    try {
      await revokeStaffPermission({
        grantId,
        reason: "Revoked from the staff administration page",
      });
      setStatus("Permission revoked. It stops applying immediately.");
      await refreshGrants();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to revoke that grant.");
    } finally {
      setMutation("");
    }
  }

  function manage(person: TeamDirectoryPerson): void {
    setSelected(person);
    setError("");
    setStatus("");
    setInvalidField(undefined);
  }

  function failValidation(field: StaffField, message: string): void {
    setError(message);
    setStatus("");
    setInvalidField(field);
    fieldRefs.current[field]?.focus();
  }

  function clearFieldError(field: StaffField): void {
    if (invalidField !== field) return;
    setError("");
    setInvalidField(undefined);
  }

  async function runMutation<T>(
    kind: Exclude<Mutation, "">,
    operation: () => Promise<T>,
    successMessage: string,
    errorMessage: string,
    onSuccess: (result: T) => void,
  ): Promise<void> {
    setMutation(kind);
    setError("");
    setStatus("");
    setInvalidField(undefined);
    try {
      const result = await operation();
      onSuccess(result);
      setStatus(successMessage);
    } catch {
      setError(errorMessage);
    } finally {
      setMutation("");
    }
  }

  async function handleActiveUpdate(): Promise<void> {
    if (busy || !selectedProfile) return;
    const active = !selectedProfile.active;

    await runMutation(
      "active",
      () => setStaffActive({ staffKey: selectedProfile.staffKey, active }),
      active ? "Staff profile activated." : "Staff profile deactivated.",
      "Unable to update staff status. Please try again.",
      (profile) => {
        setSelected((current) =>
          current?.coach?.staffKey === profile.staffKey
            ? { ...current, coach: { ...current.coach, active: profile.active } }
            : current,
        );
        setRefreshKey((key) => key + 1);
      },
    );
  }

  async function handleAvailability(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !selectedProfile) return;
    const window: StaffAvailabilityWindowInput = {
      weekday: Number(weekday),
      startLocal: startLocal.trim(),
      endLocal: endLocal.trim(),
      timezone: timezone.trim(),
    };
    const availabilityError = "Enter a valid weekday, local time range, and IANA timezone.";
    if (!window.startLocal) {
      failValidation("startLocal", availabilityError);
      return;
    }
    if (!window.endLocal || window.startLocal >= window.endLocal) {
      failValidation("endLocal", availabilityError);
      return;
    }
    if (!window.timezone || !isValidTimezone(window.timezone)) {
      failValidation("timezone", availabilityError);
      return;
    }

    await runMutation(
      "availability",
      () => replaceStaffAvailability({ staffKey: selectedProfile.staffKey, windows: [window] }),
      "Staff availability replaced.",
      "Unable to replace staff availability. Please try again.",
      () => undefined,
    );
  }

  async function handleAssignment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !selectedProfile) return;
    const assignment: StaffAssignmentInput = { targetType, targetId: targetId.trim() };
    if (!assignment.targetId) {
      failValidation("targetId", "Enter a target ID to replace the staff assignment.");
      return;
    }

    await runMutation(
      "assignment",
      () =>
        replaceStaffAssignments({ staffKey: selectedProfile.staffKey, assignments: [assignment] }),
      "Staff assignment replaced.",
      "Unable to replace staff assignments. Please try again.",
      () => undefined,
    );
  }

  return (
    <section className="admin-module-page staff-admin-page" aria-labelledby="staff-admin-title">
      <AdminSectionHeader
        description="View your team and manage administrative and coaching access."
        eyebrow="Staff / Access lifecycle"
        title="Staff management"
      />

      <TeamDirectory onManage={manage} refreshKey={refreshKey} />

      {error ? (
        <p
          aria-live="assertive"
          className="staff-message staff-message-error"
          id="staff-error-message"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {selected ? (
        <section className="staff-selected-panel" aria-labelledby="staff-selected-title">
          <p className="admin-eyebrow">Manage · {teamRoleLabels[selected.role]}</p>
          <h3 id="staff-selected-title">{selected.name || selected.email || "Team member"}</h3>

          <section className="staff-card staff-operation-card">
            <h4>Website</h4>
            <CoachWebsiteControls
              key={`${selected.userId}:${refreshKey}`}
              person={selected}
              owner={session.role === "owner"}
              onChanged={(message, updated) => {
                setStatus(message);
                if (updated) setSelected(updated);
                setRefreshKey((key) => key + 1);
                if (message.endsWith("was deleted.")) setSelected(undefined);
              }}
            />
            {selected.coach?.belt && (session.role === "owner" || selected.role !== "owner") ? (
              <CoachWebsiteCard
                key={selected.userId}
                beltLabel={coachBeltLabels[selected.coach.belt]}
                name={selected.name || selected.email || "Coach"}
                onSaved={(message) => {
                  setStatus(message);
                  setRefreshKey((key) => key + 1);
                }}
                userId={selected.userId}
              />
            ) : null}
          </section>

          {selectedProfile ? (
            <>
              <section className="staff-card staff-operation-card">
                <p>Coaching availability and assignments are managed below.</p>
                {selected?.role === "coach" || selected?.role === "headCoach" ? (
                  <button
                    className="staff-secondary-button"
                    disabled={busy}
                    onClick={() => void handleActiveUpdate()}
                    type="button"
                  >
                    {selectedProfile.active ? "Deactivate coach profile" : "Activate coach profile"}
                  </button>
                ) : null}
              </section>

          <form
            className="staff-card staff-operation-card"
            onSubmit={(event) => void handleAvailability(event)}
          >
            <h4>Availability</h4>
            <div className="staff-form-grid">
              <label className="staff-field" htmlFor="staff-weekday">
                Weekday
                <select
                  id="staff-weekday"
                  onChange={(event) => setWeekday(event.target.value)}
                  value={weekday}
                >
                  {weekdays.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
              <label className="staff-field" htmlFor="staff-start-local">
                Start local time
                <input
                  aria-describedby={
                    invalidField === "startLocal" ? "staff-error-message" : undefined
                  }
                  aria-invalid={invalidField === "startLocal" || undefined}
                  id="staff-start-local"
                  onChange={(event) => {
                    setStartLocal(event.target.value);
                    clearFieldError("startLocal");
                  }}
                  ref={(element) => {
                    fieldRefs.current.startLocal = element;
                  }}
                  type="time"
                  value={startLocal}
                />
              </label>
              <label className="staff-field" htmlFor="staff-end-local">
                End local time
                <input
                  aria-describedby={invalidField === "endLocal" ? "staff-error-message" : undefined}
                  aria-invalid={invalidField === "endLocal" || undefined}
                  id="staff-end-local"
                  onChange={(event) => {
                    setEndLocal(event.target.value);
                    clearFieldError("endLocal");
                  }}
                  ref={(element) => {
                    fieldRefs.current.endLocal = element;
                  }}
                  type="time"
                  value={endLocal}
                />
              </label>
              <label className="staff-field" htmlFor="staff-timezone">
                IANA timezone
                <input
                  aria-describedby={invalidField === "timezone" ? "staff-error-message" : undefined}
                  aria-invalid={invalidField === "timezone" || undefined}
                  id="staff-timezone"
                  onChange={(event) => {
                    setTimezone(event.target.value);
                    clearFieldError("timezone");
                  }}
                  placeholder="Europe/London"
                  ref={(element) => {
                    fieldRefs.current.timezone = element;
                  }}
                  value={timezone}
                />
              </label>
            </div>
            <button className="staff-secondary-button" disabled={busy} type="submit">
              Replace availability
            </button>
          </form>

          <form
            className="staff-card staff-operation-card"
            onSubmit={(event) => void handleAssignment(event)}
          >
            <h4>Assignment</h4>
            <div className="staff-form-grid">
              <label className="staff-field" htmlFor="staff-target-type">
                Target type
                <select
                  id="staff-target-type"
                  onChange={(event) => setTargetType(event.target.value as AssignmentType)}
                  value={targetType}
                >
                  {assignmentOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="staff-field" htmlFor="staff-target-id">
                Target ID
                <input
                  aria-describedby={invalidField === "targetId" ? "staff-error-message" : undefined}
                  aria-invalid={invalidField === "targetId" || undefined}
                  id="staff-target-id"
                  onChange={(event) => {
                    setTargetId(event.target.value);
                    clearFieldError("targetId");
                  }}
                  ref={(element) => {
                    fieldRefs.current.targetId = element;
                  }}
                  value={targetId}
                />
              </label>
            </div>
            <button className="staff-secondary-button" disabled={busy} type="submit">
              Replace assignment
            </button>
          </form>
            </>
          ) : (
            <p className="staff-hint">Turn on «Teaches» to manage availability and assignments.</p>
          )}
          <button className="staff-secondary-button" type="button"
            onClick={() => {
              setSelected(undefined);
              setError("");
              setStatus("");
              setInvalidField(undefined);
            }}
          >
            Close
          </button>
        </section>
      ) : null}

      <section className="staff-selected-panel" aria-labelledby="staff-permissions-title">
        <p className="admin-eyebrow">Delegated permissions</p>
        <h3 id="staff-permissions-title">Existing permission grants</h3>
        <p className="staff-hint">
          No screen uses delegated permissions any more, so new grants are no longer offered. You
          can still revoke any grant that is active.
        </p>

        {grantsError ? (
          <p className="staff-message staff-message-error" role="alert">
            {grantsError}
          </p>
        ) : grants.length === 0 ? (
          <p className="staff-hint">No permission has been delegated.</p>
        ) : (
          <ul className="staff-grant-list">
            {grants.map((grant) => (
              <li className="staff-grant-item" key={grant.grantId}>
                <div>
                  <p className="staff-grant-title">
                    {permissionGrantLabel(grant.permission)} &middot; {grant.subjectUserId}
                  </p>
                  <p className="staff-hint">
                    {permissionGrantStatusLabel(grant)} &middot; granted by {grant.grantedBy}
                    {" — "}
                    {grant.reason}
                  </p>
                </div>
                {grant.status === "active" ? (
                  <button
                    className="staff-secondary-button"
                    disabled={busy}
                    onClick={() => void handleRevoke(grant.grantId)}
                    type="button"
                  >
                    Revoke
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {status ? (
        <p aria-live="polite" className="staff-message staff-message-success" role="status">
          {status}
        </p>
      ) : null}
    </section>
  );
}

export default function StaffAdminRoute() {
  return <StaffAdminPage />;
}
