import { enrolmentWaiverTermsVersion } from "@bpt-jersey/domain/consents/enrolment-waiver";

type Snapshot = Readonly<{ exists: boolean; data: () => Readonly<Record<string, unknown>> | undefined }>;
type Query = Readonly<{
  where: (field: string, operator: "array-contains", value: unknown) => Query;
  limit: (count: number) => Query;
}>;

export type WaiverAcceptanceReader = Readonly<{
  firestore: Readonly<{ doc: (path: string) => unknown; collection: (path: string) => unknown }>;
  transaction: Readonly<{ get: (target: never) => Promise<unknown> }>;
}>;

/**
 * D12 (2026-09-23): one rule for "this student accepted the academy terms", read inside the
 * caller's transaction. Either the current version was accepted from /account
 * (`enrolmentWaiverAcceptances/{studentId}__{version}`), or an approved online enrolment carried it
 * for this student — the same two sources getEnrolmentWaiverStatus reads.
 */
export async function hasAcceptedEnrolmentWaiver(
  reader: WaiverAcceptanceReader,
  academyId: string,
  studentId: string,
): Promise<boolean> {
  const base = `academies/${academyId}`;
  // Bound: a Firestore Transaction reads through `this`.
  const get = (reader.transaction.get as (target: unknown) => Promise<unknown>).bind(
    reader.transaction,
  );
  const accepted = (await get(
    reader.firestore.doc(`${base}/enrolmentWaiverAcceptances/${studentId}__${enrolmentWaiverTermsVersion}`),
  )) as Snapshot;
  if (accepted.exists) return true;
  const requests = (await get(
    (reader.firestore.collection(`${base}/enrolmentRequests`) as Query)
      .where("approvedStudentIds", "array-contains", studentId)
      .limit(20),
  )) as Readonly<{ docs: readonly Snapshot[] }>;
  return requests.docs.some((doc) => {
    const value = doc.data();
    const waiver = value?.waiverAcceptance as Readonly<{ version?: unknown }> | undefined;
    return value?.status === "approved" && waiver?.version === enrolmentWaiverTermsVersion;
  });
}
