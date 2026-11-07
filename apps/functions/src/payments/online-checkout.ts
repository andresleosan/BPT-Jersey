import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  calculateInvoiceBalance,
  parseInvoiceRecord,
  parseManualPaymentRecord,
  sameInvoicePayer,
  type InvoiceRecord,
} from "@bpt-jersey/domain/finance";
import {
  checkoutRecordSchema,
  prepareCheckoutSchema,
  savedBillingDetailsSchema,
  supportsCheckoutMethod,
  verifiedPaymentEventSchema,
  type CheckoutRecord,
  type BillingDetails,
} from "@bpt-jersey/domain/payments";
import type { UserActorContext } from "@bpt-jersey/domain";
import type { FinanceStore } from "../finance/finance-service.js";
import { requireUserActor } from "../auth/user-authorization.js";
import { isCurrentActorSession } from "../auth/active-session.js";
import { requireMemberAccountActor } from "../members/member-access-callables.js";
import { renderPaidInvoiceEmail } from "./invoice-email.js";
import type { OnlinePaymentProvider } from "./online-provider.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const denied = () => new HttpsError("permission-denied", "Payment access is unavailable.");
const root = (actor: Pick<UserActorContext, "academyId">) =>
  `academies/${idSchema.parse(actor.academyId)}`;

export async function paymentActor(request: CallableRequest<unknown>, officeOnly = false) {
  const actor = requireUserActor(request);
  const office = ["owner", "administrator"].includes(actor.role);
  if (
    (!office && (officeOnly || !["guardian", "adultStudent"].includes(actor.role))) ||
    !(await isCurrentActorSession(actor, request))
  )
    throw denied();
  if (!office) await requireMemberAccountActor(request);
  return actor;
}

/** Read payer ownership in the same transaction as the invoice. Child-profile access is insufficient. */
async function authorisedInvoice(
  db: Firestore,
  tx: Transaction,
  actor: UserActorContext,
  invoiceId: string,
): Promise<InvoiceRecord> {
  const snapshot = await tx.get(db.doc(`${root(actor)}/invoices/${idSchema.parse(invoiceId)}`));
  const invoice = parseInvoiceRecord(snapshot.data());
  if (
    !invoice.ok ||
    invoice.value.invoiceId !== snapshot.id ||
    invoice.value.academyId !== actor.academyId
  )
    throw denied();
  if (["owner", "administrator"].includes(actor.role)) return invoice.value;
  if (invoice.value.schemaVersion === 2 && invoice.value.payer.kind === "user") {
    if (invoice.value.payer.userId !== actor.userId) throw denied();
  } else {
    if (!invoice.value.familyId) throw denied();
    const family = (
      await tx.get(db.doc(`${root(actor)}/families/${idSchema.parse(invoice.value.familyId)}`))
    ).data();
    if (
      !family ||
      family.academyId !== actor.academyId ||
      family.familyId !== invoice.value.familyId ||
      family.billingContactUserId !== actor.userId
    )
      throw denied();
  }
  return invoice.value;
}

async function invoiceBalance(db: Firestore, tx: Transaction, invoice: InvoiceRecord) {
  const snapshot = await tx.get(
    db
      .collection(`academies/${invoice.academyId}/payments`)
      .where("invoiceId", "==", invoice.invoiceId),
  );
  const payments = snapshot.docs.map((doc) => {
    const parsed = parseManualPaymentRecord(doc.data());
    if (
      !parsed.ok ||
      parsed.value.paymentId !== doc.id ||
      parsed.value.academyId !== invoice.academyId ||
      !sameInvoicePayer(invoice, parsed.value)
    )
      throw new HttpsError("failed-precondition", "The invoice needs office review.");
    return parsed.value;
  });
  return calculateInvoiceBalance(invoice, payments);
}

