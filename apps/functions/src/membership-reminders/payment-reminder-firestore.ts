import type { Auth } from "firebase-admin/auth";
import type { Firestore, Query } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import type { DeliveryHistoryRecord } from "@bpt-jersey/domain/delivery";
import { parseFamilyRecord } from "@bpt-jersey/domain/families";
import { parsePlanRecord, type BillingPeriod } from "@bpt-jersey/domain/memberships";
import { parseMembershipRecord } from "@bpt-jersey/domain/memberships/lifecycle";
import {
  membershipReminderStateSchema,
  type MembershipReminderState,
} from "@bpt-jersey/domain/memberships/payment-reminders";
import { parseEffectiveStudentProfileAt } from "@bpt-jersey/domain/profiles";
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";
import { createUnpaidMembershipNotice } from "../notifications/admin-notification-service.js";
import {
  canonicalEndsAt,
  sameReminderCycle,
  type PaymentReminderPorts,
  type ReminderCandidate,
  type ReminderRecipient,
} from "./payment-reminder-service.js";

/**
 * Firestore and Auth ports for the payment reminder run. Logs carry ids and counts only, never
 * names or addresses.
 */

const pageSize = 200;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const uidPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/** The first whitespace-separated word, or null when blank. */
function firstWord(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().split(/\s+/u)[0] || null;
}

