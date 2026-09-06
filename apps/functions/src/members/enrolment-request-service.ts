import {
  isOpenEnrolmentRequest,
  parseEnrolmentRequestRecord,
  type EnrolmentRequestRecord,
  type EnrolmentRequestSubmission,
} from "@bpt-jersey/domain/members/enrolment-requests";

export type EnrolmentDocumentData = Readonly<Record<string, unknown>>;
export type EnrolmentDocumentReference = Readonly<{ id: string; path: string }>;
export type EnrolmentDocumentSnapshot = Readonly<{
  id: string;
  exists: boolean;
  data: () => EnrolmentDocumentData | undefined;
}>;
export type EnrolmentQuerySnapshot = Readonly<{ docs: readonly EnrolmentDocumentSnapshot[] }>;
export type EnrolmentQuery = Readonly<{
  path: string;
  field: string;
  value: unknown;
  limit: number;
}>;
export type EnrolmentCollection = Readonly<{
  doc: (id?: string) => EnrolmentDocumentReference;
  where: (
    field: string,
    operator: "==",
    value: unknown,
  ) => Readonly<{ limit: (count: number) => EnrolmentQuery }>;
}>;
export type EnrolmentTransaction = Readonly<{
  get: (
    target: EnrolmentDocumentReference | EnrolmentQuery,
  ) => Promise<EnrolmentDocumentSnapshot | EnrolmentQuerySnapshot>;
  create: (ref: EnrolmentDocumentReference, data: EnrolmentDocumentData) => EnrolmentTransaction;
  set: (ref: EnrolmentDocumentReference, data: EnrolmentDocumentData) => EnrolmentTransaction;
}>;
export type EnrolmentFirestore = Readonly<{
  doc: (path: string) => EnrolmentDocumentReference;
  collection: (path: string) => EnrolmentCollection;
  runTransaction: <T>(callback: (transaction: EnrolmentTransaction) => Promise<T>) => Promise<T>;
}>;

export type EnrolmentAuditAction =
  "enrolment.request.submitted" | "enrolment.request.returned" | "enrolment.request.withdrawn";
export type EnrolmentAuditDraft = Readonly<{
  academyId: string;
  actorId: string;
  action: EnrolmentAuditAction;
  targetRef: string;
  purpose: string;
  correlationId: string;
}>;

export type EnrolmentRequestStoreDependencies = Readonly<{
  firestore: EnrolmentFirestore;
  appendAudit: (
    transaction: EnrolmentTransaction,
    reference: EnrolmentDocumentReference,
    draft: EnrolmentAuditDraft,
  ) => void;
}>;

export type SubmitEnrolmentRequestInput = Readonly<{
  academyId: string;
  actorId: string;
  now: string;
  submission: EnrolmentRequestSubmission;
}>;
export type ReviewEnrolmentRequestInput = Readonly<{
  academyId: string;
  actorId: string;
  now: string;
  enrolmentRequestId: string;
  note: string;
}>;
export type WithdrawEnrolmentRequestInput = Readonly<{
  academyId: string;
  actorId: string;
  now: string;
  enrolmentRequestId: string;
}>;

export type EnrolmentRequestStore = Readonly<{
  submit: (input: SubmitEnrolmentRequestInput) => Promise<EnrolmentRequestRecord>;
  listForAcademy: (academyId: string) => Promise<readonly EnrolmentRequestRecord[]>;
  listForSubmitter: (
    academyId: string,
    actorId: string,
  ) => Promise<readonly EnrolmentRequestRecord[]>;
  returnForChanges: (input: ReviewEnrolmentRequestInput) => Promise<EnrolmentRequestRecord>;
  withdraw: (input: WithdrawEnrolmentRequestInput) => Promise<EnrolmentRequestRecord>;
}>;

export type EnrolmentRequestStoreErrorCode =
  "invalid" | "tenant" | "not-found" | "conflict" | "precondition";

export class EnrolmentRequestStoreError extends Error {
  public readonly code: EnrolmentRequestStoreErrorCode;

