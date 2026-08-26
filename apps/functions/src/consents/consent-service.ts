import { createHash, randomUUID } from "node:crypto";

import {
  canonicalizeWaiverContent,
  parseConsentRecord,
  parseWaiverAcceptanceInput,
  parseWaiverPublicationInput,
  parseWaiverRegistrationProjection,
  parseWaiverVersion,
  toConsentProjection,
  toWaiverVersionProjection,
  type ClauseResponses,
  type ConsentProjection,
  type ConsentRecord,
  type WaiverAcceptanceInput,
  type WaiverPublicationInput,
  type WaiverRegistrationProjection,
  type WaiverVersion,
  type WaiverVersionProjection,
} from "@bpt-jersey/domain/consents";
import {
  buildPrivateDocumentObjectKey,
  parsePrivateDocumentRecord,
  type PrivateDocumentRecord,
} from "@bpt-jersey/domain/documents";
import { parseFamilyRelationship } from "@bpt-jersey/domain/families";
import {
  parseStudentProfile,
  parseUserProfile,
  type StudentProfile,
  type UserProfile,
} from "@bpt-jersey/domain/profiles";
import type { R2Client } from "../storage/r2-client.js";

export type ConsentDocumentData = Readonly<Record<string, unknown>>;
export type ConsentDocumentReference = Readonly<{ id: string; path: string }>;
export type ConsentDocumentSnapshot = Readonly<{
  id: string;
  exists: boolean;
  data: () => ConsentDocumentData | undefined;
}>;
export type ConsentQuerySnapshot = Readonly<{ docs: readonly ConsentDocumentSnapshot[] }>;
export type ConsentQuery = Readonly<{ path: string; field: string; value: unknown; limit: number }>;
export type ConsentCollection = Readonly<{
  doc: (id?: string) => ConsentDocumentReference;
  where: (
    field: string,
    operator: "==",
    value: unknown,
  ) => Readonly<{ limit: (count: number) => ConsentQuery }>;
}>;
export type ConsentTransaction = Readonly<{
  get: (
    target: ConsentDocumentReference | ConsentQuery,
  ) => Promise<ConsentDocumentSnapshot | ConsentQuerySnapshot>;
  create: (ref: ConsentDocumentReference, data: ConsentDocumentData) => ConsentTransaction;
  set: (ref: ConsentDocumentReference, data: ConsentDocumentData) => ConsentTransaction;
}>;
export type ConsentFirestore = Readonly<{
  doc: (path: string) => ConsentDocumentReference;
  collection: (path: string) => ConsentCollection;
  runTransaction: <T>(callback: (transaction: ConsentTransaction) => Promise<T>) => Promise<T>;
}>;

