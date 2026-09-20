import type { Firestore } from "firebase-admin/firestore";
import { createMemberAccessService, createFirestoreMemberAccessService,
  type MemberAccessDependencies, type MemberAccessDocument } from "../members/member-access-service.js";

export { teenAccountMinimumAge } from "@bpt-jersey/domain/members/access";
export type CanonicalClientStudentScopeInput = Readonly<{
  academyId: string; actorUserId: string; actorRole: "guardian" | "adultStudent" | "teenStudent"; requestedStudentId: string;
}>;
export type CanonicalClientStudentScopeResolver = (input: CanonicalClientStudentScopeInput) => Promise<boolean>;
export type CanonicalClientScopeDocument = MemberAccessDocument;
export type CanonicalClientStudentScopeDependencies = MemberAccessDependencies;

export function createCanonicalClientStudentScopeResolver(dependencies: CanonicalClientStudentScopeDependencies): CanonicalClientStudentScopeResolver {
  const service = createMemberAccessService(dependencies);
  return async (input) => ["guardian", "adultStudent", "teenStudent"].includes(input.actorRole) &&
    (await service.authorise(input.academyId, input.actorUserId, input.requestedStudentId)).allowed;
}
export function createFirestoreCanonicalClientStudentScopeResolver(options: Readonly<{ firestore?: Firestore; now?: () => string }> = {}): CanonicalClientStudentScopeResolver {
  const service = createFirestoreMemberAccessService(options);
  return async (input) => ["guardian", "adultStudent", "teenStudent"].includes(input.actorRole) &&
    (await service.authorise(input.academyId, input.actorUserId, input.requestedStudentId)).allowed;
}
