import { createHash } from "node:crypto";
import { z } from "zod";
import { HttpsError } from "firebase-functions/v2/https";
import {
  recoverySubjectSchema, memberRecoveryV2ResultSchema, memberRecoveryV2StatusSchema,
  recoveryRequestStatus, memberRecoveryProfileSchema,
} from "@bpt-jersey/domain/members/recovery";
import { canonicalizeMemberDirectoryValue } from "./member-directory-crypto.js";

const opaqueId = z.string().regex(/^[a-f0-9]{64}$/u);
const recordId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
export const recoveryCandidateBindingSchema = z.strictObject({
  candidateId: opaqueId, subjectId: opaqueId, kind: z.enum(["regyfit", "member", "student"]),
  recordId, sourceRevision: z.string().min(1).max(100).optional(),
});
export const storedRecoverySubjectSchema = recoverySubjectSchema.safeExtend({
  profile: memberRecoveryProfileSchema.optional(),
  studentId: recordId.optional(),
  decisionReceiptId: opaqueId.optional(),
  reviewedBy: recordId.optional(),
  reviewedAt: z.iso.datetime().optional(),
  identityEvidence: z.string().max(1000).optional(),
  guardianEvidence: z.string().max(1000).optional(),
  informationRequested: z.string().max(1000).optional(),
});
export const recoveryTicketV2Schema = z.strictObject({
  version: z.literal("2"), recoveryId: opaqueId, academyId: recordId,
  revision: opaqueId, mode: z.enum(["athlete", "guardian"]),
  fullName: z.string().min(1).max(160), previousEmail: z.string().max(320),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  status: memberRecoveryV2StatusSchema, accountVerified: z.boolean(),
  userId: recordId.optional(), accountEmail: z.email().max(320).optional(),
  subjects: z.array(storedRecoverySubjectSchema).min(1).max(11),
  candidates: z.array(recoveryCandidateBindingSchema).max(220),
  legacyAdapted: z.boolean().optional(),
}).superRefine((ticket, ctx) => {
  const ids = ticket.subjects.map((subject) => subject.subjectId);
  const children = ticket.subjects.filter((subject) => subject.kind === "child").length;
  const own = ticket.subjects.length - children;
  if (new Set(ids).size !== ids.length || own > 1 || children > 10 ||
      (ticket.mode === "athlete" && (children !== 0 || own !== 1)) ||
      (ticket.mode === "guardian" && children === 0) ||
      ticket.candidates.some((candidate) => !ids.includes(candidate.subjectId)) ||
      new Set(ticket.candidates.map((candidate) => candidate.candidateId)).size !== ticket.candidates.length ||
      ids.some((id) => ticket.candidates.filter((candidate) => candidate.subjectId === id).length > 20) ||
      ticket.status !== recoveryRequestStatus(ticket.subjects, ticket.accountVerified)) {
    ctx.addIssue({ code: "custom", message: "Recovery ticket scope is invalid" });
  }
});
export type RecoveryTicketV2 = z.infer<typeof recoveryTicketV2Schema>;
export type StoredRecoverySubject = z.infer<typeof storedRecoverySubjectSchema>;

/** Legacy tickets remain stored as-is until an explicit account/reviewer action changes one. */
export function readRecoveryTicket(value: unknown, academyId: string, recoveryId: string): RecoveryTicketV2 {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid ticket");
    const raw = value as Record<string, unknown>;
    if (raw.version === "2") {
      const ticket = recoveryTicketV2Schema.parse(raw);
      if (ticket.academyId !== academyId || ticket.recoveryId !== recoveryId) throw new Error("Invalid ticket binding");
      return ticket;
    }
    if (raw.version !== undefined || raw.academyId !== academyId || raw.recoveryId !== recoveryId ||
        !["verify-email", "pending-review", "profile-required", "linked", "rejected"].includes(String(raw.status))) {
      throw new Error("Invalid legacy ticket");
    }
    const subjectId = createHash("sha256").update(`bpt-recovery-legacy-self:${academyId}:${recoveryId}`).digest("hex");
    const profile = raw.profile === undefined ? undefined : memberRecoveryProfileSchema.parse(raw.profile);
    const previousEmail = typeof raw.previousEmail === "string" ? raw.previousEmail : "";
    const subject = storedRecoverySubjectSchema.parse({
      subjectId, kind: "self", fullName: raw.fullName,
      ...(profile?.dateOfBirth ? { dateOfBirth: profile.dateOfBirth } : {}),
      ...(z.email().safeParse(previousEmail).success ? { previousEmail } : {}),
      ...(profile ? { profile } : {}),
      status: raw.status === "linked" ? "approved" : raw.status === "rejected" ? "rejected"
        : raw.status === "profile-required" ? "more-information" : "pending-review",
      ...(typeof raw.studentId === "string" ? { studentId: raw.studentId } : {}),
    });
    const candidates = z.array(z.object({ candidateId: opaqueId, recordId,
      kind: z.enum(["regyfit", "member", "student"]).optional() })).max(20).parse(raw.candidates)
      .map((candidate) => ({ ...candidate, kind: candidate.kind ?? "regyfit", subjectId }));
    const accountVerified = raw.accountVerified === true;
    return recoveryTicketV2Schema.parse({
      version: "2", recoveryId, academyId, mode: "athlete", fullName: raw.fullName, previousEmail,
      revision: createHash("sha256").update(canonicalizeMemberDirectoryValue(raw)).digest("hex"),
      createdAt: raw.createdAt, updatedAt: raw.updatedAt, expiresAt: raw.expiresAt,
      ...(raw.userId === undefined ? {} : { userId: raw.userId }),
      ...(raw.accountEmail === undefined ? {} : { accountEmail: raw.accountEmail }),
      accountVerified, subjects: [subject], candidates, legacyAdapted: true,
      status: recoveryRequestStatus([subject], accountVerified),
    });
  } catch {
    throw new HttpsError("failed-precondition", "This recovery request needs office review");
  }
}

/** Applicant projections contain only the supplied identities and their decision states. */
export function recoveryTicketForApplicant(ticket: RecoveryTicketV2, accountRefreshRequired = false) {
  return memberRecoveryV2ResultSchema.parse({
    version: "2", recoveryId: ticket.recoveryId, revision: ticket.revision,
    expiresAt: ticket.expiresAt, status: ticket.status, accountRefreshRequired,
    subjects: ticket.subjects.map((subject) => ({
      subjectId: subject.subjectId, kind: subject.kind, fullName: subject.fullName, status: subject.status,
      ...(subject.dateOfBirth ? { dateOfBirth: subject.dateOfBirth } : {}),
      ...(subject.previousEmail ? { previousEmail: subject.previousEmail } : {}),
    })),
  });
}
