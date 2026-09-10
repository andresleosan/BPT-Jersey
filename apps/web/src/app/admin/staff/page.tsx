"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import type { DelegablePermission } from "@bpt-jersey/domain/staff/permission-grants";

import {
  createStaffProfile,
  listStaffProfiles,
  replaceStaffAssignments,
  replaceStaffAvailability,
  setStaffActive,
  updateStaffProfile,
  type StaffAssignmentInput,
  type StaffAvailabilityWindowInput,
  type StaffProfileProjection,
} from "../../../lib/staff-client";
import {
  grantStaffPermission,
  listStaffPermissionGrants,
  permissionGrantLabel,
  permissionGrantStatusLabel,
  revokeStaffPermission,
  type PermissionGrantView,
} from "../../../lib/staff-permissions-client";
import { AdminDataTable } from "../admin-data-table";
import { AdminSectionHeader, AdminStatusBadge } from "../admin-ui";

import "../admin.css";

type Mutation =
  "create" | "role" | "active" | "availability" | "assignment" | "grant" | "revoke" | "";
type StaffRole = StaffProfileProjection["role"];
type AssignmentType = StaffAssignmentInput["targetType"];
type StaffField =
  "createUserId" | "requestId" | "startLocal" | "endLocal" | "timezone" | "targetId";
type StaffFieldElement = HTMLInputElement | HTMLSelectElement;

const roleOptions: readonly { value: StaffRole; label: string }[] = [
  { value: "headCoach", label: "Head coach" },
  { value: "coach", label: "Coach" },
];

/**
 * T116: the closed list office may delegate, mirrored from the domain so the form can never offer
 * something the backend would refuse. Adding an option here without adding it to
 * `delegablePermissions` produces a rejected call, which is the correct direction to fail.
 */
const permissionOptions: readonly { value: DelegablePermission; label: string }[] = [
  { value: "reviewPenalties", label: "Review no-show penalties" },
  { value: "manageClasses", label: "Manage classes" },
];

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

function roleLabel(role: StaffRole): string {
  return role === "headCoach" ? "Head coach" : "Coach";
}

