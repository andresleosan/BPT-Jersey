import { z } from "zod";

export const teamRoleSchema = z.enum(["owner", "administrator", "headCoach", "coach"]);
export const assignableTeamRoleSchema = z.enum(["coach", "administrator", "owner"]);
export const administrativeTeamRoleSchema = z.enum(["administrator", "owner"]);
export const teamRoleLabels = {
  owner: "Owner",
  administrator: "Administrator",
  headCoach: "Head coach (legacy)",
  coach: "Coach",
} as const;
export const teamEmailSchema = z.string().trim().toLowerCase().email().max(320);
export const teamDirectoryRequestSchema = z.strictObject({
  pageToken: z.string().min(1).max(2048).optional(),
});
export const teamDirectoryPersonSchema = z.strictObject({
  userId: z.string().min(1).max(128),
  name: z.string().max(256),
  email: z.string().max(320).nullable(),
  role: teamRoleSchema,
});
export const teamDirectoryResponseSchema = z.strictObject({
  people: z.array(teamDirectoryPersonSchema).max(1000),
  nextPageToken: z.string().min(1).max(2048).nullable(),
});
export const changeTeamRoleSchema = z.strictObject({
  userId: z.string().min(1).max(128),
  email: teamEmailSchema,
  role: administrativeTeamRoleSchema,
});
export const staffInvitationInputSchema = z.strictObject({
  email: teamEmailSchema,
  role: assignableTeamRoleSchema,
});
export const staffInvitationSchema = z.strictObject({
  id: z.string().min(1).max(128),
  version: z.string().min(1).max(128),
  academyId: z.string().min(1),
  email: teamEmailSchema,
  role: assignableTeamRoleSchema,
  invitedBy: z.string().min(1),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  status: z.enum(["pending", "processing", "accepted", "cancelled", "failed"]),
  claimedBy: z.string().nullable(),
});
export const invitationIdentitySchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/u),
  version: z.string().min(1).max(128),
});
export const staffInvitationListSchema = z.array(staffInvitationSchema).max(500);
export type TeamDirectoryPerson = z.infer<typeof teamDirectoryPersonSchema>;
export type TeamDirectoryResponse = z.infer<typeof teamDirectoryResponseSchema>;
export type StaffInvitation = z.infer<typeof staffInvitationSchema>;
export type StaffInvitationInput = z.infer<typeof staffInvitationInputSchema>;
export type ChangeTeamRoleInput = z.infer<typeof changeTeamRoleSchema>;
