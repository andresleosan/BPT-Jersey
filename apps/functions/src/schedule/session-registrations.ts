import type { Firestore, DocumentData, QuerySnapshot } from "firebase-admin/firestore";
import type { BookingRecord, SessionRegistrationRecord } from "@bpt-jersey/domain/schedule";
import {
  calculateInvoiceBalance,
  parseInvoiceRecord,
  parseManualPaymentRecord,
} from "@bpt-jersey/domain/finance";

/** Called only after the staff and course-roster guards have authorised the session. */
export async function sessionRegistrations(
  firestore: Firestore,
  academyId: string,
  bookings: readonly BookingRecord[],
): Promise<readonly SessionRegistrationRecord[]> {
  const academy = firestore.collection("academies").doc(academyId);
  const sessionInvoices = new Map<string, Promise<QuerySnapshot>>();
  const records = new Map<string, Promise<DocumentData | undefined>>();
  function read(collection: string, id: string): Promise<DocumentData | undefined> {
    if (!id || id.includes("/")) return Promise.resolve(undefined);
    const key = `${collection}/${id}`;
    let pending = records.get(key);
    if (!pending) {
      pending = academy.collection(collection).doc(id).get().then((snapshot) => {
        const data = snapshot.data();
        return data?.academyId === academyId ? data : undefined;
      });
      records.set(key, pending);
    }
    return pending;
  }

  return Promise.all(bookings.map(async (booking): Promise<SessionRegistrationRecord> => {
    const student = await read("students", booking.studentId).catch(() => undefined);
    const displayName = student?.studentId === booking.studentId && typeof student.fullName === "string"
      ? student.fullName : null;
    const result = (paymentLabel: SessionRegistrationRecord["paymentLabel"]): SessionRegistrationRecord =>
      ({ ...booking, displayName, paymentLabel });
    if (booking.schemaVersion === "2") return result("Course");
    if (booking.schemaVersion === "3") return result("Intro");
    // Unsettled is not the same as unanswered: the member already said how they mean to pay.
    const unsettled = (): SessionRegistrationRecord =>
      result(
        booking.paygPayment?.method === "at_venue"
          ? "PAYG Pay at venue"
          : booking.paygPayment?.method === "bank_transfer"
            ? "PAYG Transfer sent"
            : "PAYG Needs to pay",
      );
    try {
      const membership = await read("memberships", booking.membershipId);
      if (membership?.studentId !== booking.studentId || typeof membership.planId !== "string") {
        return result("Payment status unavailable");
      }
      const plan = await read("plans", membership.planId);
      if (plan?.billingPeriod === "monthly" || plan?.billingPeriod === "term") return result("Subscription");
      if (plan?.billingPeriod !== "per-session") return result("Payment status unavailable");

      // A family's balance or a paid subscription says nothing about this particular class.
      let pendingInvoices = sessionInvoices.get(booking.sessionId);
      if (!pendingInvoices) {
        pendingInvoices = academy.collection("invoices")
          .where("sourceRef", "==", `academies/${academyId}/sessions/${booking.sessionId}`).get();
        sessionInvoices.set(booking.sessionId, pendingInvoices);
      }
      const snapshots = await pendingInvoices;
      const invoices = snapshots.docs.flatMap((snapshot) => {
        const parsed = parseInvoiceRecord(snapshot.data());
        if (!parsed.ok) return [];
        const invoice = parsed.value;
        return invoice.academyId === academyId && invoice.invoiceId === snapshot.id &&
          invoice.chargeKind === "payg_session" && invoice.membershipId === booking.membershipId &&
          invoice.familyId === membership.familyId && invoice.status !== "void" ? [invoice] : [];
      });
      if (!invoices.length) return unsettled();
      const settled = await Promise.all(invoices.map(async (invoice) => {
        const payments = await academy.collection("payments").where("invoiceId", "==", invoice.invoiceId).get();
        const recorded = payments.docs.flatMap((snapshot) => {
          const parsed = parseManualPaymentRecord(snapshot.data());
          return parsed.ok && parsed.value.paymentId === snapshot.id ? [parsed.value] : [];
        });
        return calculateInvoiceBalance(invoice, recorded) === 0;
      }));
      return settled.every(Boolean) ? result("PAYG Paid") : unsettled();
    } catch {
      // A failed financial read must not hide the roster or claim that someone owes money.
      return result("Payment status unavailable");
    }
  }));
}
