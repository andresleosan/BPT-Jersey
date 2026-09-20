import { requireMemberAccountActor } from "./member-access-callables.js";
import { memberHistoryInputSchema } from "@bpt-jersey/domain/members/history";
import { getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret, defineString } from "firebase-functions/params";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import {
  createMemberDirectoryActorActivityCheck,
  requireCanonicalMemberDirectoryActor,
  type MemberDirectoryActorActivityCheck,
} from "./canonical-actor.js";
import {
  createMemberRecoveryService,
  type MemberRecoveryService,
} from "./member-recovery-service.js";

const academyParameter = defineString("ACADEMY_ID");
const identitySecret = defineSecret("MEMBER_DIRECTORY_IDENTITY_KEY_SECRET");
const integritySecret = defineSecret("MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET");
export function memberRecoveryOrigins(emulator: boolean): string[] {
  return [
    "https://bptjersey.com",
    "https://www.bptjersey.com",
    "https://bptjersey.pages.dev",
    ...(emulator ? ["http://localhost:3000", "http://127.0.0.1:3000"] : []),
  ];
}
const options = {
  invoker: "public" as const,
  enforceAppCheck: true,
  cors: memberRecoveryOrigins(process.env.FUNCTIONS_EMULATOR === "true"),
  secrets: [identitySecret, integritySecret],
};
export type MemberRecoveryCallableServices = {
  service: Pick<MemberRecoveryService, "begin" | "complete" | "list" | "detail" | "review">;
  isActorActive: MemberDirectoryActorActivityCheck;
};
function services(): MemberRecoveryCallableServices & { service: MemberRecoveryService } {
  const academyId = academyParameter.value().trim();
  if (!academyId) throw new HttpsError("failed-precondition", "Member recovery is not configured");
  const firestore = getFirestore();
  const auth = getAuth();
  return {
    service: createMemberRecoveryService({
      firestore,
      auth,
      academyId,
      projectId: getApp().options.projectId ?? "",
      identitySecretMaterial: identitySecret.value(),
      integritySecretMaterial: integritySecret.value(),
      identitySecretVersion: "identity-v1",
      integritySecretVersion: "integrity-v1",
    }),
    isActorActive: createMemberDirectoryActorActivityCheck({
      getAuthUser: (uid) => auth.getUser(uid),
      getDocument: (path) => firestore.doc(path).get(),
    }),
  };
}
function appCheck(request: CallableRequest<unknown>) {
  if (!request.app) throw new HttpsError("unauthenticated", "Verified App Check is required");
}
async function handled<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "unavailable",
      "Recovery could not be completed. Please try again or contact the office.",
    );
  }
}
export async function beginMemberRecoveryHandler(
  request: CallableRequest<unknown>,
  s: MemberRecoveryCallableServices,
) {
  appCheck(request);
  return handled(() => s.service.begin(request.data, request.rawRequest.ip ?? ""));
}
export async function completeMemberRecoveryHandler(
  request: CallableRequest<unknown>,
  s: MemberRecoveryCallableServices,
) {
  appCheck(request);
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to continue recovery");
  return handled(() => s.service.complete(request.data, uid));
}
export async function listMemberRecoveryRequestsHandler(
  request: CallableRequest<unknown>,
  s: MemberRecoveryCallableServices,
) {
  const actor = await requireCanonicalMemberDirectoryActor(request, s.isActorActive);
  if (request.data !== null && request.data !== undefined)
    throw new HttpsError("invalid-argument", "Recovery request is invalid");
  return handled(() => s.service.list(actor));
}
export async function getMemberRecoveryDetailHandler(
  request: CallableRequest<unknown>,
  s: MemberRecoveryCallableServices,
) {
  const actor = await requireCanonicalMemberDirectoryActor(request, s.isActorActive);
  return handled(() => s.service.detail(request.data, actor));
}
export async function reviewMemberRecoveryHandler(
  request: CallableRequest<unknown>,
  s: MemberRecoveryCallableServices,
) {
  const actor = await requireCanonicalMemberDirectoryActor(request, s.isActorActive);
  const result = await handled(() => s.service.review(request.data, actor));
  return { status: result.status };
}
export const getMemberRecoveryHistory = onCall(options, async (request) => {
  const actor = await requireMemberAccountActor(request);
  const input = request.data === null || request.data === undefined ? undefined : memberHistoryInputSchema.safeParse(request.data);
  if (input && !input.success) throw new HttpsError("invalid-argument", "Select a member to view their history");
  return handled(() => services().service.history(actor.userId, input?.data?.studentId, input?.data?.cursor));
});
export const beginMemberRecovery = onCall(options, (request) =>
  beginMemberRecoveryHandler(request, services()),
);
export const completeMemberRecovery = onCall(options, (request) =>
  completeMemberRecoveryHandler(request, services()),
);
export const listMemberRecoveryRequests = onCall(options, (request) =>
  listMemberRecoveryRequestsHandler(request, services()),
);
export const getMemberRecoveryDetail = onCall(options, (request) =>
  getMemberRecoveryDetailHandler(request, services()),
);
export const reviewMemberRecovery = onCall(options, (request) =>
  reviewMemberRecoveryHandler(request, services()),
);
