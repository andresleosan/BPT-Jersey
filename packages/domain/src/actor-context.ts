import type { AcademyId, CorrelationId, SystemActorId, UserId } from "./identifiers";

/**
 * `shopper` is a buyer-only client: it exists so somebody who just wants to buy a gi can hold an
 * account without being a student. It grants nothing on its own - every requirement in
 * `access-policy` lists the roles it allows, so a role that is not listed is denied - and it is
 * never used to reach student, family, health, attendance or finance data.
 */
export const userRoles = Object.freeze([
  "owner",
  "administrator",
  "headCoach",
  "coach",
  "guardian",
  "adultStudent",
  "shopper",
] as const);

export const administrativeRoles = Object.freeze(["owner", "administrator"] as const);

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
