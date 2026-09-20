"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  teamRoleLabels,
  type StaffInvitation,
  type TeamDirectoryPerson,
} from "@bpt-jersey/domain/staff/team-access";
import type { AdminSession } from "../../../lib/admin-auth";
import {
  listTeamDirectory,
  changeTeamRole,
  createStaffInvitation,
  listStaffInvitations,
  cancelStaffInvitation,
} from "../../../lib/team-access-client";
import { useAdminGateSession } from "../admin-gate";
import { AdminDataTable } from "../admin-data-table";

type AdministrativeRole = "administrator" | "owner";
type InvitationRole = AdministrativeRole | "coach";
type Review =
  | { kind: "role"; person: TeamDirectoryPerson; role: AdministrativeRole }
  | { kind: "invitation"; email: string; role: InvitationRole };

export function TeamDirectory() {
  const session = useAdminGateSession();
  return (
    <TeamDirectoryContent
      key={`${session.academyId}:${session.uid}:${session.role}`}
      session={session}
    />
  );
}
export function TeamDirectoryContent({ session }: { session: AdminSession }) {
  const [people, setPeople] = useState<TeamDirectoryPerson[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState("");
  const [invitations, setInvitations] = useState<StaffInvitation[]>([]);
  const [invitationsCheckedAt, setInvitationsCheckedAt] = useState(0);
  const [invitationsError, setInvitationsError] = useState("");
  const [invitationsLoading, setInvitationsLoading] = useState(session.role === "owner");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<TeamDirectoryPerson>();
  const [role, setRole] = useState<AdministrativeRole>("administrator");
  const [email, setEmail] = useState("");
  const [invitedRole, setInvitedRole] = useState<InvitationRole>(
    session.role === "owner" ? "administrator" : "coach",
  );
  const [review, setReview] = useState<Review>();
  const owner = session.role === "owner";
  const roleSelect = useRef<HTMLSelectElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const inviteEmail = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const directoryRequest = useRef(0);

  async function loadDirectory(pageToken?: string) {
    const requestVersion = ++directoryRequest.current;
    setLoading(true);
    setDirectoryError("");
    try {
      const result = await listTeamDirectory(pageToken);
      if (!mounted.current || requestVersion !== directoryRequest.current) return;
      setPeople((prior) =>
        pageToken
          ? [
              ...new Map(
                [...prior, ...result.people].map((person) => [person.userId, person]),
              ).values(),
            ]
          : result.people,
      );
      setNextPage(result.nextPageToken);
    } catch {
      if (mounted.current && requestVersion === directoryRequest.current)
        setDirectoryError("Unable to load the team directory. Please try again.");
    } finally {
      if (mounted.current && requestVersion === directoryRequest.current) setLoading(false);
    }
  }
  async function loadInvitations() {
    if (!owner) return;
    setInvitationsLoading(true);
    setInvitationsError("");
    try {
      const result = await listStaffInvitations();
      if (mounted.current) {
        setInvitations(result);
        setInvitationsCheckedAt(Date.now());
      }
    } catch {
      if (mounted.current)
        setInvitationsError("Unable to load pending invitations. Please try again.");
    } finally {
      if (mounted.current) setInvitationsLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void loadDirectory();
    void loadInvitations();
    return () => {
      mounted.current = false;
    };
    // The component is keyed to the authenticated session; requests never cross identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (review) confirmButton.current?.focus();
    else if (selected) roleSelect.current?.focus();
  }, [review, selected]);

  async function confirm() {
    if (!review || busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      if (review.kind === "role") {
        directoryRequest.current += 1;
        setLoading(false);
        await changeTeamRole({
          userId: review.person.userId,
          email: review.person.email!,
          role: review.role,
        });
        if (!mounted.current) return;
        setPeople((prior) =>
          prior.map((person) =>
            person.userId === review.person.userId ? { ...person, role: review.role } : person,
          ),
        );
        setStatus(
          `Role changed to ${teamRoleLabels[review.role]}. The person must sign in again to refresh their access.`,
        );
        setSelected(undefined);
      } else {
        await createStaffInvitation({ email: review.email, role: review.role });
        if (!mounted.current) return;
        setStatus(
          `Access authorised for ${review.email}. Ask them to open /staff/login and continue with Google within seven days.`,
        );
        setEmail("");
        await loadInvitations();
      }
      setReview(undefined);
      inviteEmail.current?.focus();
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error ? cause.message : "Unable to update access. Please try again.",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function cancel(invitation: StaffInvitation) {
    if (busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await cancelStaffInvitation({ id: invitation.id, version: invitation.version });
      if (!mounted.current) return;
      setInvitations((prior) => prior.filter((item) => item.id !== invitation.id));
      setStatus("Invitation cancelled. It can no longer activate access.");
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : "Unable to cancel this invitation.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function reviewInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setReview({ kind: "invitation", email: email.trim().toLowerCase(), role: invitedRole });
  }

  return (
    <section className="staff-team-directory" aria-labelledby="team-directory-title">
      <div className="staff-team-heading" id="staff-account-roles">
        <div>
          <p className="admin-eyebrow">Academy team</p>
          <h3 id="team-directory-title">Team directory</h3>
        </div>
        <button
          className="staff-secondary-button"
          disabled={loading || busy}
          onClick={() => void loadDirectory()}
          type="button"
        >
          Refresh team
        </button>
      </div>
      <p className="staff-hint">
        Owners, administrators and coaches. Existing head-coach accounts can be moved to
        Administrator.
      </p>
      {directoryError && (
        <p className="staff-message staff-message-error" role="alert">
          {directoryError}
        </p>
      )}
      {loading && (
        <p className="staff-message" role="status">
          Loading team directory…
        </p>
      )}
      {!loading && !directoryError && people.length === 0 && (
        <p role="status">No team accounts found on this page.</p>
      )}
      {people.length > 0 && (
        <AdminDataTable
          caption="Team directory"
          rowKey={(person) => person.userId}
          rows={people}
          columns={[
            { key: "name", label: "Name", render: (person) => person.name || "Name not provided" },
            {
              key: "email",
              label: "Email",
              render: (person) => person.email || "Email not provided",
            },
            { key: "role", label: "Role", render: (person) => teamRoleLabels[person.role] },
            ...(owner
              ? [
                  {
                    key: "actions",
                    label: "Access",
                    render: (person: TeamDirectoryPerson) =>
                      person.userId === session.uid ? (
                        "Your account"
                      ) : (
                        <button
                          className="staff-row-action"
                          type="button"
                          disabled={busy || !!review || !person.email}
                          aria-label={`Change role for ${person.name || person.email || "team member"}`}
                          onClick={() => {
                            setSelected(person);
                            setRole(person.role === "administrator" ? "owner" : "administrator");
                            setError("");
                          }}
                        >
                          Change role
                        </button>
                      ),
                  },
                ]
              : []),
          ]}
        />
      )}
      {nextPage && (
        <button
          className="staff-secondary-button"
          type="button"
          disabled={loading || busy}
          onClick={() => void loadDirectory(nextPage)}
        >
          Load more accounts
        </button>
      )}
      {owner && selected && !review && (
        <form
          className="staff-card"
          onSubmit={(event) => {
            event.preventDefault();
            setReview({ kind: "role", person: selected, role });
          }}
        >
          <h4>Change account role</h4>
          <p>
            {selected.name || selected.email} · {selected.email}
          </p>
          <label className="staff-field">
            New role
            <select
              ref={roleSelect}
              value={role}
              onChange={(event) => setRole(event.target.value as AdministrativeRole)}
            >
              <option value="administrator">Administrator</option>
              <option value="owner">Owner</option>
            </select>
          </label>
          <div className="staff-team-actions">
            <button
              className="staff-primary-button"
              disabled={busy || role === selected.role}
              type="submit"
            >
              Review role change
            </button>
            <button
              className="staff-secondary-button"
              type="button"
              onClick={() => setSelected(undefined)}
            >
              Cancel role change
            </button>
          </div>
        </form>
      )}
      {(owner || session.role === "administrator") && (
        <form className="staff-card" onSubmit={reviewInvitation}>
          <p className="admin-eyebrow">New team member</p>
          <h3>Create staff profile</h3>
          <p className="staff-hint">
            {owner ? "Choose Coach, Administrator or Owner." : "Create coaching access by email."}{" "}
            The profile and access activate when this person signs in at /staff/login with the
            matching verified Google account. Authorisation lasts seven days. No email is sent
            automatically.
          </p>
          <div className="staff-form-grid">
            <label className="staff-field">
              Staff email
              <input
                ref={inviteEmail}
                required
                type="email"
                autoComplete="off"
                maxLength={320}
                value={email}
                disabled={busy || !!review}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="staff-field">
              Staff role
              <select
                value={invitedRole}
                disabled={busy || !!review}
                onChange={(event) => setInvitedRole(event.target.value as InvitationRole)}
              >
                <option value="coach">Coach</option>
                {owner ? (
                  <>
                    <option value="administrator">Administrator</option>
                    <option value="owner">Owner</option>
                  </>
                ) : null}
              </select>
            </label>
          </div>
          <button className="staff-primary-button" disabled={busy || !!review} type="submit">
            Review staff access
          </button>
        </form>
      )}
      {review && (
        <section className="staff-card staff-role-review" aria-labelledby="staff-role-review-title">
          <h3 id="staff-role-review-title">Confirm staff access</h3>
          <p>
            <strong>{review.kind === "role" ? review.person.email : review.email}</strong> will
            receive the <strong>{teamRoleLabels[review.role]}</strong> role
            {review.kind === "invitation" ? " when they sign in with Google" : " immediately"}.
          </p>
          <p>
            {review.role === "coach"
              ? "Coaches have sporting access. They cannot manage finances or administrative roles."
              : review.role === "owner"
                ? "Owners can manage the academy and grant administrative access to other people."
                : "Administrators can manage members, finances, the team, classes and sporting decisions. They cannot grant owner or administrator access."}
          </p>
          {review.kind === "role" && (
            <p>This replaces their current {teamRoleLabels[review.person.role]} role.</p>
          )}
          <div className="staff-team-actions">
            <button
              ref={confirmButton}
              className="staff-primary-button"
              type="button"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? "Saving access…" : "Confirm access"}
            </button>
            <button
              className="staff-secondary-button"
              type="button"
              disabled={busy}
              onClick={() => setReview(undefined)}
            >
              Back
            </button>
          </div>
        </section>
      )}
      {error && (
        <p className="staff-message staff-message-error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="staff-message" role="status">
          {status}
        </p>
      )}
      {owner && (
        <section className="staff-pending-invitations" aria-labelledby="pending-invitations-title">
          <div className="staff-team-heading">
            <h3 id="pending-invitations-title">Pending access</h3>
            <button
              className="staff-secondary-button"
              disabled={busy || invitationsLoading}
              type="button"
              onClick={() => void loadInvitations()}
            >
              Refresh invitations
            </button>
          </div>
          {invitationsLoading && <p role="status">Loading invitations…</p>}
          {invitationsError && (
            <p className="staff-message staff-message-error" role="alert">
              {invitationsError}
            </p>
          )}
          {!invitationsLoading && !invitationsError && invitations.length === 0 && (
            <p className="staff-hint">No pending invitations.</p>
          )}
          {invitations.map((invitation) => (
            <div className="staff-team-invitation" key={invitation.id}>
              <div>
                <strong>{invitation.email}</strong>
                <p className="staff-hint">
                  {teamRoleLabels[invitation.role]} ·{" "}
                  {invitation.status === "processing"
                    ? "Activation in progress — contact support if it does not complete"
                    : invitation.status === "failed"
                      ? "Activation failed — an owner must authorise this email again"
                      : Date.parse(invitation.expiresAt) <= invitationsCheckedAt
                        ? "Expired — authorise this email again"
                        : `Pending until ${invitation.expiresAt.slice(0, 10)}`}
                </p>
              </div>
              {invitation.status !== "processing" && (
                <button
                  className="staff-secondary-button"
                  type="button"
                  disabled={busy}
                  aria-label={`Cancel invitation for ${invitation.email}`}
                  onClick={() => void cancel(invitation)}
                >
                  Cancel invitation
                </button>
              )}
            </div>
          ))}
        </section>
      )}
    </section>
  );
}
