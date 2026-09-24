import { z } from "zod";
import { reviewIdentifierSchema } from "./member-reconciliation-contracts";

export const teenAccountMinimumAge = 12;
/** Calendar years at the academy. A leap-day birthday is reached on 1 March in a non-leap year. */
export function memberAgeOn(dateOfBirth: string | undefined, academyDate: string): number | null {
  if (!dateOfBirth || !z.iso.date().safeParse(dateOfBirth).success || !z.iso.date().safeParse(academyDate).success || dateOfBirth > academyDate) return null;
  const years = Number(academyDate.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  return years - (academyDate.slice(5) < dateOfBirth.slice(5) ? 1 : 0);
}
export type MemberAccessFacts = Readonly<{
  actorActive: boolean; academyMatches: boolean; memberAccessible: boolean;
  confirmedAge: number | null; ownLinkApproved: boolean; guardianLinkCurrent: boolean;
}>;
export type MemberAccessDecision = Readonly<{ allowed: true; via: "self" | "guardian" }> | Readonly<{ allowed: false }>;
export function decideMemberAccess(facts: MemberAccessFacts): MemberAccessDecision {
  if (!facts.actorActive || !facts.academyMatches || !facts.memberAccessible || facts.confirmedAge === null || !Number.isSafeInteger(facts.confirmedAge) || facts.confirmedAge < 0) return { allowed: false };
  if (facts.ownLinkApproved && facts.confirmedAge >= teenAccountMinimumAge) return { allowed: true, via: "self" };
  if (facts.guardianLinkCurrent && facts.confirmedAge < 18) return { allowed: true, via: "guardian" };
  return { allowed: false };
}
/** Q4: credentials never expire; the first own sign-in at 18 hands the account over once. */
export function needsAdultClaim(input: Readonly<{ age: number | null; via: "self" | "guardian"; createdByGuardian: boolean; adultClaimedAt: string | null }>): boolean {
  return input.via === "self" && input.createdByGuardian && input.adultClaimedAt === null && input.age !== null && input.age >= 18;
}
export const accountMemberProfileSchema = z.strictObject({
  studentId: reviewIdentifierSchema, fullName: z.string().min(1).max(160),
  via: z.enum(["self", "guardian"]), trainingDetailsRequired: z.boolean(),
});
export type AccountMemberProfile = Readonly<z.infer<typeof accountMemberProfileSchema>>;
export interface MemberAccessService {
  authorise(academyId: string, actorUserId: string, studentId: string): Promise<MemberAccessDecision>;
  listProfiles(academyId: string, actorUserId: string): Promise<readonly AccountMemberProfile[]>;
}
/** This index serialises child link changes; the relationship remains the permission record. */
export const memberGuardianStateSchema = z.strictObject({
  academyId: reviewIdentifierSchema, studentId: reviewIdentifierSchema,
  relationshipId: reviewIdentifierSchema.nullable(), guardianUserId: reviewIdentifierSchema.nullable(),
  integrityMac: z.string().regex(/^[a-f0-9]{64}$/u), revision: z.uuid(), updatedAt: z.iso.datetime(), updatedBy: reviewIdentifierSchema, schemaVersion: z.literal("1"),
}).refine((state) => (state.relationshipId === null) === (state.guardianUserId === null));
