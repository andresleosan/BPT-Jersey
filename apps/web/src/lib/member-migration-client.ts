import { httpsCallable } from "firebase/functions";
import type { z } from "zod";
import {
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
  "minor-deferred": "Members under 18 or without a date of birth wait for the guardian step.",
  "record-already-linked": "That record already belongs to another member.",
  "identifier-reserved": "Another member already holds this membership or ID number.",
  "identity-changed": "The archive record changed. Refresh before linking.",
  "write-failed": "Could not save this decision. Try again.",
};
export const memberMigrationErrorMessage = (code: MemberMigrationRejectionCode) => messages[code];
