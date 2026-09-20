"use client";
import { httpsCallable } from "firebase/functions";
import { z } from "zod";
import {
  teamDirectoryRequestSchema, teamDirectoryResponseSchema, changeTeamRoleSchema,
  staffInvitationInputSchema, staffInvitationSchema, staffInvitationListSchema, invitationIdentitySchema,
  type ChangeTeamRoleInput, type StaffInvitationInput,
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
