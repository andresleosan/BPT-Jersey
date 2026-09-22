import { httpsCallable } from "./callable";
import { getFirebaseFunctions } from "./firebase-client";
import { scheduleCallableClientOptions } from "./schedule-client";
import type { GroupSessionView, MemberGroupView, SaveMemberGroup } from "@bpt-jersey/domain/schedule/groups";
async function call<Input, Output>(name: string, input: Input): Promise<Output> {
  return (await httpsCallable<Input, Output>(getFirebaseFunctions(), name, { ...scheduleCallableClientOptions, timeout: 540_000 })(input)).data;
}
export async function listMemberGroups() { return (await call<null, { groups: MemberGroupView[] }>("listMemberGroups", null)).groups; }
export async function saveMemberGroup(input: SaveMemberGroup) { await call("saveMemberGroup", input); }
export async function deleteMemberGroup(groupId: string, revision: number) { await call("deleteMemberGroup", { groupId, revision }); }
export async function listSessionGroups(sessionId: string) { return (await call<{ sessionId: string }, { groups: GroupSessionView[] }>("listSessionGroups", { sessionId })).groups; }
export async function registerMemberGroup(groupId: string, sessionId: string) { return (await call<{ groupId: string; sessionId: string }, { groups: GroupSessionView[] }>("registerMemberGroup", { groupId, sessionId })).groups; }
export async function removeGroupSessionMember(groupId: string, sessionId: string, studentId: string) { return (await call<{ groupId: string; sessionId: string; studentId: string }, { groups: GroupSessionView[] }>("removeGroupSessionMember", { groupId, sessionId, studentId })).groups; }
export async function preparePaygClassPayment(sessionId: string, studentId: string) { return (await call<{ sessionId: string; studentId: string }, { invoice: import("./billing-client").InvoiceView }>("preparePaygClassPayment", { sessionId, studentId })).invoice; }
export async function confirmPaygClassPayment(sessionId: string, studentId: string) { return await call<{ sessionId: string; studentId: string }, { status: "paid" }>("confirmPaygClassPayment", { sessionId, studentId }); }
export async function getPaygClassProofUrl(sessionId: string, studentId: string) { return (await call<{ sessionId: string; studentId: string }, { url: string; expiresAt: string }>("getPaygClassProofUrl", { sessionId, studentId })).url; }