/** Resolve the authorised invoice payer, never a browser-supplied account or a child's profile. */
async function savedPayerBilling(
  db: Firestore,
  tx: Transaction,
  invoice: InvoiceRecord,
): Promise<BillingDetails> {
  const base = `academies/${invoice.academyId}`;
  let payerUid: unknown =
    invoice.schemaVersion === 2 && invoice.payer.kind === "user" ? invoice.payer.userId : null;
  if (!payerUid && invoice.familyId) {
    const family = (
      await tx.get(db.doc(`${base}/families/${idSchema.parse(invoice.familyId)}`))
    ).data();
    if (family?.academyId === invoice.academyId && family?.familyId === invoice.familyId)
      payerUid = family.billingContactUserId;
  }
  const snapshot =
    typeof payerUid === "string" && idSchema.safeParse(payerUid).success
      ? await tx.get(db.doc(`${base}/users/${payerUid}`))
      : null;
  const user = snapshot?.data();
  const ownsProfile = user?.academyId === invoice.academyId && user?.userId === payerUid;
  // Reuse an existing billing snapshot for this invoice, without reading restricted student data.
  const history = await tx.get(
    db.collection(`${base}/onlineCheckouts`)
      .where("invoiceId", "==", invoice.invoiceId)
      .orderBy("createdAt", "desc")
      .limit(1),
  );
  const previous = checkoutRecordSchema.safeParse(history.docs[0]?.data());
  const saved =
    previous.success && previous.data.academyId === invoice.academyId && previous.data.invoiceId === invoice.invoiceId
      ? previous.data.billing
      : { name: "", email: "", line1: "", line2: "", city: "", postalCode: "", countryCode: "" };
  const name = savedBillingDetailsSchema.shape.name.safeParse(ownsProfile ? user?.displayName : "");
  const email = savedBillingDetailsSchema.shape.email.safeParse(ownsProfile ? user?.email : "");
  return savedBillingDetailsSchema.parse({
    ...saved,
    name: name.success && name.data ? name.data : saved.name,
    email: email.success && email.data ? email.data : saved.email,
  });
}

export async function prepareOnlineCheckout(
  db: Firestore,
  actor: UserActorContext,
  raw: unknown,
  provider: OnlinePaymentProvider,
): Promise<CheckoutRecord> {
  const parsed = prepareCheckoutSchema.safeParse(raw);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Check your billing details.");
  const input = parsed.data;
  const checkoutId = `checkout-${digest(`${actor.academyId}:${actor.userId}:${input.requestId}`).slice(0, 40)}`;
  const ref = db.doc(`${root(actor)}/onlineCheckouts/${checkoutId}`);
  const now = new Date().toISOString();
  const configured =
    supportsCheckoutMethod(provider.methods, input.method) && provider.name !== "unconfigured";
  const claimed = await db.runTransaction(async (tx) => {
    const invoice = await authorisedInvoice(db, tx, actor, input.invoiceId);
    const previous = await tx.get(ref);
    if (previous.exists) {
      const record = checkoutRecordSchema.parse(previous.data());
      if (
        record.invoiceId !== input.invoiceId ||
        record.requestedBy !== actor.userId ||
        record.method !== input.method ||
        (input.billing !== undefined &&
          JSON.stringify(record.billing) !== JSON.stringify(input.billing))
      )
        throw new HttpsError(
          "already-exists",
          "This request was already used with different details.",
        );
      return { record, created: false };
    }
    const balance = await invoiceBalance(db, tx, invoice);
    if (invoice.status === "void" || invoice.status === "paid" || balance <= 0)
      throw new HttpsError(
        "failed-precondition",
        "This invoice no longer needs a payment. Refresh your account.",
      );
    const rateRef = db.doc(
      `${root(actor)}/paymentRateLimits/${digest(`${actor.userId}:${now.slice(0, 10)}`)}`,
    );
    const rate = await tx.get(rateRef);
    const count = Number(rate.get("count") ?? 0);
    if (!Number.isSafeInteger(count) || count >= 20)
      throw new HttpsError("resource-exhausted", "Too many payment requests. Contact the academy.");
    const lockRef = db.doc(`${root(actor)}/paymentInvoiceLocks/${invoice.invoiceId}`);
    const lock = await tx.get(lockRef);
    if (configured && lock.exists)
      throw new HttpsError(
        "failed-precondition",
        "A payment is already in progress. Check its status before paying again.",
      );
    const billing = input.billing ?? (await savedPayerBilling(db, tx, invoice));
    const record = checkoutRecordSchema.parse({
      checkoutId,
      academyId: actor.academyId,
      invoiceId: input.invoiceId,
      requestedBy: actor.userId,
      method: input.method,
      billing,
      amountMinor: balance,
      currency: "GBP",
      status: configured ? "preparing" : "unconfigured",
      provider: provider.name,
      providerCheckoutId: null,
      checkoutUrl: null,
      paymentId: null,
      failureCode: configured ? null : "provider_unconfigured",
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    });
    tx.create(ref, record);
    tx.set(rateRef, { count: count + 1, updatedAt: now });
    if (configured) tx.create(lockRef, { checkoutId, createdAt: now });
    return { record, created: true };
  });
  if (
    !configured ||
    (!claimed.created && claimed.record.status !== "preparing") ||
    claimed.record.provider !== provider.name
  )
    return claimed.record;
  try {
    // The adapter must send checkoutId as the provider's idempotency key.
    const session = await provider.createCheckout(
      claimed.record,
      "https://www.bptjersey.com/account/billing",
    );
    const url = new URL(session.checkoutUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !provider.checkoutOrigins.includes(url.origin)
    )
      throw new Error("Invalid provider destination");
    const result = await db.runTransaction(async (tx) => {
      const latest = checkoutRecordSchema.parse((await tx.get(ref)).data());
      // A webhook may have completed while checkout creation was returning.
      if (latest.status !== "preparing") return latest;
      const next = checkoutRecordSchema.parse({
        ...latest,
        providerCheckoutId: session.providerCheckoutId,
        checkoutUrl: url.href,
        status: "requires_action",
        updatedAt: new Date().toISOString(),
      });
      tx.set(ref, next);
      return next;
    });
    return result;
  } catch {
    // A timeout may have created a real session: retain the lock until reconciled.
    return db.runTransaction(async (tx) => {
      const latest = checkoutRecordSchema.parse((await tx.get(ref)).data());
      if (latest.status !== "preparing") return latest;
      const next = {
        ...latest,
        status: "review_required" as const,
        failureCode: "provider_session_uncertain",
        updatedAt: new Date().toISOString(),
      };
      tx.set(ref, next);
      return next;
    });
  }
}