export type ConsentClientRole = "guardian" | "adultStudent";
export type ConsentAdminRole = "owner" | "administrator";
export type ConsentAuditDraft = Readonly<{
  academyId: string;
  actorId: string;
  action:
    | "waiver.version.published"
    | "waiver.version.withdrawn"
    | "consent.accepted"
    | "consent.revoked"
    | "consent.evidence.downloaded";
  targetRef: string;
  purpose: string;
  correlationId: string;
}>;
export type WaiverEvidencePdfInput = Readonly<{
  consentId: string;
  version: WaiverVersion;
  student: Readonly<{ studentId: string; fullName: string; participantType: "adult" | "minor" }>;
  signer: Readonly<{ userId: string; displayName: string }>;
  clauseResponses: ClauseResponses;
  signedAt: string;
}>;
export type WaiverEvidencePdfGenerator = (input: WaiverEvidencePdfInput) => Promise<Uint8Array>;
export type ConsentStoreDependencies = Readonly<{
  firestore: ConsentFirestore;
  r2: R2Client;
  createEvidencePdf: WaiverEvidencePdfGenerator;
  appendAudit: (
    transaction: ConsentTransaction,
    reference: ConsentDocumentReference,
    draft: ConsentAuditDraft,
  ) => void;
  generateDocumentId?: () => string;
}>;
export type ConsentStore = Readonly<{
  publishWaiverVersion: (
    input: Readonly<{
      academyId: string;
      actorId: string;
      now: string;
      publication: WaiverPublicationInput;
    }>,
  ) => Promise<WaiverVersion>;
  getCurrentWaiverAdmin: (
    input: Readonly<{ academyId: string }>,
  ) => Promise<WaiverVersionProjection | null>;
  withdrawCurrentWaiver: (
    input: Readonly<{ academyId: string; actorId: string; now: string; waiverVersionId: string }>,
  ) => Promise<WaiverVersion>;
  getWaiverRegistration: (
    input: Readonly<{ academyId: string; actorId: string; role: ConsentClientRole; now: string }>,
  ) => Promise<WaiverRegistrationProjection>;
  acceptWaiver: (
    input: Readonly<
      {
        academyId: string;
        actorId: string;
        role: ConsentClientRole;
        now: string;
      } & WaiverAcceptanceInput
    >,
  ) => Promise<ConsentProjection>;
  revokeWaiverConsent: (
    input: Readonly<{
      academyId: string;
      actorId: string;
      role: ConsentClientRole;
      consentId: string;
      now: string;
    }>,
  ) => Promise<ConsentProjection>;
  getWaiverEvidenceDownload: (
    input: Readonly<{
      academyId: string;
      actorId: string;
      role: ConsentClientRole | ConsentAdminRole;
      consentId: string;
      now: string;
    }>,
  ) => Promise<Readonly<{ consent: ConsentProjection; downloadUrl: string; expiresAt: string }>>;
}>;

export class ConsentStoreError extends Error {
  public readonly code: "invalid" | "forbidden" | "not-found" | "conflict" | "precondition";
  public constructor(code: ConsentStoreError["code"], message: string) {
    super(message);
    this.name = "ConsentStoreError";
    this.code = code;
  }
}

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const collectionPath = (academyId: string, collection: string) =>
  `academies/${academyId}/${collection}`;
const recordPath = (academyId: string, collection: string, recordId: string) =>
  `${collectionPath(academyId, collection)}/${recordId}`;
