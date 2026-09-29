"use client";
import { useState } from "react";
import { coachBeltLabels, coachBelts, type CoachBelt, type TeamDirectoryPerson } from "@bpt-jersey/domain/staff/team-access";
import { deleteCoachAccount, setCoachBelt, setOwnerTeaches } from "../../../lib/team-access-client";

/** Website settings of one person: belt, «Teaches» for owners, delete for coaches. */
export function CoachWebsiteControls({ person, owner, onChanged }: { person: TeamDirectoryPerson; owner: boolean; onChanged: (message: string, updated?: TeamDirectoryPerson) => void }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [pendingBelt, setPendingBelt] = useState<CoachBelt | "">(person.coach?.belt ?? "");
  const name = person.name || person.email || "this person";
  const isCoach = person.role === "coach" || person.role === "headCoach";
  const isOwner = person.role === "owner";
  const teaches = isOwner && person.coach?.active === true;

  async function run(action: () => Promise<unknown>, done: string, updated?: TeamDirectoryPerson, onFail?: () => void) {
    setBusy(true);
    setError("");
    try {
      await action();
      setConfirming(false);
      setTyped("");
      onChanged(done, updated);
    } catch (caught) {
      onFail?.();
      setError(caught instanceof Error ? caught.message : "Unable to update this person.");
    } finally {
      setBusy(false);
    }
  }

  function chooseBelt(belt: CoachBelt) {
    if (isCoach && !person.coach) {
      setError("This coach has no coach profile.");
      return;
    }
    const previous = person.coach?.belt ?? "";
    setPendingBelt(belt);
    if (person.coach)
      void run(
        () => setCoachBelt({ userId: person.userId, belt }),
        `Belt saved for ${name}.`,
        { ...person, coach: { ...person.coach, belt } },
        () => setPendingBelt(previous),
      );
  }

  if (!isCoach && !isOwner) return <p className="staff-hint">Administrators do not appear on the website.</p>;
  return (
    <div className="coach-website-controls">
      <label className="staff-field">
        <span>Belt on website</span>
        <select value={pendingBelt} disabled={busy} onChange={(event) => chooseBelt(event.target.value as CoachBelt)}>
          {pendingBelt ? null : <option value="">Choose a belt</option>}
          {coachBelts.map((belt) => <option key={belt} value={belt}>{coachBeltLabels[belt]}</option>)}
        </select>
      </label>
      {isOwner && owner && (
        <label className="staff-field">
          <input
            type="checkbox"
            checked={teaches}
            disabled={busy || (!teaches && !pendingBelt)}
            onChange={(event) => void run(
              () => setOwnerTeaches({ userId: person.userId, teaches: event.target.checked, ...(pendingBelt ? { belt: pendingBelt } : {}) }),
              event.target.checked ? `${name} now appears on the website.` : `${name} no longer appears on the website.`,
              event.target.checked
                ? { ...person, coach: { staffKey: person.coach?.staffKey ?? person.userId, active: true, belt: pendingBelt as CoachBelt } }
                : { ...person, coach: person.coach ? { ...person.coach, active: false } : null },
            )}
          />
          <span>Teaches — show on website</span>
        </label>
      )}
      {isCoach && owner && !confirming && (
        <button className="staff-secondary-button" type="button" disabled={busy} onClick={() => setConfirming(true)}>
          Delete coach
        </button>
      )}
      {isCoach && owner && confirming && (
        <div role="group" aria-label={`Delete ${name}`}>
          <p id={`delete-coach-${person.userId}`}>This deletes {name}&apos;s login and removes them from the website. It cannot be undone. Type the coach&apos;s name to confirm.</p>
          <input autoFocus aria-describedby={`delete-coach-${person.userId}`} aria-label="Coach name" value={typed} onChange={(event) => setTyped(event.target.value)} />
          <button
            className="staff-primary-button"
            type="button"
            disabled={busy || !person.name || typed.trim() !== person.name.trim()}
            onClick={() => void run(() => deleteCoachAccount({ userId: person.userId }), `${name} was deleted.`)}
          >
            Delete permanently
          </button>
          <button className="staff-secondary-button" type="button" disabled={busy} onClick={() => { setConfirming(false); setTyped(""); }}>
            Cancel
          </button>
        </div>
      )}
      {error && <p className="staff-message staff-message-error" role="alert">{error}</p>}
    </div>
  );
}