export async function listOnlineCheckouts(db: Firestore, actor: UserActorContext, raw: unknown) {
  const parsed = z.strictObject({ invoiceId: idSchema.optional() }).safeParse(raw);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid payment history request.");
  if (!parsed.data.invoiceId && !["owner", "administrator"].includes(actor.role)) throw denied();
  return db.runTransaction(async (tx) => {
    if (parsed.data.invoiceId) await authorisedInvoice(db, tx, actor, parsed.data.invoiceId);
    const collection = db.collection(`${root(actor)}/onlineCheckouts`);
    const query = parsed.data.invoiceId
      ? collection
          .where("invoiceId", "==", parsed.data.invoiceId)
          .orderBy("createdAt", "desc")
          .limit(50)
      : collection.orderBy("createdAt", "desc").limit(50);
    const snapshot = await tx.get(query);
    const items = snapshot.docs.map((doc) => checkoutRecordSchema.parse(doc.data()));
    if (items.some((item) => item.academyId !== actor.academyId)) throw denied();
    return { items };
  });
}

/** Called exclusively after provider verification. Retried delivery resumes after any lost response. */
export async function settleOnlinePayment(
  db: Firestore,
  finance: FinanceStore,
  provider: OnlinePaymentProvider,
  raw: unknown,
) {
  const event = verifiedPaymentEventSchema.parse(raw);
  const base = `academies/${event.academyId}`;
  const ref = db.doc(`${base}/onlineCheckouts/${event.checkoutId}`);
  const eventRef = db.doc(
    `${base}/paymentProviderEvents/${digest(`${provider.name}:${event.eventId}`)}`,
  );
  const checkout = await db.runTransaction(async (tx) => {
    const stored = checkoutRecordSchema.parse((await tx.get(ref)).data());
    if (
      stored.academyId !== event.academyId ||
      stored.checkoutId !== event.checkoutId ||
      stored.provider !== provider.name ||
      stored.amountMinor !== event.amountMinor ||
      stored.currency !== event.currency ||
      (stored.providerCheckoutId !== null &&
        stored.providerCheckoutId !== event.providerCheckoutId) ||
      !provider.methods.includes(event.method)
    )
      throw new Error("Payment event does not match checkout");
    // A verified notification can arrive before session creation returns, including after a
    // timeout. Bind it only through the adapter's authenticated merchant/checkout correlation.
    if (stored.providerCheckoutId === null) {
      const next = { ...stored, providerCheckoutId: event.providerCheckoutId };
      tx.set(ref, next);
      return next;
    }
    return stored;
  });
  const fingerprint = digest(JSON.stringify(event));
  const existing = await eventRef.get();
  if (existing.exists) {
    if (existing.get("fingerprint") !== fingerprint) throw new Error("Provider event conflict");
    return;
  }
  if (event.status !== "succeeded") {
    await db.runTransaction(async (tx) => {
      const latest = checkoutRecordSchema.parse((await tx.get(ref)).data());
      const seen = await tx.get(eventRef);
      const lockRef = db.doc(`${base}/paymentInvoiceLocks/${checkout.invoiceId}`);
      const lock = await tx.get(lockRef);
      if (seen.exists) {
        if (seen.get("fingerprint") !== fingerprint) throw new Error("Provider event conflict");
        return;
      }
      // Success is terminal. Late decline/cancel messages cannot undo recorded money.
      const terminalFailure = !["succeeded", "review_required"].includes(latest.status);
      if (terminalFailure)
        tx.update(ref, { status: event.status, updatedAt: new Date().toISOString() });
      tx.create(eventRef, {
        fingerprint,
        checkoutId: checkout.checkoutId,
        status: event.status,
        receivedAt: new Date().toISOString(),
      });
      if (terminalFailure && lock.get("checkoutId") === checkout.checkoutId) tx.delete(lockRef);
    });
    return;
  }
  if (!finance.recordProviderPayment) throw new Error("Provider settlement is unavailable");
  const manualReference = `online-${digest(`${provider.name}:${event.transactionId}`).slice(0, 40)}`;
  let payment;
  try {
    payment = await finance.recordProviderPayment({
      academyId: checkout.academyId,
      actorId: checkout.requestedBy,
      invoiceId: checkout.invoiceId,
      amountMinor: checkout.amountMinor,
      method: event.method,
      manualReference,
      providerReference: `${provider.name}:${event.transactionId}`,
      occurredAt: event.occurredAt,
    });
  } catch (error) {
    await ref.update({
      status: "review_required",
      failureCode: "settlement_requires_review",
      updatedAt: new Date().toISOString(),
    });
    throw error;
  }
  const invoiceView = await finance.getInvoice(
    { academyId: checkout.academyId },
    checkout.invoiceId,
  );
  const email = renderPaidInvoiceEmail(
    invoiceView.invoice,
    payment,
    checkout.billing,
    invoiceView.balanceMinor,
  );
  await db.runTransaction(async (tx) => {
    const seen = await tx.get(eventRef);
    const latest = checkoutRecordSchema.parse((await tx.get(ref)).data());
    const outboxRef = db.doc(`${base}/invoiceEmailOutbox/${payment.paymentId}`);
    const outbox = await tx.get(outboxRef);
    const lockRef = db.doc(`${base}/paymentInvoiceLocks/${checkout.invoiceId}`);
    const lock = await tx.get(lockRef);
    if (seen.exists) {
      if (seen.get("fingerprint") !== fingerprint) throw new Error("Provider event conflict");
      return;
    }
    if (latest.paymentId !== null && latest.paymentId !== payment.paymentId)
      throw new Error("Checkout already settled with another payment");
    const now = new Date().toISOString();
    tx.update(ref, {
      status: "succeeded",
      settledMethod: event.method,
      paymentId: payment.paymentId,
      failureCode: null,
      checkoutUrl: null,
      updatedAt: now,
    });
    tx.create(eventRef, {
      fingerprint,
      checkoutId: checkout.checkoutId,
      paymentId: payment.paymentId,
      status: "succeeded",
      receivedAt: now,
    });
    if (!outbox.exists)
      tx.create(outboxRef, {
        academyId: checkout.academyId,
        invoiceId: checkout.invoiceId,
        paymentId: payment.paymentId,
        to: checkout.billing.email || null,
        ...email,
        status: checkout.billing.email ? "awaiting_configuration" : "missing_recipient",
        createdAt: now,
        sentAt: null,
        schemaVersion: 1,
      });
    if (lock.get("checkoutId") === checkout.checkoutId) tx.delete(lockRef);
  });
}