function id(value: string, label: string): string {
  if (!safeIdPattern.test(value)) throw new ConsentStoreError("invalid", `Invalid ${label}`);
  return value;
}
function timestamp(value: string): string {
  if (!isoPattern.test(value) || Number.isNaN(Date.parse(value)))
    throw new ConsentStoreError("invalid", "Invalid timestamp");
  return value;
}
function asDocument(
  value: ConsentDocumentSnapshot | ConsentQuerySnapshot,
): ConsentDocumentSnapshot {
  if ("docs" in value) throw new ConsentStoreError("invalid", "Expected document snapshot");
  return value;
}
function asQuery(value: ConsentDocumentSnapshot | ConsentQuerySnapshot): ConsentQuerySnapshot {
  if (!("docs" in value)) throw new ConsentStoreError("invalid", "Expected query snapshot");
  return value;
}
function consentIdFor(academyId: string, studentId: string, versionId: string): string {
  return `consent_${createHash("sha256").update(`${academyId}|${studentId}|${versionId}`).digest("hex").slice(0, 40)}`;
}
function versionIdFor(
  academyId: string,
  publication: WaiverPublicationInput,
  contentHash: string,
): string {
  return `waiver_${createHash("sha256").update(`${academyId}|${publication.versionLabel}|${contentHash}`).digest("hex").slice(0, 40)}`;
}
function storedVersion(snapshot: ConsentDocumentSnapshot, academyId: string): WaiverVersion {
  if (!snapshot.exists) throw new ConsentStoreError("not-found", "Waiver version is not available");
  const parsed = parseWaiverVersion(snapshot.data());
  if (
    !parsed.ok ||
    parsed.value.academyId !== academyId ||
    parsed.value.waiverVersionId !== snapshot.id
  )
    throw new ConsentStoreError("forbidden", "Waiver version scope is not permitted");
  return parsed.value;
}
function storedConsent(snapshot: ConsentDocumentSnapshot, academyId: string): ConsentRecord {
  if (!snapshot.exists) throw new ConsentStoreError("not-found", "Consent is not available");
  const parsed = parseConsentRecord(snapshot.data());
  if (!parsed.ok || parsed.value.academyId !== academyId || parsed.value.consentId !== snapshot.id)
    throw new ConsentStoreError("forbidden", "Consent scope is not permitted");
  return parsed.value;
}
function storedDocument(
  snapshot: ConsentDocumentSnapshot,
  academyId: string,
): PrivateDocumentRecord {
  if (!snapshot.exists) throw new ConsentStoreError("not-found", "Evidence is not available");
  const parsed = parsePrivateDocumentRecord(snapshot.data());
  if (!parsed.ok || parsed.value.academyId !== academyId || parsed.value.documentId !== snapshot.id)
    throw new ConsentStoreError("forbidden", "Evidence scope is not permitted");
  return parsed.value;
}
function storedUser(
  snapshot: ConsentDocumentSnapshot,
  academyId: string,
  actorId: string,
): UserProfile {
  if (!snapshot.exists) throw new ConsentStoreError("precondition", "Signer is not available");
  const parsed = parseUserProfile(snapshot.data());
  if (
    !parsed.ok ||
    parsed.value.academyId !== academyId ||
    parsed.value.userId !== actorId ||
    !parsed.value.active ||
    parsed.value.status !== "active"
  )
    throw new ConsentStoreError("precondition", "Signer is not eligible");
  return parsed.value;
}
function storedStudent(snapshot: ConsentDocumentSnapshot, academyId: string): StudentProfile {
  if (!snapshot.exists) throw new ConsentStoreError("precondition", "Student is not available");
  const parsed = parseStudentProfile(snapshot.data());
  if (
    !parsed.ok ||
    parsed.value.academyId !== academyId ||
    parsed.value.studentId !== snapshot.id ||
    !parsed.value.active ||
    parsed.value.status !== "active"
  )
    throw new ConsentStoreError("precondition", "Student is not eligible");
  return parsed.value;
}

async function currentPublished(
  transaction: ConsentTransaction,
  firestore: ConsentFirestore,
  academyId: string,
): Promise<WaiverVersion | null> {
  const snapshot = asQuery(
    await transaction.get(
      firestore
        .collection(collectionPath(academyId, "waiverVersions"))
        .where("status", "==", "published")
        .limit(2),
    ),
  );
  if (snapshot.docs.length > 1)
    throw new ConsentStoreError("conflict", "Multiple waiver versions are published");
  return snapshot.docs[0] ? storedVersion(snapshot.docs[0], academyId) : null;
}

async function assertAuthority(
  transaction: ConsentTransaction,
  firestore: ConsentFirestore,
  academyId: string,
  actorId: string,
  role: ConsentClientRole,
  studentId: string,
  now: string,
): Promise<{ user: UserProfile; student: StudentProfile }> {
  const user = storedUser(
    asDocument(await transaction.get(firestore.doc(recordPath(academyId, "users", actorId)))),
    academyId,
    actorId,
  );
  const student = storedStudent(
    asDocument(await transaction.get(firestore.doc(recordPath(academyId, "students", studentId)))),
    academyId,
  );
  if (role === "adultStudent") {
    if (student.participantType !== "adult" || student.userId !== actorId)
      throw new ConsentStoreError("forbidden", "Adult consent scope is not permitted");
    return { user, student };
  }
  if (student.participantType !== "minor")
    throw new ConsentStoreError("forbidden", "Guardian consent scope is not permitted");
  const relationships = asQuery(
    await transaction.get(
      firestore
        .collection(collectionPath(academyId, "relationships"))
        .where("studentId", "==", studentId)
        .limit(100),
    ),
  );
  const permitted = relationships.docs.some((snapshot) => {
    const parsed = parseFamilyRelationship(snapshot.data());
    return (
      parsed.ok &&
      parsed.value.academyId === academyId &&
      parsed.value.studentId === studentId &&
      parsed.value.adultUserId === actorId &&
      parsed.value.active &&
      parsed.value.status === "active" &&
      parsed.value.validFrom <= now &&
      (parsed.value.validTo === undefined || parsed.value.validTo > now)
    );
  });
  if (!permitted)
    throw new ConsentStoreError("forbidden", "Guardian consent scope is not permitted");
  return { user, student };
}