export function createPaymentReminderPorts(
  db: Firestore,
  auth: Auth,
  academyId: string,
  dispatcher: { dispatch: (request: unknown) => Promise<DeliveryHistoryRecord> } | null,
): PaymentReminderPorts {
  const base = db.doc(`academies/${academyId}`);
  const membershipPrefix = `academies/${academyId}/memberships/`;

  /** Only a missing Auth user means "no email on file"; any other Auth failure is rethrown. */
  const authUser = (uid: string) =>
    uidPattern.test(uid)
      ? auth.getUser(uid).catch((error: unknown) => {
          const code =
            typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
          if (code === "auth/user-not-found") return null;
          throw error;
        })
      : Promise.resolve(null);

  /**
   * The renewal rule of intro-application-admin-service.ts: the member renews one live
   * subscription, so a student with several live (or unreadable) memberships is left to the office.
   */
  async function hasSingleLiveMembership(studentId: string): Promise<boolean> {
    const live = (
      await base.collection("memberships").where("studentId", "==", studentId).limit(20).get()
    ).docs
      .filter((doc) => doc.get("source") !== "legacy-import")
      .map((doc) => parseMembershipRecord(doc.data()))
      .filter((record) => !record.ok || record.value.status !== "cancelled");
    return live.length <= 1 && live.every((record) => record.ok);
  }

  return {
    async listCandidates(fromIso, toIso) {
      const query: Query = db
        .collectionGroup("memberships")
        .where("endsAt", ">", fromIso)
        .where("endsAt", "<=", toIso)
        .orderBy("endsAt")
        .limit(pageSize);
      const found: ReminderCandidate[] = [];
      let legacy = 0;
      let otherSource = 0;
      let invalid = 0;
      let page = await query.get();
      while (!page.empty) {
        for (const doc of page.docs) {
          const membershipId = doc.ref.path.slice(membershipPrefix.length);
          if (!doc.ref.path.startsWith(membershipPrefix) || membershipId.includes("/")) continue;
          const source: unknown = doc.get("source");
          if (source === "legacy-import") {
            legacy += 1;
            continue;
          }
          if (source !== undefined) {
            otherSource += 1;
            continue;
          }
          const parsed = parseMembershipRecord(doc.data());
          if (
            !parsed.ok ||
            parsed.value.academyId !== academyId ||
            parsed.value.membershipId !== membershipId ||
            parsed.value.endsAt === null
          ) {
            invalid += 1;
            logger.warn("Payment reminder skipped an invalid membership", { membershipId: doc.id });
            continue;
          }
          const record = parsed.value;
          found.push({
            membershipId: record.membershipId,
            studentId: record.studentId,
            familyId: record.familyId,
            status: record.status,
            endsAt: record.endsAt as string,
            planId: record.planId,
          });
        }
        const last = page.docs.at(-1);
        if (page.size < pageSize || !last) break;
        page = await query.startAfter(last).get();
      }

      const candidates: ReminderCandidate[] = [];
      let severalLive = 0;
      for (let offset = 0; offset < found.length; offset += 10) {
        const slice = found.slice(offset, offset + 10);
        const single = await Promise.all(
          slice.map((candidate) => hasSingleLiveMembership(candidate.studentId)),
        );
        slice.forEach((candidate, index) => {
          if (single[index]) candidates.push(candidate);
          else severalLive += 1;
        });
      }
      logger.info("Payment reminder candidates listed", {
        candidates: candidates.length,
        legacy,
        otherSource,
        invalid,
        severalLive,
      });
      return candidates;
    },

    async loadPendingStudentIds() {
      const snapshot = await base
        .collection("membershipApplications")
        .where("status", "==", "pending_review")
        .get();
      const ids = new Set<string>();
      for (const doc of snapshot.docs) {
        const studentId: unknown = doc.get("studentId");
        if (typeof studentId === "string" && studentId) ids.add(studentId);
      }
      return ids;
    },

    async loadPlans() {
      const snapshot = await base.collection("plans").get();
      const plans = new Map<
        string,
        { displayName: string; billingPeriod: BillingPeriod; priceMinor: number }
      >();
      for (const doc of snapshot.docs) {
        const parsed = parsePlanRecord(doc.data());
        if (!parsed.ok || parsed.value.academyId !== academyId) {
          logger.warn("Payment reminder skipped an invalid plan", { planId: doc.id });
          continue;
        }
        const { planId, displayName, billingPeriod, priceMinor } = parsed.value;
        plans.set(planId, { displayName, billingPeriod, priceMinor });
      }
      return plans;
    },

    async loadComplimentaryIds(ids) {
      const complimentary = new Set<string>();
      if (ids.length === 0) return complimentary;
      const snapshots = await db.getAll(
        ...ids.map((id) => base.collection("membershipAdministration").doc(id)),
      );
      for (const snapshot of snapshots) {
        if (snapshot.exists && snapshot.get("complimentary") === true)
          complimentary.add(snapshot.id);
      }
      return complimentary;
    },

    async loadStates(ids) {
      const states = new Map<string, MembershipReminderState>();
      if (ids.length === 0) return states;
      const snapshots = await db.getAll(
        ...ids.map((id) => base.collection("membershipReminders").doc(id)),
      );
      for (const snapshot of snapshots) {
        if (!snapshot.exists) continue;
        const parsed = membershipReminderStateSchema.safeParse(snapshot.data());
        if (!parsed.success || parsed.data.membershipId !== snapshot.id) {
          logger.warn("Payment reminder skipped an invalid state", { membershipId: snapshot.id });
          continue;
        }
        states.set(snapshot.id, parsed.data);
      }
      return states;
    },

    async resolveRecipient(candidate, todayKey) {
      const student = parseEffectiveStudentProfileAt(
        (await base.collection("students").doc(candidate.studentId).get()).data(),
        todayKey,
      );
      if (
        !student.ok ||
        student.value.academyId !== academyId ||
        student.value.studentId !== candidate.studentId
      ) {
        logger.warn("Payment reminder could not read the student", {
          membershipId: candidate.membershipId,
          studentId: candidate.studentId,
        });
        return null;
      }
      // The renewal rule of intro-application-service.ts: only an active student can renew.
      if (!student.value.active || student.value.status !== "active") return "out-of-scope";
      const profile = student.value;
      let email: string | null | undefined;
      let greeting: string | null;
      let memberFirstName: string | null = null;

      if (profile.participantType === "adult") {
        // Adult: the login's Auth email, or the office-entered email when there is no login.
        email = profile.userId ? (await authUser(profile.userId))?.email : profile.email;
        greeting = firstWord(profile.fullName);
      } else {
        // Minor: the family's contact, never `students.userId`.
        memberFirstName = firstWord(profile.fullName);
        const family = parseFamilyRecord(
          (await base.collection("families").doc(candidate.familyId).get()).data(),
        );
        if (
          !family.ok ||
          family.value.academyId !== academyId ||
          family.value.familyId !== candidate.familyId
        ) {
          logger.warn("Payment reminder could not read the family", {
            membershipId: candidate.membershipId,
            familyId: candidate.familyId,
          });
          return null;
        }
        const contactUserId = family.value.primaryContactUserId;
        if (contactUserId) {
          const user = await authUser(contactUserId);
          email = user?.email;
          // Profile name first, then the sign-in name, as `describer` in admin-notification-triggers.
          const stored: unknown = (await base.collection("users").doc(contactUserId).get()).get(
            "displayName",
          );
          greeting =
            firstWord(typeof stored === "string" && stored.trim() ? stored : null) ??
            firstWord(user?.displayName);
        } else {
          email = family.value.guardianContact?.email;
          greeting = firstWord(family.value.guardianContact?.fullName);
        }
      }

      const address = email?.trim();
      if (!address || !emailPattern.test(address)) return null;
      const recipient: ReminderRecipient = {
        email: address,
        recipientFirstName: greeting ?? "there",
        memberFirstName,
      };
      return recipient;
    },

    async dispatch(request) {
      if (dispatcher === null) throw new Error("Dispatch is disabled in dry-run");
      return dispatcher.dispatch(request);
    },

    async saveStep(previous, membershipId, endsAt, step, outcome, at) {
      // A changed `endsAt` is a new cycle: the old cycle's steps never carry over. Two spellings
      // of the same instant are one cycle, and the state keeps the canonical form.
      const steps = previous && sameReminderCycle(previous.endsAt, endsAt) ? previous.steps : {};
      const state = membershipReminderStateSchema.parse({
        membershipId,
        endsAt: canonicalEndsAt(endsAt),
        steps: { ...steps, [step]: { at, outcome } },
        schemaVersion: "1",
      });
      await base.collection("membershipReminders").doc(membershipId).set(state);
    },

    async notifyOfficeUnpaid(candidate, planName) {
      const studentRef = base.collection("students").doc(candidate.studentId);
      const parsed = parseEffectiveStudentProfileAt(
        (await studentRef.get()).data(),
        dateKeyInJersey(new Date()),
      );
      const fullName = parsed.ok ? parsed.value.fullName.trim() : "";
      await createUnpaidMembershipNotice(db, {
        academyId,
        membershipId: candidate.membershipId,
        studentId: candidate.studentId,
        endsAt: candidate.endsAt,
        memberName: fullName || "A member",
        planName,
      });
    },
  };
}
