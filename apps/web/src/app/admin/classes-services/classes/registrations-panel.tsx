"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";

import type { MemberNameRow } from "@bpt-jersey/domain/members/directory";
import type { BookingRecord, SessionRecord } from "@bpt-jersey/domain/schedule";

import { listMemberNames } from "../../../../lib/members-client";
import { listMemberships, type AdminMembership } from "../../../../lib/membership-admin-client";
import {
  cancelBooking,
  listSessionBookings,
  requestBooking,
} from "../../../../lib/schedule-client";

export type RegistrationsPanelProps = Readonly<{
  session: SessionRecord;
  canEdit: boolean;
  /** `listMemberships` is an office-only read: a head coach may edit a class but not enrol. */
  canReadMemberships: boolean;
}>;

type Tab = "member" | "group" | "external";

const tabs: readonly { id: Tab; label: string }[] = [
  { id: "member", label: "Member" },
  { id: "group", label: "Group" },
  { id: "external", label: "External" },
];

const officeRemovalReason = "Removed by the office";
const noMembership = "No active membership";
const noMembershipList = "Membership list unavailable";
const minimumSearchLength = 2;
const enrolmentPanelId = "cs-enrolment-panel";

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function surnameOf(fullName: string): string {
  const words = fullName.trim().split(/\s+/u);
  return words[words.length - 1] ?? fullName;
}

type Family = Readonly<{ familyId: string; label: string; members: readonly MemberNameRow[] }>;

