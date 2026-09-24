import { z } from "zod";
import { httpsCallable } from "./callable";
import { getFirebaseFunctions } from "./firebase-client";
import { scheduleCallableClientOptions } from "./schedule-client";
import { groupSites, type GroupSessionView, type MemberGroupView, type SaveMemberGroup } from "@bpt-jersey/domain/schedule/groups";
async function call<Input, Output>(name: string, input: Input): Promise<Output> {
  return (await httpsCallable<Input, Output>(getFirebaseFunctions(), name, { ...scheduleCallableClientOptions, timeout: 540_000 })(input)).data;
}
/** The group callables answer refusals with fixed sentences for the office; anything else stays generic. */
const officeCodes = ["failed-precondition", "aborted", "not-found", "permission-denied", "invalid-argument"];
const knownSentences = ["Guardians can't be added to a group: ", "Only active members can be added: ", "Choose a group from this class's site."];
async function officeCall<Input, Output>(name: string, input: Input, fallback: string): Promise<Output> {
  try {
    return await call<Input, Output>(name, input);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code).replace(/^functions\//u, "") : "";
    const message = error instanceof Error ? error.message : "";
    if (code === "invalid-argument") throw new Error(knownSentences.some((known) => message.startsWith(known)) ? message : "Check the group details and try again.");
    throw new Error(officeCodes.includes(code) && message ? message : fallback);
  }
}
const saveFallback = "Unable to save changes. Try again.";
const memberGroupViewSchema = z.object({
  groupId: z.string().min(1),
  name: z.string(),
  site: z.enum(groupSites).optional(),
  studentIds: z.array(z.string()),
  revision: z.number().int().nonnegative(),
  active: z.boolean(),
  updatedAt: z.string(),
  members: z.array(z.object({ studentId: z.string(), fullName: z.string(), missingPayment: z.boolean() })),
});
export async function listMemberGroups(): Promise<MemberGroupView[]> {
  const response = await officeCall<null, { groups: unknown }>("listMemberGroups", null, "Unable to load groups. Try again.");
  const parsed = z.array(memberGroupViewSchema).safeParse(response?.groups);
  if (!parsed.success) throw new Error("Unable to load groups. Try again.");
  return parsed.data.map(({ site, ...group }) => (site ? { ...group, site } : group));
}
export async function saveMemberGroup(input: SaveMemberGroup) { await officeCall("saveMemberGroup", input, saveFallback); }
export async function deleteMemberGroup(groupId: string, revision: number) { await officeCall("deleteMemberGroup", { groupId, revision }, saveFallback); }
export async function listSessionGroups(sessionId: string) { return (await call<{ sessionId: string }, { groups: GroupSessionView[] }>("listSessionGroups", { sessionId })).groups; }
export async function registerMemberGroup(groupId: string, sessionId: string) { return (await officeCall<{ groupId: string; sessionId: string }, { groups: GroupSessionView[] }>("registerMemberGroup", { groupId, sessionId }, "Unable to update registrations. Try again.")).groups; }
export async function removeGroupSessionMember(groupId: string, sessionId: string, studentId: string) { return (await call<{ groupId: string; sessionId: string; studentId: string }, { groups: GroupSessionView[] }>("removeGroupSessionMember", { groupId, sessionId, studentId })).groups; }
export async function preparePaygClassPayment(sessionId: string, studentId: string) { return (await call<{ sessionId: string; studentId: string }, { invoice: import("./billing-client").InvoiceView }>("preparePaygClassPayment", { sessionId, studentId })).invoice; }
export async function confirmPaygClassPayment(sessionId: string, studentId: string) { return await call<{ sessionId: string; studentId: string }, { status: "paid" }>("confirmPaygClassPayment", { sessionId, studentId }); }
export async function getPaygClassProofUrl(sessionId: string, studentId: string) { return (await call<{ sessionId: string; studentId: string }, { url: string; expiresAt: string }>("getPaygClassProofUrl", { sessionId, studentId })).url; }
