"use client";

import { useEffect, useState, type FormEvent } from "react";
import { selectCurrentMembership } from "@bpt-jersey/domain/memberships/lifecycle";
import type { ProgramRecord } from "@bpt-jersey/domain/schedule";
import { programAdmits } from "@bpt-jersey/domain/schedule/classes-services";
import {
  ageOnDate,
  dateKeyInJersey,
  participantTypeOn,
  type StudentGroupAccess,
} from "@bpt-jersey/domain/schedule/member-calendar";
import { listManagedPlans, type ManagedMembershipPlan } from "../../../../lib/membership-admin-client";
import { getScheduleCatalog } from "../../../../lib/schedule-client";
import { getStudentGroupAccess, saveStudentGroupAccess } from "../../../../lib/student-group-access-client";
import { getMemberSubscriptions } from "../../../../lib/subscription-admin-client";
import { audienceSummary } from "../../classes-services/types/audience-fields";

/**
 * Same rule as the member calendar: the type admits the member's age today and the current plan
 * covers their band and at least one centre where the type runs. No date of birth counts as adult.
 */
function includedByPlan(program: ProgramRecord, plan: ManagedMembershipPlan | undefined, dateOfBirth: string | null): boolean {
  if (!plan) return false;
  const today = dateKeyInJersey(new Date());
  const band = dateOfBirth ? participantTypeOn(dateOfBirth, today) : "adult";
  if (program.ageBand !== "all" && program.ageBand !== band) return false;
  if (!plan.eligibleParticipantTypes.includes(band)) return false;
  const age = dateOfBirth ? ageOnDate(dateOfBirth, today) : null;
  const sites = program.discipline === "open-mat" ? plan.openMatSites : plan.classSites;
  return sites.some((site) => programAdmits(program, age, site));
}

export function GroupAccessEditor({ studentId }: Readonly<{ studentId: string }>) {
  const [access, setAccess] = useState<StudentGroupAccess>();
  const [programs, setPrograms] = useState<readonly ProgramRecord[]>([]);
  const [plan, setPlan] = useState<ManagedMembershipPlan>();
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
    Promise.all([
      getStudentGroupAccess(studentId),
      getScheduleCatalog(),
      getMemberSubscriptions(studentId).catch(() => undefined),
      listManagedPlans().catch(() => []),
    ]).then(
      ([result, catalog, subscriptions, plans]) => {
        if (!active) return;
        const current = subscriptions && selectCurrentMembership(subscriptions.memberships);
        setPlan(current ? plans.find((candidate) => candidate.planId === current.planId) : undefined);
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
  const available = programs.filter((program) => program.active || selected.includes(program.programId));
  const dateOfBirth = access?.dateOfBirth ?? null;
  // A group already granted stays in the extra list so the office can still clear it.
  const included = available.filter(
    (program) => !selected.includes(program.programId) && includedByPlan(program, plan, dateOfBirth),
  );
  const extras = available.filter((program) => !included.includes(program));
  const missing = selected.filter((id) => !programs.some((program) => program.programId === id));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!access || saving || !changed) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await saveStudentGroupAccess({
        studentId, programIds: [...selected], revision: access.revision,
        ...(selected.length > 0
          ? { ...(reason.trim() ? { reason: reason.trim() } : {}), expiresOn: expiresOn || null }
          : {}),
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
      <p>Groups included by the member's plan and age are ticked and locked. Tick an extra group to let this member book it outside their age range or plan type.</p>
      <p>Extra groups still use the plan's centres and weekly limit. Active membership, payment standing, available places and booking deadlines also apply. Clearing a group stops new bookings in it.</p>
      {loading ? <p role="status">Loading group access…</p> : null}
      {error ? <p className="member-record-notice" role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!loading && access ? (
        <form onSubmit={(event) => void save(event)}>
          <fieldset disabled={saving} aria-describedby="member-group-access-help">
            <legend>Groups this member can book</legend>
            <p id="member-group-access-help">
              {plan
                ? `Included by ${plan.displayName}${dateOfBirth ? "" : " (no date of birth on file: treated as an adult)"}.`
                : "No current plan, so no group is included yet."}{" "}
              Tick extra groups, then save changes.
            </p>
            {included.length ? (
              <fieldset className="member-group-access-set">
                <legend>Included by plan and age</legend>
                {included.map((program) => (
                  <label key={program.programId} className="member-group-access-option">
                    <input type="checkbox" checked disabled />
                    <span>{program.name}<small>{audienceSummary(program)} · Included</small></span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            <fieldset className="member-group-access-set">
              <legend>Extra access (office)</legend>
              {extras.map((program) => (
                <label key={program.programId} className="member-group-access-option">
                  <input type="checkbox" checked={selected.includes(program.programId)} onChange={(event) => toggle(program.programId, event.target.checked)} />
                  <span>{program.name}<small>{audienceSummary(program)}{program.active ? "" : " · Inactive"}</small></span>
                </label>
              ))}
              {missing.map((id) => (
                <label key={id} className="member-group-access-option">
                  <input type="checkbox" checked onChange={() => toggle(id, false)} />
                  <span>Unavailable group<small>{id} · Clear to remove access</small></span>
                </label>
              ))}
              {!extras.length && !missing.length ? <p>No other groups are available.</p> : null}
            </fieldset>
            <label className="member-group-access-field">
              Reason for the extra access (optional)
              <textarea rows={2} maxLength={500} value={reason} aria-describedby="member-group-access-reason-help" onChange={(event) => { setNotice(""); setReason(event.target.value); }} />
            </label>
            <p id="member-group-access-reason-help">Only the office can read it.</p>
            <label className="member-group-access-field">
              Ends on (optional)
              <input type="date" value={expiresOn} onChange={(event) => { setNotice(""); setExpiresOn(event.target.value); }} />
            </label>
          </fieldset>
          <div className="member-group-access-actions">
            <button className="member-record-button" type="submit" disabled={saving || !changed}>{saving ? "Saving access…" : "Save group access"}</button>
            <button className="member-record-button" type="button" disabled={saving} onClick={() => setAttempt((value) => value + 1)}>Reload saved access</button>
          </div>
        </form>
      ) : null}
      {!loading && !access ? <button className="member-record-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Reload group access</button> : null}
    </section>
  );
}
