import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { initializeApp as clientApp, deleteApp as deleteClient } from "firebase/app";
import {
  getAuth as clientAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithCredential,
  GoogleAuthProvider,
  signOut,
} from "firebase/auth";
import { describe, expect, it } from "vitest";
import type { UserActorContext } from "@bpt-jersey/domain";
import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";
import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";
import { buildInitialMemberDirectoryControlPlane } from "../../apps/functions/src/members/member-directory-state.js";
import { createMemberRecoveryService } from "../../apps/functions/src/members/member-recovery-service.js";
import { saveManualSubscription } from "../../apps/functions/src/memberships/manual-subscription-service.js";
import {
  createBookingTransactionService,
  type BookingFirestore,
} from "../../apps/functions/src/schedule/booking-transaction-service.js";
import { createFirestoreWaitlistStore } from "../../apps/functions/src/schedule/advanced-booking-service.js";
const enabled =
  process.env.BPT_TEST_INTEGRATION === "true" &&
  ["127.0.0.1:8080", "127.0.0.1:18080"].includes(process.env.FIRESTORE_EMULATOR_HOST ?? "") &&
  ["127.0.0.1:9099", "127.0.0.1:19099"].includes(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "");
const suite = enabled ? describe : describe.skip;
const projectId = "demo-bpt-jersey";
const identitySecretMaterial = Buffer.alloc(32, 1).toString("base64url");
const integritySecretMaterial = Buffer.alloc(32, 2).toString("base64url");
const now = "2026-09-18T10:00:00.000Z";
suite("old member access and paid sessions with real Firebase emulators", () => {
  it.each(["password", "google"])(
    "recovers with %s, preserves history and uses the confirmed paid period",
    async (provider) => {
      const academyId = "recovered-" + randomUUID();
      const app = initializeApp({ projectId }, academyId);
      const database = getFirestore(app);
      const adminAuth = getAuth(app);
      const web = clientApp({ projectId, apiKey: "demo-api-key" }, academyId);
      const auth = clientAuth(web);
      connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, {
        disableWarnings: true,
      });
      const root = `academies/${academyId}/`;
      let uid: string | undefined;
      const address = academyId + "@example.test";
      const password = randomUUID();
      const google = GoogleAuthProvider.credential(
        JSON.stringify({ sub: academyId, email: address, email_verified: true }),
      );
      try {
        const state: MemberDirectoryState = {
          stateId: "current",
          academyId,
          readerVersion: "canonical-v1",
          directoryWriteMode: "canonical-v1",
          freezeStatus: "open",
          stateRevision: 0,
          globalLegacyReadEliminated: false,
          identityKeyCoverage: "complete",
          digestVersion: "hmac-sha256-v1",
          secretVersion: "identity-v1",
          identityKeyBaselineMac: "a".repeat(64),
          identityKeyBaselineArtifactId: "baseline-1",
          rollbackProtocolVersion: "legacy-projection-v1",
          rollbackCapacityLimit: 400,
          rollbackEligibleStudentCount: 0,
          operationPhase: "idle",
          lastCommittedChunkNo: 0,
          schemaVersion: "1",
          createdAt: now,
          createdBy: "system-1",
          updatedAt: now,
          updatedBy: "system-1",
        };
        const control = buildInitialMemberDirectoryControlPlane({
          projectId,
          state,
          integritySecretMaterial,
          integritySecretVersion: "integrity-v1",
          now,
          actorId: "system-1",
        });

        const envelope = {
          academyId,
          active: true,
          status: "active",
          schemaVersion: "1",
          createdAt: now,
          createdBy: "office",
          updatedAt: now,
          updatedBy: "office",
        };
        const archive = {
          recordId: "123",
          fullName: "Synthetic Returning Member",
          birthDate: "1990-01-01",
          mobile: "+441534000000",
          gender: "unknown",
          membershipState: "active",
          appAccess: {},
          graduation: { belt: "Historical purple belt", progressPercent: 60 },
          plan: {
            membershipPlan: "Old adult plan",
            validFrom: "2026-08-01",
            validUntil: "2026-09-30",
          },
          attendance: { attended: 30, records: [{ date: "2026-08-31", status: "present" }] },
          payments: [{ date: "2026-08-01", amount: "£60" }],
          capturedAt: now,
          source: "regyfit-admin-capture",
          schemaVersion: "1",
        };
        const oldStudent = {
          ...envelope,
          studentId: "original-student",
          familyId: "office-original-student",
          fullName: archive.fullName,
          dateOfBirth: archive.birthDate,
          phoneNumber: archive.mobile,
          trainingCenter: "Town",
          trainingTimePreferences: ["evening"],
          participantType: "adult",
        };
        const plan = PLAN_CATALOG.find((p) => p.planId === "bpt-jersey-adult")!;
        const session = {
          sessionId: "paid-class",
          academyId,
          programId: "adult-fundamentals",
          locationId: "town",
          classId: null,
          instructorId: "coach",
          title: "Synthetic adult class",
          startAt: "2026-09-21T18:00:00.000Z",
          endAt: "2026-09-21T19:00:00.000Z",
          capacity: 10,
          minParticipants: 1,
          status: "scheduled",
          cancellationReason: null,
          schemaVersion: "1",
          createdAt: now,
          createdBy: "office",
          updatedAt: now,
          updatedBy: "office",
        };
        await Promise.all([
          database.doc(root + "memberDirectoryStates/current").set(state),
          database.doc(`memberDirectoryRestoreGuards/${academyId}`).set(control.guard),
          database.doc(`memberDirectoryRestoreGuards/${academyId}/events/0`).set(control.event),
          database.doc(root + "regyfitMemberRecords/123").set(archive),
          database
            .doc(root + "regyfitOfficeLinks/123")
            .set({ academyId, recordId: "123", studentId: "original-student" }),
          database.doc(root + "students/original-student").set(oldStudent),
          database
            .doc(root + "families/office-original-student")
            .set({
              ...envelope,
              familyId: "office-original-student",
              primaryContactUserId: null,
              billingContactUserId: null,
              guardianContact: { fullName: archive.fullName, phoneNumber: archive.mobile },
            }),
          database
            .doc(root + "studentLevelProgress/original-student")
            .set({ studentId: "original-student", attendedClasses: 30, historicalMarker: true }),
          database
            .doc(root + "plans/" + plan.planId)
            .set({
              ...plan,
              academyId,
              active: true,
              schemaVersion: "1",
              createdAt: now,
              createdBy: "office",
              updatedAt: now,
              updatedBy: "office",
            }),
          database
            .doc(root + "programs/adult-fundamentals")
            .set({
              programId: "adult-fundamentals",
              academyId,
              name: "Adult fundamentals",
              ageBand: "adult",
              discipline: "bjj",
              level: "fundamentals",
              active: true,
              schemaVersion: "1",
            }),
          database.doc(root + "sessions/paid-class").set(session),
          database
            .doc(root + "sessions/expired-class")
            .set({
              ...session,
              sessionId: "expired-class",
              startAt: "2026-10-01T18:00:00.000Z",
              endAt: "2026-10-01T19:00:00.000Z",
            }),
          database
            .doc(root + "users/office")
            .set({
              userId: "office",
              academyId,
              accountType: "staff",
              displayName: "Office",
              email: "office@example.test",
              authProvider: "google",
              active: true,
              adminRole: "owner",
              lastRoleChangeAuditId: "audit-1",
              createdAt: Timestamp.now(),
              createdBy: "office",
              updatedAt: Timestamp.now(),
              updatedBy: "office",
              status: "active",
              schemaVersion: 1,
            }),
        ]);
        const service = createMemberRecoveryService({
          firestore: database,
          auth: adminAuth,
          academyId,
          projectId,
          identitySecretMaterial,
          integritySecretMaterial,
          identitySecretVersion: "identity-v1",
          integritySecretVersion: "integrity-v1",
          now: () => now,
        });
        const ticket = await service.begin({ fullName: archive.fullName }, "192.0.2.8");
        const account =
          provider === "password"
            ? await createUserWithEmailAndPassword(auth, address, password)
            : await signInWithCredential(auth, google);
        uid = account.user.uid;
        if (provider === "password") {
          expect(await service.complete({ recoveryId: ticket.recoveryId }, uid)).toEqual({
            status: "verify-email",
          });
          await adminAuth.updateUser(uid, { emailVerified: true });
        }
        expect(await service.complete({ recoveryId: ticket.recoveryId }, uid)).toEqual({
          status: "pending-review",
        });
        expect((await adminAuth.getUser(uid)).customClaims?.role).toBeUndefined();
        const office = {
          actorId: "office",
          academyId,
          role: "owner" as const,
          active: true,
          appCheckVerified: true,
        };
        expect((await service.list(office)).requests.map((r) => r.requestId)).toContain(
          ticket.recoveryId,
        );
        const detail = await service.detail({ requestId: ticket.recoveryId }, office);
        const candidate = detail.candidates.find((c) => c.source === "regyfit")!;
        expect(
          await service.review(
            {
              requestId: ticket.recoveryId,
              decision: "approve",
              candidateId: candidate.candidateId,
              identityConfirmed: true,
            },
            office,
          ),
        ).toEqual({ status: "linked" });
        await signOut(auth);
        const signedIn =
          provider === "password"
            ? await signInWithEmailAndPassword(auth, address, password)
            : await signInWithCredential(auth, google);
        expect(signedIn.user.uid).toBe(uid);
        expect((await signedIn.user.getIdTokenResult(true)).claims).toMatchObject({
          academyId,
          role: "adultStudent",
        });
        expect(await service.complete({ recoveryId: ticket.recoveryId }, uid)).toEqual({
          status: "linked",
        });
        const student = (await database.doc(root + "students/original-student").get()).data()!;
        expect(student).toMatchObject({
          ...oldStudent,
          userId: uid,
          email: address,
          updatedBy: uid,
        });
        expect((await database.collection(root + "students").get()).size).toBe(1);
        expect(
          (await database.doc(root + "studentLevelProgress/original-student").get()).data(),
        ).toEqual({ studentId: "original-student", attendedClasses: 30, historicalMarker: true });
        expect(await service.history(uid)).toMatchObject({
          records: [
            {
              graduation: archive.graduation,
              attendance: archive.attendance,
              payments: archive.payments,
            },
          ],
        });
        const input = {
          operation: "assign" as const,
          membershipId: null,
          expectedUpdatedAt: null,
          requestId: randomUUID(),
          studentId: "original-student",
          planId: plan.planId,
          startsAt: "2026-08-01T00:00:00.000Z",
          endsAt: "2026-10-01T00:00:00.000Z",
          settlement: {
            kind: "previously-paid" as const,
            recordId: "123",
            paymentConfirmed: true as const,
          },
        };
        const actor = {
          kind: "user",
          userId: "office",
          academyId,
          role: "owner",
        } as UserActorContext;
        const membership = await saveManualSubscription(database, actor, input);
        expect(await saveManualSubscription(database, actor, input)).toEqual(membership);
        expect((await database.collection(root + "payments").get()).size).toBe(0);
        expect((await database.doc(root + "regyfitMemberRecords/123").get()).data()).toEqual(
          archive,
        );
        const booking = createBookingTransactionService({
          firestore: database as unknown as BookingFirestore,
          now: () => now,
        });
        const request = {
          sessionId: "paid-class",
          studentId: "original-student",
          membershipId: membership.membershipId,
        };
        expect(
          await booking.requestBooking(academyId, request, uid, { ip: null, role: "adultStudent" }),
        ).toMatchObject({ status: "confirmed", studentId: "original-student" });
        await expect(
          booking.requestBooking(academyId, { ...request, sessionId: "expired-class" }, uid, {
            ip: null,
            role: "adultStudent",
          }),
        ).rejects.toMatchObject({ code: "ineligible" });
        const waitlist = createFirestoreWaitlistStore({ firestore: database as never });
        await expect(
          waitlist.joinWaitlist({
            academyId,
            request: { ...request, sessionId: "expired-class" },
            actorId: uid,
            now,
          }),
        ).rejects.toMatchObject({ code: "ineligible" });
      } finally {
        if (uid) await adminAuth.deleteUser(uid);
        await database.recursiveDelete(database.doc(`academies/${academyId}`));
        await database.recursiveDelete(database.doc(`memberDirectoryRestoreGuards/${academyId}`));
        await deleteClient(web);
        await deleteApp(app);
      }
    },
    60000,
  );
});
