import type { CreateSessionInput, SessionRecord } from "./schedule-contracts";

export type CreateWaitlistClassInput = Readonly<{ operationId: string; sourceSessionId: string; session: CreateSessionInput }>;
export type WaitlistClassResult = Readonly<{ session: SessionRecord; operationId: string; invited: number; complete: boolean }>;
export type WaitlistInvitationView = Readonly<{
  invitationId: string;
  studentId: string;
  sourceSessionId: string;
  sourceTitle: string;
  status: "pending" | "accepted" | "declined" | "closed";
  session: Pick<SessionRecord, "sessionId" | "title" | "locationId" | "startAt" | "endAt" | "updatedAt">;
  createdAt: string;
  respondedAt: string | null;
}>;
export type InvitationPage = Readonly<{ invitations: readonly WaitlistInvitationView[]; cursor: string | null }>;
export type RespondWaitlistInvitationInput = Readonly<{
  invitationId: string;
  studentId: string;
  response: "accept" | "decline";
  sessionRevision: string;
}>;
