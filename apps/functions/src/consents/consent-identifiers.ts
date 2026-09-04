import { createHash } from "node:crypto";

export function consentRecordId(
  academyId: string,
  studentId: string,
  waiverVersionId: string,
): string {
  return `consent_${createHash("sha256")
    .update(`${academyId}|${studentId}|${waiverVersionId}`)
    .digest("hex")
    .slice(0, 40)}`;
}
