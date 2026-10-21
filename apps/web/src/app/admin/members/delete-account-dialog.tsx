"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import type { MemberOverviewRow } from "@bpt-jersey/domain/members/overview";
import { deleteMemberAccount } from "../../../lib/member-overview-client";
import { getProgressManagement } from "../../../lib/progress-management-client";
import { getMemberSubscriptionBilling } from "../../../lib/subscription-admin-client";
import { ModalDialog } from "./profile/payment-dialogs";

/**
 * What the office can count before deleting; a total is missing when its load failed. Only records
 * the delete removes are counted: hand-added attendance and the progress change log stay behind.
 */
type Totals = {
  attended?: number;
  /** The progress list stops at 1,000 rows, so there may be more classes. */
  attendedCut?: boolean;
  hasLevel?: boolean;
  payments?: number;
  failed: boolean;
};

/** The family's invoices and payments go only with its last member. */
const unlessFamily = ", unless the family has other members";

/** Capitals, spacing and how an accent was typed never block the confirmation. */
function comparableName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

/** "1 class attended", "12 classes attended", "1,000 or more classes attended". */
function counted(count: number, one: string, many: string, more = false): string {
  return `${count.toLocaleString("en-GB")}${more ? " or more" : ""} ${count === 1 && !more ? one : many}`;
}

/** Hard delete behind a typed full name, showing first what goes with the member. */
export function DeleteAccountDialog({
  row,
  onClose,
  onDeleted,
}: {
  row: MemberOverviewRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const titleId = useId();
  const warningId = useId();
  // ModalDialog closes after React removed it, so the browser cannot hand focus back by itself.
  const [opener] = useState(() => document.activeElement);
  const [totals, setTotals] = useState<Totals>();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(
    () => () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    },
    [opener],
  );

  useEffect(() => {
    let live = true;
    void Promise.allSettled([
      getProgressManagement(row.studentId),
      getMemberSubscriptionBilling(row.studentId),
    ]).then(([progress, billing]) => {
      if (!live) return;
      setTotals({
        ...(progress.status === "fulfilled"
          ? {
              attended: progress.value.attendance.filter((entry) => entry.kind === "attendance")
                .length,
              attendedCut: progress.value.attendance.length >= 1000,
              hasLevel: progress.value.initialized,
            }
          : {}),
        ...(billing.status === "fulfilled"
          ? {
              payments: billing.value.flatMap((item) =>
                item.invoices.flatMap((invoice) => invoice.payments),
              ).length,
            }
          : {}),
        failed: progress.status === "rejected" || billing.status === "rejected",
      });
    });
    return () => {
      live = false;
    };
  }, [row.studentId]);

  const confirmed = totals !== undefined && comparableName(typed) === comparableName(row.fullName);
  const close = () => {
    if (!busy) onClose();
  };

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !confirmed) return;
    setBusy(true);
    setError(undefined);
    try {
      await deleteMemberAccount({ studentId: row.studentId, requestId: crypto.randomUUID() });
      onDeleted();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not delete the account.");
      setBusy(false);
    }
  }

  return (
    <ModalDialog titleId={titleId} onClose={close}>
      <div className="billing-dialog-heading">
        <div>
          <p className="admin-eyebrow">{row.fullName}</p>
          <h3 id={titleId}>Delete account</h3>
        </div>
      </div>
      <form className="billing-form" onSubmit={(event) => void remove(event)}>
        <p className="member-subscription-help billing-form-wide" id={warningId}>
          This deletes the member and everything below for good, even with an active plan. A copy is
          kept for 30 days.
        </p>
        {totals === undefined ? (
          <p className="billing-form-wide" role="status">
            Checking what will be deleted…
          </p>
        ) : (
          <ul aria-label="What will be deleted" className="billing-form-wide">
            <li>
              {totals.attended === undefined
                ? "Classes attended"
                : counted(
                    totals.attended,
                    "class attended",
                    "classes attended",
                    totals.attendedCut,
                  )}
            </li>
            <li>{totals.hasLevel === false ? "No level yet" : "Current level"}</li>
            <li>
              {totals.payments === undefined
                ? `Plan payments${unlessFamily}`
                : `${counted(totals.payments, "plan payment", "plan payments")}${totals.payments === 0 ? "" : unlessFamily}`}
            </li>
            {row.plan ? <li>Plan: {row.plan.displayName}</li> : null}
            <li>Bookings</li>
            {row.ownAccount ? <li>The app login, unless another member uses it</li> : null}
          </ul>
        )}
        {totals?.failed ? (
          <p className="member-record-notice billing-form-wide" role="status">
            Some totals could not be loaded.
          </p>
        ) : null}
        <label className="family-field billing-form-wide">
          Type “{row.fullName}” to confirm
          <input
            aria-describedby={warningId}
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
            spellCheck={false}
            value={typed}
          />
        </label>
        {error ? (
          <p className="member-record-notice billing-form-wide" role="alert">
            {error}
          </p>
        ) : null}
        <div className="billing-dialog-actions billing-form-wide">
          <button className="family-text-button" disabled={busy} onClick={close} type="button">
            Cancel
          </button>
          <button className="family-danger-button" disabled={busy || !confirmed} type="submit">
            {busy ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
