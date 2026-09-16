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
}>;

type Tab = "member" | "group" | "external";

const tabs: readonly { id: Tab; label: string }[] = [
  { id: "member", label: "Member" },
  { id: "group", label: "Group" },
  { id: "external", label: "External" },
];

const officeRemovalReason = "Removed by the office";
const noMembership = "No active membership";
const minimumSearchLength = 2;

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

export function RegistrationsPanel({ session, canEdit }: RegistrationsPanelProps): ReactElement {
  const [tab, setTab] = useState<Tab>("member");
  const [bookings, setBookings] = useState<readonly BookingRecord[]>([]);
  const [members, setMembers] = useState<readonly MemberNameRow[]>([]);
  const [memberships, setMemberships] = useState<readonly AdminMembership[]>([]);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sessionId = session.sessionId;

  useEffect(() => {
    let abandoned = false;
    void (async () => {
      try {
        const [bookingRows, memberRows, membershipRows] = await Promise.all([
          listSessionBookings(sessionId),
          listMemberNames(),
          canEdit ? listMemberships() : Promise.resolve([] as readonly AdminMembership[]),
        ]);
        if (abandoned) return;
        setBookings(bookingRows);
        setMembers(memberRows);
        setMemberships(membershipRows);
      } catch (failure) {
        if (!abandoned) setError(messageOf(failure, "Unable to load the registrations"));
      }
    })();
    return () => {
      abandoned = true;
    };
  }, [sessionId, canEdit]);

  const nameOf = useMemo(() => {
    const byStudent = new Map(members.map((member) => [member.studentId, member.fullName]));
    return (studentId: string) => byStudent.get(studentId) ?? studentId;
  }, [members]);

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
    const membership = memberships.find(
      (candidate) =>
        candidate.studentId === studentId &&
        (candidate.status === "active" || candidate.status === "trial"),
    );
    if (!membership) return noMembership;
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
      {registered.length === 0 ? (
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
            aria-selected={tab === candidate.id}
            className="cs-subtab"
            onClick={() => setTab(candidate.id)}
          >
            {candidate.label}
          </button>
        ))}
      </div>
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
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type at least two letters"
            />
          </label>
          <ul className="cs-results">
            {matches.map((member) => (
              <li key={member.studentId}>
                <button
                  type="button"
                  className="cs-button"
                  disabled={busy}
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
          {families.length === 0 ? (
            <li className="cs-placeholder">No family has more than one member yet.</li>
          ) : (
            families.map((family) => (
              <li key={family.familyId}>
                <button
                  type="button"
                  className="cs-button"
                  disabled={busy}
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
      {canEdit ? null : <p className="cs-placeholder">Registrations are managed by the office.</p>}
    </section>
  );
}
