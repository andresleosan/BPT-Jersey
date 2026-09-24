import { z } from "zod";

export const groupIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
export const groupSites = Object.freeze(["Town", "West"] as const);
export type GroupSite = (typeof groupSites)[number];
export const saveMemberGroupSchema = z.object({
  groupId: groupIdSchema,
  name: z.string().trim().min(2).max(100),
  site: z.enum(groupSites),
  studentIds: z.array(groupIdSchema).max(300).refine((ids) => new Set(ids).size === ids.length),
  revision: z.number().int().nonnegative(),
}).strict();
export const groupSessionSchema = z.object({ groupId: groupIdSchema, sessionId: groupIdSchema }).strict();
export const removeGroupSessionMemberSchema = groupSessionSchema.extend({ studentId: groupIdSchema });
export const deleteMemberGroupSchema = z.object({ groupId: groupIdSchema, revision: z.number().int().positive() }).strict();
export type SaveMemberGroup = z.infer<typeof saveMemberGroupSchema>;
/** Groups saved before sites existed have no `site` until the office edits them. */
export type MemberGroup = Omit<SaveMemberGroup, "site"> & { site?: GroupSite; active: boolean; updatedAt: string };
export type GroupMember = { studentId: string; fullName: string; missingPayment: boolean };
export type MemberGroupView = MemberGroup & { members: GroupMember[] };
export type GroupRegistrationState = "registered" | "excluded" | "blocked" | "pending";
export type GroupSessionMember = GroupMember & { state: GroupRegistrationState; reason: string };
export type GroupSessionView = {
  groupId: string; name: string; site?: GroupSite; active: boolean; assigned: boolean; recurring: boolean; members: GroupSessionMember[];
};
