import { randomUUID } from "node:crypto";

import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";

import { memberAgeOn, type MemberAccessService } from "@bpt-jersey/domain/members/access";
import { memberPlanRequestInputSchema } from "@bpt-jersey/domain/members/engagement";
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";
import { parseUserProfile } from "@bpt-jersey/domain/profiles";

import { FamilyStoreError, type FamilyStore } from "../families/family-service.js";
import {
  CanonicalMemberDirectoryError,
  type CanonicalMemberDirectoryActor,
  type CanonicalMemberDirectoryService,
} from "../members/canonical-member-directory-service.js";

/**
 * "Add a child" / "Train yourself" from My plan (plan tasks 2.2). A member asks; the office decides.
 * Nothing canonical is written on the member's word: the request is a server-only document and the
 * approval reuses the writers the enrolment approval uses, so the same identity checks apply.
 */
export type MemberPlanRequestDoc = Readonly<{
  academyId: string;
  requestId: string;
  kind: "self" | "child";
  requestedBy: string;
  person: Readonly<{
    fullName: string;
    dateOfBirth: string;
    trainingCenter: string;
    trainingTimePreferences: string[];
  }>;
  /**
   * `approving` is the lock, as on enrolment requests: approving is several writes across Firestore
   * and Auth, so one office user takes the request before the first write and nobody else can
   * decide it while that lease is live. The holder may re-enter (its retry replays the receipts).
   */
  status: "pending" | "approving" | "approved" | "rejected";
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  studentId: string | null;
  approvingBy?: string | null;
  approvingAt?: string | null;
}>;

export type FamilyPlanAuth = Readonly<{
  getUser: (uid: string) => Promise<Readonly<{ uid: string; disabled?: boolean; customClaims?: Readonly<Record<string, unknown>> }>>;
  setCustomUserClaims: (uid: string, claims: Record<string, unknown>) => Promise<void>;
}>;

export type FamilyPlanDependencies = Readonly<{
  firestore: Firestore;
  access: Pick<MemberAccessService, "listProfiles">;
  /** Office-only writers; the member-facing callable never builds them. */
  directory?: CanonicalMemberDirectoryService;
  families?: FamilyStore;
  auth?: FamilyPlanAuth;
  now?: () => string;
  generateId?: () => string;
}>;

type MemberActor = Readonly<{ userId: string; academyId: string; role: string }>;

const MAX_PENDING_PER_ACCOUNT = 5;
const APPROVAL_LEASE_MS = 10 * 60 * 1000;
const openStatuses = ["pending", "approving"] as const;
const requestIdSchema = z.uuid();
/** `pending` lists every open request: waiting, and being approved (`approving`). */
export const listMemberPlanRequestsInputSchema = z.strictObject({ status: z.literal("pending").optional() });
export const decideMemberPlanRequestInputSchema = z.strictObject({
  requestId: requestIdSchema,
  decision: z.enum(["approve", "reject"]),
});

const requestsPath = (academyId: string) => `academies/${academyId}/memberPlanRequests`;
const userPath = (academyId: string, userId: string) => `academies/${academyId}/users/${userId}`;
const normalizedName = (name: string) =>
  name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-GB");

function storedRequest(value: unknown): MemberPlanRequestDoc {
  const record = value as MemberPlanRequestDoc | undefined;
  if (!record || typeof record.requestId !== "string" || !record.person) {
    throw new HttpsError("failed-precondition", "This request is unavailable");
  }
  return record;
}

