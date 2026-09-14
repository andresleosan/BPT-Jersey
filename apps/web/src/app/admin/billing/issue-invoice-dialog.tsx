"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { ChargeKind, InvoiceRecord } from "@bpt-jersey/domain/finance";
import type { MemberNameRow } from "@bpt-jersey/domain/members/directory";

import { issueManualInvoice } from "../../../lib/billing-client";
import type { AdminMembership } from "../../../lib/membership-admin-client";
import { parseMoney } from "./billing-format";
import { MemberPicker } from "./member-picker";

import "./billing.css";

const noMembership = "__none__";

type Props = Readonly<{
  members: readonly MemberNameRow[] | null;
  membersError?: string | undefined;
  memberships: readonly AdminMembership[];
  onClose: () => void;
  onIssued: (invoice: InvoiceRecord) => void;
  issue?: typeof issueManualInvoice;
}>;

export function IssueInvoiceDialog({
  members,
  membersError,
  memberships,
  onClose,
  onIssued,
  issue = issueManualInvoice,
}: Props) {
  const [member, setMember] = useState<MemberNameRow | null>(null);
  const [membershipId, setMembershipId] = useState<string>(noMembership);
  const [form, setForm] = useState({
    amount: "",
    dueDate: "",
    chargeKind: "membership" as Exclude<ChargeKind, "payg_session">,
    invoiceReference: "",
    description: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const options = member
    ? memberships
        .filter((m) => m.studentId === member.studentId)
        .sort((a, b) => Number(b.status === "active") - Number(a.status === "active"))
    : [];

  useEffect(() => {
    setMembershipId(options[0]?.membershipId ?? noMembership);
    setForm((current) => ({
      ...current,
      chargeKind: options.length > 0 ? "membership" : "manual_adjustment",
    }));
    // options derives from member; recomputing on every options identity change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member?.studentId]);

  const chosen = options.find((m) => m.membershipId === membershipId);
  const familyId = chosen?.familyId ?? member?.familyId ?? null;
  const blocked = member !== null && familyId === null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!member || !familyId) return;
    const totalMinor = parseMoney(form.amount);
    if (totalMinor === undefined || !/^\d{4}-\d{2}-\d{2}$/u.test(form.dueDate)) {
      setError("Enter a valid positive amount and due date.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const invoice = await issue({
        familyId,
        membershipId: chosen?.membershipId ?? null,
        totalMinor,
        dueAt: `${form.dueDate}T23:59:59.000Z`,
        chargeKind: form.chargeKind,
        invoiceReference: form.invoiceReference.trim(),
        description: form.description.trim(),
      });
      onIssued(invoice);
    } catch {
      setError("The invoice could not be issued. Check the reference is unique and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      aria-labelledby="issue-invoice-title"
      aria-modal="true"
      className="billing-dialog-backdrop"
      role="dialog"
    >
      <section className="billing-dialog">
        <div className="billing-dialog-heading">
          <div>
            <p className="admin-eyebrow">Manual charge</p>
            <h3 id="issue-invoice-title">Issue invoice</h3>
          </div>
          <button
            aria-label="Close dialog"
            className="button button-secondary"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
        <form className="billing-form" onSubmit={(event) => void submit(event)}>
          <MemberPicker
            autoFocus
            error={membersError}
            members={members}
            onSelect={setMember}
            selected={member}
          />
          {member ? (
            <fieldset className="billing-form-wide">
              <legend>Membership</legend>
              <div aria-label="Membership" className="billing-choice-column" role="radiogroup">
                {options.map((m) => (
                  <label className="billing-radio" key={m.membershipId}>
                    <input
                      checked={membershipId === m.membershipId}
                      name="membership"
                      onChange={() => {
                        setMembershipId(m.membershipId);
                        setForm((current) => ({ ...current, chargeKind: "membership" }));
                      }}
                      type="radio"
                    />
                    {m.planId} · {m.status}
                  </label>
                ))}
                <label className="billing-radio">
                  <input
                    checked={membershipId === noMembership}
                    name="membership"
                    onChange={() => {
                      setMembershipId(noMembership);
                      setForm((current) => ({ ...current, chargeKind: "manual_adjustment" }));
                    }}
                    type="radio"
                  />
                  No membership · custom charge
                </label>
              </div>
            </fieldset>
          ) : null}
          {blocked ? (
            <p className="family-error billing-form-wide" role="alert">
              This member has no billing family yet. Add the family before invoicing.
            </p>
          ) : null}
          <label className="family-field">
            Invoice amount (GBP)
            <input
              aria-label="Invoice amount (GBP)"
              disabled={!member}
              inputMode="decimal"
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
              placeholder="75.00"
              required
              value={form.amount}
            />
          </label>
          <label className="family-field">
            Due date
            <input
              aria-label="Due date"
              disabled={!member}
              onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
              required
              type="date"
              value={form.dueDate}
            />
          </label>
          <label className="family-field">
            Charge type
            <select
              aria-label="Charge type"
              disabled={!member}
              onChange={(event) =>
                setForm({
                  ...form,
                  chargeKind: event.target.value as Exclude<ChargeKind, "payg_session">,
                })
              }
              value={form.chargeKind}
            >
              <option value="membership">Membership</option>
              <option value="manual_adjustment">Manual adjustment</option>
            </select>
          </label>
          <label className="family-field">
            Invoice reference
            <input
              aria-label="Invoice reference"
              autoComplete="off"
              disabled={!member}
              onChange={(event) => setForm({ ...form, invoiceReference: event.target.value })}
              required
              value={form.invoiceReference}
            />
          </label>
          <label className="family-field billing-form-wide">
            Description
            <textarea
              aria-label="Description"
              disabled={!member}
              maxLength={200}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              required
              value={form.description}
            />
          </label>
          {error ? (
            <p className="family-error billing-form-wide" role="alert">
              {error}
            </p>
          ) : null}
          <div className="billing-dialog-actions billing-form-wide">
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={onClose}
              type="button"
            >
              Keep unchanged
            </button>
            <button className="button" disabled={busy || !member || blocked} type="submit">
              {busy ? "Working…" : "Issue invoice"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
