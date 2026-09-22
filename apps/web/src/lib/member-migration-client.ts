import { httpsCallable } from "./callable";
import type { z } from "zod";
import {
  assignMemberGuardianInputSchema,
  confirmMemberTrainingCenterInputSchema,
  setMemberDateOfBirthInputSchema,
  memberReviewResultSchema,
  decideMemberMigrationInputSchema,
  decideMemberMigrationResultSchema,
  memberMigrationQueueResponseSchema,
  type MemberMigrationRejectionCode,
} from "@bpt-jersey/domain/members/migration";
import { getFirebaseFunctions } from "./firebase-client";

async function call<T>(name: string, input: unknown, schema: z.ZodType<T>): Promise<T> {
  const result = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), name)(input);
  return schema.parse(result.data);
}

export const listMemberMigrationQueue = () =>
  call("listMemberMigrationQueue", null, memberMigrationQueueResponseSchema);

export const decideMemberMigration = (
  decisions: z.input<typeof decideMemberMigrationInputSchema>["decisions"],
) =>
  call(
    "decideMemberMigration",
    decideMemberMigrationInputSchema.parse({ decisions }),
    decideMemberMigrationResultSchema,
  );

const messages: Readonly<Record<MemberMigrationRejectionCode, string>> = {
  "unknown-member": "This member is no longer in the legacy list. Refresh the queue.",
  "already-decided": "Someone already decided this member. Refresh the queue.",
  "not-a-candidate": "That record is not a match for this member any more. Refresh the queue.",
  "record-already-linked": "That record already belongs to another member.",
  "identifier-reserved": "Another member already holds this membership or ID number.",
  "invalid-member-data": "This member's ID or member number is not in a format the directory accepts. Correct the legacy record or skip.",
  "conflicts-require-review": "Choose and explain how to resolve every source difference before linking.",
  "batch-requires-compatible-identity": "Batch approval requires a compatible unique identifier and no unresolved differences.",
  "identity-changed": "The archive record changed. Refresh before linking.",
  "write-failed": "Could not save this decision. Try again.",
};
export const memberMigrationErrorMessage = (code: MemberMigrationRejectionCode) => messages[code];


export async function assignMemberGuardian(input: z.input<typeof assignMemberGuardianInputSchema>) {
  try { return await call("assignMemberGuardian", assignMemberGuardianInputSchema.parse(input), memberReviewResultSchema); }
  catch { throw new Error("Could not assign the guardian. Please try again."); }
}
export async function setMemberDateOfBirth(input: z.input<typeof setMemberDateOfBirthInputSchema>) {
  try { return await call("setMemberDateOfBirth", setMemberDateOfBirthInputSchema.parse(input), memberReviewResultSchema); }
  catch { throw new Error("Could not set the date of birth. Please try again."); }
}
export async function confirmMemberTrainingCenter(input: z.input<typeof confirmMemberTrainingCenterInputSchema>) {
  try { return await call("confirmMemberTrainingCenter", confirmMemberTrainingCenterInputSchema.parse(input), memberReviewResultSchema); }
  catch { throw new Error("Could not confirm the training centre. Please try again."); }
}