export function createFamilyPlanService(dependencies: FamilyPlanDependencies) {
  const db = dependencies.firestore;
  const now = () => dependencies.now?.() ?? new Date().toISOString();

  async function accountProfile(academyId: string, userId: string) {
    const parsed = parseUserProfile((await db.doc(userPath(academyId, userId)).get()).data());
    if (!parsed.ok || parsed.value.active !== true || parsed.value.status !== "active") {
      throw new HttpsError("failed-precondition", "Your account details are incomplete. Contact the office.");
    }
    return parsed.value;
  }

  /** Same shape as `promoteClaim` in the enrolment approval: set, read back, restore on a miss. */
  async function promoteToGuardian(auth: FamilyPlanAuth, userId: string, academyId: string) {
    const claims = { ...(await auth.getUser(userId)).customClaims };
    if (claims.role === "guardian" && claims.academyId === academyId) return;
    if (claims.role !== "adultStudent" || claims.academyId !== academyId) {
      throw new HttpsError("failed-precondition", "The account role cannot hold a family");
    }
    await auth.setCustomUserClaims(userId, { ...claims, academyId, role: "guardian" });
    const observed = (await auth.getUser(userId)).customClaims;
    if (observed?.role !== "guardian" || observed.academyId !== academyId) {
      await auth.setCustomUserClaims(userId, claims);
      throw new HttpsError("unavailable", "The account role did not persist");
    }
  }

  return Object.freeze({
    async requestPerson(actor: MemberActor, input: unknown): Promise<{ requestId: string }> {
      if (actor.role !== "guardian" && actor.role !== "adultStudent") {
        throw new HttpsError("permission-denied", "Only the account holder can change the plan");
      }
      const parsed = memberPlanRequestInputSchema.safeParse(input);
      if (!parsed.success) throw new HttpsError("invalid-argument", "Check the details and try again");
      const value = parsed.data;
      const today = dateKeyInJersey(new Date(now()));
      const age = memberAgeOn(value.dateOfBirth, today);
      if (age === null) throw new HttpsError("invalid-argument", "Check the date of birth");
      let fullName = value.fullName;
      if (value.kind === "self") {
        const profiles = await dependencies.access.listProfiles(actor.academyId, actor.userId);
        if (profiles.some((profile) => profile.via === "self")) {
          throw new HttpsError("failed-precondition", "You already train on this account");
        }
        // The adult writer only takes adults; say so now rather than at the office's approval.
        if (age < 18) throw new HttpsError("invalid-argument", "You must be 18 or over to train on your own plan");
        fullName = (await accountProfile(actor.academyId, actor.userId)).displayName;
      } else if (age >= 18) {
        throw new HttpsError("invalid-argument", "Children must be under 18");
      }
      const requestId = dependencies.generateId?.() ?? randomUUID();
      const collection = db.collection(requestsPath(actor.academyId));
      await db.runTransaction(async (transaction) => {
        const pending = await transaction.get(
          collection.where("requestedBy", "==", actor.userId).where("status", "in", [...openStatuses])
            .limit(MAX_PENDING_PER_ACCOUNT),
        );
        if (pending.size >= MAX_PENDING_PER_ACCOUNT) {
          throw new HttpsError("resource-exhausted", "You already have 5 requests waiting for the office");
        }
        const doc: MemberPlanRequestDoc = {
          academyId: actor.academyId, requestId, kind: value.kind, requestedBy: actor.userId,
          person: {
            fullName, dateOfBirth: value.dateOfBirth, trainingCenter: value.trainingCenter,
            trainingTimePreferences: [...value.trainingTimePreferences],
          },
          status: "pending", createdAt: now(), decidedAt: null, decidedBy: null, studentId: null,
          approvingBy: null, approvingAt: null,
        };
        transaction.create(collection.doc(requestId), doc);
      });
      return { requestId };
    },

    async listRequests(actor: CanonicalMemberDirectoryActor, input: unknown) {
      const parsed = listMemberPlanRequestsInputSchema.safeParse(input ?? {});
      if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid plan request query");
      let query = db.collection(requestsPath(actor.academyId)).limit(100);
      if (parsed.data.status) query = query.where("status", "in", [...openStatuses]);
      const snapshot = await query.get();
      const requests = snapshot.docs.map((document) => storedRequest(document.data()))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      return { requests };
    },

    async decide(actor: CanonicalMemberDirectoryActor, input: unknown): Promise<{ studentId: string | null }> {
      const parsed = decideMemberPlanRequestInputSchema.safeParse(input);
      if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid plan request decision");
      const reference = db.doc(`${requestsPath(actor.academyId)}/${parsed.data.requestId}`);
      const heldByOther = (live: MemberPlanRequestDoc, at: string) =>
        live.status === "approving" && live.approvingBy !== actor.actorId &&
        Date.parse(at) - Date.parse(live.approvingAt ?? "") < APPROVAL_LEASE_MS;
      // Read, check and claim in one transaction: the request itself is the lock.
      const claimed = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) throw new HttpsError("not-found", "Plan request not found");
        const live = storedRequest(snapshot.data());
        if (live.academyId !== actor.academyId) throw new HttpsError("not-found", "Plan request not found");
        if (live.status === "approved") return { done: true as const, request: live };
        if (live.status === "rejected") throw new HttpsError("failed-precondition", "This request was already rejected");
        const at = now();
        if (heldByOther(live, at)) {
          throw new HttpsError("failed-precondition", "Another office user is approving this request");
        }
        if (parsed.data.decision === "reject") {
          // An approval that started may already have written the student: finish it, never reject.
          if (live.status === "approving") {
            throw new HttpsError("failed-precondition", "This request is being approved. Approve it again to finish.");
          }
          transaction.update(reference, {
            status: "rejected", decidedAt: at, decidedBy: actor.actorId, approvingBy: null, approvingAt: null,
          });
        } else {
          transaction.update(reference, { status: "approving", approvingBy: actor.actorId, approvingAt: at });
        }
        return { done: false as const, request: live };
      });
      const request = claimed.request;
      if (claimed.done) return { studentId: request.studentId };
      if (parsed.data.decision === "reject") return { studentId: null };

      const { directory, families, auth } = dependencies;
      if (!directory || !families || !auth) throw new HttpsError("internal", "Plan approval is not configured");
      const account = await auth.getUser(request.requestedBy);
      const role = account.customClaims?.role;
      if (account.disabled === true || account.customClaims?.academyId !== actor.academyId ||
          (role !== "guardian" && role !== "adultStudent")) {
        throw new HttpsError("failed-precondition", "The member's account is not available");
      }
      const stored = memberPlanRequestInputSchema.safeParse({ kind: request.kind, ...request.person });
      if (!stored.success) throw new HttpsError("failed-precondition", "This request is unavailable");
      const person = stored.data;
      const draft = {
        fullName: person.fullName, dateOfBirth: person.dateOfBirth,
        trainingCenter: person.trainingCenter, trainingTimePreferences: person.trainingTimePreferences,
      };
      const decidedAt = now();
      const tutor = await accountProfile(actor.academyId, request.requestedBy);
      let studentId: string;
      try {
        if (request.kind === "self") {
          const created = await directory.createAdminAdultForAccount({
            actor,
            // Receipts scoped to the plan request, not the approving user: a retry by any office
            // user replays instead of writing again. Plan ids never collide with `enrolment-*`.
            enrolmentRequestId: `plan-${request.requestId}`,
            value: { ...draft, requestId: request.requestId, phoneNumber: tutor.phoneNumber },
            account: { userId: tutor.userId, displayName: tutor.displayName, email: tutor.email },
            existingClientAccount: true,
            now: decidedAt,
          });
          studentId = created.studentId;
        } else {
          if (role === "adultStudent") await promoteToGuardian(auth, request.requestedBy, actor.academyId);
          const existing = await families.getGuardianFamily(actor.academyId, request.requestedBy);
          // A retry by another office user must not create the same child twice.
          const same = existing?.students.find((student) =>
            normalizedName(student.fullName) === normalizedName(draft.fullName) && student.dateOfBirth === draft.dateOfBirth);
          if (same) studentId = same.studentId;
          else {
            const common = {
              academyId: actor.academyId, actorId: actor.actorId,
              actorRole: actor.role === "owner" ? "owner" as const : "administrator" as const, now: decidedAt,
            };
            const written = existing
              ? await families.updateFamily({
                ...common, familyId: existing.family.familyId,
                operation: { kind: "addStudent", requestId: request.requestId, student: draft },
              })
              : await families.createFamily({
                ...common, enrolmentRequestId: `plan-${request.requestId}`, requestId: request.requestId, tutorUserId: request.requestedBy, students: [draft],
              });
            const matches = written.students.filter((student) =>
              normalizedName(student.fullName) === normalizedName(draft.fullName) && student.dateOfBirth === draft.dateOfBirth);
            if (matches.length !== 1) throw new HttpsError("aborted", "The child's record needs office review");
            studentId = matches[0]!.studentId;
          }
        }
      } catch (error) {
        if (error instanceof HttpsError) throw error;
        if (error instanceof CanonicalMemberDirectoryError || error instanceof FamilyStoreError) {
          if (error.code === "conflict" || error.code === "duplicate") {
            throw new HttpsError("already-exists", "This person already holds a member record");
          }
          if (error.code === "unavailable") throw new HttpsError("unavailable", "The member directory is unavailable. Try again.");
          throw new HttpsError("failed-precondition", "The request could not be approved. Check the member's account.");
        }
        throw new HttpsError("unavailable", "The request could not be approved. Try again.");
      }
      // Only the holder of the lock may close it; a takeover after an expired lease wins instead.
      await db.runTransaction(async (transaction) => {
        const live = storedRequest((await transaction.get(reference)).data());
        if (live.status === "approved" && live.studentId === studentId) return;
        if (live.status !== "approving" || live.approvingBy !== actor.actorId) {
          throw new HttpsError("failed-precondition", "Another office user took over this request. Reload it.");
        }
        transaction.update(reference, {
          status: "approved", decidedAt, decidedBy: actor.actorId, studentId, approvingBy: null, approvingAt: null,
        });
      });
      return { studentId };
    },
  });
}