/** One button per family: the label is the surname most of its students share. */
function familiesOf(members: readonly MemberNameRow[]): readonly Family[] {
  const byFamily = new Map<string, MemberNameRow[]>();
  for (const member of members) {
    if (member.familyId === null) continue;
    const group = byFamily.get(member.familyId);
    if (group) group.push(member);
    else byFamily.set(member.familyId, [member]);
  }
  return [...byFamily.entries()]
    .map(([familyId, group]) => {
      const counts = new Map<string, number>();
      for (const member of group) {
        const surname = surnameOf(member.fullName);
        counts.set(surname, (counts.get(surname) ?? 0) + 1);
      }
      const [surname] = [...counts.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0] ?? [""];
      return { familyId, label: `${surname} family`, members: group as readonly MemberNameRow[] };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function RegistrationsPanel({
  session,
  canEdit,
  canReadMemberships,
}: RegistrationsPanelProps): ReactElement {
  const [tab, setTab] = useState<Tab>("member");
  const [bookings, setBookings] = useState<readonly BookingRecord[]>([]);
  const [members, setMembers] = useState<readonly MemberNameRow[]>([]);
  const [memberships, setMemberships] = useState<readonly AdminMembership[]>([]);
  const [membershipsReady, setMembershipsReady] = useState(true);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const sessionId = session.sessionId;

  useEffect(() => {
    let abandoned = false;
    void (async () => {
      // Three independent reads with three different permissions: one refusal must not blank the
      // other two. Names simply fall back to the studentId, memberships to "no enrolment".
      // The directory and memberships are office-only, so the mat does not ask for either.
      const [bookingRows, memberRows, membershipRows] = await Promise.allSettled([
        listSessionBookings(sessionId),
        canReadMemberships ? listMemberNames() : Promise.resolve([] as readonly MemberNameRow[]),
        canReadMemberships ? listMemberships() : Promise.resolve([] as readonly AdminMembership[]),
      ]);
      if (abandoned) return;
      setLoading(false);
      if (bookingRows.status === "fulfilled") setBookings(bookingRows.value);
      else setError(messageOf(bookingRows.reason, "Unable to load the registrations"));
      if (memberRows.status === "fulfilled") setMembers(memberRows.value);
      if (membershipRows.status === "fulfilled") setMemberships(membershipRows.value);
      // Telling an administrator "no active membership" when the list never arrived would send
      // them to fix a membership that is probably fine.
      setMembershipsReady(membershipRows.status === "fulfilled");
    })();
    return () => {
      abandoned = true;
    };
  }, [sessionId, canReadMemberships]);

  const nameOf = useMemo(() => {
    const byStudent = new Map(members.map((member) => [member.studentId, member.fullName]));
    return (studentId: string) => byStudent.get(studentId) ?? studentId;
  }, [members]);

  const canEnrol = canReadMemberships && membershipsReady && !loading;
  const registered = bookings.filter((booking) => booking.status !== "cancelled");

  const matches =
    query.trim().length < minimumSearchLength
      ? []
      : members
          .filter((member) => member.fullName.toLowerCase().includes(query.trim().toLowerCase()))
          .slice(0, 20);

  const families = useMemo(() => familiesOf(members), [members]);

  async function refresh(): Promise<void> {
    try {
      setBookings(await listSessionBookings(sessionId));
    } catch (failure) {
      setError(messageOf(failure, "Unable to load the registrations"));
    }
  }

  /** Enrols one student; returns the reason it could not be done, or null on success. */
  async function enrol(studentId: string): Promise<string | null> {
    if (!membershipsReady) return noMembershipList;
    const active = memberships.filter(
      (candidate) =>
        candidate.studentId === studentId &&
        (candidate.status === "active" || candidate.status === "trial"),
    );
    if (!active.length) return noMembership;
    const sessionTime = Date.parse(session.startAt);
    const membership = active.find(
      (candidate) =>
        Date.parse(candidate.startsAt) <= sessionTime &&
        (candidate.endsAt === null || sessionTime < Date.parse(candidate.endsAt)),
    );
    if (!membership) return "This class is outside the member's paid membership period";
    try {
      await requestBooking({ sessionId, studentId, membershipId: membership.membershipId });
      return null;
    } catch (failure) {
      return messageOf(failure, "Unable to enrol this member");
    }
  }

  async function enrolOne(studentId: string): Promise<void> {
    setBusy(true);
    const failure = await enrol(studentId);
    setMessages(failure === null ? [] : [failure]);
    if (failure === null) {
      setQuery("");
      await refresh();
    }
    setBusy(false);
  }

  async function enrolFamily(family: Family): Promise<void> {
    setBusy(true);
    const failures: string[] = [];
    for (const member of family.members) {
      const failure = await enrol(member.studentId);
      if (failure !== null) failures.push(`${member.fullName}: ${failure}`);
    }
    setMessages(failures);
    await refresh();
    setBusy(false);
  }

  async function remove(studentId: string): Promise<void> {
    setBusy(true);
    try {
      await cancelBooking({ sessionId, studentId, reason: officeRemovalReason });
      await refresh();
    } catch (failure) {
      setMessages([messageOf(failure, "Unable to remove this registration")]);
    }
    setBusy(false);
  }

  return (
    <section className="cs-registrations" aria-label="Registrations">
      <h3>Registrations</h3>
      {error === null ? null : (
        <p className="cs-notice" data-kind="error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="cs-placeholder" role="status">
          Loading registrations…
        </p>
      ) : registered.length === 0 ? (
        <p className="cs-placeholder">No one is registered yet.</p>
      ) : (
        <ul className="cs-registered">
          {registered.map((booking) => (
            <li key={booking.bookingId}>
              <span className="cs-registered-name">{nameOf(booking.studentId)}</span>
              <span className="cs-registered-status">
                {booking.status === "confirmed" ? "Confirmed" : "Requested"}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  className="cs-button"
                  aria-label={`Remove ${nameOf(booking.studentId)}`}
                  disabled={busy}
                  onClick={() => void remove(booking.studentId)}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div className="cs-subtabs" role="tablist" aria-label="Enrolment source">
        {tabs.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            aria-controls={enrolmentPanelId}
            aria-selected={tab === candidate.id}
            className="cs-subtab"
            onClick={() => setTab(candidate.id)}
          >
            {candidate.label}
          </button>
        ))}
      </div>
      <div id={enrolmentPanelId} role="tabpanel" aria-label="Enrolment">
        {messages.length === 0 ? null : (
          <ul className="cs-notice" data-kind="error" role="alert">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
        {tab === "member" && canEdit ? (
          <div className="cs-enrol">
            <label className="cs-field">
              <span>Enrol a member of this gym</span>
              <input
                type="search"
                value={query}
                disabled={!canEnrol}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Type at least two letters"
              />
            </label>
            {canReadMemberships ? null : (
              <p className="cs-placeholder">Enrolment needs an office account</p>
            )}
            {canReadMemberships && !membershipsReady ? (
              <p className="cs-placeholder">{noMembershipList}</p>
            ) : null}
            <ul className="cs-results">
              {matches.map((member) => (
                <li key={member.studentId}>
                  <button
                    type="button"
                    className="cs-button"
                    disabled={busy || !canEnrol}
                    onClick={() => void enrolOne(member.studentId)}
                  >
                    {member.fullName}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {tab === "group" && canEdit ? (
          <ul className="cs-results">
            {canReadMemberships ? null : (
              <li className="cs-placeholder">Enrolment needs an office account</li>
            )}
            {canReadMemberships && !membershipsReady ? (
              <li className="cs-placeholder">{noMembershipList}</li>
            ) : null}
            {families.length === 0 ? (
              <li className="cs-placeholder">No families yet.</li>
            ) : (
              families.map((family) => (
                <li key={family.familyId}>
                  <button
                    type="button"
                    className="cs-button"
                    disabled={busy || !canEnrol}
                    onClick={() => void enrolFamily(family)}
                  >
                    {family.label}
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
        {tab === "external" ? (
          <p className="cs-placeholder">Drop-in registrations arrive with the Drop-ins release.</p>
        ) : null}
      </div>
      {canEdit ? null : <p className="cs-placeholder">Registrations are managed by the office.</p>}
    </section>
  );
}
