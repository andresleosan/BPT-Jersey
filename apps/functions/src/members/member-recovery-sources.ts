import { FieldPath, type Firestore, type Transaction, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { parseMemberRecord } from "@bpt-jersey/domain/members";
import {
  parseStoredRegyfitMemberRecord,
  type RegyfitMemberRecord,
} from "@bpt-jersey/domain/members/regyfit-records";
import { parseEffectiveStudentProfileAt } from "@bpt-jersey/domain/profiles";
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";

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
    const parsed = parseEffectiveStudentProfileAt(document.data(), dateKeyInJersey(new Date(time)));
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


const sourceCollections = { regyfit: "regyfitMemberRecords", member: "members", student: "students" } as const;
export type RecoverySourcePage = Readonly<{
  records: readonly Readonly<{ source: RecoverySource; revision: string }>[];
  nextCursor?: string;
}>;
/** Office-only caller: scan one bounded source page, never the entire directory during public recovery. */
export async function readRecoverySourcePage(
  t: Transaction, firestore: Firestore, academyId: string, kind: RecoverySourceKind,
  time: string, afterDocumentId?: string,
): Promise<RecoverySourcePage> {
  const safe = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
  if (!safe.test(academyId) || (afterDocumentId !== undefined && !safe.test(afterDocumentId))) {
    throw new HttpsError("invalid-argument", "Invalid recovery page");
  }
  let query = firestore.collection(`academies/${academyId}/${sourceCollections[kind]}`)
    .orderBy(FieldPath.documentId());
  if (afterDocumentId) query = query.startAfter(afterDocumentId);
  const snapshot = await t.get(query.limit(51));
  const visible = snapshot.docs.slice(0, 50);
  const records = visible.flatMap((document) => {
    const source = recoverySourceFromDocument(document, academyId, kind, time);
    return source ? [{ source, revision: `${document.updateTime.seconds}:${document.updateTime.nanoseconds}` }] : [];
  });
  const nextCursor = snapshot.docs.length > 50 ? visible.at(-1)!.id : undefined;
  return { records, ...(nextCursor ? { nextCursor } : {}) };
}
function recoverySourceFromDocument(document: QueryDocumentSnapshot, academyId: string, kind: RecoverySourceKind, time: string): RecoverySource | undefined {
  const raw = document.data();
  if (kind === "regyfit") {
    if (raw.academyId !== undefined && raw.academyId !== academyId) return;
    const parsed = parseStoredRegyfitMemberRecord(raw);
    if (!parsed.ok || parsed.value.recordId !== document.id) return;
    return { ...parsed.value, kind };
  }
  if (kind === "member") {
    const parsed = parseMemberRecord(raw);
    if (!parsed.ok || parsed.value.academyId !== academyId || parsed.value.memberId !== document.id) return;
    const record = parsed.value;
    return { kind, recordId: record.memberId, legacyMemberId: record.memberId, source: "legacy-member-directory",
      fullName: record.fullName, email: record.email, birthDate: record.birthDate, mobile: record.mobileNumber,
      gender: record.gender, memberNumber: record.membershipNumber, idCardNumber: record.idCardNumber,
      vatNumber: record.vatNumber, membershipState: record.membershipStatus === "active" ? "active" : "inactive", capturedAt: record.updatedAt };
  }
  const parsed = parseEffectiveStudentProfileAt(raw, dateKeyInJersey(new Date(time)));
  if (!parsed.ok || parsed.value.academyId !== academyId || parsed.value.studentId !== document.id) return;
  const record = parsed.value;
  return { kind, recordId: record.studentId, canonicalStudentId: record.studentId, source: "canonical-student",
    fullName: record.fullName, email: record.email, birthDate: record.dateOfBirth, mobile: record.phoneNumber,
    gender: "unknown", membershipState: record.active && record.status === "active" ? "active" : "inactive", capturedAt: record.updatedAt };
}
