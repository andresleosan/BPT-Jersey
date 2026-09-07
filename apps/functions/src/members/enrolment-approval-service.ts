import type { EnrolmentRequestRecord } from "@bpt-jersey/domain/members/enrolment-requests";
import type { FamilyStudentDraft } from "@bpt-jersey/domain/families";
import type { FamilyStore } from "../families/family-service.js";
import type { GuardianProfileStore } from "../profiles/guardian-profile-service.js";
import type {
  CanonicalMemberDirectoryActor,
  CanonicalMemberDirectoryService,
} from "./canonical-member-directory-service.js";
import type { EnrolmentRequestStore } from "./enrolment-request-service.js";

/**
 * Approving an enrolment request (T121 slice 2). Everything the applicant typed already exists;
 * this is the step that turns it into a member of the academy and into an account that can sign in
 * as one.
 *
 * The honest shape of the thing: **this is not one transaction and cannot be.** The student lives
 * in Firestore, the role lives in Auth, and for a guardian the family writer insists the role is
 * already there before it will run. So the approval is a short sequence of individually
 * transactional steps, and what makes it safe is not atomicity but three properties held together:
 *
 * 1. The request document is the lock. One reviewer moves it to `approving` and pins the
 *    idempotency key of the administrative write to it; every later attempt, by anybody, runs
 *    against that same key.
 * 2. Every step is idempotent under that key. The canonical write answers a repeat with the
 *    student it already created, the guardian profile write replays its receipt, the family write
 *    replays its own, and setting a claim to the value it already holds is a no-op.
 * 3. A sequence that stops halfway leaves the request in `approval-failed`, never in `approved`
 *    and never back in the applicant's hands. Office sees it, and retrying resumes rather than
 *    restarts.
 *
 * Ordering is not a preference either. For an adult the record is written first and the claim
 * second, because an account carrying `adultStudent` with no member record behind it is worse than
 * a member record whose owner cannot yet sign in. For a guardian the order is forced the other
 * way - client document, then claim, then family - because `createFamily` refuses a tutor who is
 * not already a `guardian` holding a client document.
 */
export type EnrolmentApprovalAuthUser = Readonly<{
  uid: string;
  disabled?: boolean;
  email?: string;
  displayName?: string;
  customClaims?: Readonly<Record<string, unknown>>;
}>;

export type EnrolmentApprovalAuth = Readonly<{
  getUser: (uid: string) => Promise<EnrolmentApprovalAuthUser>;
  setCustomUserClaims: (uid: string, claims: Record<string, unknown>) => Promise<void>;
}>;

export type EnrolmentApprovalDependencies = Readonly<{
  store: EnrolmentRequestStore;
  directory: CanonicalMemberDirectoryService;
  guardianProfiles: GuardianProfileStore;
  families: FamilyStore;
  auth: EnrolmentApprovalAuth;
}>;

export type ApproveEnrolmentRequestInput = Readonly<{
  actor: CanonicalMemberDirectoryActor;
  enrolmentRequestId: string;
  /** The reviewer's idempotency key. Ignored when the request already carries one. */
  requestId: string;
  now: string;
}>;

export type EnrolmentApprovalResult = Readonly<{
  enrolmentRequestId: string;
  role: "adultStudent" | "guardian";
  studentIds: readonly string[];
  alreadyApproved: boolean;
}>;

export type EnrolmentApprovalErrorCode =
  "unauthorized" | "invalid" | "not-found" | "precondition" | "conflict" | "unavailable";

export class EnrolmentApprovalError extends Error {
  public readonly code: EnrolmentApprovalErrorCode;
  /** A short slug recorded on the request so office can see why the approval stopped. */
  public readonly failureCode: string;

  public constructor(code: EnrolmentApprovalErrorCode, failureCode: string, message: string) {
    super(message);
    this.name = "EnrolmentApprovalError";
    this.code = code;
    this.failureCode = failureCode;
  }
}

export type EnrolmentApprovalService = Readonly<{
  approve: (input: ApproveEnrolmentRequestInput) => Promise<EnrolmentApprovalResult>;
}>;

const clientRolesEligibleForEnrolment = new Set(["shopper", "guardian", "adultStudent"]);

function targetRoleFor(record: EnrolmentRequestRecord): "adultStudent" | "guardian" {
  return record.applicantIsStudent ? "adultStudent" : "guardian";
}

function currentClaims(user: EnrolmentApprovalAuthUser): Record<string, unknown> {
  const claims = user.customClaims;
  if (typeof claims !== "object" || claims === null || Array.isArray(claims)) return {};
  return { ...claims };
}

