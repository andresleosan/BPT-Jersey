import type { Firestore, Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { courseIdSchema, courseLabel, courseMutationSchema, type Course, type CourseEnrolment, type CourseMutation, type CoursePaymentIncident, type CourseRefund } from "@bpt-jersey/domain/courses";
import { parseInvoiceRecord, parseManualPaymentRecord, type CourseInvoiceRecord, type CourseManualPaymentRecord, type CoursePayer } from "@bpt-jersey/domain/finance";
import { ensureApprovedCourseStudent, type CourseIdentityDependencies } from "./course-participants.js";
import { assertCourseActorLive, appendCourseNotice, assertCourseOffice, assertCourseRevision, courseCollection, courseData, courseFailure, courseOperation, operationResult, saveOperation, type CourseActor } from "./course-store.js";

export async function prepareCourseMoney(db: Firestore, tx: Transaction, actor: CourseActor, enrolment: CourseEnrolment, course: Course, studentId: string, now: string): Promise<() => void> {
  const student = (await tx.get(courseCollection(db, actor.academyId, "students").doc(studentId))).data();
  if (!student || student.academyId !== actor.academyId) courseFailure("conflict", "Participant identity is unavailable.");
  const payer: CoursePayer = student.participantType === "minor" && student.familyId ? {kind: "family", familyId: String(student.familyId)} : {kind: "user", userId: enrolment.applicantUid};
  const familyId = payer.kind === "family" ? payer.familyId : null;
  const invoiceRef = courseCollection(db, actor.academyId, "invoices").doc(`course_invoice_${enrolment.enrolmentId}`);
  const paymentRef = courseCollection(db, actor.academyId, "payments").doc(`course_payment_${enrolment.enrolmentId}`);
  const [invoiceSnapshot, paymentSnapshot] = await Promise.all([tx.get(invoiceRef), tx.get(paymentRef)]);
  if (invoiceSnapshot.exists || paymentSnapshot.exists) {
    const invoice = parseInvoiceRecord(invoiceSnapshot.data());
    const payment = parseManualPaymentRecord(paymentSnapshot.data());
    if (!invoice.ok || !payment.ok || invoice.value.schemaVersion !== 2 || payment.value.schemaVersion !== 2 || invoice.value.sourceRef !== `academies/${actor.academyId}/courseEnrolments/${enrolment.enrolmentId}` || invoice.value.totalMinor !== enrolment.priceMinor || payment.value.amountMinor !== enrolment.priceMinor || payment.value.invoiceId !== invoice.value.invoiceId || JSON.stringify(invoice.value.payer) !== JSON.stringify(payer) || JSON.stringify(payment.value.payer) !== JSON.stringify(payer)) courseFailure("conflict", "Existing course financial records require office review.");
    return () => {};
  }
  if (enrolment.receivedMinor !== 0) courseFailure("conflict", "The recorded course balance requires office review.");
  const common = {academyId: actor.academyId, familyId, currency: "GBP" as const, schemaVersion: 2 as const, payer, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid};
  const invoice: CourseInvoiceRecord = {...common, invoiceId: invoiceRef.id, membershipId: null, chargeKind: "course", sourceRef: `academies/${actor.academyId}/courseEnrolments/${enrolment.enrolmentId}`, status: "paid", totalMinor: enrolment.priceMinor, dueAt: now, paidAt: now, invoiceReference: invoiceRef.id, description: course.title.slice(0, 200)};
  const payment: CourseManualPaymentRecord = {...common, paymentId: paymentRef.id, invoiceId: invoiceRef.id, status: "recorded", amountMinor: enrolment.priceMinor, method: "bank_transfer", manualReference: enrolment.reference, providerReference: null, occurredAt: now};
  if (!parseInvoiceRecord(invoice).ok || !parseManualPaymentRecord(payment).ok) courseFailure("invalid", "The course payment details are incomplete.");
  return () => {tx.create(invoiceRef, invoice); tx.create(paymentRef, payment);};
}

export async function resolveCoursePaymentIncident(db: Firestore, actor: CourseActor, value: CourseMutation & {incidentId: string; received: boolean; reason: string}, dependencies: CourseIdentityDependencies): Promise<CoursePaymentIncident> {
  assertCourseOffice(actor);
  const input = courseMutationSchema.extend({incidentId: courseIdSchema, received: z.boolean(), reason: courseLabel(1000)}).parse(value);
  const replay = operationResult<CoursePaymentIncident>(await courseOperation(db, actor, "resolve-incident", input.requestId).get(), input);
  if (replay) return replay;
  const identity = input.received ? await ensureApprovedCourseStudent(db, actor, input.enrolmentId, dependencies) : null;
  return db.runTransaction(async tx => {
    await assertCourseActorLive(db, tx, actor);
    const ref = courseCollection(db, actor.academyId, "courseEnrolments").doc(input.enrolmentId);
    const incidentRef = courseCollection(db, actor.academyId, "coursePaymentIncidents").doc(input.incidentId);
    const [snapshot, incidentSnapshot, receipt] = await Promise.all([tx.get(ref), tx.get(incidentRef), tx.get(courseOperation(db, actor, "resolve-incident", input.requestId))]);
    const replay = operationResult<CoursePaymentIncident>(receipt, input); if (replay) return replay;
    const enrolment = courseData<CourseEnrolment>(snapshot);
    const incident = courseData<CoursePaymentIncident>(incidentSnapshot);
    assertCourseRevision(enrolment.revision, input.expectedRevision);
    if (incident.enrolmentId !== enrolment.enrolmentId || incident.state !== "open") courseFailure("conflict", "This payment incident has already changed.");
    const now = new Date().toISOString();
    const course = courseData<Course>(await tx.get(courseCollection(db, actor.academyId, "courses").doc(enrolment.courseId)));
    const proof = (await tx.get(courseCollection(db, actor.academyId, "courseProofs").doc(incident.proofId))).data();
    if (!proof || proof.enrolmentId !== enrolment.enrolmentId || proof.state !== "attached") courseFailure("conflict", "Payment evidence is unavailable.");
    const writeMoney = input.received && identity ? await prepareCourseMoney(db, tx, actor, {...enrolment, reference: incident.reference}, course, identity.studentId, now) : () => {};
    const result: CoursePaymentIncident = {...incident, state: "resolved", resolution: `${input.received ? "Payment received; no course access granted." : "Payment not confirmed."} ${input.reason}`, resolvedAt: now};
    writeMoney();
    tx.set(incidentRef, result);
    tx.update(ref, {receivedMinor: input.received ? enrolment.priceMinor : enrolment.receivedMinor, studentId: identity?.studentId ?? enrolment.studentId, revision: enrolment.revision + 1, updatedAt: now});
    saveOperation(tx, db, actor, "resolve-incident", input.requestId, input, result);
    return result;
  });
}

export async function recordCourseRefund(db: Firestore, actor: CourseActor, value: CourseMutation & {refundId: string; amountMinor: number; reason: string; status: "pending" | "recorded" | "cancelled"; reference: string | null; occurredAt: string | null}): Promise<CourseRefund> {
  assertCourseOffice(actor);
  const input = courseMutationSchema.extend({refundId: courseIdSchema, amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), reason: courseLabel(1000), status: z.enum(["pending", "recorded", "cancelled"]), reference: courseLabel(160).nullable(), occurredAt: z.iso.datetime().nullable()}).parse(value);
  if (input.status === "recorded" && (!input.reference || !input.occurredAt || Date.parse(input.occurredAt) > Date.now())) courseFailure("invalid", "A recorded refund needs its bank reference and past transfer date.");
  return db.runTransaction(async tx => {
    await assertCourseActorLive(db, tx, actor);
    const ref = courseCollection(db, actor.academyId, "courseEnrolments").doc(input.enrolmentId);
    const refundRef = courseCollection(db, actor.academyId, "courseRefunds").doc(input.refundId);
    const [snapshot, refundSnapshot, receipt] = await Promise.all([tx.get(ref), tx.get(refundRef), tx.get(courseOperation(db, actor, "refund", input.requestId))]);
    const replay = operationResult<CourseRefund>(receipt, input); if (replay) return replay;
    const enrolment = courseData<CourseEnrolment>(snapshot); assertCourseRevision(enrolment.revision, input.expectedRevision);
    const old = refundSnapshot.exists ? refundSnapshot.data() as CourseRefund : null;
    if (old && (old.enrolmentId !== enrolment.enrolmentId || old.status !== "pending" || old.amountMinor !== input.amountMinor)) courseFailure("conflict", "Recorded or cancelled refunds cannot be changed.");
    if (!old && input.status === "cancelled") courseFailure("invalid", "Only an existing pending refund can be cancelled.");
    const pending = enrolment.pendingRefundMinor - (old?.status === "pending" ? old.amountMinor : 0) + (input.status === "pending" ? input.amountMinor : 0);
    const refunded = enrolment.refundedMinor + (input.status === "recorded" ? input.amountMinor : 0);
    if (!Number.isSafeInteger(pending + refunded) || pending < 0 || refunded + pending > enrolment.receivedMinor) courseFailure("conflict", "The refund exceeds the remaining received payment.");
    const refund: CourseRefund = {refundId: input.refundId, academyId: actor.academyId, enrolmentId: enrolment.enrolmentId, amountMinor: input.amountMinor, currency: "GBP", reason: input.reason, status: input.status, reference: input.status === "recorded" ? input.reference : null, occurredAt: input.status === "recorded" ? input.occurredAt : null, createdBy: old?.createdBy ?? actor.uid, updatedBy: actor.uid, revision: (old?.revision ?? 0) + 1};
    const now = new Date().toISOString();
    tx.set(refundRef, refund); tx.update(ref, {pendingRefundMinor: pending, refundedMinor: refunded, revision: enrolment.revision + 1, updatedAt: now});
    appendCourseNotice(tx, db, actor.academyId, {eventId: `refund:${refund.refundId}:${refund.revision}`, recipientUid: enrolment.applicantUid, courseId: enrolment.courseId, enrolmentId: enrolment.enrolmentId, kind: "refund", title: "Course refund update", message: input.status === "recorded" ? "The office has recorded your refund transfer." : input.status === "pending" ? "Your refund is pending. No transfer has been recorded yet." : "The pending refund has been cancelled.", href: "/account/courses", createdAt: now});
    saveOperation(tx, db, actor, "refund", input.requestId, input, refund);
    return refund;
  });
}