  public constructor(code: EnrolmentRequestStoreErrorCode, message: string) {
    super(message);
    this.name = "EnrolmentRequestStoreError";
    this.code = code;
  }
}

const safePathSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const dateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
export const ENROLMENT_REQUEST_QUERY_LIMIT = 200;
export const ENROLMENT_REQUEST_SUBMITTER_QUERY_LIMIT = 20;

function id(value: string, label: string): string {
  if (typeof value !== "string" || !safePathSegmentPattern.test(value))
    throw new EnrolmentRequestStoreError("invalid", `Invalid ${label}`);
  return value;
}
function timestamp(value: string): string {
  if (typeof value !== "string" || !dateTimePattern.test(value) || Number.isNaN(Date.parse(value)))
    throw new EnrolmentRequestStoreError("invalid", "Invalid enrolment timestamp");
  return value;
}
function collectionPath(academyId: string, collection: string): string {
  return `academies/${academyId}/${collection}`;
}
function asDocument(
  value: EnrolmentDocumentSnapshot | EnrolmentQuerySnapshot,
): EnrolmentDocumentSnapshot {
  if ("docs" in value)
    throw new EnrolmentRequestStoreError("invalid", "Expected document snapshot");
  return value;
}
function asQuery(
  value: EnrolmentDocumentSnapshot | EnrolmentQuerySnapshot,
): EnrolmentQuerySnapshot {
  if (!("docs" in value))
    throw new EnrolmentRequestStoreError("invalid", "Expected query snapshot");
  return value;
}
function stored(snapshot: EnrolmentDocumentSnapshot, academyId: string): EnrolmentRequestRecord {
  const parsed = parseEnrolmentRequestRecord(snapshot.data());
  if (!parsed.ok)
    throw new EnrolmentRequestStoreError("invalid", "Stored enrolment request contract rejected");
  if (parsed.value.academyId !== academyId || parsed.value.enrolmentRequestId !== snapshot.id)
    throw new EnrolmentRequestStoreError("tenant", "Enrolment request tenant mismatch");
  return parsed.value;
}
function newestFirst(
  records: readonly EnrolmentRequestRecord[],
): readonly EnrolmentRequestRecord[] {
  return Object.freeze(
    [...records].sort(
      (left, right) =>
        right.submittedAt.localeCompare(left.submittedAt) ||
        left.enrolmentRequestId.localeCompare(right.enrolmentRequestId),
    ),
  );
}

/** The document id is derived from the client request id, so a retry lands on the same request. */
export function enrolmentRequestId(requestId: string): string {
  return `enrolment-${requestId}`;
}

