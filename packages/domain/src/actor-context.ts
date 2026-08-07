import type { AcademyId, CorrelationId, SystemActorId, UserId } from "./identifiers";

export const userRoles = Object.freeze([
  "owner",
  "administrator",
  "headCoach",
  "coach",
  "guardian",
  "adultStudent",
] as const);

export type UserRole = (typeof userRoles)[number];

export type AnonymousActorContext = Readonly<{
  kind: "anonymous";
}>;

export type UserActorContext = Readonly<{
  kind: "user";
  academyId: AcademyId;
  userId: UserId;
  role: UserRole;
}>;

export type SystemActorContext = Readonly<{
  kind: "system";
  academyId: AcademyId;
  systemActorId: SystemActorId;
  correlationId: CorrelationId;
}>;

export type ActorContext = AnonymousActorContext | UserActorContext | SystemActorContext;
