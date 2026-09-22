"use client";

import { PaygPaymentDialog } from "./payg-payment-dialog";
import type { InvoiceView } from "../../../../lib/billing-client";
import { preparePaygClassPayment } from "../../../../lib/groups-client";
import { GroupRegistrations } from "./group-registrations";
import { useEffect, useMemo, useState, type ReactElement } from "react";

import type { MemberNameRow } from "@bpt-jersey/domain/members/directory";
import type { SessionRegistrationRecord, SessionRecord } from "@bpt-jersey/domain/schedule";

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

export function RegistrationsPanel({
  session,
  canEdit,
  canReadMemberships,
}: RegistrationsPanelProps): ReactElement {
  const [paymentInvoice, setPaymentInvoice] = useState<InvoiceView | null>(null);
  const [tab, setTab] = useState<Tab>("member");
  const [bookings, setBookings] = useState<readonly SessionRegistrationRecord[]>([]);
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
      // other two. Roster names come from the session; directory names are an office fallback.
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


  async function refresh(): Promise<void> {
    try {
      setBookings(await listSessionBookings(sessionId));
      setError(null);
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
      await requestBooking({
        kind: "membership",
        sessionId,
        studentId,
        membershipId: membership.membershipId,
      });
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
      {paymentInvoice && canReadMemberships ? <PaygPaymentDialog invoice={paymentInvoice} onClose={() => setPaymentInvoice(null)} onRecorded={() => { setPaymentInvoice(null); void refresh(); }} /> : null}
      <button
        type="button"
        className="cs-button"
        disabled={loading || busy}
        onClick={async () => {
          setBusy(true);
          await refresh();
          setBusy(false);
        }}
      >
        Refresh registrations
      </button>
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
              <span className="cs-registered-name">{booking.displayName ?? nameOf(booking.studentId)}</span>
              <span className="cs-registered-status">
                {booking.status === "confirmed" ? "Confirmed" : "Requested"}
              </span>
              <span
                className="cs-registration-payment"
                data-payment={booking.paymentLabel === "PAYG Paid" ? "paid" : booking.paymentLabel === "PAYG Needs to pay" ? "due" : "other"}
              >
                {booking.paymentLabel ?? "Payment status unavailable"}
              </span>
              {canReadMemberships && booking.paymentLabel === "PAYG Needs to pay" ? (
                <button className="cs-button" type="button" disabled={busy} onClick={async () => {
                  setBusy(true); setMessages([]);
                  try {
                    const invoice = await preparePaygClassPayment(sessionId, booking.studentId);
                    if (invoice.balanceMinor > 0) setPaymentInvoice(invoice);
                    else await refresh();
                  } catch (error) { setMessages([messageOf(error, "Unable to prepare class payment")]); }
                  finally { setBusy(false); }
                }}>Record class payment</button>
              ) : null}
              {canEdit ? (
                <button
                  type="button"
                  className="cs-button"
                  aria-label={`Remove ${booking.displayName ?? nameOf(booking.studentId)}`}
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
        {tab === "group" ? (
          <GroupRegistrations sessionId={sessionId} canManage={canReadMemberships} onChanged={refresh} />
        ) : null}
        {tab === "external" ? (
          <p className="cs-placeholder">Drop-in registrations arrive with the Drop-ins release.</p>
        ) : null}
      </div>
      {canEdit ? null : <p className="cs-placeholder">Registrations are managed by the office.</p>}
    </section>
  );
}
