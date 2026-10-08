"use client";
import { useState, type FormEvent } from "react";
import { coachBelts, coachBeltLabels, type CoachBelt, type CoachEligibleMember } from "@bpt-jersey/domain/staff/team-access";
import { grantMemberCoachAccess, listCoachEligibleMembers } from "../../../lib/team-access-client";

/** Gives an existing adult member coach access on the same login (no new email or password). */
export function MemberCoachAccessForm({ onCreated }: { onCreated: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CoachEligibleMember[] | null>(null);
  const [selected, setSelected] = useState("");
  const [belt, setBelt] = useState<CoachBelt | "">("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function search(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return setMessage("Type at least two letters.");
    setBusy(true); setMessage(""); setSelected("");
    try { setResults(await listCoachEligibleMembers(query.trim())); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to search members."); }
    finally { setBusy(false); }
  }

  async function grant() {
    const member = results?.find((item) => item.userId === selected);
    if (!member || !belt) return;
    setBusy(true); setMessage("");
    try {
      await grantMemberCoachAccess({ userId: member.userId, belt });
      setMessage(`${member.name || member.email} can now sign in at /staff/login with their member email and password, or Google.`);
      setQuery(""); setResults(null); setSelected(""); setBelt("");
      onCreated();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to give coach access."); }
    finally { setBusy(false); }
  }

  return (
    <section className="staff-card" aria-labelledby="member-coach-access-title">
      <p className="admin-eyebrow">Existing member</p>
      <h3 id="member-coach-access-title">Give coach access to a member</h3>
      <p className="staff-hint">Adult members and guardians only. They keep their member login and use it for both: /login opens their member area, /staff/login opens Coach.</p>
      <form className="staff-form-grid" onSubmit={(event) => void search(event)}>
        <label className="staff-field">Member name or email<input value={query} onChange={(e) => setQuery(e.target.value)} minLength={2} maxLength={120} required /></label>
        <button className="staff-row-action" type="submit" disabled={busy}>{busy && !results ? "Searching..." : "Search"}</button>
      </form>
      {results && results.length === 0 ? <p role="status" className="staff-message">No adult members match. Members who are already staff are not listed.</p> : null}
      {results && results.length > 0 ? (
        <fieldset className="staff-field" disabled={busy}>
          <legend>Member</legend>
          {results.map((member) => (
            <label key={member.userId}>
              <input type="radio" name="member-coach" value={member.userId} checked={selected === member.userId} onChange={() => setSelected(member.userId)} />
              {" "}{member.name || "(no name)"} · {member.email}
            </label>
          ))}
        </fieldset>
      ) : null}
      {results && results.length > 0 ? (
        <div className="staff-form-grid">
          <label className="staff-field">Belt shown on the website<select value={belt} onChange={(e) => setBelt(e.target.value as CoachBelt)} required><option value="" disabled>Choose a belt</option>{coachBelts.map((value) => <option key={value} value={value}>{coachBeltLabels[value]}</option>)}</select></label>
        </div>
      ) : null}
      {results && results.length > 0 ? (
        <button className="staff-primary-button" type="button" disabled={busy || !selected || !belt} onClick={() => void grant()}>{busy ? "Saving..." : "Give coach access"}</button>
      ) : null}
      {message ? <p role="status" className="staff-message">{message}</p> : null}
    </section>
  );
}
