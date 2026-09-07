import {
  canSubmitEnrolmentRequest,
  isApprovableEnrolmentRequest,
  isOpenEnrolmentRequest,
  isReturnableEnrolmentRequest,
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
  field?: string;
  value?: unknown;
  orderBy?: Readonly<{ field: string; direction: "desc" }>;
  limit: number;
}>;
export type EnrolmentCollection = Readonly<{
  doc: (id?: string) => EnrolmentDocumentReference;
  where: (
    field: string,
    operator: "==",
    value: unknown,
  ) => Readonly<{ limit: (count: number) => EnrolmentQuery }>;
  // The collection is already scoped to one academy by its path, so the office queue needs no
  // equality filter - only an order, which keeps the newest requests inside the page instead of
  // letting an accumulating archive push them out of sight.
  orderBy: (
    field: string,
    direction: "desc",
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
  | "enrolment.request.submitted"
  | "enrolment.request.returned"
  | "enrolment.request.withdrawn"
  | "enrolment.request.approved"
  | "enrolment.request.approval.failed";
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

export type BeginEnrolmentApprovalInput = Readonly<{
  academyId: string;
  actorId: string;
  now: string;
  enrolmentRequestId: string;
  /** The reviewer's idempotency key, used only if the request does not already carry one. */
  requestId: string;
}>;

export type BeginEnrolmentApprovalResult = Readonly<{
  record: EnrolmentRequestRecord;
  /** True when the request was already approved and this call changed nothing. */
  alreadyApproved: boolean;
}>;

export type CompleteEnrolmentApprovalInput = Readonly<{
  academyId: string;
  actorId: string;
  now: string;
  enrolmentRequestId: string;
  studentIds: readonly string[];
}>;

export type FailEnrolmentApprovalInput = Readonly<{
  academyId: string;
  actorId: string;
  now: string;
  enrolmentRequestId: string;
  failureCode: string;
}>;

export type EnrolmentRequestPage = Readonly<{
  requests: readonly EnrolmentRequestRecord[];
  /** True when the page filled up: the reviewer is not seeing every request. */
  truncated: boolean;
}>;

export type EnrolmentRequestStore = Readonly<{
  submit: (input: SubmitEnrolmentRequestInput) => Promise<EnrolmentRequestRecord>;
  listForAcademy: (academyId: string) => Promise<EnrolmentRequestPage>;
  listForSubmitter: (
    academyId: string,
    actorId: string,
  ) => Promise<readonly EnrolmentRequestRecord[]>;
  returnForChanges: (input: ReviewEnrolmentRequestInput) => Promise<EnrolmentRequestRecord>;
  withdraw: (input: WithdrawEnrolmentRequestInput) => Promise<EnrolmentRequestRecord>;
  /**
   * Takes the approval lock. Approving spans several commits across Firestore and Auth, so the
   * request document is what serialises reviewers: whoever moves it to `approving` owns the
   * attempt, and the idempotency key of the canonical write is pinned to the request at that
   * moment so a retry cannot mint a second student under a second key.
   */
  beginApproval: (input: BeginEnrolmentApprovalInput) => Promise<BeginEnrolmentApprovalResult>;
  completeApproval: (input: CompleteEnrolmentApprovalInput) => Promise<EnrolmentRequestRecord>;
  /** Where a half-finished approval stops: not open to the applicant, and not approved. */
  failApproval: (input: FailEnrolmentApprovalInput) => Promise<EnrolmentRequestRecord>;
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

/**
 * One document per applicant recording the request they currently hold. Scanning the applicant's
 * own rows to answer "do you already have one open?" is only correct while they have few rows: the
 * scan is capped, so once somebody accumulates enough resolved requests a genuinely open one can
 * fall outside the page and the guard silently passes. A single document keyed by the applicant is
 * exact regardless of how much history they build up.
 */
export function enrolmentHoldId(submittedBy: string): string {
  return `hold-${submittedBy}`;
}

type EnrolmentHold = Readonly<{
  submittedBy: string;
  enrolmentRequestId: string;
  status: string;
  updatedAt: string;
}>;

function storedHold(snapshot: EnrolmentDocumentSnapshot): EnrolmentHold | undefined {
  const data = snapshot.data();
  if (data === undefined) return undefined;
  const { submittedBy, enrolmentRequestId: heldId, status, updatedAt } = data;
  if (
    typeof submittedBy !== "string" ||
    typeof heldId !== "string" ||
    typeof status !== "string" ||
    typeof updatedAt !== "string"
  ) {
    throw new EnrolmentRequestStoreError("invalid", "Stored enrolment hold is unreadable");
  }
  return Object.freeze({ submittedBy, enrolmentRequestId: heldId, status, updatedAt });
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

  async function run(query: EnrolmentQuery, academyId: string): Promise<EnrolmentRequestPage> {
    const snapshot = await firestore.runTransaction(async (transaction) =>
      asQuery(await transaction.get(query)),
    );
    return Object.freeze({
      requests: newestFirst(snapshot.docs.map((document) => stored(document, academyId))),
      truncated: snapshot.docs.length >= query.limit,
    });
  }

  async function transition(
    input: ReviewEnrolmentRequestInput | WithdrawEnrolmentRequestInput,
    status: "returned" | "withdrawn",
    action: EnrolmentAuditAction,
    note: string | undefined,
    requireOwner: boolean,
    permitted: (status: string) => boolean,
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
      if (!permitted(existing.status))
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
      transaction.set(
        firestore.doc(
          `${collectionPath(academyId, "enrolmentRequestHolds")}/${enrolmentHoldId(existing.submittedBy)}`,
        ),
        {
          submittedBy: existing.submittedBy,
          enrolmentRequestId: existing.enrolmentRequestId,
          status,
          updatedAt: now,
        },
      );
      audit(transaction, academyId, actorId, action, reference.path);
      return candidate.value;
    });
  }

  /**
   * Settles an attempt that holds the lock. Only a request in `approving` may be settled, so a
   * late answer from an attempt somebody else already resolved cannot overwrite the outcome; and
   * settling to the state a request already holds is a no-op, which is what makes a retried
   * approval safe to run to the end.
   */
  async function settleApproval(
    academyIdInput: string,
    actorIdInput: string,
    nowInput: string,
    enrolmentRequestIdInput: string,
    settlement: Readonly<{
      status: "approved" | "approval-failed";
      action: EnrolmentAuditAction;
      fields: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<EnrolmentRequestRecord> {
    const academyId = id(academyIdInput, "academy");
    const actorId = id(actorIdInput, "actor");
    const now = timestamp(nowInput);
    const reference = firestore.doc(
      `${collectionPath(academyId, "enrolmentRequests")}/${id(enrolmentRequestIdInput, "enrolment request")}`,
    );
    return firestore.runTransaction(async (transaction) => {
      const snapshot = asDocument(await transaction.get(reference));
      if (!snapshot.exists)
        throw new EnrolmentRequestStoreError("not-found", "Enrolment request not found");
      const existing = stored(snapshot, academyId);
      if (existing.status === settlement.status) return existing;
      if (existing.status !== "approving")
        throw new EnrolmentRequestStoreError(
          "precondition",
          "This approval is no longer the one in progress",
        );
      const candidate = parseEnrolmentRequestRecord({
        ...existing,
        ...settlement.fields,
        status: settlement.status,
        reviewedBy: actorId,
        reviewedAt: now,
      });
      if (!candidate.ok)
        throw new EnrolmentRequestStoreError("invalid", "Enrolment request contract rejected");
      transaction.set(reference, candidate.value);
      transaction.set(
        firestore.doc(
          `${collectionPath(academyId, "enrolmentRequestHolds")}/${enrolmentHoldId(existing.submittedBy)}`,
        ),
        {
          submittedBy: existing.submittedBy,
          enrolmentRequestId: existing.enrolmentRequestId,
          status: settlement.status,
          updatedAt: now,
        },
      );
      audit(transaction, academyId, actorId, settlement.action, reference.path);
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
      const holdReference = firestore.doc(
        `${collectionPath(academyId, "enrolmentRequestHolds")}/${enrolmentHoldId(actorId)}`,
      );

      return firestore.runTransaction(async (transaction) => {
        const snapshot = asDocument(await transaction.get(reference));
        if (snapshot.exists) {
          // A retry of the same submission is the same request, not a second one.
          const existing = stored(snapshot, academyId);
          if (existing.submittedBy !== actorId)
            throw new EnrolmentRequestStoreError("conflict", "Request id already used");
          return existing;
        }
        const hold = storedHold(asDocument(await transaction.get(holdReference)));
        // An allow list, not a list of refusals: a status added to the vocabulary is refused here
        // until somebody decides otherwise, instead of quietly letting a person hold two requests.
        if (!canSubmitEnrolmentRequest(hold?.status)) {
          if (hold !== undefined && isOpenEnrolmentRequest(hold.status))
            throw new EnrolmentRequestStoreError(
              "precondition",
              "You already have a request waiting for the academy to review",
            );
          // Somebody the academy already enrolled does not apply again: a second approval would
          // create a second student record for one person.
          throw new EnrolmentRequestStoreError(
            "precondition",
            "The academy is already handling your enrolment. Ask reception if something needs changing",
          );
        }

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
        transaction.set(holdReference, {
          submittedBy: actorId,
          enrolmentRequestId: reference.id,
          status: "submitted",
          updatedAt: now,
        });
        audit(transaction, academyId, actorId, "enrolment.request.submitted", reference.path);
        return candidate.value;
      });
    },

    async listForAcademy(academyId) {
      const scope = id(academyId, "academy");
      return run(
        firestore
          .collection(collectionPath(scope, "enrolmentRequests"))
          .orderBy("submittedAt", "desc")
          .limit(ENROLMENT_REQUEST_QUERY_LIMIT),
        scope,
      );
    },

    async listForSubmitter(academyId, actorId) {
      const scope = id(academyId, "academy");
      const page = await run(
        firestore
          .collection(collectionPath(scope, "enrolmentRequests"))
          .where("submittedBy", "==", id(actorId, "actor"))
          .limit(ENROLMENT_REQUEST_SUBMITTER_QUERY_LIMIT),
        scope,
      );
      return page.requests;
    },

    async beginApproval(input) {
      const academyId = id(input.academyId, "academy");
      const actorId = id(input.actorId, "actor");
      const now = timestamp(input.now);
      const requestId = input.requestId;
      const reference = firestore.doc(
        `${collectionPath(academyId, "enrolmentRequests")}/${id(input.enrolmentRequestId, "enrolment request")}`,
      );
      return firestore.runTransaction(async (transaction) => {
        const snapshot = asDocument(await transaction.get(reference));
        if (!snapshot.exists)
          throw new EnrolmentRequestStoreError("not-found", "Enrolment request not found");
        const existing = stored(snapshot, academyId);
        // Approving twice is not an error to shout about: the first approval already did it.
        if (existing.status === "approved")
          return Object.freeze({ record: existing, alreadyApproved: true });
        if (!isApprovableEnrolmentRequest(existing.status))
          throw new EnrolmentRequestStoreError(
            "precondition",
            "This request was already resolved and cannot be approved",
          );
        // Whoever got here first pinned the key. A retry - by the same reviewer or another - runs
        // against that key, so the canonical writer answers with the student it already created
        // instead of creating a second one.
        const approvalRequestId = existing.approvalRequestId ?? requestId;
        const candidate = parseEnrolmentRequestRecord({
          ...existing,
          status: "approving",
          reviewedBy: actorId,
          reviewedAt: now,
          approvalRequestId,
        });
        if (!candidate.ok)
          throw new EnrolmentRequestStoreError("invalid", "Enrolment request contract rejected");
        transaction.set(reference, candidate.value);
        transaction.set(
          firestore.doc(
            `${collectionPath(academyId, "enrolmentRequestHolds")}/${enrolmentHoldId(existing.submittedBy)}`,
          ),
          {
            submittedBy: existing.submittedBy,
            enrolmentRequestId: existing.enrolmentRequestId,
            status: "approving",
            updatedAt: now,
          },
        );
        return Object.freeze({ record: candidate.value, alreadyApproved: false });
      });
    },

    async completeApproval(input) {
      return settleApproval(input.academyId, input.actorId, input.now, input.enrolmentRequestId, {
        status: "approved",
        action: "enrolment.request.approved",
        fields: { approvedStudentIds: Object.freeze([...input.studentIds]) },
      });
    },

    async failApproval(input) {
      return settleApproval(input.academyId, input.actorId, input.now, input.enrolmentRequestId, {
        status: "approval-failed",
        action: "enrolment.request.approval.failed",
        fields: { approvalFailureCode: input.failureCode },
      });
    },

    async returnForChanges(input) {
      // Office can also hand back an approval that stopped, which is the only way out for an
      // applicant whose enrolment failed for a reason only they can fix.
      return transition(
        input,
        "returned",
        "enrolment.request.returned",
        input.note,
        false,
        isReturnableEnrolmentRequest,
      );
    },

    async withdraw(input) {
      // The applicant may only withdraw something still in their hands. A request office is in the
      // middle of approving is not.
      return transition(
        input,
        "withdrawn",
        "enrolment.request.withdrawn",
        undefined,
        true,
        isOpenEnrolmentRequest,
      );
    },
  });
}
