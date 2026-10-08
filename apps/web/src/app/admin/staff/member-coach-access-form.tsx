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

  async function grant(event: FormEvent) {
    event.preventDefault();
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
    <div className="staff-add-form">
      <p className="staff-hint">Adult members and guardians only. They keep their member login: /login opens their member area, /staff/login opens Coach.</p>
      <form className="staff-search-row" role="search" onSubmit={(event) => void search(event)}>
        <label className="staff-field">Member name or email<input value={query} onChange={(e) => setQuery(e.target.value)} minLength={2} maxLength={120} required autoComplete="off" /></label>
        <button className="staff-secondary-button" type="submit" disabled={busy}>{busy && !results ? "Searching…" : "Search"}</button>
      </form>
      {results && results.length === 0 ? <p role="status" className="staff-hint">No adult members match. Members who are already staff are not listed.</p> : null}
      {results && results.length > 0 ? (
        <form className="staff-add-form" onSubmit={(event) => void grant(event)}>
          <fieldset className="staff-member-results" disabled={busy}>
            <legend>Choose the member</legend>
            {results.map((member) => (
              <label key={member.userId} className="staff-member-option">
                <input type="radio" name="member-coach" value={member.userId} checked={selected === member.userId} onChange={() => setSelected(member.userId)} />
                <span>
                  <strong>{member.name || "Name not on file"}</strong>
                  <span>{member.email}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="staff-search-row">
            <label className="staff-field">Belt shown on the website<select value={belt} onChange={(e) => setBelt(e.target.value as CoachBelt)} required><option value="" disabled>Choose a belt</option>{coachBelts.map((value) => <option key={value} value={value}>{coachBeltLabels[value]}</option>)}</select></label>
            <button className="staff-primary-button" type="submit" disabled={busy || !selected || !belt}>{busy ? "Saving…" : "Give coach access"}</button>
          </div>
        </form>
      ) : null}
      {message ? <p role="status" className="staff-message">{message}</p> : null}
    </div>
  );
}
