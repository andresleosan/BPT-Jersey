import { createHash, randomUUID } from "node:crypto";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import {
  changeTeamRoleSchema,
  staffInvitationInputSchema,
  teamDirectoryRequestSchema,
  teamDirectoryResponseSchema,
  invitationIdentitySchema,
  type StaffInvitation,
  type TeamDirectoryResponse,
} from "@bpt-jersey/domain/staff/team-access";
import { requireAdminActor, type AdminActor } from "../auth/admin-authorization.js";

export type TeamAccount = Readonly<{
  uid: string;
  email?: string;
  emailVerified: boolean;
  displayName?: string;
  disabled: boolean;
  customClaims?: Record<string, unknown>;
  providerData: readonly { providerId: string }[];
}>;
export type TeamAccessServices = Readonly<{
  auth: {
    getUser(uid: string): Promise<TeamAccount>;
    listUsers(
      maxResults: number,
      pageToken?: string,
    ): Promise<{ users: readonly TeamAccount[]; pageToken?: string }>;
  };
  invitations: {
    list(academyId: string): Promise<StaffInvitation[]>;
    save(invitation: StaffInvitation): Promise<StaffInvitation>;
    cancel(academyId: string, id: string, version: string): Promise<void>;
    claim(email: string, userId: string, now: string): Promise<StaffInvitation | null>;
    finish(
      invitation: StaffInvitation,
      userId: string,
      status: "accepted" | "failed",
    ): Promise<void>;
  };
  grant(
    actor: AdminActor,
    target: { uid: string; email: string | null; role: "owner" | "administrator" | "coach" },
    transition: "team" | "invitation",
  ): Promise<void>;
  now(): Date;
}>;
function verifiedApplication(request: CallableRequest): void {
  if (!request.app || !request.auth)
    throw new HttpsError("unauthenticated", "Sign in with the verified application.");
}
function emptyInput(data: unknown): void {
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length !== 0)
    throw new HttpsError("invalid-argument", "This request takes no fields.");
}
async function currentActor(
  request: CallableRequest,
  services: TeamAccessServices,
  ownerOnly = false,
): Promise<AdminActor> {
  verifiedApplication(request);
  const actor = requireAdminActor(request);
  if (ownerOnly && actor.role !== "owner")
    throw new HttpsError("permission-denied", "Only an owner can manage administrative access.");
  const current = await services.auth.getUser(actor.uid);
  if (
    current.disabled ||
    current.customClaims?.academyId !== actor.academyId ||
    current.customClaims.role !== actor.role
  )
    throw new HttpsError(
      "permission-denied",
      "Your administrative access has changed. Sign in again.",
    );
  return actor;
}
export async function listTeamDirectoryHandler(
  request: CallableRequest,
  services: TeamAccessServices,
): Promise<TeamDirectoryResponse> {
  const actor = await currentActor(request, services);
  const input = teamDirectoryRequestSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid directory request.");
  const page = await services.auth.listUsers(1000, input.data.pageToken);
  const people = page.users
    .filter(
      (user) =>
        user.customClaims?.academyId === actor.academyId &&
        ["owner", "administrator", "headCoach", "coach"].includes(String(user.customClaims.role)),
    )
    .map((user) => ({
      userId: user.uid,
      name: user.displayName?.trim() ?? "",
      email: user.email ?? null,
      role: user.customClaims!.role,
    }));
  return teamDirectoryResponseSchema.parse({ people, nextPageToken: page.pageToken ?? null });
}
export async function changeTeamRoleHandler(
  request: CallableRequest,
  services: TeamAccessServices,
) {
  const actor = await currentActor(request, services, true);
  const input = changeTeamRoleSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid role change.");
  if (input.data.userId === actor.uid)
    throw new HttpsError("failed-precondition", "Ask another owner to change your role.");
  await services.grant(
    actor,
    { uid: input.data.userId, email: input.data.email, role: input.data.role },
    "team",
  );
  return { changed: true };
}
export async function createStaffInvitationHandler(
  request: CallableRequest,
  services: TeamAccessServices,
) {
  const actor = await currentActor(request, services);
  const input = staffInvitationInputSchema.safeParse(request.data);
  if (!input.success)
    throw new HttpsError("invalid-argument", "Enter an email address and an administrative role.");
  if (input.data.role !== "coach" && actor.role !== "owner")
    throw new HttpsError("permission-denied", "Only an owner can grant administrative access.");
  const now = services.now();
  return services.invitations.save({
    id: createHash("sha256").update(input.data.email).digest("hex"),
    version: randomUUID(),
    academyId: actor.academyId,
    ...input.data,
    invitedBy: actor.uid,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString(),
    status: "pending",
    claimedBy: null,
  });
}
export async function listStaffInvitationsHandler(
  request: CallableRequest,
  services: TeamAccessServices,
) {
  const actor = await currentActor(request, services, true);
  emptyInput(request.data);
  return services.invitations.list(actor.academyId);
}
export async function cancelStaffInvitationHandler(
  request: CallableRequest,
  services: TeamAccessServices,
) {
  const actor = await currentActor(request, services, true);
  const input = invitationIdentitySchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid invitation.");
  await services.invitations.cancel(actor.academyId, input.data.id, input.data.version);
  return { cancelled: true };
}
export async function acceptStaffInvitationHandler(
  request: CallableRequest,
  services: TeamAccessServices,
) {
  verifiedApplication(request);
  emptyInput(request.data);
  const token = request.auth!.token;
  if (token.firebase?.sign_in_provider !== "google.com" || token.email_verified !== true)
    throw new HttpsError("failed-precondition", "Use Google with your verified invitation email.");
  const user = await services.auth.getUser(request.auth!.uid);
  if (
    user.disabled ||
    !user.emailVerified ||
    !user.email ||
    user.email.toLowerCase() !== String(token.email).toLowerCase() ||
    !user.providerData.some((provider) => provider.providerId === "google.com")
  )
    throw new HttpsError("failed-precondition", "Use Google with your verified invitation email.");
  const invitation = await services.invitations.claim(
    user.email.toLowerCase(),
    user.uid,
    services.now().toISOString(),
  );
  if (!invitation) return { activated: false };
  try {
    const issuer = await services.auth.getUser(invitation.invitedBy);
    if (
      issuer.disabled ||
      !(
        issuer.customClaims?.role === "owner" ||
        (invitation.role === "coach" && issuer.customClaims?.role === "administrator")
      ) ||
      issuer.customClaims.academyId !== invitation.academyId
    )
      throw new HttpsError("permission-denied", "The invitation needs to be renewed by an owner.");
    await services.grant(
      {
        uid: issuer.uid,
        academyId: invitation.academyId,
        role: issuer.customClaims!.role as "owner" | "administrator",
      },
      { uid: user.uid, email: invitation.email, role: invitation.role },
      "invitation",
    );
  } catch (error) {
    await services.invitations.finish(invitation, user.uid, "failed");
    throw error;
  }
  // A failed acknowledgement must not make the already-applied grant eligible for replay.
  await services.invitations.finish(invitation, user.uid, "accepted");
  return { activated: true };
}
