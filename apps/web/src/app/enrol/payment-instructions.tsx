"use client";
import { useEffect, useState } from "react";
import type { PaymentInstructionsInput } from "@bpt-jersey/domain/finance";
import { getEnrolmentPaymentInstructions } from "../../lib/enrolment-client";

// Keep the request with the form so changing steps does not fetch the same details again.
export function useEnrolmentBankDetails(sessionKey: string | undefined) {
  const [result, setResult] = useState<{
    sessionKey: string;
    details?: PaymentInstructionsInput | null;
    error: boolean;
  }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setResult(undefined);
    if (!sessionKey) return;
    let active = true;
    void getEnrolmentPaymentInstructions().then(
      (details) => {
        if (active) setResult({ sessionKey, details, error: false });
      },
      () => {
        if (active) setResult({ sessionKey, error: true });
      },
    );
    return () => {
      active = false;
    };
  }, [sessionKey, attempt]);
  const current = result?.sessionKey === sessionKey ? result : undefined;
  return {
    details: current?.details,
    error: current?.error ?? false,
    onRetry: () => setAttempt((value) => value + 1),
  };
}

export function EnrolmentBankDetails({
  details,
  error,
  onRetry,
}: ReturnType<typeof useEnrolmentBankDetails>) {
  if (error)
    return (
      <div role="alert">
        <p>Unable to load bank details.</p>
        <button
          className="button button-secondary"
          type="button"
          onClick={onRetry}
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
