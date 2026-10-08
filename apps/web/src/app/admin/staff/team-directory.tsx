"use client";
import { useEffect, useRef, useState } from "react";
import {
  coachBeltLabels,
  teamRoleLabels,
  type TeamDirectoryPerson,
} from "@bpt-jersey/domain/staff/team-access";
import type { AdminSession } from "../../../lib/admin-auth";
import {
  listTeamDirectory,
  changeTeamRole,
} from "../../../lib/team-access-client";
import { useAdminGateSession } from "../admin-gate";
import { AdminDataTable } from "../admin-data-table";
import { DirectStaffForm } from "./direct-staff-form";
import { MemberCoachAccessForm } from "./member-coach-access-form";

type TeamRole = "coach" | "administrator" | "owner";
type Review = { person: TeamDirectoryPerson; role: TeamRole };
type DirectoryProps = { onManage?: (person: TeamDirectoryPerson) => void; refreshKey?: number };

export function TeamDirectory(props: DirectoryProps) {
  const session = useAdminGateSession();
  return (
    <TeamDirectoryContent
      key={`${session.academyId}:${session.uid}:${session.role}`}
      session={session}
      {...props}
    />
  );
}
export function TeamDirectoryContent({
  session,
  onManage,
  refreshKey = 0,
}: { session: AdminSession } & DirectoryProps) {
  const [people, setPeople] = useState<TeamDirectoryPerson[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<TeamDirectoryPerson>();
  const [role, setRole] = useState<TeamRole>("coach");
  const [review, setReview] = useState<Review>();
  const owner = session.role === "owner";
  const roleSelect = useRef<HTMLSelectElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
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
  useEffect(() => {
    mounted.current = true;
    void loadDirectory();
    return () => {
      mounted.current = false;
    };
    // The component is keyed to the authenticated session; requests never cross identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (refreshKey > 0) void loadDirectory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);
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
      directoryRequest.current += 1;
      setLoading(false);
      await changeTeamRole({
        userId: review.person.userId,
        email: review.person.email,
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
      void loadDirectory();
      setReview(undefined);
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error ? cause.message : "Unable to update access. Please try again.",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
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
            { key: "role", label: "Role", render: (person) => (person.alsoMember ? "Coach · also a member" : teamRoleLabels[person.role]) },
            {
              key: "website",
              label: "Website",
              render: (person: TeamDirectoryPerson) =>
                person.role === "administrator"
                  ? "—"
                  : person.coach?.active && person.coach.belt && !person.coach.hidden
                    ? `Shown · ${coachBeltLabels[person.coach.belt]}`
                    : "Hidden",
            },
            {
              key: "manage",
              label: "Coaching",
              render: (person: TeamDirectoryPerson) =>
                person.role === "administrator" || !onManage ? (
                  "—"
                ) : (
                  <button
                    className="staff-row-action"
                    type="button"
                    disabled={busy}
                    aria-label={`Manage ${person.name || person.email || "team member"}`}
                    onClick={() => onManage(person)}
                  >
                    Manage
                  </button>
                ),
            },
            ...(owner
              ? [
                  {
                    key: "actions",
                    label: "Access",
                    render: (person: TeamDirectoryPerson) =>
                      person.userId === session.uid ? (
                        "Your account"
                      ) : person.alsoMember ? (
                        "Member account"
                      ) : (
                        <button
                          className="staff-row-action"
                          type="button"
                          disabled={busy || !!review}
                          aria-label={`Change role for ${person.name || person.email || "team member"}`}
                          onClick={() => {
                            setSelected(person);
                            setRole(person.role === "coach" || person.role === "headCoach" ? "administrator" : "coach");
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
            setReview({ person: selected, role });
          }}
        >
          <h4>Change account role</h4>
          <p>
            {selected.name || selected.email || selected.userId} ·{" "}
            {selected.email || "No email linked"}
          </p>
          <label className="staff-field">
            New role
            <select
              ref={roleSelect}
              value={role}
              onChange={(event) => setRole(event.target.value as TeamRole)}
            >
              <option value="coach">Coach</option>
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
      <section className="staff-add" aria-labelledby="staff-add-title">
        <h4 id="staff-add-title">Add to the team</h4>
        {/* Collapsed by default so the directory stays the first thing on the page, on phones too. */}
        <details className="staff-add-option">
          <summary>
            <span className="staff-add-option-title">Existing member</span>
            <span className="staff-add-option-hint">Give coach access with their member login</span>
          </summary>
          <MemberCoachAccessForm onCreated={() => void loadDirectory()} />
        </details>
        <details className="staff-add-option">
          <summary>
            <span className="staff-add-option-title">New staff account</span>
            <span className="staff-add-option-hint">Create a login with an initial password</span>
          </summary>
          <DirectStaffForm session={session} onCreated={() => void loadDirectory()} />
        </details>
      </section>
      {review && (
        <section className="staff-card staff-role-review" aria-labelledby="staff-role-review-title">
          <h3 id="staff-role-review-title">Confirm staff access</h3>
          <p>
            <strong>
              {review.person.name || review.person.email || review.person.userId}
            </strong>{" "}
            will receive the <strong>{teamRoleLabels[review.role]}</strong> role immediately.
          </p>
          <p>
            {review.role === "coach"
              ? "Coaches have sporting access. They cannot manage finances or administrative roles."
              : review.role === "owner"
                ? "Owners can manage the academy and grant administrative access to other people."
                : "Administrators can manage members, finances, the team, classes and sporting decisions. They cannot grant owner or administrator access."}
          </p>
          {review.role === "coach" && review.person.role !== "coach" && (
            <p>They lose office access at their next sign-in and get an active coach profile. Choose their belt in Manage.</p>
          )}
          <p>This replaces their current {teamRoleLabels[review.person.role]} role.</p>
          {!review.person.email && (
            <p>No email is linked. Their existing staff account and Staff ID sign-in are kept.</p>
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
    </section>
  );
}
