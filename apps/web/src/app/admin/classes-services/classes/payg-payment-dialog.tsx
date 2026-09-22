"use client";
import { useEffect, useRef } from "react";
import type { InvoiceView } from "../../../../lib/billing-client";
import { RecordPaymentDialog } from "../../billing/record-payment-dialog";

/** A second native modal keeps payment controls above the calendar dialog and contains focus. */
export function PaygPaymentDialog({ invoice, onClose, onRecorded }: {
  invoice: InvoiceView; onClose: () => void; onRecorded: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); };
  }, []);
  return <dialog ref={ref} className="group-payment-dialog" aria-labelledby="record-payment-title" onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <RecordPaymentDialog invoice={invoice} members={null} onClose={onClose} onRecorded={onRecorded} />
  </dialog>;
}