function signerName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-GB");
}
function assertResponses(version: WaiverVersion, responses: ClauseResponses): void {
  for (const clause of version.clauses)
    if (clause.required && responses[clause.key] !== "accepted")
      throw new ConsentStoreError("precondition", "All required waiver clauses must be accepted");
}
function appendAudit(
  dependencies: ConsentStoreDependencies,
  transaction: ConsentTransaction,
  academyId: string,
  actorId: string,
  action: ConsentAuditDraft["action"],
  targetRef: string,
): void {
  const reference = dependencies.firestore
    .collection(collectionPath(academyId, "auditEvents"))
    .doc();
  dependencies.appendAudit(transaction, reference, {
    academyId,
    actorId,
    action,
    targetRef,
    purpose: "versioned waiver operation",
    correlationId: `consent:${reference.id}`,
  });
}
function safeFileName(versionLabel: string): string {
  return `waiver-${versionLabel.replace(/[^A-Za-z0-9._-]/gu, "-")}.pdf`.slice(0, 128);
}

export function createConsentStore(dependencies: ConsentStoreDependencies): ConsentStore {
  const generateDocumentId = dependencies.generateDocumentId ?? randomUUID;
  return Object.freeze({
    async publishWaiverVersion(input) {
      const academyId = id(input.academyId, "academy");
      const actorId = id(input.actorId, "actor");
      const now = timestamp(input.now);
      const parsed = parseWaiverPublicationInput(input.publication);
      if (!parsed.ok) throw new ConsentStoreError("invalid", "Waiver publication is invalid");
      const contentHash = createHash("sha256")
        .update(canonicalizeWaiverContent(parsed.value))
        .digest("hex");
      const waiverVersionId = versionIdFor(academyId, parsed.value, contentHash);
      return dependencies.firestore.runTransaction(async (transaction) => {
        const current = await currentPublished(transaction, dependencies.firestore, academyId);
        const reference = dependencies.firestore.doc(
          recordPath(academyId, "waiverVersions", waiverVersionId),
        );
        const existing = asDocument(await transaction.get(reference));
        if (existing.exists) {
          const version = storedVersion(existing, academyId);
          if (version.status === "published" && version.contentHash === contentHash) return version;
          throw new ConsentStoreError("conflict", "Waiver version already exists");
        }
        if (current) {
          const retired = parseWaiverVersion({
            ...current,
            status: "superseded",
            supersededAt: now,
            updatedAt: now,
            updatedBy: actorId,
          });
          if (!retired.ok)
            throw new ConsentStoreError("invalid", "Waiver version contract rejected");
          transaction.set(
            dependencies.firestore.doc(
              recordPath(academyId, "waiverVersions", current.waiverVersionId),
            ),
            retired.value,
          );
        }
        const content = {
          versionLabel: parsed.value.versionLabel,
          title: parsed.value.title,
          introduction: parsed.value.introduction,
          clauses: parsed.value.clauses,
          effectiveAt: parsed.value.effectiveAt,
        };
        const candidate = parseWaiverVersion({
          waiverVersionId,
          academyId,
          ...content,
          contentHash,
          status: "published",
          supersededAt: null,
          schemaVersion: "1",
          createdAt: now,
          createdBy: actorId,
          updatedAt: now,
          updatedBy: actorId,
        });
        if (!candidate.ok)
          throw new ConsentStoreError("invalid", "Waiver version contract rejected");
        transaction.create(reference, candidate.value);
        appendAudit(
          dependencies,
          transaction,
          academyId,
          actorId,
          "waiver.version.published",
          reference.path,
        );
        return candidate.value;
      });
    },

    async getCurrentWaiverAdmin(input) {
      const academyId = id(input.academyId, "academy");
      return dependencies.firestore.runTransaction(async (transaction) => {
        const current = await currentPublished(transaction, dependencies.firestore, academyId);
        return current ? toWaiverVersionProjection(current) : null;
      });
    },

    async withdrawCurrentWaiver(input) {
      const academyId = id(input.academyId, "academy");
      const actorId = id(input.actorId, "actor");
      const waiverVersionId = id(input.waiverVersionId, "waiver version");
      const now = timestamp(input.now);
      return dependencies.firestore.runTransaction(async (transaction) => {
        const current = await currentPublished(transaction, dependencies.firestore, academyId);
        if (!current || current.waiverVersionId !== waiverVersionId)
          throw new ConsentStoreError("precondition", "Current waiver is not available");
        const next = parseWaiverVersion({
          ...current,
          status: "withdrawn",
          supersededAt: now,
          updatedAt: now,
          updatedBy: actorId,
        });
        if (!next.ok) throw new ConsentStoreError("invalid", "Waiver version contract rejected");
        const reference = dependencies.firestore.doc(
          recordPath(academyId, "waiverVersions", waiverVersionId),
        );
        transaction.set(reference, next.value);
        appendAudit(
          dependencies,
          transaction,
          academyId,
          actorId,
          "waiver.version.withdrawn",
          reference.path,
        );
        return next.value;
      });
    },

    async getWaiverRegistration(input) {
      const academyId = id(input.academyId, "academy");
      const actorId = id(input.actorId, "actor");
      const now = timestamp(input.now);
      return dependencies.firestore.runTransaction(async (transaction) => {
        storedUser(
          asDocument(
            await transaction.get(
              dependencies.firestore.doc(recordPath(academyId, "users", actorId)),
            ),
          ),
          academyId,
          actorId,
        );
        const currentCandidate = await currentPublished(
          transaction,
          dependencies.firestore,
          academyId,
        );
        const current =
          currentCandidate && currentCandidate.effectiveAt <= now ? currentCandidate : null;
        const students: StudentProfile[] = [];
        if (input.role === "adultStudent") {
          const matches = asQuery(
            await transaction.get(
              dependencies.firestore
                .collection(collectionPath(academyId, "students"))
                .where("userId", "==", actorId)
                .limit(2),
            ),
          );
          if (matches.docs.length > 1)
            throw new ConsentStoreError("conflict", "Multiple adult student profiles are linked");
          if (matches.docs[0]) {
            const student = storedStudent(matches.docs[0], academyId);
            if (student.participantType !== "adult" || student.userId !== actorId)
              throw new ConsentStoreError("forbidden", "Adult consent scope is not permitted");
            students.push(student);
          }
        } else {
          const links = asQuery(
            await transaction.get(
              dependencies.firestore
                .collection(collectionPath(academyId, "relationships"))
                .where("adultUserId", "==", actorId)
                .limit(100),
            ),
          );
          for (const link of links.docs) {
            const parsed = parseFamilyRelationship(link.data());
            if (
              !parsed.ok ||
              parsed.value.academyId !== academyId ||
              parsed.value.adultUserId !== actorId ||
              !parsed.value.active ||
              parsed.value.status !== "active" ||
              parsed.value.validFrom > now ||
              (parsed.value.validTo !== undefined && parsed.value.validTo <= now)
            )
              continue;
            const student = storedStudent(
              asDocument(
                await transaction.get(
                  dependencies.firestore.doc(
                    recordPath(academyId, "students", parsed.value.studentId),
                  ),
                ),
              ),
              academyId,
            );
            if (student.participantType === "minor") students.push(student);
          }
        }
        const subjects = [];
        for (const student of new Map(
          students.map((candidate) => [candidate.studentId, candidate]),
        ).values()) {
          let consent: ConsentProjection | null = null;
          if (current) {
            const consentId = consentIdFor(academyId, student.studentId, current.waiverVersionId);
            const snapshot = asDocument(
              await transaction.get(
                dependencies.firestore.doc(recordPath(academyId, "consents", consentId)),
              ),
            );
            if (snapshot.exists) consent = toConsentProjection(storedConsent(snapshot, academyId));
          }
          subjects.push({
            studentId: student.studentId,
            displayName: student.fullName,
            participantType: student.participantType,
            consent,
          });
        }
        const projection = parseWaiverRegistrationProjection({
          currentVersion: current ? toWaiverVersionProjection(current) : null,
          subjects,
        });
        if (!projection.ok)
          throw new ConsentStoreError("invalid", "Waiver registration projection rejected");
        return projection.value;
      });
    },

    async acceptWaiver(input) {
      const academyId = id(input.academyId, "academy");
      const actorId = id(input.actorId, "actor");
      const now = timestamp(input.now);
      const parsedInput = parseWaiverAcceptanceInput({
        studentId: input.studentId,
        waiverVersionId: input.waiverVersionId,
        contentHash: input.contentHash,
        typedName: input.typedName,
        clauseResponses: input.clauseResponses,
      });
      if (!parsedInput.ok) throw new ConsentStoreError("invalid", "Waiver acceptance is invalid");
      const consentId = consentIdFor(
        academyId,
        parsedInput.value.studentId,
        parsedInput.value.waiverVersionId,
      );
      const prepare = async (transaction: ConsentTransaction) => {
        const current = await currentPublished(transaction, dependencies.firestore, academyId);
        if (
          !current ||
          current.effectiveAt > now ||
          current.waiverVersionId !== parsedInput.value.waiverVersionId ||
          current.contentHash !== parsedInput.value.contentHash
        )
          throw new ConsentStoreError("precondition", "Current waiver version is not available");
        const authority = await assertAuthority(
          transaction,
          dependencies.firestore,
          academyId,
          actorId,
          input.role,
          parsedInput.value.studentId,
          now,
        );
        if (signerName(parsedInput.value.typedName) !== signerName(authority.user.displayName))
          throw new ConsentStoreError(
            "precondition",
            "Typed signer name does not match the authenticated signer",
          );
        assertResponses(current, parsedInput.value.clauseResponses);
        const consentReference = dependencies.firestore.doc(
          recordPath(academyId, "consents", consentId),
        );
        const existing = asDocument(await transaction.get(consentReference));
        return {
          current,
          ...authority,
          consentReference,
          existing: existing.exists ? storedConsent(existing, academyId) : null,
        };
      };
      const preliminary = await dependencies.firestore.runTransaction(prepare);
      if (preliminary.existing) {
        if (preliminary.existing.status !== "accepted" || preliminary.existing.signedBy !== actorId)
          throw new ConsentStoreError("conflict", "Consent version was already used");
        return toConsentProjection(preliminary.existing);
      }
      const documentId = id(generateDocumentId(), "document");
      const objectKey = buildPrivateDocumentObjectKey(
        academyId,
        parsedInput.value.studentId,
        documentId,
      );
      const bytes = await dependencies.createEvidencePdf({
        consentId,
        version: preliminary.current,
        student: {
          studentId: preliminary.student.studentId,
          fullName: preliminary.student.fullName,
          participantType: preliminary.student.participantType,
        },
        signer: { userId: actorId, displayName: preliminary.user.displayName },
        clauseResponses: parsedInput.value.clauseResponses,
        signedAt: now,
      });
      if (bytes.byteLength === 0)
        throw new ConsentStoreError("precondition", "Waiver evidence is not available");
      await dependencies.r2.putObject(objectKey, bytes, "application/pdf").catch(() => {
        throw new ConsentStoreError("precondition", "Waiver evidence storage is not available");
      });
      try {
        const committed = await dependencies.firestore.runTransaction(async (transaction) => {
          const context = await prepare(transaction);
          if (context.existing) return { created: false as const, consent: context.existing };
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          const document = parsePrivateDocumentRecord({
            documentId,
            academyId,
            studentId: context.student.studentId,
            kind: "waiver",
            objectKey,
            fileName: safeFileName(context.current.versionLabel),
            contentType: "application/pdf",
            sizeBytes: bytes.byteLength,
            sha256,
            signedAt: now,
            status: "active",
            schemaVersion: "1",
            createdAt: now,
            createdBy: actorId,
            updatedAt: now,
            updatedBy: actorId,
          });
          const consent = parseConsentRecord({
            consentId,
            academyId,
            subjectType: context.student.participantType,
            subjectId: context.student.studentId,
            waiverVersionId: context.current.waiverVersionId,
            versionLabel: context.current.versionLabel,
            waiverContentHash: context.current.contentHash,
            signedBy: actorId,
            signatureMethod: "authenticated_typed_name",
            clauseResponses: parsedInput.value.clauseResponses,
            signedAt: now,
            revokedAt: null,
            evidenceDocumentId: documentId,
            status: "accepted",
            schemaVersion: "1",
            createdAt: now,
            createdBy: actorId,
            updatedAt: now,
            updatedBy: actorId,
          });
          if (!document.ok || !consent.ok)
            throw new ConsentStoreError("invalid", "Consent evidence contract rejected");
          transaction.create(
            dependencies.firestore.doc(recordPath(academyId, "documents", documentId)),
            document.value,
          );
          transaction.create(context.consentReference, consent.value);
          appendAudit(
            dependencies,
            transaction,
            academyId,
            actorId,
            "consent.accepted",
            context.consentReference.path,
          );
          return { created: true as const, consent: consent.value };
        });
        if (!committed.created)
          await dependencies.r2.deleteObject(objectKey).catch(() => undefined);
        return toConsentProjection(committed.consent);
      } catch (error) {
        await dependencies.r2.deleteObject(objectKey).catch(() => undefined);
        throw error;
      }
    },

    async revokeWaiverConsent(input) {
      const academyId = id(input.academyId, "academy");
      const actorId = id(input.actorId, "actor");
      const consentId = id(input.consentId, "consent");
      const now = timestamp(input.now);
      return dependencies.firestore.runTransaction(async (transaction) => {
        const consentReference = dependencies.firestore.doc(
          recordPath(academyId, "consents", consentId),
        );
        const current = storedConsent(
          asDocument(await transaction.get(consentReference)),
          academyId,
        );
        if (current.status !== "accepted")
          throw new ConsentStoreError("conflict", "Consent is not active");
        await assertAuthority(
          transaction,
          dependencies.firestore,
          academyId,
          actorId,
          input.role,
          current.subjectId,
          now,
        );
        if (current.signedBy !== actorId)
          throw new ConsentStoreError("forbidden", "Consent revocation is not permitted");
        const documentReference = dependencies.firestore.doc(
          recordPath(academyId, "documents", current.evidenceDocumentId),
        );
        const document = storedDocument(
          asDocument(await transaction.get(documentReference)),
          academyId,
        );
        if (document.studentId !== current.subjectId || document.status !== "active")
          throw new ConsentStoreError("precondition", "Consent evidence is not available");
        const nextConsent = parseConsentRecord({
          ...current,
          status: "revoked",
          revokedAt: now,
          updatedAt: now,
          updatedBy: actorId,
        });
        const nextDocument = parsePrivateDocumentRecord({
          ...document,
          status: "revoked",
          updatedAt: now,
          updatedBy: actorId,
        });
        if (!nextConsent.ok || !nextDocument.ok)
          throw new ConsentStoreError("invalid", "Consent revocation contract rejected");
        transaction.set(consentReference, nextConsent.value);
        transaction.set(documentReference, nextDocument.value);
        appendAudit(
          dependencies,
          transaction,
          academyId,
          actorId,
          "consent.revoked",
          consentReference.path,
        );
        return toConsentProjection(nextConsent.value);
      });
    },

    async getWaiverEvidenceDownload(input) {
      const academyId = id(input.academyId, "academy");
      const actorId = id(input.actorId, "actor");
      const consentId = id(input.consentId, "consent");
      const now = timestamp(input.now);
      const result = await dependencies.firestore.runTransaction(async (transaction) => {
        const consent = storedConsent(
          asDocument(
            await transaction.get(
              dependencies.firestore.doc(recordPath(academyId, "consents", consentId)),
            ),
          ),
          academyId,
        );
        if (consent.status !== "accepted")
          throw new ConsentStoreError("precondition", "Consent evidence is not available");
        if (input.role === "guardian" || input.role === "adultStudent") {
          await assertAuthority(
            transaction,
            dependencies.firestore,
            academyId,
            actorId,
            input.role,
            consent.subjectId,
            now,
          );
          if (consent.signedBy !== actorId)
            throw new ConsentStoreError("forbidden", "Consent evidence access is not permitted");
        }
        const document = storedDocument(
          asDocument(
            await transaction.get(
              dependencies.firestore.doc(
                recordPath(academyId, "documents", consent.evidenceDocumentId),
              ),
            ),
          ),
          academyId,
        );
        if (document.status !== "active" || document.studentId !== consent.subjectId)
          throw new ConsentStoreError("precondition", "Consent evidence is not available");
        return { consent, document };
      });
      const downloadUrl = await dependencies.r2
        .createPdfDownloadUrl({ objectKey: result.document.objectKey, expiresInSeconds: 600 })
        .catch(() => {
          throw new ConsentStoreError("precondition", "Consent evidence is not available");
        });
      await dependencies.firestore.runTransaction(async (transaction) => {
        const consent = storedConsent(
          asDocument(
            await transaction.get(
              dependencies.firestore.doc(recordPath(academyId, "consents", consentId)),
            ),
          ),
          academyId,
        );
        if (
          consent.status !== "accepted" ||
          consent.evidenceDocumentId !== result.document.documentId
        )
          throw new ConsentStoreError("precondition", "Consent evidence is not available");
        if (input.role === "guardian" || input.role === "adultStudent") {
          await assertAuthority(
            transaction,
            dependencies.firestore,
            academyId,
            actorId,
            input.role,
            consent.subjectId,
            now,
          );
          if (consent.signedBy !== actorId)
            throw new ConsentStoreError("forbidden", "Consent evidence access is not permitted");
        }
        const document = storedDocument(
          asDocument(
            await transaction.get(
              dependencies.firestore.doc(
                recordPath(academyId, "documents", consent.evidenceDocumentId),
              ),
            ),
          ),
          academyId,
        );
        if (document.status !== "active" || document.objectKey !== result.document.objectKey)
          throw new ConsentStoreError("precondition", "Consent evidence is not available");
        appendAudit(
          dependencies,
          transaction,
          academyId,
          actorId,
          "consent.evidence.downloaded",
          recordPath(academyId, "consents", consentId),
        );
      });
      return {
        consent: toConsentProjection(result.consent),
        downloadUrl,
        expiresAt: new Date(Date.parse(now) + 600_000).toISOString(),
      };
    },
  });
}
