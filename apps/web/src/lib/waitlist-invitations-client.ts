import type { AgeAvailability } from "@bpt-jersey/domain/schedule/age-capacity";
import { httpsCallable } from "./callable";
import { getFirebaseFunctions } from "./firebase-client";
import { scheduleCallableClientOptions } from "./schedule-client";
import type { CreateSessionInput, SessionRecord } from "@bpt-jersey/domain/schedule";
import type { InvitationPage, RespondWaitlistInvitationInput, WaitlistClassResult } from "@bpt-jersey/domain/schedule/waitlist-invitations";

async function call<I, O>(name: string, input: I): Promise<O> {
  try {
    return (await httpsCallable<I, O>(getFirebaseFunctions(), name, scheduleCallableClientOptions)(input)).data;
  } catch (error) {
    const value = error as { code?: string; message?: string };
    if (["functions/failed-precondition", "functions/invalid-argument", "functions/already-exists"].includes(value.code ?? "")) throw new Error(value.message ?? "Check the class details and try again.");
    throw new Error("Unable to update class invitations. Please try again.");
  }
}
export const createWaitlistClass = (input: { operationId: string; sourceSessionId: string; session?: CreateSessionInput }) => call<typeof input, WaitlistClassResult>("createWaitlistClass", input);
export const listWaitlistClassInvitations = (studentId: string, cursor?: string) => call<{ studentId: string; cursor?: string }, InvitationPage>("listWaitlistClassInvitations", { studentId, ...(cursor ? { cursor } : {}) });
export const respondWaitlistClassInvitation = (input: RespondWaitlistInvitationInput) => call<RespondWaitlistInvitationInput, { status: string }>("respondWaitlistClassInvitation", input);
export type WaitlistClassHistory = { operations: readonly (WaitlistClassResult & { sourceSessionId: string; sourceTitle: string; sourceStartAt: string | null; responses: { pending: number; accepted: number; declined: number } })[]; cursor: string | null };
export const listWaitlistClassHistory = (sourceSessionId?: string, cursor?: string) => call<{ sourceSessionId?: string; cursor?: string }, WaitlistClassHistory>("listWaitlistClassHistory", { ...(sourceSessionId ? { sourceSessionId } : {}), ...(cursor ? { cursor } : {}) });
export const getWaitlistClassSource = (sessionId: string) => call<{ sessionId: string }, { session: SessionRecord; waiting: number }>("getWaitlistClassSource", { sessionId });

export const getSessionAgeAvailability = (sessionId: string) => call<{ sessionId: string }, { rows: readonly AgeAvailability[] }>("getSessionAgeAvailability", { sessionId });
