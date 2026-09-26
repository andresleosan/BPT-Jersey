import type { Firestore, Transaction } from "firebase-admin/firestore";
import {
  privateLessonPurchaseSchema,
  type PrivateLessonPurchase,
} from "@bpt-jersey/domain/private-lessons";

import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import {
  createMemberAccessService,
  memberAccessDependenciesInTransaction,
} from "../members/member-access-service.js";
import { assertIntroProof, introProofUrl } from "../memberships/intro-payment-proof.js";
import type { R2Client } from "../storage/r2-client.js";
import type {
  PrivateLessonStore,
  PrivateLessonStudent,
  PrivateLessonTransaction,
} from "./private-lesson-service.js";

const maxPurchaseRows = 200;

function readPurchaseData(
  academyId: string,
  id: string,
  data: unknown,
): PrivateLessonPurchase | null {
  if (!data || typeof data !== "object") return null;
  // The stored document carries its academy for tenant checks; the contract does not.
  const { academyId: storedAcademyId, ...purchase } = data as Record<string, unknown>;
  const parsed = privateLessonPurchaseSchema.safeParse(purchase);
  return parsed.success && parsed.data.purchaseId === id && storedAcademyId === academyId
    ? parsed.data
    : null;
}

function readStudentData(
  academyId: string,
  studentId: string,
  data: Record<string, unknown> | undefined,
): PrivateLessonStudent | null {
  if (!data || data.academyId !== academyId || data.studentId !== studentId) return null;
  return {
    studentId,
    fullName: typeof data.fullName === "string" ? data.fullName : null,
    dateOfBirth: typeof data.dateOfBirth === "string" ? data.dateOfBirth : null,
    familyId: typeof data.familyId === "string" && data.familyId ? data.familyId : null,
    active: data.active === true && data.status === "active",
  };
}

export function createFirestorePrivateLessonStore(
  db: Firestore,
  academyId: string,
  storage: () => R2Client,
): PrivateLessonStore {
  const base = `academies/${academyId}`;
  const purchases = db.collection(`${base}/privateLessonPurchases`);
  const toPurchases = (docs: readonly { id: string; data: () => unknown }[]) =>
    docs.flatMap((doc) => {
      const purchase = readPurchaseData(academyId, doc.id, doc.data());
      return purchase ? [purchase] : [];
    });
  const canAccess = (tx: Transaction) => async (userId: string, studentId: string) =>
    (
      await createMemberAccessService(memberAccessDependenciesInTransaction(db, tx)).authorise(
        academyId,
        userId,
        studentId,
      )
    ).allowed;

  return {
    runTransaction: (update) =>
      db.runTransaction((tx) => {
        const port: PrivateLessonTransaction = {
          canAccessStudent: canAccess(tx),
          async readStudent(studentId) {
            const snapshot = await tx.get(db.doc(`${base}/students/${studentId}`));
            return readStudentData(academyId, studentId, snapshot.data());
          },
          async readPurchase(purchaseId) {
            const snapshot = await tx.get(purchases.doc(purchaseId));
            return snapshot.exists
              ? readPurchaseData(academyId, purchaseId, snapshot.data())
              : null;
          },
          async readStudentPurchases(studentId) {
            const snapshot = await tx.get(
              purchases.where("studentId", "==", studentId).limit(maxPurchaseRows),
            );
            return toPurchases(snapshot.docs);
          },
          writePurchase(purchase) {
            tx.set(purchases.doc(purchase.purchaseId), { ...purchase, academyId });
          },
          writeInvoice(invoice, payment) {
            tx.create(db.doc(`${base}/invoices/${invoice.invoiceId}`), invoice);
            tx.create(db.doc(`${base}/payments/${payment.paymentId}`), payment);
          },
          appendAudit(draft) {
            appendAuditEventInTransaction(tx, db.collection(`${base}/auditEvents`).doc(), draft);
          },
        };
        return update(port);
      }),
    async listByStatus(status) {
      const snapshot = await purchases.where("status", "==", status).limit(maxPurchaseRows).get();
      return toPurchases(snapshot.docs);
    },
    async listForStudent(studentId) {
      const snapshot = await purchases
        .where("studentId", "==", studentId)
        .limit(maxPurchaseRows)
        .get();
      return toPurchases(snapshot.docs);
    },
    async studentNames(studentIds) {
      const names = new Map<string, string>();
      if (studentIds.length === 0) return names;
      const snapshots = await db.getAll(
        ...studentIds.map((studentId) => db.doc(`${base}/students/${studentId}`)),
      );
      for (const snapshot of snapshots) {
        const student = readStudentData(academyId, snapshot.id, snapshot.data());
        if (student?.fullName) names.set(student.studentId, student.fullName);
      }
      return names;
    },
    canAccessStudent: (userId, studentId) =>
      db.runTransaction((tx) => canAccess(tx)(userId, studentId)),
    verifyProof: (input) => assertIntroProof(storage(), { academyId, ...input }),
    proofUrl: (input) => introProofUrl(storage(), { academyId, ...input }),
  };
}