export function createEnrolmentRequestStore(
  dependencies: EnrolmentRequestStoreDependencies,
): EnrolmentRequestStore {
  const { firestore } = dependencies;

  function audit(
    transaction: EnrolmentTransaction,
    academyId: string,
    actorId: string,
    action: EnrolmentAuditAction,
    targetRef: string,
  ): void {
    const reference = firestore.collection(collectionPath(academyId, "auditEvents")).doc();
    dependencies.appendAudit(transaction, reference, {
      academyId,
      actorId,
      action,
      targetRef,
      purpose: "self-service enrolment request",
      correlationId: `enrolment:${reference.id}`,
    });
  }

  async function read(
    academyId: string,
    field: "academyId" | "submittedBy",
    value: string,
    limit: number,
  ): Promise<readonly EnrolmentRequestRecord[]> {
    const query = firestore
      .collection(collectionPath(academyId, "enrolmentRequests"))
      .where(field, "==", value)
      .limit(limit);
    const snapshot = await firestore.runTransaction(async (transaction) =>
      asQuery(await transaction.get(query)),
    );
    return newestFirst(snapshot.docs.map((document) => stored(document, academyId)));
  }

  async function transition(
    input: ReviewEnrolmentRequestInput | WithdrawEnrolmentRequestInput,
    status: "returned" | "withdrawn",
    action: EnrolmentAuditAction,
    note: string | undefined,
    requireOwner: boolean,
  ): Promise<EnrolmentRequestRecord> {
    const academyId = id(input.academyId, "academy");
    const actorId = id(input.actorId, "actor");
    const now = timestamp(input.now);
    const reference = firestore.doc(
      `${collectionPath(academyId, "enrolmentRequests")}/${id(input.enrolmentRequestId, "enrolment request")}`,
    );
    return firestore.runTransaction(async (transaction) => {
      const snapshot = asDocument(await transaction.get(reference));
      if (!snapshot.exists)
        throw new EnrolmentRequestStoreError("not-found", "Enrolment request not found");
      const existing = stored(snapshot, academyId);
      if (requireOwner && existing.submittedBy !== actorId)
        throw new EnrolmentRequestStoreError("not-found", "Enrolment request not found");
      if (!isOpenEnrolmentRequest(existing.status))
        throw new EnrolmentRequestStoreError(
          "precondition",
          "This request was already resolved and cannot change",
        );
      const candidate = parseEnrolmentRequestRecord({
        ...existing,
        status,
        reviewedBy: actorId,
        reviewedAt: now,
        ...(note === undefined ? {} : { reviewNote: note }),
      });
      if (!candidate.ok)
        throw new EnrolmentRequestStoreError("invalid", "Enrolment request contract rejected");
      transaction.set(reference, candidate.value);
      audit(transaction, academyId, actorId, action, reference.path);
      return candidate.value;
    });
  }

  return Object.freeze({
    async submit(input) {
      const academyId = id(input.academyId, "academy");
      const actorId = id(input.actorId, "actor");
      const now = timestamp(input.now);
      const reference = firestore.doc(
        `${collectionPath(academyId, "enrolmentRequests")}/${enrolmentRequestId(
          id(input.submission.requestId, "request"),
        )}`,
      );
      const openRequests = firestore
        .collection(collectionPath(academyId, "enrolmentRequests"))
        .where("submittedBy", "==", actorId)
        .limit(ENROLMENT_REQUEST_SUBMITTER_QUERY_LIMIT);

      return firestore.runTransaction(async (transaction) => {
        const snapshot = asDocument(await transaction.get(reference));
        if (snapshot.exists) {
          // A retry of the same submission is the same request, not a second one.
          const existing = stored(snapshot, academyId);
          if (existing.submittedBy !== actorId)
            throw new EnrolmentRequestStoreError("conflict", "Request id already used");
          return existing;
        }
        const mine = asQuery(await transaction.get(openRequests));
        const alreadyOpen = mine.docs
          .map((document) => stored(document, academyId))
          .some((record) => isOpenEnrolmentRequest(record.status));
        if (alreadyOpen)
          throw new EnrolmentRequestStoreError(
            "precondition",
            "You already have a request waiting for the academy to review",
          );

        const candidate = parseEnrolmentRequestRecord({
          enrolmentRequestId: reference.id,
          academyId,
          requestId: input.submission.requestId,
          status: "submitted",
          applicantIsStudent: input.submission.applicantIsStudent,
          applicant: input.submission.applicant,
          minors: input.submission.minors,
          submittedBy: actorId,
          submittedAt: now,
          schemaVersion: "1",
        });
        if (!candidate.ok)
          throw new EnrolmentRequestStoreError("invalid", "Enrolment request contract rejected");
        transaction.create(reference, candidate.value);
        audit(transaction, academyId, actorId, "enrolment.request.submitted", reference.path);
        return candidate.value;
      });
    },

    async listForAcademy(academyId) {
      const scope = id(academyId, "academy");
      return read(scope, "academyId", scope, ENROLMENT_REQUEST_QUERY_LIMIT);
    },

    async listForSubmitter(academyId, actorId) {
      return read(
        id(academyId, "academy"),
        "submittedBy",
        id(actorId, "actor"),
        ENROLMENT_REQUEST_SUBMITTER_QUERY_LIMIT,
      );
    },

    async returnForChanges(input) {
      return transition(input, "returned", "enrolment.request.returned", input.note, false);
    },

    async withdraw(input) {
      return transition(input, "withdrawn", "enrolment.request.withdrawn", undefined, true);
    },
  });
}
