"use client";
import { useEffect, useState } from "react";
import type { PaymentInstructionsInput } from "@bpt-jersey/domain/finance";
import { getEnrolmentPaymentInstructions } from "../../lib/enrolment-client";

export function EnrolmentBankDetails() {
  const [details, setDetails] = useState<PaymentInstructionsInput | null>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    void getEnrolmentPaymentInstructions().then(
      (result) => {
        if (active) setDetails(result);
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  if (error)
    return (
      <div role="alert">
        <p>Unable to load bank details.</p>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Retry bank details
        </button>
      </div>
    );
  if (details === undefined) return <p role="status">Loading bank details…</p>;
  if (!details)
    return (
      <p>
        Contact the academy for its bank details before transferring. You can attach a transfer you
        have already made.
      </p>
    );
  return (
    <dl className="enrol-bank-details">
      <dt>Account name</dt>
      <dd>{details.accountName}</dd>
      {details.bankName ? (
        <>
          <dt>Bank</dt>
          <dd>{details.bankName}</dd>
        </>
      ) : null}
      <dt>Sort code</dt>
      <dd>{details.sortCode.replace(/(\d{2})(?=\d)/gu, "$1-")}</dd>
      <dt>Account number</dt>
      <dd>{details.accountNumber}</dd>
      <dt>Payment reference</dt>
      <dd>{details.referenceHint}</dd>
    </dl>
  );
}
