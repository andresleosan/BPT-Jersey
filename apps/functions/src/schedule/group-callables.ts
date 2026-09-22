import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { deleteMemberGroupSchema, groupIdSchema, groupSessionSchema, removeGroupSessionMemberSchema, saveMemberGroupSchema } from "@bpt-jersey/domain/schedule/groups";
import { requireActiveOfficeActor } from "../auth/office-actor.js";
import { requireCourseActor } from "../courses/course-authorization.js";
import { clientIpFromRequest } from "../audit/client-ip.js";
import { scheduleCallableOptions } from "./schedule-callable-options.js";
import { createGroupService } from "./group-service.js";

const options = { ...scheduleCallableOptions, timeoutSeconds: 540 };
function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpsError("invalid-argument", "Check the group details and try again.");
  return result.data;
}
async function office(request: CallableRequest) {
  const actor = await requireActiveOfficeActor(request);
  return { service: createGroupService(getFirestore(), actor.academyId), actor: { userId: actor.userId, role: actor.role as "owner" | "administrator", ip: clientIpFromRequest(request) } };
}
export const listMemberGroups = onCall(options, async (request) => {
  const { service } = await office(request);
  return { groups: await service.list() };
});
export const saveMemberGroup = onCall(options, async (request) => {
  const { service, actor } = await office(request);
  await service.save(parse(saveMemberGroupSchema, request.data), actor);
  return { saved: true };
});
export const deleteMemberGroup = onCall(options, async (request) => {
  const { service, actor } = await office(request);
  const input = parse(deleteMemberGroupSchema, request.data);
  await service.remove(input.groupId, input.revision, actor);
  return { deleted: true };
});
export const registerMemberGroup = onCall(options, async (request) => {
  const { service, actor } = await office(request);
  const input = parse(groupSessionSchema, request.data);
  await service.enrol(input.groupId, input.sessionId, actor);
  return { groups: await service.sessionGroups(input.sessionId, true) };
});
export const removeGroupSessionMember = onCall(options, async (request) => {
  const { service, actor } = await office(request);
  const input = parse(removeGroupSessionMemberSchema, request.data);
  await service.exclude(input.groupId, input.sessionId, input.studentId, actor);
  return { groups: await service.sessionGroups(input.sessionId, true) };
});
export const listSessionGroups = onCall(options, async (request) => {
  const actor = await requireCourseActor(request);
  if (!["owner", "administrator", "coach", "headCoach"].includes(actor.role)) throw new HttpsError("permission-denied", "Staff access is required.");
  const { sessionId } = parse(z.object({ sessionId: groupIdSchema }).strict(), request.data);
  // Coaches receive only this class's group names, member names and registration reasons.
  // No directory, subscription documents, balances or payment controls are exposed.
  return { groups: await createGroupService(getFirestore(), actor.academyId).sessionGroups(sessionId, ["owner", "administrator"].includes(actor.role)) };
});
