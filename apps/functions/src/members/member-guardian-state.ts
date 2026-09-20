import { createHash } from "node:crypto";
import { memberGuardianStateSchema, memberAgeOn } from "@bpt-jersey/domain/members/access";
import { parseFamilyRelationship, type FamilyRelationship, type ChildGuardianChange } from "@bpt-jersey/domain/families";
import type { StudentProfile } from "@bpt-jersey/domain/profiles";
import { dateKeyInJersey, jerseyMidnight } from "@bpt-jersey/domain/schedule/member-calendar";
import { canonicalizeMemberDirectoryValue, createMemberDirectoryIntegrityMac, constantTimeMacEquals } from "./member-directory-crypto.js";
import { HttpsError } from "firebase-functions/v2/https";

export type GuardianStateInput = Omit<ReturnType<typeof memberGuardianStateSchema.parse>, "integrityMac">;
export function signedGuardianState(value: GuardianStateInput, secretMaterial: string) {
  const integrityMac = createMemberDirectoryIntegrityMac({ domain: "bpt-member-guardian-state-v1",
    values: [value.academyId, value.studentId, canonicalizeMemberDirectoryValue(value)], secretMaterial });
  return memberGuardianStateSchema.parse({ ...value, integrityMac });
}
export function guardianRelationshipVersion(value: FamilyRelationship): string {
  return createHash("sha256").update(canonicalizeMemberDirectoryValue(value)).digest("hex");
}
export type GuardianTransaction = Readonly<{
  get: (path: string) => Promise<Readonly<Record<string, unknown>> | undefined>;
  listRelationships: (academyId: string, studentId: string) => Promise<readonly Readonly<{ id: string; data: Readonly<Record<string, unknown>> | undefined }>[]>;
  create: (path: string, data: Readonly<Record<string, unknown>>) => void;
  set: (path: string, data: Readonly<Record<string, unknown>>) => void;
}>;
export function eighteenthBirthday(dateOfBirth: string): string {
  const year = Number(dateOfBirth.slice(0, 4)) + 18;
  const day = `${year.toString().padStart(4, "0")}${dateOfBirth.slice(4)}`;
  // The age policy reaches a leap-day birthday on 1 March when 29 February does not exist.
  return dateOfBirth.endsWith("02-29") && memberAgeOn(dateOfBirth, day) === null ? `${year}-03-01` : day;
}

/** All reads precede commit(). The enclosing writer owns actor/Auth verification, guard and receipt. */
export async function prepareChildGuardianChange(tx: GuardianTransaction, input: ChildGuardianChange,
  context: Readonly<{ academyId: string; actorId: string; now: string; student: StudentProfile; familyId: string; integritySecretMaterial: string; deactivateFamily?: boolean }>) {
  const { academyId, actorId, now, student, familyId, integritySecretMaterial } = context;
  const fail = (message: string): never => { throw new HttpsError("failed-precondition", message); };
  const age = memberAgeOn(student.dateOfBirth, dateKeyInJersey(new Date(now)));
  if (student.academyId !== academyId || student.studentId !== input.studentId || age === null) fail("Confirm this member's identity and date of birth first");
  if (input.proposedGuardianUserId === null && age < 16 && !context.deactivateFamily) fail("A guardian is required before age 16");
  if (input.proposedGuardianUserId !== null && age >= 18) fail("This member manages their own account");
  const base = `academies/${academyId}`;
  const anchorPath = `${base}/memberGuardianStates/${student.studentId}`;
  const [rawAnchor, docs, alias] = await Promise.all([tx.get(anchorPath), tx.listRelationships(academyId, student.studentId), tx.get(`${base}/memberIdentityAliases/${student.studentId}`)]);
  if (alias) fail("Open the canonical member before changing guardian access");
  if (docs.length > 100) fail("Review this child's relationship history in bounded pages first");
  const relationships = docs.map((doc) => {
    const parsed = parseFamilyRelationship(doc.data);
    if (!parsed.ok || parsed.value.relationshipId !== doc.id || parsed.value.studentId !== student.studentId || parsed.value.academyId !== academyId) return fail("A stored relationship needs review");
    return parsed.value;
  });
  const open = relationships.filter((link) => link.active && link.status === "active");
  if (open.length > 1) fail("Conflicting guardians require individual reconciliation");
  const before = open[0] ?? null;
  if (rawAnchor) {
    const parsed = memberGuardianStateSchema.safeParse(rawAnchor);
    if (!parsed.success) fail("The guardian index needs review");
    const { integrityMac, ...value } = parsed.data;
    if (!constantTimeMacEquals(signedGuardianState(value, integritySecretMaterial).integrityMac, integrityMac) ||
        value.academyId !== academyId || value.studentId !== student.studentId || value.relationshipId !== (before?.relationshipId ?? null) ||
        value.guardianUserId !== (before?.adultUserId ?? null)) fail("The guardian index conflicts with the relationship history");
  }
  if ((before?.relationshipId ?? null) !== input.expectedRelationshipId ||
      (before ? guardianRelationshipVersion(before) : null) !== input.expectedRelationshipVersion) fail("The guardian has changed. Refresh this review");
  if (before && before.familyId !== familyId) fail("The child and guardian have conflicting family references");
  if (before && Date.parse(before.validFrom) > Date.parse(now)) fail("A future guardian relationship needs review");
  let effectiveEnd = now;
  if (age >= 18 && student.dateOfBirth) effectiveEnd = jerseyMidnight(eighteenthBirthday(student.dateOfBirth)).toISOString();
  if (before?.validTo && Date.parse(before.validTo) < Date.parse(effectiveEnd)) effectiveEnd = before.validTo;
  if (before && Date.parse(effectiveEnd) < Date.parse(before.validFrom)) fail("The guardian start date conflicts with adulthood");
  const ended: FamilyRelationship | null = before ? { ...before, active: false, status: "inactive", validTo: effectiveEnd, updatedAt: now, updatedBy: actorId } : null;
  const relationship: FamilyRelationship | null = input.proposedGuardianUserId === null ? null : {
    relationshipId: `guardian-${input.requestId}`, academyId, familyId, studentId: student.studentId,
    adultUserId: input.proposedGuardianUserId, relationshipType: "guardian", permissions: ["readProfile"],
    active: true, status: "active", validFrom: now, schemaVersion: "1", createdAt: now, createdBy: actorId, updatedAt: now, updatedBy: actorId,
  };
  if (relationship && await tx.get(`${base}/relationships/${relationship.relationshipId}`)) fail("This relationship ID has already been used");
  const anchor = signedGuardianState({ academyId, studentId: student.studentId, relationshipId: relationship?.relationshipId ?? null,
    guardianUserId: relationship?.adultUserId ?? null, revision: input.requestId, updatedAt: now, updatedBy: actorId, schemaVersion: "1" }, integritySecretMaterial);
  return { before, ended, relationship, anchor, reason: age >= 18 ? "adulthood" : "reviewed-change",
    commit() {
      if (ended) tx.set(`${base}/relationships/${ended.relationshipId}`, ended);
      if (relationship) tx.create(`${base}/relationships/${relationship.relationshipId}`, relationship);
      tx.set(anchorPath, anchor);
    } };
}
