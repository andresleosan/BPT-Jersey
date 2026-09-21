import { canonicalMemberIdentityIds } from "../members/member-identity-resolution.js";
import { createMemberDirectoryReadTransaction } from "../members/member-directory-firestore.js";
import { memberHistoryEntrySchema } from "@bpt-jersey/domain/members/history";
import { createHash } from "node:crypto";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { UserActorContext } from "@bpt-jersey/domain";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import { parseStoredRegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";
import { parseStudentProfile } from "@bpt-jersey/domain/profiles";
import { parseFamilyRecord } from "@bpt-jersey/domain/families";
import { parsePlanRecord } from "@bpt-jersey/domain/memberships";
import { parseMembershipRecord } from "@bpt-jersey/domain/memberships/lifecycle";
import {
  parseInvoiceRecord,
  parseManualPaymentRecord,
  type InvoiceRecord,
} from "@bpt-jersey/domain/finance";
import {
  editableSubscriptionSchema,
  manualSubscriptionSchema,
  subscriptionBillingSchema,
  type ManualSubscriptionInput,
} from "@bpt-jersey/domain/memberships/admin";
import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { expiryNotificationId } from "../notifications/notification-identifiers.js";

function fail(message: string): never {
  throw new HttpsError("failed-precondition", message);
}

function operationalDocument(document: DocumentSnapshot): boolean {
  const source: unknown = document.get("source");
  if (source === "legacy-import") return false;
  if (source !== undefined) fail("Unsupported record source.");
  return true;
}

function memberInvoices(
  documents: readonly DocumentSnapshot[],
  academyId: string,
  membershipId: string,
  familyId: string,
  operationalOnly = false,
): InvoiceRecord[] {
  if (documents.length > 100) fail("Full billing history is available in Billing.");
  return documents
    .filter((document) => !operationalOnly || operationalDocument(document))
    .map((document) => {
      const parsed = parseInvoiceRecord(document.data());
      if (
        !parsed.ok ||
        parsed.value.invoiceId !== document.id ||
        parsed.value.academyId !== academyId ||
        parsed.value.membershipId !== membershipId ||
        parsed.value.familyId !== familyId
      )
        fail("Invalid invoice record.");
      return parsed.value;
    })
    .sort((a, b) => Date.parse(b.dueAt) - Date.parse(a.dueAt));
}

function currentInvoiceFor(invoices: readonly InvoiceRecord[], administration: DocumentSnapshot) {
  if (administration.exists) {
    const id: unknown = administration.get("invoiceId");
    if (
      id === null &&
      (administration.get("complimentary") === true ||
        administration.get("payAsYouGo") === true ||
        typeof administration.get("previousPaymentRecordId") === "string")
    )
      return null;
    const linked = invoices.find((invoice) => invoice.invoiceId === id);
    if (!linked) fail("Billing link is invalid.");
    return linked;
  }
  // Older subscriptions were created through Billing, before the office link existed.
  return (
    invoices.find((invoice) => invoice.status === "open" || invoice.status === "partially_paid") ??
    invoices.find((invoice) => invoice.status !== "void") ??
    null
  );
}

/** Membership and its office settlement commit together. No payment provider is called. */
export async function saveManualSubscription(
  db: Firestore,
  actor: UserActorContext,
  raw: ManualSubscriptionInput,
) {
  if (actor.role !== "owner" && actor.role !== "administrator")
    throw new HttpsError("permission-denied", "Office access is required.");
  const input = manualSubscriptionSchema.parse(raw);
  const base = db.doc(`academies/${actor.academyId}`);
  const ref = (collection: string, id: string) => base.collection(collection).doc(id);
  const membershipId = input.membershipId ?? `manual-${input.requestId}`;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ actorId: actor.userId, input }))
    .digest("hex");
  return db.runTransaction(async (tx) => {
    const [staff, roleLock] = await Promise.all([
      tx.get(ref("users", actor.userId)),
      tx.get(ref("adminRoleLocks", actor.userId)),
    ]);
    if (
      !staff.exists ||
      roleLock.exists ||
      staff.get("userId") !== actor.userId ||
      staff.get("academyId") !== actor.academyId ||
      staff.get("active") !== true ||
      staff.get("status") !== "active" ||
      staff.get("adminRole") !== actor.role
    ) {
      throw new HttpsError("permission-denied", "Current office access is required.");
    }
    const identityIds = await canonicalMemberIdentityIds(
      createMemberDirectoryReadTransaction(db, tx),
      actor.academyId,
      input.studentId,
    );
    if (identityIds[0] !== input.studentId)
      fail("Open the canonical member before editing subscriptions.");
    const receiptRef = ref("membershipChanges", input.requestId);
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      if (receipt.get("fingerprint") !== fingerprint)
        throw new HttpsError("already-exists", "Request ID is already used.");
      return editableSubscriptionSchema.parse(receipt.get("result"));
    }
    const membershipRef = ref("memberships", membershipId);
    const administrationRef = ref("membershipAdministration", membershipId);
    const existingPages = await Promise.all(
      identityIds.map((id) =>
        tx.get(base.collection("memberships").where("studentId", "==", id).limit(101)),
      ),
    );
    const existing = {
      docs: existingPages.flatMap((page) => page.docs),
      size: existingPages.reduce((count, page) => count + page.size, 0),
    };
    const [studentDoc, planDoc, currentDoc, administrationDoc] = await Promise.all([
      tx.get(ref("students", input.studentId)),
      tx.get(ref("plans", input.planId)),
      tx.get(membershipRef),
      tx.get(administrationRef),
    ]);
    const student = parseStudentProfile(studentDoc.data());
    const plan = parsePlanRecord(planDoc.data());
    if (
      !student.ok ||
      student.value.academyId !== actor.academyId ||
      student.value.studentId !== input.studentId ||
      !student.value.active ||
      student.value.status !== "active"
    )
      fail("An active member is required.");
    if (!student.value.familyId) fail("Register the member's billing account first.");
    const family = parseFamilyRecord(
      (await tx.get(ref("families", student.value.familyId))).data(),
    );
    if (
      !family.ok ||
      family.value.academyId !== actor.academyId ||
      family.value.familyId !== student.value.familyId ||
      !family.value.active ||
      family.value.status !== "active"
    )
      fail("An active billing account is required.");
    if (
      !plan.ok ||
      plan.value.academyId !== actor.academyId ||
      plan.value.planId !== input.planId ||
      !plan.value.active
    )
      fail("Choose an active catalogue plan.");
    const transitFree = input.planId === "transit-free";
    if (
      transitFree &&
      (input.endsAt !== null ||
        input.operation === "renew" ||
        input.settlement.kind !== "complimentary")
    )
      fail("Transit Free must be indefinite and complimentary.");
    if (
      input.settlement.kind === "pay-as-you-go" &&
      (input.operation !== "assign" ||
        plan.value.billingPeriod !== "per-session" ||
        plan.value.classSites.length !== 1 ||
        plan.value.classSites[0] !== "West")
    )
      fail("Pay at class is only available for a new West pay-as-you-go subscription.");
    let previousPayment:
      | {
          recordId: string;
          capturedAt: string;
          sourceVersion: string;
          review:
            | Extract<ManualSubscriptionInput["settlement"], { kind: "previously-paid" }>["review"]
            | null;
        }
      | undefined;
    if (input.settlement.kind === "previously-paid") {
      const recordId = input.settlement.recordId;
      const [archive, recoveryLink, officeLink] = await Promise.all([
        tx.get(ref("regyfitMemberRecords", recordId)),
        tx.get(ref("regyfitMemberLinks", recordId)),
        tx.get(ref("regyfitOfficeLinks", recordId)),
      ]);
      const parsed = parseStoredRegyfitMemberRecord(archive.data());
      if (
        !parsed.ok ||
        parsed.value.recordId !== recordId ||
        (archive.get("academyId") !== undefined && archive.get("academyId") !== actor.academyId)
      )
        fail("Previous membership record is unavailable.");
      const links = [recoveryLink, officeLink].filter((link) => link.exists);
      if (
        !links.length ||
        links.some(
          (link) =>
            link.get("academyId") !== actor.academyId ||
            link.get("recordId") !== recordId ||
            !identityIds.includes(String(link.get("studentId"))),
        )
      )
        fail("Link this archive to the correct member before confirming its paid period.");
      if (!input.endsAt || Date.parse(input.startsAt) > Date.now())
        fail("Confirm the start and end of the previous paid period.");
      const sourceVersion = `${archive.updateTime!.seconds}:${archive.updateTime!.nanoseconds}`;
      const review = input.settlement.review;
      if (review) {
        const decision = await tx.get(ref("memberHistoryDecisions", review.decisionId));
        const approved = memberHistoryEntrySchema.safeParse(decision.get("result")?.entry);
        if (
          review.sourceVersion !== sourceVersion ||
          decision.get("academyId") !== actor.academyId ||
          !approved.success ||
          !identityIds.includes(approved.data.studentId) ||
          approved.data.kind !== "payment" ||
          approved.data.confirmation !== "confirmed" ||
          approved.data.sourceRecordId !== recordId ||
          !review.sourceItemIds.includes(approved.data.sourceItemId)
        )
          fail("Refresh the confirmed payment evidence before linking coverage.");
        for (const sourceItemId of review.sourceItemIds) {
          const entryId = `archive-${createHash("sha256").update(`${recordId}:${sourceVersion}:${sourceItemId}`).digest("hex")}`;
          const entryDoc = await tx.get(ref("memberHistoryEntries", entryId));
          const entry = memberHistoryEntrySchema.safeParse(entryDoc.get("entry"));
          if (
            !entry.success ||
            entryDoc.get("academyId") !== actor.academyId ||
            !identityIds.includes(entry.data.studentId) ||
            entry.data.kind !== "payment" ||
            entry.data.confirmation !== "confirmed" ||
            entry.data.sourceRecordId !== recordId ||
            entry.data.sourceVersion !== sourceVersion ||
            (entry.data.sourceItemId === approved.data.sourceItemId &&
              entryDoc.get("decisionId") !== review.decisionId)
          )
            fail("A selected historical payment is no longer confirmed.");
        }
      }
      previousPayment = {
        recordId,
        capturedAt: parsed.value.capturedAt,
        sourceVersion,
        review: review ?? null,
      };
      // A new request ID must not create a second copy of the same already confirmed paid coverage.
      if (existing.size > 100) fail("Review this member's billing history in bounded pages first.");
      const compatible = [];
      for (const doc of existing.docs.filter(operationalDocument)) {
        const candidate = parseMembershipRecord(doc.data());
        if (
          !candidate.ok ||
          candidate.value.academyId !== actor.academyId ||
          !identityIds.includes(candidate.value.studentId)
        )
          fail("Existing coverage needs review.");
        if (
          candidate.value.planId !== input.planId ||
          candidate.value.startsAt !== input.startsAt ||
          candidate.value.endsAt !== input.endsAt
        )
          continue;
        const administration = await tx.get(ref("membershipAdministration", doc.id));
        if (
          administration.get("previousPaymentRecordId") === recordId &&
          administration.get("confirmedStartsAt") === input.startsAt &&
          administration.get("confirmedEndsAt") === input.endsAt
        )
          compatible.push(candidate.value);
      }
      if (compatible.length > 1) fail("Duplicate paid coverage requires reconciliation.");
      if (compatible.length === 1) {
        const retained = compatible[0]!;
        if (
          input.operation !== "assign" &&
          (retained.membershipId !== input.membershipId ||
            new Date(retained.updatedAt).toISOString() !== input.expectedUpdatedAt)
        ) {
          throw new HttpsError("aborted", "Paid coverage changed. Refresh before saving.");
        }
        const result = editableSubscriptionSchema.parse({
          membershipId: retained.membershipId,
          studentId: input.studentId,
          planId: retained.planId,
          status: retained.status,
          startsAt: retained.startsAt,
          endsAt: retained.endsAt,
          updatedAt: retained.updatedAt,
        });
        tx.create(receiptRef, {
          fingerprint,
          result,
          previousPayment,
          reusedMembershipId: retained.membershipId,
          createdAt: new Date().toISOString(),
        });
        appendAuditEventInTransaction(tx, base.collection("auditEvents").doc(), {
          academyId: actor.academyId,
          actorId: actor.userId,
          action: "membership.subscription.updated",
          targetRef: ref("memberships", retained.membershipId).path,
          purpose: "confirmed paid coverage retained",
          correlationId: input.requestId,
        } as AuditEventDraft);
        return result;
      }
    }
    // Office may intentionally grant any active plan. Booking/consent checks remain independent.
    const parsedCurrent = currentDoc.exists ? parseMembershipRecord(currentDoc.data()) : null;
    const current = parsedCurrent?.ok ? parsedCurrent.value : null;
    if (input.operation === "assign") {
      if (
        existing.size > 100 ||
        currentDoc.exists ||
        existing.docs.filter(operationalDocument).some((doc) => {
          if (!previousPayment) return doc.get("status") !== "cancelled";
          const record = parseMembershipRecord(doc.data());
          if (!record.ok) fail("Existing coverage needs review.");
          const starts = Date.parse(record.value.startsAt);
          const ends = record.value.endsAt === null ? Infinity : Date.parse(record.value.endsAt);
          return starts < Date.parse(input.endsAt!) && Date.parse(input.startsAt) < ends;
        })
      )
        fail("A subscription already exists. Refresh and edit it.");
    } else if (
      !current ||
      current.academyId !== actor.academyId ||
      current.studentId !== input.studentId ||
      current.familyId !== student.value.familyId ||
      current.status === "cancelled"
    ) {
      fail("Subscription is unavailable.");
    } else if (new Date(current.updatedAt).toISOString() !== input.expectedUpdatedAt) {
      throw new HttpsError("aborted", "Subscription changed. Refresh before saving.");
    }
    if (
      current?.planId === "transit-free" &&
      input.planId !== "transit-free" &&
      input.settlement.kind === "unchanged"
    )
      fail("Choose the payment status when replacing Transit Free.");
    const now = new Date(
      Math.max(Date.now(), current ? Date.parse(current.updatedAt) + 1 : 0),
    ).toISOString();
    if (input.settlement.kind === "paid" && Date.parse(input.settlement.occurredAt) > Date.now())
      fail("Payment date cannot be in the future.");
    const invoiceDocuments = await tx.get(
      base.collection("invoices").where("membershipId", "==", membershipId).limit(101),
    );
    const invoices = memberInvoices(
      invoiceDocuments.docs,
      actor.academyId,
      membershipId,
      student.value.familyId,
    );
    const oldInvoice = currentInvoiceFor(invoices, administrationDoc);
    const settlement = input.settlement;
    if (
      input.operation === "update" &&
      settlement.kind !== "unchanged" &&
      !transitFree &&
      (oldInvoice?.status === "paid" || oldInvoice?.status === "partially_paid")
    )
      fail("Recorded payments are preserved. Renew for a new billing period.");
    if (
      input.operation === "renew" &&
      invoices.some((invoice) => ["open", "partially_paid"].includes(invoice.status))
    )
      fail("Settle the current amount due before renewing.");
    if (
      settlement.kind !== "unchanged" &&
      !transitFree &&
      invoices.some(
        (invoice) =>
          invoice.invoiceId !== oldInvoice?.invoiceId &&
          ["open", "partially_paid"].includes(invoice.status),
      )
    )
      fail("Settle other outstanding invoices in Billing first.");
    const reuseInvoice = input.operation === "update" && oldInvoice?.status === "open";
    const invoiceId = reuseInvoice ? oldInvoice.invoiceId : `manual-${input.requestId}`;
    const paymentId =
      settlement.kind === "paid"
        ? `payment-${createHash("sha256").update(`${actor.academyId}:${settlement.reference}`).digest("hex").slice(0, 40)}`
        : null;
    if (paymentId && (await tx.get(ref("payments", paymentId))).exists)
      throw new HttpsError("already-exists", "Payment reference already recorded.");
    const oldNoticeRef = current?.endsAt
      ? ref("adminNotifications", expiryNotificationId(membershipId, current.endsAt))
      : null;
    const oldNotice = oldNoticeRef ? await tx.get(oldNoticeRef) : null;
    const record = {
      ...(current ?? {
        membershipId,
        academyId: actor.academyId,
        studentId: input.studentId,
        familyId: student.value.familyId,
        schemaVersion: "1",
        createdAt: now,
        createdBy: actor.userId,
      }),
      planId: input.planId,
      // Renewal must preserve access through the remainder of the current paid period.
      startsAt:
        input.operation === "renew" &&
        current &&
        Date.parse(current.startsAt) < Date.parse(input.startsAt)
          ? current.startsAt
          : input.startsAt,
      endsAt: input.endsAt,
      nextBillingAt: input.endsAt,
      status:
        settlement.kind === "unchanged"
          ? current!.status
          : settlement.kind === "unpaid"
            ? "overdue"
            : previousPayment && input.endsAt && Date.parse(input.endsAt) <= Date.parse(now)
              ? "cancelled"
              : "active",
      updatedAt: now,
      updatedBy: actor.userId,
    };
    if (!parseMembershipRecord(record).ok) fail("Subscription dates are invalid.");
    const audit = (action: AuditEventDraft["action"], targetRef: string, purpose: string) =>
      appendAuditEventInTransaction(tx, base.collection("auditEvents").doc(), {
        academyId: actor.academyId,
        actorId: actor.userId,
        action,
        targetRef,
        purpose,
        correlationId: input.requestId,
        ...(action.startsWith("invoice.") || action === "payment.recorded"
          ? {
              amountMinor:
                settlement.kind === "paid" || settlement.kind === "unpaid"
                  ? settlement.amountMinor
                  : oldInvoice!.totalMinor,
              currency: "GBP",
            }
          : {}),
        ...(action === "payment.recorded" && settlement.kind === "paid"
          ? { method: settlement.method }
          : {}),
      } as AuditEventDraft);
    if (settlement.kind === "paid" || settlement.kind === "unpaid") {
      if (reuseInvoice && oldInvoice.totalMinor !== settlement.amountMinor)
        fail("The amount must match the existing unpaid invoice.");
      const invoice = {
        ...(reuseInvoice ? oldInvoice : {}),
        invoiceId,
        academyId: actor.academyId,
        familyId: student.value.familyId,
        membershipId,
        status: settlement.kind === "paid" ? "paid" : "open",
        totalMinor: settlement.amountMinor,
        currency: "GBP",
        dueAt: input.startsAt,
        paidAt: settlement.kind === "paid" ? settlement.occurredAt : null,
        schemaVersion: 1,
        createdAt: reuseInvoice ? oldInvoice.createdAt : now,
        createdBy: reuseInvoice ? oldInvoice.createdBy : actor.userId,
        updatedAt: now,
        updatedBy: actor.userId,
        chargeKind: "membership",
        sourceRef: null,
        invoiceReference: reuseInvoice ? oldInvoice.invoiceReference : `MANUAL-${input.requestId}`,
        description:
          `${plan.value.displayName}: ${input.startsAt.slice(0, 10)} to ${input.endsAt?.slice(0, 10) ?? "no end date"}`.slice(
            0,
            200,
          ),
      };
      if (!parseInvoiceRecord(invoice).ok) fail("Invoice is invalid.");
      tx.set(ref("invoices", invoiceId), invoice);
      audit(
        reuseInvoice ? "invoice.status.changed" : "invoice.created",
        ref("invoices", invoiceId).path,
        "office subscription settlement",
      );
      if (settlement.kind === "paid" && paymentId) {
        const payment = {
          paymentId,
          academyId: actor.academyId,
          familyId: student.value.familyId,
          invoiceId,
          status: "recorded",
          amountMinor: settlement.amountMinor,
          currency: "GBP",
          method: settlement.method,
          manualReference: settlement.reference,
          providerReference: null,
          occurredAt: settlement.occurredAt,
          schemaVersion: 1,
          createdAt: now,
          createdBy: actor.userId,
          updatedAt: now,
          updatedBy: actor.userId,
        };
        if (!parseManualPaymentRecord(payment).ok) fail("Payment is invalid.");
        tx.create(ref("payments", paymentId), payment);
        audit(
          "payment.recorded",
          ref("payments", paymentId).path,
          "office received subscription payment",
        );
      }
      tx.set(administrationRef, {
        invoiceId,
        complimentary: false,
        transitFree: false,
        updatedAt: now,
        updatedBy: actor.userId,
      });
    } else if (settlement.kind === "complimentary") {
      if (reuseInvoice) {
        tx.set(ref("invoices", oldInvoice.invoiceId), {
          ...oldInvoice,
          status: "void",
          updatedAt: now,
          updatedBy: actor.userId,
        });
        audit(
          "invoice.voided",
          ref("invoices", oldInvoice.invoiceId).path,
          "office waived unpaid subscription charge",
        );
      }
      tx.set(administrationRef, {
        invoiceId: null,
        complimentary: true,
        transitFree,
        reason: settlement.reason,
        updatedAt: now,
        updatedBy: actor.userId,
      });
    }
    if (previousPayment)
      tx.set(administrationRef, {
        invoiceId: null,
        complimentary: false,
        previousPaymentRecordId: previousPayment.recordId,
        sourceCapturedAt: previousPayment.capturedAt,
        sourceVersion: previousPayment.sourceVersion,
        historyReview: previousPayment.review,
        confirmedStartsAt: input.startsAt,
        confirmedEndsAt: input.endsAt,
        reason: "Previous payment verified by the office; original payment history retained.",
        updatedAt: now,
        updatedBy: actor.userId,
      });
    if (settlement.kind === "pay-as-you-go")
      tx.set(administrationRef, {
        invoiceId: null,
        complimentary: false,
        payAsYouGo: true,
        updatedAt: now,
        updatedBy: actor.userId,
      });
    tx.set(membershipRef, record);
    if (oldNoticeRef && oldNotice?.exists && input.endsAt !== current?.endsAt)
      tx.set(oldNoticeRef, { ...oldNotice.data(), resolvedAt: now, readAt: now });
    const result = editableSubscriptionSchema.parse({
      membershipId,
      studentId: input.studentId,
      planId: record.planId,
      status: record.status,
      startsAt: record.startsAt,
      endsAt: record.endsAt,
      updatedAt: now,
    });
    tx.create(receiptRef, {
      fingerprint,
      result,
      ...(previousPayment ? { previousPayment } : {}),
      createdAt: now,
    });
    audit(
      current ? "membership.subscription.updated" : "membership.created",
      membershipRef.path,
      settlement.kind === "complimentary"
        ? transitFree
          ? "transit free: " + settlement.reason
          : "complimentary: " + settlement.reason
        : `manual subscription ${input.operation}`,
    );
    return result;
  });
}