function statusLabel(active: boolean): string {
  return active ? "Active" : "Inactive";
}

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function StaffAdminPage() {
  const [profiles, setProfiles] = useState<readonly StaffProfileProjection[]>([]);
  const [selectedStaffKey, setSelectedStaffKey] = useState<string>();
  const [createUserId, setCreateUserId] = useState("");
  const [createRole, setCreateRole] = useState<StaffRole>("coach");
  const [requestId, setRequestId] = useState("");
  const [selectedRole, setSelectedRole] = useState<StaffRole>("coach");
  const [weekday, setWeekday] = useState("1");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [timezone, setTimezone] = useState("");
  const [targetType, setTargetType] = useState<AssignmentType>("location");
  const [targetId, setTargetId] = useState("");
  const [loading, setLoading] = useState(true);
  const [mutation, setMutation] = useState<Mutation>("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [grants, setGrants] = useState<readonly PermissionGrantView[]>([]);
  const [grantsError, setGrantsError] = useState("");
  const [grantSubject, setGrantSubject] = useState("");
  const [grantPermission, setGrantPermission] = useState<DelegablePermission>("reviewPenalties");
  const [grantReason, setGrantReason] = useState("");
  const [grantExpiry, setGrantExpiry] = useState("");
  const [invalidField, setInvalidField] = useState<StaffField>();
  const fieldRefs = useRef<Partial<Record<StaffField, StaffFieldElement | null>>>({});
  const rowActionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const restoreFocusRef = useRef<string | undefined>(undefined);

  const selectedProfile = profiles.find((profile) => profile.staffKey === selectedStaffKey);
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

  async function handleGrant(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setMutation("grant");
    setError("");
    setStatus("");
    try {
      // The expiry arrives from a date input as a plain day; the contract wants an instant.
      const grant = await grantStaffPermission({
        subjectUserId: grantSubject.trim(),
        permission: grantPermission,
        reason: grantReason.trim(),
        expiresAt: new Date(`${grantExpiry}T23:59:59.000Z`).toISOString(),
      });
      setStatus(`Granted ${permissionGrantLabel(grant.permission)} to ${grant.subjectUserId}.`);
      setGrantSubject("");
      setGrantReason("");
      setGrantExpiry("");
      await refreshGrants();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to grant that permission.");
    } finally {
      setMutation("");
    }
  }

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

  useEffect(() => {
    if (busy || !restoreFocusRef.current) return;
    const staffKey = restoreFocusRef.current;
    restoreFocusRef.current = undefined;
    rowActionRefs.current[staffKey]?.focus();
  }, [busy]);

  useEffect(() => {
    let mounted = true;
    void listStaffProfiles()
      .then((result) => {
        if (!mounted) return;
        setProfiles(result);
        setLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setError("Unable to load staff profiles. Please try again.");
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  function selectProfile(profile: StaffProfileProjection): void {
    setSelectedStaffKey(profile.staffKey);
    setSelectedRole(profile.role);
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
      if (selectedStaffKey) restoreFocusRef.current = selectedStaffKey;
      setMutation("");
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const userId = createUserId.trim();
    const trimmedRequestId = requestId.trim();
    if (!userId) {
      failValidation("createUserId", "Enter a user ID and request ID to create a staff profile.");
      return;
    }
    if (!trimmedRequestId) {
      failValidation("requestId", "Enter a user ID and request ID to create a staff profile.");
      return;
    }

    await runMutation(
      "create",
      () => createStaffProfile({ userId, role: createRole, requestId: trimmedRequestId }),
      "Staff profile created.",
      "Unable to create staff profile. Please try again.",
      (profile) => setProfiles((current) => [...current, profile]),
    );
  }

  async function handleRoleUpdate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !selectedProfile) return;

    await runMutation(
      "role",
      () => updateStaffProfile({ staffKey: selectedProfile.staffKey, role: selectedRole }),
      "Staff role updated.",
      "Unable to update staff profile. Please try again.",
      (profile) =>
        setProfiles((current) =>
          current.map((candidate) =>
            candidate.staffKey === profile.staffKey ? profile : candidate,
          ),
        ),
    );
  }

  async function handleActiveUpdate(): Promise<void> {
    if (busy || !selectedProfile) return;
    const active = !selectedProfile.active;

    await runMutation(
      "active",
      () => setStaffActive({ staffKey: selectedProfile.staffKey, active }),
      active ? "Staff profile activated." : "Staff profile deactivated.",
      "Unable to update staff status. Please try again.",
      (profile) =>
        setProfiles((current) =>
          current.map((candidate) =>
            candidate.staffKey === profile.staffKey ? profile : candidate,
          ),
        ),
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
        description="Manage operational coach access without exposing identity or audit records."
        eyebrow="Staff / Access lifecycle"
        title="Staff management"
      />

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
      {loading ? (
        <p aria-live="polite" className="staff-message" role="status">
          Loading staff profiles...
        </p>
      ) : profiles.length === 0 ? (
        <p className="staff-message" role="status">
          No staff profiles found.
        </p>
      ) : (
        <AdminDataTable
          caption="Staff profiles"
          columns={[
            {
              key: "staffKey",
              label: "Staff key",
              render: (profile: StaffProfileProjection) => (
                <button
                  aria-pressed={profile.staffKey === selectedStaffKey}
                  aria-label={`Select staff ${profile.staffKey}`}
                  className="staff-row-action"
                  disabled={busy}
                  onClick={() => selectProfile(profile)}
                  ref={(element) => {
                    rowActionRefs.current[profile.staffKey] = element;
                  }}
                  type="button"
                >
                  {profile.staffKey}
                </button>
              ),
            },
            {
              key: "role",
              label: "Role",
              render: (profile: StaffProfileProjection) => roleLabel(profile.role),
            },
            {
              key: "status",
              label: "Status",
              render: (profile: StaffProfileProjection) => (
                <AdminStatusBadge status={statusLabel(profile.active)} />
              ),
            },
          ]}
          rowKey={(profile) => profile.staffKey}
          rows={profiles}
        />
      )}

      <form
        className="staff-card staff-create-form"
        noValidate
        onSubmit={(event) => void handleCreate(event)}
      >
        <p className="admin-eyebrow">Provisioning</p>
        <h3>Create staff profile</h3>
        <div className="staff-form-grid">
          <label className="staff-field" htmlFor="staff-user-id">
            User ID
            <input
              aria-describedby={invalidField === "createUserId" ? "staff-error-message" : undefined}
              aria-invalid={invalidField === "createUserId" || undefined}
              id="staff-user-id"
              onChange={(event) => {
                setCreateUserId(event.target.value);
                clearFieldError("createUserId");
              }}
              ref={(element) => {
                fieldRefs.current.createUserId = element;
              }}
              value={createUserId}
            />
          </label>
          <label className="staff-field" htmlFor="staff-create-role">
            Role
            <select
              id="staff-create-role"
              onChange={(event) => setCreateRole(event.target.value as StaffRole)}
              value={createRole}
            >
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="staff-field" htmlFor="staff-request-id">
            Request ID
            <input
              aria-describedby={invalidField === "requestId" ? "staff-error-message" : undefined}
              aria-invalid={invalidField === "requestId" || undefined}
              id="staff-request-id"
              onChange={(event) => {
                setRequestId(event.target.value);
                clearFieldError("requestId");
              }}
              ref={(element) => {
                fieldRefs.current.requestId = element;
              }}
              value={requestId}
            />
          </label>
        </div>
        <button className="staff-primary-button" disabled={busy} type="submit">
          {mutation === "create" ? "Creating staff profile..." : "Create staff profile"}
        </button>
      </form>

      {selectedProfile ? (
        <section className="staff-selected-panel" aria-labelledby="staff-selected-title">
          <p className="admin-eyebrow">Selected profile</p>
          <h3 id="staff-selected-title">{selectedProfile.staffKey}</h3>

          <form
            className="staff-card staff-operation-card"
            onSubmit={(event) => void handleRoleUpdate(event)}
          >
            <label className="staff-field" htmlFor="staff-selected-role">
              Selected staff role
              <select
                id="staff-selected-role"
                onChange={(event) => setSelectedRole(event.target.value as StaffRole)}
                value={selectedRole}
              >
                {roleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="staff-secondary-button" disabled={busy} type="submit">
              Update role
            </button>
            <button
              className="staff-secondary-button"
              disabled={busy}
              onClick={() => void handleActiveUpdate()}
              type="button"
            >
              {selectedProfile.active ? "Deactivate staff profile" : "Activate staff profile"}
            </button>
          </form>

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
        </section>
      ) : null}

      <section className="staff-selected-panel" aria-labelledby="staff-permissions-title">
        <p className="admin-eyebrow">Delegated permissions</p>
        <h3 id="staff-permissions-title">Give a coach an administrative permission</h3>
        <p className="staff-hint">
          A grant never changes anyone&apos;s role. The coach keeps signing in as a coach; the
          permission lives here, it expires on its own, and revoking it takes effect immediately.
        </p>

        <form
          className="staff-card staff-operation-card"
          onSubmit={(event) => void handleGrant(event)}
        >
          <div className="staff-field-row">
            <label className="staff-field" htmlFor="staff-grant-subject">
              Coach user ID
              <input
                id="staff-grant-subject"
                onChange={(event) => setGrantSubject(event.target.value)}
                required
                value={grantSubject}
              />
            </label>
            <label className="staff-field" htmlFor="staff-grant-permission">
              Permission
              <select
                id="staff-grant-permission"
                onChange={(event) => setGrantPermission(event.target.value as DelegablePermission)}
                value={grantPermission}
              >
                {permissionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="staff-field" htmlFor="staff-grant-expiry">
              Expires on
              <input
                id="staff-grant-expiry"
                onChange={(event) => setGrantExpiry(event.target.value)}
                required
                type="date"
                value={grantExpiry}
              />
            </label>
          </div>
          <label className="staff-field" htmlFor="staff-grant-reason">
            Reason
            <input
              id="staff-grant-reason"
              onChange={(event) => setGrantReason(event.target.value)}
              required
              value={grantReason}
            />
          </label>
          <button className="staff-secondary-button" disabled={busy} type="submit">
            Grant permission
          </button>
        </form>

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
