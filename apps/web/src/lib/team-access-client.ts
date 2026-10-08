"use client";
import { httpsCallable } from "./callable";
import { z } from "zod";
import {
  teamDirectoryRequestSchema, teamDirectoryResponseSchema, changeTeamRoleSchema,
  staffInvitationInputSchema, staffInvitationSchema, staffInvitationListSchema, invitationIdentitySchema,
  setCoachBeltSchema, setCoachBeltResultSchema, setOwnerTeachesSchema, setOwnerTeachesResultSchema,
  deleteCoachAccountSchema, deleteCoachAccountResultSchema,
  getCoachWebsiteProfileSchema, setCoachWebsiteProfileSchema, coachWebsiteProfileSchema, type SetCoachWebsiteProfileInput,
  type ChangeTeamRoleInput, type StaffInvitationInput,
  type CoachBelt, type SetCoachBeltInput, type SetOwnerTeachesInput, type DeleteCoachAccountInput,
  listCoachEligibleMembersSchema, coachEligibleMembersResponseSchema, grantMemberCoachAccessSchema, switchAccessModeResultSchema,
  type GrantMemberCoachAccessInput, type AccessMode,
  setCoachWebsiteVisibilitySchema, setCoachWebsiteVisibilityResultSchema, type SetCoachWebsiteVisibilityInput,
} from "@bpt-jersey/domain/staff/team-access";
import { getFirebaseFunctions } from "./firebase-client";

async function call<T>(name: string, input: unknown, schema: z.ZodType<T>, message: string): Promise<T> {
  try { return schema.parse((await httpsCallable<unknown, unknown>(getFirebaseFunctions(), name)(input)).data); }
  catch { throw new Error(message); }
}
export function listTeamDirectory(pageToken?: string) {
  return call("listTeamDirectory", teamDirectoryRequestSchema.parse(pageToken ? { pageToken } : {}), teamDirectoryResponseSchema, "Unable to load the team directory. Please try again.");
}
export function changeTeamRole(input: ChangeTeamRoleInput) {
  return call("changeTeamRole", changeTeamRoleSchema.parse(input), z.strictObject({ changed: z.literal(true) }), "Unable to change this role. Refresh the team directory and check that the account is active and you still have owner access.");
}
export function createStaffInvitation(input: StaffInvitationInput) {
  return call("createStaffInvitation", staffInvitationInputSchema.parse(input), staffInvitationSchema, "Unable to authorise this email. Please refresh and try again.");
}
export function listStaffInvitations() {
  return call("listStaffInvitations", {}, staffInvitationListSchema, "Unable to load pending invitations. Please try again.");
}
export function cancelStaffInvitation(input: { id: string; version: string }) {
  return call("cancelStaffInvitation", invitationIdentitySchema.parse(input), z.strictObject({ cancelled: z.literal(true) }), "Unable to cancel this invitation. It may have changed; refresh the list.");
}
export function acceptStaffInvitation() {
  return call("acceptStaffInvitation", {}, z.strictObject({ activated: z.boolean() }), "Unable to activate staff access. Use the invited Google account or contact an owner.");
}

const directStaffResultSchema = z.strictObject({ userId: z.string().min(1).max(128), email: z.email(), role: z.enum(["coach","administrator","owner"]), passwordChangeRequired: z.literal(true) });
export function createStaffWithPassword(input: { displayName: string; email: string; password: string; role: "coach"|"administrator"|"owner"; belt?: CoachBelt }) {
  return call("createStaffWithPassword", input, directStaffResultSchema, "Unable to create this staff account. Check the email and try again.");
}
export function setCoachBelt(input: SetCoachBeltInput) {
  return call("setCoachBelt", setCoachBeltSchema.parse(input), setCoachBeltResultSchema, "Unable to save this belt. Refresh the team directory and try again.");
}
export function setOwnerTeaches(input: SetOwnerTeachesInput) {
  return call("setOwnerTeaches", setOwnerTeachesSchema.parse(input), setOwnerTeachesResultSchema, "Unable to update this owner. Choose a belt and try again.");
}
export function getCoachWebsiteProfile(userId: string) {
  return call("getCoachWebsiteProfile", getCoachWebsiteProfileSchema.parse({ userId }), coachWebsiteProfileSchema, "Unable to load this coach's website card. Please try again.");
}
export function setCoachWebsiteProfile(input: SetCoachWebsiteProfileInput) {
  const parsed = setCoachWebsiteProfileSchema.safeParse(input);
  if (!parsed.success) return Promise.reject(new Error("Keep the description within the limit and use a photo under 2 MB."));
  return call("setCoachWebsiteProfile", parsed.data, coachWebsiteProfileSchema, "Unable to save this website card. Check the photo and try again.");
}
/** Unlike call(), keeps the server's reason when a coach still has classes to reassign. */
export async function deleteCoachAccount(input: DeleteCoachAccountInput) {
  try {
    return deleteCoachAccountResultSchema.parse((await httpsCallable<unknown, unknown>(getFirebaseFunctions(), "deleteCoachAccount")(deleteCoachAccountSchema.parse(input))).data);
  } catch (error) {
    const reason = (error as { code?: string }).code === "functions/failed-precondition" && error instanceof Error ? error.message : "";
    throw new Error(reason || "Unable to delete this coach. Refresh the team directory and try again.");
  }
}
export function listCoachEligibleMembers(query: string) {
  return call("listCoachEligibleMembers", listCoachEligibleMembersSchema.parse({ query }), coachEligibleMembersResponseSchema, "Unable to search members. Please try again.").then((result) => result.members);
}
export function grantMemberCoachAccess(input: GrantMemberCoachAccessInput) {
  return call("grantMemberCoachAccess", grantMemberCoachAccessSchema.parse(input), z.strictObject({ granted: z.literal(true) }), "Unable to give coach access. Check that the member is an active adult and not already staff.");
}
/** true when the claim changed; false when there was nothing to change or the account has one access mode. */
export async function switchAccessMode(mode: AccessMode): Promise<boolean> {
  try {
    return switchAccessModeResultSchema.parse((await httpsCallable<unknown, unknown>(getFirebaseFunctions(), "switchAccessMode")({ mode })).data).switched;
  } catch {
    return false;
  }
}
export function setCoachWebsiteVisibility(input: SetCoachWebsiteVisibilityInput) {
  return call("setCoachWebsiteVisibility", setCoachWebsiteVisibilitySchema.parse(input), setCoachWebsiteVisibilityResultSchema, "Unable to change website visibility. Refresh the team directory and try again.");
}
