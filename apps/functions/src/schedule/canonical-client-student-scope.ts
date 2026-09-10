import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { parseFamilyRecord, parseFamilyRelationship } from "@bpt-jersey/domain/families";
import { parseStudentProfile } from "@bpt-jersey/domain/profiles";

export type CanonicalClientStudentScopeInput = Readonly<{
  academyId: string;
  actorUserId: string;
  actorRole: "guardian" | "adultStudent";
  requestedStudentId: string;
}>;

export type CanonicalClientStudentScopeResolver = (
  input: CanonicalClientStudentScopeInput,
) => Promise<boolean>;

export type CanonicalClientScopeDocument = Readonly<{
  id: string;
  exists: boolean;
  data: Readonly<Record<string, unknown>> | undefined;
}>;

export type CanonicalClientStudentScopeDependencies = Readonly<{
  getDocument: (path: string) => Promise<CanonicalClientScopeDocument>;
  queryDocuments: (
    collectionPath: string,
    field: string,
    value: unknown,
    limit: number,
  ) => Promise<readonly CanonicalClientScopeDocument[]>;
  now?: () => string;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const maximumRelationships = 100;

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

export function createCanonicalClientStudentScopeResolver(
  dependencies: CanonicalClientStudentScopeDependencies,
): CanonicalClientStudentScopeResolver {
  return async (input) => {
    if (
      !safeIdentifier(input.academyId) ||
      !safeIdentifier(input.actorUserId) ||
      !safeIdentifier(input.requestedStudentId)
    ) {
      return false;
    }

    try {
      if (input.actorRole === "adultStudent") {
        const matches = await dependencies.queryDocuments(
          `academies/${input.academyId}/students`,
          "userId",
          input.actorUserId,
          2,
        );
        if (matches.length !== 1) return false;
        const document = matches[0]!;
        const parsed = document.data === undefined ? undefined : parseStudentProfile(document.data);
        return (
          document.exists &&
          parsed !== undefined &&
          parsed.ok &&
          document.id === parsed.value.studentId &&
          parsed.value.studentId === input.requestedStudentId &&
          parsed.value.academyId === input.academyId &&
          parsed.value.userId === input.actorUserId &&
          parsed.value.participantType === "adult" &&
          parsed.value.active &&
          parsed.value.status === "active"
        );
      }

      const [studentDocument, relationships] = await Promise.all([
        dependencies.getDocument(
          `academies/${input.academyId}/students/${input.requestedStudentId}`,
        ),
        dependencies.queryDocuments(
          `academies/${input.academyId}/relationships`,
          "studentId",
          input.requestedStudentId,
          maximumRelationships + 1,
        ),
      ]);
      if (
        relationships.length > maximumRelationships ||
        !studentDocument.exists ||
        studentDocument.data === undefined
      ) {
        return false;
      }

      const parsedStudent = parseStudentProfile(studentDocument.data);
      if (
        !parsedStudent.ok ||
        studentDocument.id !== parsedStudent.value.studentId ||
        parsedStudent.value.studentId !== input.requestedStudentId ||
        parsedStudent.value.academyId !== input.academyId ||
        parsedStudent.value.participantType !== "minor" ||
        !parsedStudent.value.active ||
        parsedStudent.value.status !== "active" ||
        !safeIdentifier(parsedStudent.value.familyId)
      ) {
        return false;
      }

      const familyDocument = await dependencies.getDocument(
        `academies/${input.academyId}/families/${parsedStudent.value.familyId}`,
      );
      if (!familyDocument.exists || familyDocument.data === undefined) {
        return false;
      }
      const parsedFamily = parseFamilyRecord(familyDocument.data);
      if (
        !parsedFamily.ok ||
        familyDocument.id !== parsedFamily.value.familyId ||
        parsedFamily.value.familyId !== parsedStudent.value.familyId ||
        parsedFamily.value.academyId !== input.academyId ||
        !parsedFamily.value.active ||
        parsedFamily.value.status !== "active"
      ) {
        return false;
      }

      const nowMs = Date.parse(dependencies.now?.() ?? new Date().toISOString());
      if (!Number.isFinite(nowMs)) return false;
      return relationships.some((document) => {
        if (!document.exists || document.data === undefined) return false;
        const parsed = parseFamilyRelationship(document.data);
        if (!parsed.ok) return false;
        const validFromMs = Date.parse(parsed.value.validFrom);
        const validToMs =
          parsed.value.validTo === undefined ? undefined : Date.parse(parsed.value.validTo);
        return (
          document.id === parsed.value.relationshipId &&
          parsed.value.academyId === input.academyId &&
          parsed.value.familyId === parsedStudent.value.familyId &&
          parsed.value.studentId === parsedStudent.value.studentId &&
          parsed.value.adultUserId === input.actorUserId &&
          parsed.value.relationshipType === "guardian" &&
          parsed.value.permissions.includes("readProfile") &&
          parsed.value.active &&
          parsed.value.status === "active" &&
          Number.isFinite(validFromMs) &&
          validFromMs <= nowMs &&
          (validToMs === undefined || (Number.isFinite(validToMs) && nowMs < validToMs))
        );
      });
    } catch {
      return false;
    }
  };
}

export function createFirestoreCanonicalClientStudentScopeResolver(
  options: Readonly<{ firestore?: Firestore; now?: () => string }> = {},
): CanonicalClientStudentScopeResolver {
  const firestore = () => options.firestore ?? getFirestore();
  return createCanonicalClientStudentScopeResolver({
    ...(options.now === undefined ? {} : { now: options.now }),
    getDocument: async (path) => {
      const snapshot = await firestore().doc(path).get();
      return {
        id: snapshot.id,
        exists: snapshot.exists,
        data: snapshot.data(),
      };
    },
    queryDocuments: async (path, field, value, limit) => {
      const snapshot = await firestore()
        .collection(path)
        .where(field, "==", value)
        .limit(limit)
        .get();
      return snapshot.docs.map((document) => ({
        id: document.id,
        exists: document.exists,
        data: document.data(),
      }));
    },
  });
}
