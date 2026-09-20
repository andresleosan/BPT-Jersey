import { HttpsError } from "firebase-functions/v2/https";
import type { Firestore } from "firebase-admin/firestore";

import { parseFamilyRecord, parseFamilyRelationship } from "@bpt-jersey/domain/families";
import { parsePlanRecord } from "@bpt-jersey/domain/memberships";
import { parseMembershipRecord } from "@bpt-jersey/domain/memberships/lifecycle";

import { canonicalMemberIdentityIds } from "./member-identity-resolution.js";
import { createMemberDirectoryReadTransaction } from "./member-directory-firestore.js";

import type { MemberProfileStore } from "./member-profile-service.js";

const maxRelationships = 100;
const maxMemberships = 100;
const maxDisplayName = 160;

/**
 * The account manager card renders a name, not contact details, so the guardian is read straight
 * off the user document: a missing phone number or a malformed email must not hide a real guardian
 * (the full `parseUserProfile` requires both).
 */
export function userDisplayNameOf(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const displayName = (data as Record<string, unknown>).displayName;
  if (typeof displayName !== "string" || displayName.length > maxDisplayName) return undefined;
  const trimmed = displayName.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Admin SDK reads for the member record. Every document is parsed with its domain parser and a
 * document that does not parse is skipped: a broken guardian link must not hide the record.
 * All queries are single-field equality or plain collection reads (no composite index).
 */
export function createMemberProfileFirestoreStore(firestore: Firestore): MemberProfileStore {
  const academy = (academyId: string) => firestore.collection("academies").doc(academyId);
  return Object.freeze({
    async getFamily(academyId, familyId) {
      const snapshot = await academy(academyId).collection("families").doc(familyId).get();
      const parsed = snapshot.exists ? parseFamilyRecord(snapshot.data()) : undefined;
      return parsed?.ok === true && parsed.value.academyId === academyId ? parsed.value : undefined;
    },
    async listStudentRelationships(academyId, studentId) {
      const snapshot = await academy(academyId)
        .collection("relationships")
        .where("studentId", "==", studentId)
        .limit(maxRelationships)
        .get();
      return snapshot.docs.flatMap((document) => {
        const parsed = parseFamilyRelationship(document.data());
        return parsed.ok && parsed.value.relationshipId === document.id ? [parsed.value] : [];
      });
    },
    async getUserDisplayName(academyId, userId) {
      const snapshot = await academy(academyId).collection("users").doc(userId).get();
      return snapshot.exists ? userDisplayNameOf(snapshot.data()) : undefined;
    },
    async listStudentMemberships(academyId, studentId) {
      return firestore.runTransaction(async (tx) => {
        const ids = await canonicalMemberIdentityIds(createMemberDirectoryReadTransaction(firestore, tx), academyId, studentId);
        const pages = await Promise.all(ids.map((id) => tx.get(academy(academyId).collection("memberships")
          .where("studentId", "==", id).limit(maxMemberships + 1))));
        const docs = pages.flatMap((page) => page.docs);
        if (docs.length > maxMemberships) throw new HttpsError("failed-precondition", "Review this member's subscription history in bounded pages.");
        return docs.flatMap((document) => {
          if (document.get("source") === "legacy-import") return [];
          if (document.get("source") !== undefined) throw new HttpsError("failed-precondition", "Unsupported membership source.");
          const parsed = parseMembershipRecord(document.data());
          if (!parsed.ok || parsed.value.academyId !== academyId || !ids.includes(parsed.value.studentId) || parsed.value.membershipId !== document.id) {
            throw new HttpsError("failed-precondition", "Subscription ownership needs inventory review.");
          }
          return [parsed.value];
        });
      });
    },
    async getPlanDisplayName(academyId, planId) {
      const snapshot = await academy(academyId).collection("plans").doc(planId).get();
      const parsed = snapshot.exists ? parsePlanRecord(snapshot.data()) : undefined;
      return parsed?.ok === true ? parsed.value.displayName : undefined;
    },
    async listMembershipNumbers(academyId, limit) {
      const snapshot = await academy(academyId)
        .collection("studentAdminProfiles")
        .select("membershipNumber")
        .limit(limit)
        .get();
      return snapshot.docs.map((document) => {
        const value = document.get("membershipNumber") as unknown;
        return typeof value === "string" ? value : undefined;
      });
    },
    async listStudentNames(academyId, limit) {
      const snapshot = await academy(academyId)
        .collection("students")
        .select("fullName")
        .limit(limit)
        .get();
      return snapshot.docs.flatMap((document) => {
        const fullName = document.get("fullName") as unknown;
        return typeof fullName === "string" && fullName.trim().length > 0
          ? [{ studentId: document.id, fullName: fullName.trim() }]
          : [];
      });
    },
  });
}
