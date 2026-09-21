"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { ProgramRecord } from "@bpt-jersey/domain/schedule";
import type { StudentGroupAccess } from "@bpt-jersey/domain/schedule/member-calendar";
import { getScheduleCatalog } from "../../../../lib/schedule-client";
import { getStudentGroupAccess, saveStudentGroupAccess } from "../../../../lib/student-group-access-client";

export function GroupAccessEditor({ studentId }: Readonly<{ studentId: string }>) {
  const [access, setAccess] = useState<StudentGroupAccess>();
  const [programs, setPrograms] = useState<readonly ProgramRecord[]>([]);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [reason, setReason] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setAccess(undefined);
    setError("");
    setNotice("");
    Promise.all([getStudentGroupAccess(studentId), getScheduleCatalog()]).then(
      ([result, catalog]) => {
        if (!active) return;
        setAccess(result);
        setSelected(result.programIds);
        setReason(result.reason ?? "");
        setExpiresOn(result.expiresOn ?? "");
        setPrograms(catalog.programs);
        setLoading(false);
      },
      () => {
        if (!active) return;
        setError("Unable to load group access. Reload to try again.");
        setLoading(false);
      },
    );
    return () => { active = false; };
  }, [studentId, attempt]);

  const changed = access !== undefined && (
    selected.length !== access.programIds.length || selected.some((id) => !access.programIds.includes(id)) ||
    reason.trim() !== (access.reason ?? "") || expiresOn !== (access.expiresOn ?? "")
  );
  const reasonMissing = selected.length > 0 && reason.trim().length < 2;
  const available = programs.filter((program) => program.active || selected.includes(program.programId));
  const missing = selected.filter((id) => !programs.some((program) => program.programId === id));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!access || saving || !changed || reasonMissing) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await saveStudentGroupAccess({
        studentId, programIds: [...selected], revision: access.revision,
        ...(selected.length > 0 ? { reason: reason.trim(), expiresOn: expiresOn || null } : {}),
      });
      setAccess(result);
      setSelected(result.programIds);
      setReason(result.reason ?? "");
      setExpiresOn(result.expiresOn ?? "");
      setNotice("Group access saved. The member's calendar will update on its next refresh.");
    } catch (caught) {
      const code = typeof caught === "object" && caught !== null && "code" in caught ? caught.code : undefined;
      setError(code === "functions/aborted"
        ? "Another administrator changed group access. Reload before saving again."
        : "Group access was not confirmed. Reload to check the saved permissions before trying again.");
    } finally {
      setSaving(false);
    }
  }

  function toggle(programId: string, checked: boolean) {
    setNotice("");
    setSelected((ids) => checked ? [...ids, programId] : ids.filter((id) => id !== programId));
  }

  return (
    <section className="member-group-access" aria-labelledby="member-group-access-title">
      <h2 id="member-group-access-title">Additional group access</h2>
      <p>The member keeps their usual groups. Each selected group also allows booking at any site, without using the plan's class allowance or weekly limit.</p>
      <p>Active membership, payment standing, available places and booking deadlines still apply. Removing access stops new bookings in that group.</p>
      {loading ? <p role="status">Loading group access…</p> : null}
      {error ? <p className="member-record-notice" role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!loading && access ? (
        <form onSubmit={(event) => void save(event)}>
          <fieldset disabled={saving} aria-describedby="member-group-access-help">
            <legend>Groups authorised by the office</legend>
            <p id="member-group-access-help">Select additional groups, then save changes. Clear a selection to remove its exception.</p>
            {available.map((program) => (
              <label key={program.programId} className="member-group-access-option">
                <input type="checkbox" checked={selected.includes(program.programId)} onChange={(event) => toggle(program.programId, event.target.checked)} />
                <span>{program.name}<small>{program.ageBand === "all" ? "All ages" : program.ageBand === "adult" ? "Adults" : program.ageBand === "teens" ? "Teens" : "Kids"}{program.active ? "" : " · Inactive"}</small></span>
              </label>
            ))}
            {missing.map((id) => (
              <label key={id} className="member-group-access-option">
                <input type="checkbox" checked onChange={() => toggle(id, false)} />
                <span>Unavailable group<small>{id} · Clear to remove access</small></span>
              </label>
            ))}
            {!available.length && !missing.length ? <p>No groups are available.</p> : null}
            <label className="member-group-access-field">
              Reason for this exception
              <textarea rows={2} maxLength={500} value={reason} required={selected.length > 0} aria-describedby="member-group-access-reason-help" onChange={(event) => { setNotice(""); setReason(event.target.value); }} />
            </label>
            <p id="member-group-access-reason-help">Required while any group is selected. Only the office can read it.</p>
            <label className="member-group-access-field">
              Ends on (optional)
              <input type="date" value={expiresOn} onChange={(event) => { setNotice(""); setExpiresOn(event.target.value); }} />
            </label>
          </fieldset>
          <div className="member-group-access-actions">
            <button className="member-record-button" type="submit" disabled={saving || !changed || reasonMissing}>{saving ? "Saving access…" : "Save group access"}</button>
            <button className="member-record-button" type="button" disabled={saving} onClick={() => setAttempt((value) => value + 1)}>Reload saved access</button>
          </div>
        </form>
      ) : null}
      {!loading && !access ? <button className="member-record-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Reload group access</button> : null}
    </section>
  );
}