export async function listSubscriptionBilling(db: Firestore, academyId: string, studentId: string) {
  const base = db.doc(`academies/${academyId}`);
  const student = parseStudentProfile(
    (await base.collection("students").doc(studentId).get()).data(),
  );
  if (!student.ok || student.value.academyId !== academyId || student.value.studentId !== studentId)
    throw new HttpsError("not-found", "Member record unavailable.");
  if (!student.value.familyId) return [];
  const memberships = await base
    .collection("memberships")
    .where("studentId", "==", studentId)
    .limit(101)
    .get();
  if (memberships.size > 100) fail("Too many subscriptions. Contact the office.");
  return Promise.all(
    memberships.docs.filter(operationalDocument).map(async (document) => {
      const parsed = parseMembershipRecord(document.data());
      if (
        !parsed.ok ||
        parsed.value.academyId !== academyId ||
        parsed.value.studentId !== studentId ||
        parsed.value.membershipId !== document.id ||
        parsed.value.familyId !== student.value.familyId
      )
        fail("Invalid membership record.");
      const [invoices, administration] = await Promise.all([
        base.collection("invoices").where("membershipId", "==", document.id).limit(101).get(),
        base.collection("membershipAdministration").doc(document.id).get(),
      ]);
      const validatedInvoices = memberInvoices(
        invoices.docs,
        academyId,
        document.id,
        parsed.value.familyId,
        true,
      );
      const currentInvoice = currentInvoiceFor(validatedInvoices, administration);
      // Firestore supports up to 30 operands in an `in` query. Read receipts in bounded batches.
      const invoiceIds = validatedInvoices.map((invoice) => invoice.invoiceId);
      const chunks = Array.from({ length: Math.ceil(invoiceIds.length / 30) }, (_, index) =>
        invoiceIds.slice(index * 30, index * 30 + 30),
      );
      const receiptPages = await Promise.all(
        chunks.map((ids) =>
          base.collection("payments").where("invoiceId", "in", ids).limit(1001).get(),
        ),
      );
      const receipts = receiptPages.flatMap((page) => {
        if (page.size > 1000) fail("Full payment history is available in Billing.");
        return page.docs.filter(operationalDocument).map((doc) => {
          const payment = parseManualPaymentRecord(doc.data());
          if (
            !payment.ok ||
            payment.value.paymentId !== doc.id ||
            payment.value.academyId !== academyId ||
            payment.value.familyId !== parsed.value.familyId ||
            !invoiceIds.includes(payment.value.invoiceId)
          )
            fail("Invalid payment record.");
          return payment.value;
        });
      });
      return subscriptionBillingSchema.parse({
        membershipId: document.id,
        complimentary: administration.get("complimentary") === true,
        ...(typeof administration.get("previousPaymentRecordId") === "string"
          ? { previousPaymentRecordId: administration.get("previousPaymentRecordId") }
          : {}),
        currentInvoiceId: currentInvoice?.invoiceId ?? null,
        reason: administration.get("reason") ?? null,
        invoices: validatedInvoices
          .map((invoice) => {
            const { invoiceId, status, totalMinor, paidAt, dueAt, description } = invoice;
            const payments = receipts
              .filter((payment) => payment.invoiceId === invoiceId)
              .map(({ paymentId, amountMinor, method, manualReference, occurredAt }) => ({
                paymentId,
                amountMinor,
                method,
                reference: manualReference,
                occurredAt: new Date(occurredAt).toISOString(),
              }))
              .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
            return {
              invoiceId,
              status,
              totalMinor,
              paidAt: paidAt ? new Date(paidAt).toISOString() : null,
              dueAt: new Date(dueAt).toISOString(),
              description,
              payments,
            };
          })
          .sort((a, b) => b.dueAt.localeCompare(a.dueAt)),
      });
    }),
  );
}
