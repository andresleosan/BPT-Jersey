import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

const provisionedAdminDocumentSchema = z.strictObject({
  userId: z.string().min(1).max(128),
  academyId: z.string().min(1).max(128),
  accountType: z.literal("staff"),
  displayName: z.string().min(1).max(160),
  email: z.string().email().max(320),
  authProvider: z.literal("google"),
  active: z.literal(true),
  adminRole: z.enum(["owner", "administrator"]),
  lastRoleChangeAuditId: z.string().min(1).max(128),
  createdAt: z.instanceof(Timestamp),
  createdBy: z.string().min(1).max(128),
  updatedAt: z.instanceof(Timestamp),
  updatedBy: z.string().min(1).max(128),
  status: z.literal("active"),
  schemaVersion: z.literal(1),
});

export type MemberDirectoryProvisionedActor = Readonly<{
  actorId: string;
  academyId: string;
  role: string;
}>;

export function matchesProvisionedMemberDirectoryActor(
  value: unknown,
  actor: MemberDirectoryProvisionedActor,
): boolean {
  try {
    const parsed = provisionedAdminDocumentSchema.safeParse(value);
    return (
      parsed.success &&
      parsed.data.userId === actor.actorId &&
      parsed.data.academyId === actor.academyId &&
      parsed.data.adminRole === actor.role
    );
  } catch {
    return false;
  }
}
