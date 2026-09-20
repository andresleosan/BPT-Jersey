import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { parseMemberRecord } from "@bpt-jersey/domain/members";
import {
  parseStoredRegyfitMemberRecord,
  type RegyfitMemberRecord,
} from "@bpt-jersey/domain/members/regyfit-records";
import { parseStudentProfileAt } from "@bpt-jersey/domain/profiles";

export type RecoverySourceKind = "regyfit" | "member" | "student";
export type RecoverySource = Pick<
  RegyfitMemberRecord,
  | "fullName"
  | "email"
  | "birthDate"
  | "age"
  | "mobile"
  | "gender"
  | "memberNumber"
  | "idCardNumber"
  | "vatNumber"
  | "membershipState"
  | "capturedAt"
> & {
  recordId: string;
  kind: RecoverySourceKind;
  source: "regyfit-admin-capture" | "legacy-member-directory" | "canonical-student";
  canonicalStudentId?: string;
  legacyMemberId?: string;
};

export function normalizeRecoveryName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}

export async function loadRecoverySources(
  t: Transaction,
  firestore: Firestore,
  academyId: string,
  time: string,
): Promise<RecoverySource[]> {
  const collections = ["regyfitMemberRecords", "members", "students"] as const;
  const snapshots = await Promise.all(
    collections.map((collection) =>
      t.get(firestore.collection(`academies/${academyId}/${collection}`).limit(1001)),
    ),
  );
  if (snapshots.some((snapshot) => snapshot.docs.length > 1000))
    throw new HttpsError("unavailable", "The office must review the member directory.");
  const sources: RecoverySource[] = [];
  for (const document of snapshots[0]!.docs) {
    const stored = document.data();
    if (stored.academyId !== undefined && stored.academyId !== academyId) continue;
    const parsed = parseStoredRegyfitMemberRecord(stored);
    if (!parsed.ok || parsed.value.recordId !== document.id) continue;
    sources.push({ ...parsed.value, kind: "regyfit" });
  }
  for (const document of snapshots[1]!.docs) {
    const parsed = parseMemberRecord(document.data());
    if (!parsed.ok || parsed.value.memberId !== document.id || parsed.value.academyId !== academyId)
      continue;
    const m = parsed.value;
    sources.push({
      kind: "member",
      recordId: m.memberId,
      legacyMemberId: m.memberId,
      source: "legacy-member-directory",
      fullName: m.fullName,
      email: m.email,
      birthDate: m.birthDate,
      mobile: m.mobileNumber,
      gender: m.gender,
      memberNumber: m.membershipNumber,
      idCardNumber: m.idCardNumber,
      vatNumber: m.vatNumber,
      membershipState: m.membershipStatus === "active" ? "active" : "inactive",
      capturedAt: m.updatedAt,
    });
  }
  for (const document of snapshots[2]!.docs) {
    const parsed = parseStudentProfileAt(document.data(), time.slice(0, 10));
    if (
      !parsed.ok ||
      parsed.value.studentId !== document.id ||
      parsed.value.academyId !== academyId
    )
      continue;
    const s = parsed.value;
    sources.push({
      kind: "student",
      recordId: s.studentId,
      canonicalStudentId: s.studentId,
      source: "canonical-student",
      fullName: s.fullName,
      email: s.email,
      birthDate: s.dateOfBirth,
      mobile: s.phoneNumber,
      gender: "unknown",
      membershipState: s.active && s.status === "active" ? "active" : "inactive",
      capturedAt: s.updatedAt,
    });
  }
  return sources;
}

// Join archive evidence only with a unique administrative identifier and compatible
// personal details. A matching name by itself never authorises merging histories.
export function archiveForLegacyMember(
  record: RecoverySource,
  sources: readonly RecoverySource[],
): RecoverySource {
  if (record.kind !== "member") return record;
  const matching = sources.filter(
    (s) =>
      s.kind === "regyfit" &&
      normalizeRecoveryName(s.fullName) === normalizeRecoveryName(record.fullName) &&
      !(s.birthDate && record.birthDate && s.birthDate !== record.birthDate) &&
      ((s.memberNumber &&
        record.memberNumber &&
        s.memberNumber.trim() === record.memberNumber.trim()) ||
        (s.idCardNumber &&
          record.idCardNumber &&
          s.idCardNumber.trim() === record.idCardNumber.trim())),
  );
  return matching.length === 1
    ? { ...matching[0]!, membershipState: record.membershipState, legacyMemberId: record.recordId }
    : record;
}
