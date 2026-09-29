"use client";
import { httpsCallable } from "./callable";
import { z } from "zod";
import {
  teamDirectoryRequestSchema, teamDirectoryResponseSchema, changeTeamRoleSchema,
  staffInvitationInputSchema, staffInvitationSchema, staffInvitationListSchema, invitationIdentitySchema,
  setCoachBeltSchema, setCoachBeltResultSchema, setOwnerTeachesSchema, setOwnerTeachesResultSchema,
  deleteCoachAccountSchema, deleteCoachAccountResultSchema,
  type ChangeTeamRoleInput, type StaffInvitationInput,
  type CoachBelt, type SetCoachBeltInput, type SetOwnerTeachesInput, type DeleteCoachAccountInput,
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
/** Unlike call(), keeps the server's reason when a coach still has classes to reassign. */
export async function deleteCoachAccount(input: DeleteCoachAccountInput) {
  try {
    return deleteCoachAccountResultSchema.parse((await httpsCallable<unknown, unknown>(getFirebaseFunctions(), "deleteCoachAccount")(deleteCoachAccountSchema.parse(input))).data);
  } catch (error) {
    const reason = (error as { code?: string }).code === "functions/failed-precondition" && error instanceof Error ? error.message : "";
    throw new Error(reason || "Unable to delete this coach. Refresh the team directory and try again.");
  }
}