/**
 * A minor from an enrolment request, as the family writer wants it. `gender` and `frequencyNote`
 * ride along because the applicant answered them; without carrying them the family writer would
 * record `unknown` and drop the note, and nothing would say the answer had been thrown away.
 */
function toFamilyStudentDraft(minor: EnrolmentRequestRecord["minors"][number]): FamilyStudentDraft {
  return Object.freeze({
    fullName: minor.fullName,
    dateOfBirth: minor.dateOfBirth,
    trainingCenter: minor.trainingCenter,
    trainingTimePreferences: Object.freeze([...minor.trainingTimePreferences]),
    ...(minor.gender === undefined ? {} : { gender: minor.gender }),
    ...(minor.frequencyNote === undefined ? {} : { frequencyNote: minor.frequencyNote }),
    ...(minor.emergencyContact === undefined
      ? {}
      : {
          emergencyContact: Object.freeze({
            fullName: minor.emergencyContact.fullName,
            relationship: minor.emergencyContact.relationship,
            phoneNumber: minor.emergencyContact.phoneNumber,
            // Rebuilt field by field rather than spread: an absent alternate number must stay
            // absent, not become a key whose value is `undefined`, which the draft rejects.
            ...(minor.emergencyContact.alternatePhoneNumber === undefined
              ? {}
              : { alternatePhoneNumber: minor.emergencyContact.alternatePhoneNumber }),
          }),
        }),
  });
}

