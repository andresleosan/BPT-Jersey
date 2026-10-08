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
/** Rank order, highest first: the index is the order on the landing page. */
export const coachBelts = [
  "red-9",
  "coral-8",
  "coral-7",
  "black-6",
  "black-5",
  "black-4",
  "black-3",
  "black-2",
  "black-1",
  "black",
  "brown",
  "purple",
  "blue",
] as const;
export const coachBeltSchema = z.enum(coachBelts);
export type CoachBelt = z.infer<typeof coachBeltSchema>;
export const coachBeltLabels: Readonly<Record<CoachBelt, string>> = {
  "red-9": "Red belt, 9th degree",
  "coral-8": "Coral belt, 8th degree",
  "coral-7": "Coral belt, 7th degree",
  "black-6": "6th degree black belt",
  "black-5": "5th degree black belt",
  "black-4": "4th degree black belt",
  "black-3": "3rd degree black belt",
  "black-2": "2nd degree black belt",
  "black-1": "1st degree black belt",
  black: "Black belt",
  brown: "Brown belt",
  purple: "Purple belt",
  blue: "Blue belt",
};
export const teamCoachProfileSchema = z.strictObject({
  staffKey: z.string().min(1).max(128),
  active: z.boolean(),
  belt: coachBeltSchema.nullable(),
});
export type TeamCoachProfile = z.infer<typeof teamCoachProfileSchema>;
export const teamEmailSchema = z.string().trim().toLowerCase().email().max(320);
export const teamDirectoryRequestSchema = z.strictObject({
  pageToken: z.string().min(1).max(2048).optional(),
});
export const teamDirectoryPersonSchema = z.strictObject({
  userId: z.string().min(1).max(128),
  name: z.string().max(256),
  email: z.string().max(320).nullable(),
  role: teamRoleSchema,
  coach: teamCoachProfileSchema.nullable(),
});
export const teamDirectoryResponseSchema = z.strictObject({
  people: z.array(teamDirectoryPersonSchema).max(1000),
  nextPageToken: z.string().min(1).max(2048).nullable(),
});
export const changeTeamRoleSchema = z.strictObject({
  userId: z.string().min(1).max(128),
  email: teamEmailSchema.nullable(),
  role: assignableTeamRoleSchema,
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
export const setCoachBeltSchema = z.strictObject({
  userId: z.string().min(1).max(128),
  belt: coachBeltSchema,
});
export const setCoachBeltResultSchema = z.strictObject({ belt: coachBeltSchema });
export const setOwnerTeachesSchema = z
  .strictObject({
    userId: z.string().min(1).max(128),
    teaches: z.boolean(),
    belt: coachBeltSchema.optional(),
  })
  .refine((value) => !value.teaches || value.belt !== undefined, { message: "belt_required" });
export const setOwnerTeachesResultSchema = z.strictObject({ teaches: z.boolean() });
export const deleteCoachAccountSchema = z.strictObject({ userId: z.string().min(1).max(128) });
export const deleteCoachAccountResultSchema = z.strictObject({ deleted: z.literal(true) });
/** The landing card shows the bio in at most five lines; this cap keeps it there at the narrowest card. */
export const coachBioMaxLength = 160;
const coachBioSchema = z.string().trim().max(coachBioMaxLength);
const coachPhotoBase64Max = 4 * Math.ceil((2 * 1024 * 1024) / 3);

export const publicCoachSchema = z.strictObject({
  name: z.string().min(1).max(256),
  belt: coachBeltSchema,
  beltLabel: z.string().min(1).max(64),
  // Optional so a web build and a function build of different ages still read each other.
  bio: coachBioSchema.optional(),
  photoUrl: z.url({ protocol: /^https?$/ }).max(4096).optional(),
});
export const getCoachWebsiteProfileSchema = z.strictObject({ userId: z.string().min(1).max(128) });
export const coachWebsiteProfileSchema = z.strictObject({
  bio: coachBioSchema,
  photoUrl: z.url({ protocol: /^https?$/ }).max(4096).nullable(),
});
/** photo: omitted keeps the current one, null removes it, an image replaces it (3:4, re-encoded). */
export const setCoachWebsiteProfileSchema = z.strictObject({
  userId: z.string().min(1).max(128),
  bio: coachBioSchema,
  photo: z
    .union([
      z.null(),
      z.strictObject({
        base64: z.string().min(4).max(coachPhotoBase64Max),
        mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
      }),
    ])
    .optional(),
});
export const publicCoachesResponseSchema = z.strictObject({
  coaches: z.array(publicCoachSchema).max(100),
});
export type PublicCoach = z.infer<typeof publicCoachSchema>;
export type CoachWebsiteProfile = z.infer<typeof coachWebsiteProfileSchema>;
export type SetCoachWebsiteProfileInput = z.infer<typeof setCoachWebsiteProfileSchema>;
export type SetCoachBeltInput = z.infer<typeof setCoachBeltSchema>;
export type SetOwnerTeachesInput = z.infer<typeof setOwnerTeachesSchema>;
export type DeleteCoachAccountInput = z.infer<typeof deleteCoachAccountSchema>;
export type TeamDirectoryPerson = z.infer<typeof teamDirectoryPersonSchema>;
export type TeamDirectoryResponse = z.infer<typeof teamDirectoryResponseSchema>;
export type StaffInvitation = z.infer<typeof staffInvitationSchema>;
export type StaffInvitationInput = z.infer<typeof staffInvitationInputSchema>;
export type ChangeTeamRoleInput = z.infer<typeof changeTeamRoleSchema>;
