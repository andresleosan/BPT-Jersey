import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import {
  calculateInvoiceBalance,
  parseInvoiceRecord,
  parseManualPaymentRecord,
  sameInvoicePayer,
} from "@bpt-jersey/domain/finance";
import { renderPaidInvoiceEmail } from "./invoice-email.js";

/** Preserve manual transfer/cash recording. Prepare the same branded receipt without sending it.
 * The separate collection has no delivery worker until invoice email is explicitly configured. */
export const prepareManualPaymentInvoiceEmail = onDocumentCreated(
  { document: "academies/{academyId}/payments/{paymentId}", retry: true },
  async (event) => {
    const parsed = parseManualPaymentRecord(event.data?.data());
    if (
      !parsed.ok ||
      parsed.value.academyId !== event.params.academyId ||
      parsed.value.paymentId !== event.params.paymentId
    )
      throw new Error("Invalid invoice payment source");
    const payment = parsed.value;
    // Online settlement queues its receipt itself, resumably with the verified provider event.
    if (payment.providerReference !== null) return;
    const db = getFirestore();
    const base = `academies/${payment.academyId}`;
    const invoiceResult = parseInvoiceRecord(
      (await db.doc(`${base}/invoices/${payment.invoiceId}`).get()).data(),
    );
    if (
      !invoiceResult.ok ||
      !sameInvoicePayer(invoiceResult.value, payment) ||
      invoiceResult.value.academyId !== payment.academyId
    )
      throw new Error("Invoice payer mismatch");
    const invoice = invoiceResult.value;
    const family = payment.familyId
      ? (await db.doc(`${base}/families/${payment.familyId}`).get()).data()
      : null;
    const payerUid =
      invoice.schemaVersion === 2 && invoice.payer.kind === "user"
        ? invoice.payer.userId
        : family?.academyId === payment.academyId && family?.familyId === payment.familyId
          ? family.billingContactUserId
          : null;
    const account =
      typeof payerUid === "string"
        ? await getAuth()
            .getUser(payerUid)
            .catch((error) => {
              if (error?.code === "auth/user-not-found") return null;
              throw error;
            })
        : null;
    const billing = {
      name: account?.displayName || "BPT member",
      email: account?.email || "",
      line1: "",
      line2: "",
      city: "",
      postalCode: "",
      countryCode: "",
    };
    const payments = (
      await db.collection(`${base}/payments`).where("invoiceId", "==", payment.invoiceId).get()
    ).docs.map((doc) => {
      const result = parseManualPaymentRecord(doc.data());
      if (
        !result.ok ||
        result.value.paymentId !== doc.id ||
        result.value.academyId !== payment.academyId ||
        !sameInvoicePayer(invoice, result.value)
      )
        throw new Error("Invalid receipt source");
      return result.value;
    });
    const email = renderPaidInvoiceEmail(
      invoice,
      payment,
      billing,
      calculateInvoiceBalance(invoice, payments),
    );
    const ref = db.doc(`${base}/invoiceEmailOutbox/${payment.paymentId}`);
    await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return;
      tx.create(ref, {
        academyId: payment.academyId,
        invoiceId: payment.invoiceId,
        paymentId: payment.paymentId,
        to: account?.email ?? null,
        ...email,
        status: account?.email ? "awaiting_configuration" : "missing_recipient",
        createdAt: new Date().toISOString(),
        sentAt: null,
        schemaVersion: 1,
      });
    });
  },
);