export function createEnrolmentApprovalService(
  dependencies: EnrolmentApprovalDependencies,
): EnrolmentApprovalService {
  /**
   * Reads the applicant's account and refuses anything the write path cannot represent. The
   * display name and the email come from Auth rather than from the form: they are what the account
   * already proves about itself, and the academy's client document will not parse without them.
   */
  async function readApplicantAccount(
    record: EnrolmentRequestRecord,
    academyId: string,
  ): Promise<Readonly<{ userId: string; displayName: string; email: string }>> {
    let user: EnrolmentApprovalAuthUser;
    try {
      user = await dependencies.auth.getUser(record.submittedBy);
    } catch {
      throw new EnrolmentApprovalError(
        "precondition",
        "applicant_account_unavailable",
        "The applicant account could not be read",
      );
    }
    if (user.uid !== record.submittedBy || user.disabled === true) {
      throw new EnrolmentApprovalError(
        "precondition",
        "applicant_account_disabled",
        "The applicant account is not usable",
      );
    }
    const claims = currentClaims(user);
    if (typeof claims.academyId === "string" && claims.academyId !== academyId) {
      throw new EnrolmentApprovalError(
        "unauthorized",
        "applicant_other_academy",
        "The applicant account belongs to another academy",
      );
    }
    if (typeof claims.role === "string" && !clientRolesEligibleForEnrolment.has(claims.role)) {
      // Staff, coaches and owners are not enrolled through this door. Promoting one would
      // overwrite the role the academy granted them.
      throw new EnrolmentApprovalError(
        "precondition",
        "applicant_role_not_client",
        "This account does not hold a client role",
      );
    }
    const displayName = user.displayName?.trim() ?? "";
    const email = user.email?.trim() ?? "";
    if (displayName.length === 0 || email.length === 0) {
      throw new EnrolmentApprovalError(
        "precondition",
        "applicant_account_incomplete",
        "The applicant account has no name or no email address",
      );
    }
    return Object.freeze({ userId: user.uid, displayName, email: email.toLowerCase() });
  }

  /**
   * Moves the account to the role the approval grants, then reads it back. A claim that did not
   * stick is restored to what it was rather than left half-set, and the caller stops: an account
   * whose role silently failed to change is exactly the case that must not be reported as enrolled.
   */
  async function promoteClaim(
    userId: string,
    academyId: string,
    role: "adultStudent" | "guardian",
  ): Promise<void> {
    const before = currentClaims(await dependencies.auth.getUser(userId));
    if (before.role === role && before.academyId === academyId) return;
    const next: Record<string, unknown> = { ...before, academyId, role };
    try {
      await dependencies.auth.setCustomUserClaims(userId, next);
    } catch {
      throw new EnrolmentApprovalError(
        "unavailable",
        "claim_write_failed",
        "The account role could not be granted",
      );
    }
    const observed = currentClaims(await dependencies.auth.getUser(userId));
    if (observed.role !== role || observed.academyId !== academyId) {
      try {
        await dependencies.auth.setCustomUserClaims(userId, before);
      } catch {
        throw new EnrolmentApprovalError(
          "unavailable",
          "claim_rollback_failed",
          "The account role could not be granted or restored",
        );
      }
      throw new EnrolmentApprovalError(
        "unavailable",
        "claim_not_persisted",
        "The account role did not persist",
      );
    }
  }

  async function approveAdult(
    input: ApproveEnrolmentRequestInput,
    record: EnrolmentRequestRecord,
    approvalRequestId: string,
    account: Readonly<{ userId: string; displayName: string; email: string }>,
  ): Promise<readonly string[]> {
    const written = await dependencies.directory.createAdminAdultForAccount({
      actor: input.actor,
      value: { requestId: approvalRequestId, ...record.applicant },
      account,
      now: input.now,
    });
    await promoteClaim(account.userId, input.actor.academyId, "adultStudent");
    return Object.freeze([written.studentId]);
  }

  async function approveGuardian(
    input: ApproveEnrolmentRequestInput,
    record: EnrolmentRequestRecord,
    approvalRequestId: string,
    account: Readonly<{ userId: string; displayName: string; email: string }>,
  ): Promise<readonly string[]> {
    // The tutor is not a student, so no canonical member record is written for them - only the
    // client document the family writer insists on, and the role that lets them hold a family.
    await dependencies.guardianProfiles.saveGuardianProfile({
      academyId: input.actor.academyId,
      userId: account.userId,
      email: account.email,
      requestId: approvalRequestId,
      displayName: account.displayName,
      phoneNumber: record.applicant.phoneNumber,
      now: input.now,
    });
    await promoteClaim(account.userId, input.actor.academyId, "guardian");
    const family = await dependencies.families.createFamily({
      academyId: input.actor.academyId,
      actorId: input.actor.actorId,
      actorRole: input.actor.role === "owner" ? "owner" : "administrator",
      requestId: approvalRequestId,
      tutorUserId: account.userId,
      students: record.minors.map(toFamilyStudentDraft),
      now: input.now,
    });
    return Object.freeze(family.students.map((student) => student.studentId));
  }

  return Object.freeze({
    async approve(input) {
      if (input.actor.role !== "owner" && input.actor.role !== "administrator") {
        throw new EnrolmentApprovalError(
          "unauthorized",
          "actor_not_office",
          "Office access is required",
        );
      }
      const begun = await dependencies.store.beginApproval({
        academyId: input.actor.academyId,
        actorId: input.actor.actorId,
        now: input.now,
        enrolmentRequestId: input.enrolmentRequestId,
        requestId: input.requestId,
      });
      const record = begun.record;
      if (begun.alreadyApproved) {
        return Object.freeze({
          enrolmentRequestId: record.enrolmentRequestId,
          role: targetRoleFor(record),
          studentIds: Object.freeze([...(record.approvedStudentIds ?? [])]),
          alreadyApproved: true,
        });
      }
      const approvalRequestId = record.approvalRequestId;
      if (approvalRequestId === undefined) {
        throw new EnrolmentApprovalError(
          "invalid",
          "approval_key_missing",
          "The approval has no idempotency key",
        );
      }

      const role = targetRoleFor(record);
      let studentIds: readonly string[];
      try {
        const account = await readApplicantAccount(record, input.actor.academyId);
        studentIds =
          role === "adultStudent"
            ? await approveAdult(input, record, approvalRequestId, account)
            : await approveGuardian(input, record, approvalRequestId, account);
      } catch (error) {
        const failureCode =
          error instanceof EnrolmentApprovalError ? error.failureCode : "approval_write_failed";
        // Best effort: if the request cannot even be marked, the original failure is still the
        // one worth reporting, and the request stays locked rather than open.
        try {
          await dependencies.store.failApproval({
            academyId: input.actor.academyId,
            actorId: input.actor.actorId,
            now: input.now,
            enrolmentRequestId: record.enrolmentRequestId,
            failureCode,
          });
        } catch {
          /* the caller is about to hear about the real failure */
        }
        if (error instanceof EnrolmentApprovalError) throw error;
        throw new EnrolmentApprovalError(
          "unavailable",
          failureCode,
          "The enrolment could not be completed",
        );
      }

      await dependencies.store.completeApproval({
        academyId: input.actor.academyId,
        actorId: input.actor.actorId,
        now: input.now,
        enrolmentRequestId: record.enrolmentRequestId,
        studentIds,
      });
      return Object.freeze({
        enrolmentRequestId: record.enrolmentRequestId,
        role,
        studentIds,
        alreadyApproved: false,
      });
    },
  });
}
