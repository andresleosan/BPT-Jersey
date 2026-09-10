import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const projectId = "demo-bpt-jersey";
const academyId = "synthetic-academy";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST?.trim();
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim();

const fixture = Object.freeze({
  adult: Object.freeze({
    sessionId: "session-t060-adult-accept",
    sessionTitle: "T060 Adult acceptance class",
    membershipId: "membership-t060-adult",
    familyId: "family-t060-adult",
    programId: "program-t060-adult",
    planId: "bpt-jersey-adult",
    locationId: "town",
  }),
  guardian: Object.freeze({
    sessionId: "session-t060-guardian-decline",
    sessionTitle: "T060 Junior decline class",
    membershipId: "membership-t060-minor",
    familyId: "family-t060-guardian",
    studentId: "student-t060-minor",
    programId: "program-t060-kids",
    planId: "town-kids-1x",
    locationId: "town",
  }),
  rbac: Object.freeze({
    sessionId: "session-t060-rbac",
    sessionTitle: "T060 read-only staff class",
    studentId: "student-t060-rbac",
    membershipId: "membership-t060-rbac",
    programId: "program-t060-adult",
    locationId: "town",
  }),
});

function isSafeLoopbackEmulator(host) {
  const match = /^127\.0\.0\.1:([1-9]\d{3,4})$/u.exec(host ?? "");
  return Boolean(match) && Number(match[1]) >= 1_024 && Number(match[1]) <= 65_535;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment: ${name}`);
  return value;
}

function assertSafeEnvironment() {
  if (
    process.env.WAITLIST_OFFER_UI_EMULATOR_E2E !== "true" ||
    !isSafeLoopbackEmulator(firestoreHost) ||
    !isSafeLoopbackEmulator(authHost) ||
    (process.env.GCLOUD_PROJECT ?? projectId) !== projectId
  ) {
    throw new Error(
      "T060 offer seed requires explicit waitlist-offer mode and loopback demo emulators.",
    );
  }
}

function syntheticEmail(name) {
  const value = required(name);
  if (!value.endsWith("@example.test")) {
    throw new Error(`${name} must be a synthetic example.test address.`);
  }
  return value;
}

function pairId(left, right) {
  return `v2:${left.length}:${left}:${right.length}:${right}`;
}

function auditFields(actorId, createdAt) {
  return {
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt,
    createdBy: actorId,
    updatedAt: createdAt,
    updatedBy: actorId,
  };
}

function membershipRecord({ membershipId, familyId, studentId, planId, actorId, createdAt }) {
  return {
    membershipId,
    academyId,
    familyId,
    studentId,
    planId,
    status: "active",
    startsAt: createdAt,
    endsAt: null,
    nextBillingAt: null,
    schemaVersion: "1",
    createdAt,
    createdBy: actorId,
    updatedAt: createdAt,
    updatedBy: actorId,
  };
}

function planRecord(planId, actorId, createdAt) {
  const kids = planId === "town-kids-1x";
  return {
    planId,
    displayName: kids ? "Town Kids 1x" : "BPT Jersey Adult",
    priceMinor: kids ? 9_500 : 12_500,
    currency: "GBP",
    billingPeriod: "monthly",
    eligibleParticipantTypes: [kids ? "kids" : "adult"],
    classSites: kids ? ["Town"] : ["Town", "West"],
    weeklyClassLimit: kids ? 1 : null,
    openMatSites: kids ? ["Town"] : ["Town", "West"],
    openMatFeeMinor: null,
    academyId,
    active: true,
    schemaVersion: "1",
    createdAt,
    createdBy: actorId,
    updatedAt: createdAt,
    updatedBy: actorId,
  };
}

function programRecord(programId, name, ageBand) {
  return {
    programId,
    academyId,
    name,
    ageBand,
    discipline: "bjj",
    level: "all-levels",
    active: true,
    schemaVersion: "1",
  };
}

function sessionRecord(value, startAt, endAt, actorId, createdAt) {
  return {
    sessionId: value.sessionId,
    academyId,
    classId: null,
    programId: value.programId,
    locationId: value.locationId,
    instructorId: "coach-t060-synthetic",
    title: value.sessionTitle,
    startAt,
    endAt,
    capacity: 2,
    minParticipants: 1,
    status: "scheduled",
    isSeminar: false,
    cancellationReason: null,
    schemaVersion: "1",
    createdAt,
    createdBy: actorId,
    updatedAt: createdAt,
    updatedBy: actorId,
  };
}

function bookingRecord(sessionId, suffix, actorId, createdAt) {
  const bookingId = `booking-t060-capacity-${suffix}`;
  return {
    bookingId,
    academyId,
    sessionId,
    studentId: `student-t060-capacity-${suffix}`,
    membershipId: `membership-t060-capacity-${suffix}`,
    status: "confirmed",
    requestedAt: createdAt,
    cancelledAt: null,
    cancellationReason: null,
    schemaVersion: "1",
    createdAt,
    createdBy: actorId,
    updatedAt: createdAt,
    updatedBy: actorId,
  };
}

function waitlistRecord({ sessionId, studentId, membershipId, position, requestedAt, actorId }) {
  return {
    waitlistId: pairId(sessionId, studentId),
    academyId,
    sessionId,
    studentId,
    membershipId,
    position,
    status: "waiting",
    requestedAt,
    offeredAt: null,
    offerExpiresAt: null,
    acceptedAt: null,
    cancelledAt: null,
    schemaVersion: "1",
    createdAt: requestedAt,
    createdBy: actorId,
    updatedAt: requestedAt,
    updatedBy: actorId,
  };
}

async function cleanup(firestore, sessionIds, studentIds) {
  const collectionPath = (name) => `academies/${academyId}/${name}`;
  const querySnapshots = await Promise.all(
    sessionIds.flatMap((sessionId) =>
      ["bookings", "waitlistEntries"].map((name) =>
        firestore.collection(collectionPath(name)).where("sessionId", "==", sessionId).get(),
      ),
    ),
  );
  const quotaSnapshots = await Promise.all(
    studentIds.map((studentId) =>
      firestore
        .collection(collectionPath("bookingQuotaStates"))
        .where("studentId", "==", studentId)
        .get(),
    ),
  );
  const auditSnapshot = await firestore.collection(collectionPath("auditEvents")).get();
  const selectedAuditDocuments = auditSnapshot.docs.filter((document) => {
    const targetRef = document.data().targetRef;
    return (
      typeof targetRef === "string" && sessionIds.some((sessionId) => targetRef.includes(sessionId))
    );
  });
  const explicitReferences = sessionIds.flatMap((sessionId) =>
    [
      "waitlistPositionStates",
      "waitlistOfferStates",
      "waitlistMutationStates",
      "sessionCapacityStates",
    ].map((name) => firestore.doc(`${collectionPath(name)}/${sessionId}`)),
  );
  const references = [
    ...querySnapshots.flatMap((snapshot) => snapshot.docs.map((document) => document.ref)),
    ...quotaSnapshots.flatMap((snapshot) => snapshot.docs.map((document) => document.ref)),
    ...selectedAuditDocuments.map((document) => document.ref),
    ...explicitReferences,
  ];
  await Promise.all(references.map((reference) => reference.delete()));
}

async function main() {
  assertSafeEnvironment();
  const emails = {
    owner: syntheticEmail("WAITLIST_OFFER_OWNER_EMAIL"),
    administrator: syntheticEmail("WAITLIST_OFFER_ADMIN_EMAIL"),
    adult: syntheticEmail("WAITLIST_OFFER_ADULT_EMAIL"),
    guardian: syntheticEmail("WAITLIST_OFFER_GUARDIAN_EMAIL"),
  };
  const app = initializeApp({ projectId }, "t060-waitlist-offer-ui-seed");
  const auth = getAuth(app);
  const firestore = getFirestore(app);

  try {
    const [owner, administrator, adult, guardian] = await Promise.all(
      Object.values(emails).map((email) => auth.getUserByEmail(email)),
    );
    await Promise.all([
      auth.updateUser(owner.uid, { displayName: "Synthetic T060 Owner" }),
      auth.updateUser(administrator.uid, { displayName: "Synthetic T060 Administrator" }),
      auth.updateUser(adult.uid, { displayName: "Synthetic T060 Adult" }),
      auth.updateUser(guardian.uid, { displayName: "Synthetic T060 Guardian" }),
    ]);

    const now = Date.now();
    const createdAt = new Date(now - 30 * 24 * 60 * 60 * 1_000).toISOString();
    const firstRequestedAt = new Date(now - 2 * 60 * 60 * 1_000).toISOString();
    const secondRequestedAt = new Date(now - 60 * 60 * 1_000).toISOString();
    const sessionValues = [
      { value: fixture.adult, days: 5, suffix: "adult", actorId: owner.uid },
      {
        value: fixture.guardian,
        days: 6,
        suffix: "guardian",
        actorId: administrator.uid,
      },
      { value: fixture.rbac, days: 7, suffix: "rbac", actorId: owner.uid },
    ].map(({ value, days, suffix, actorId }) => {
      const startAt = new Date(now + days * 24 * 60 * 60 * 1_000).toISOString();
      const endAt = new Date(Date.parse(startAt) + 60 * 60 * 1_000).toISOString();
      return { value, suffix, actorId, startAt, endAt };
    });
    const sessionIds = sessionValues.map(({ value }) => value.sessionId);
    await cleanup(firestore, sessionIds, [adult.uid, fixture.guardian.studentId]);

    const adultAudit = auditFields(adult.uid, createdAt);
    const guardianAudit = auditFields(guardian.uid, createdAt);
    const adultWaitlist = waitlistRecord({
      sessionId: fixture.adult.sessionId,
      studentId: adult.uid,
      membershipId: fixture.adult.membershipId,
      position: 1,
      requestedAt: firstRequestedAt,
      actorId: adult.uid,
    });
    const guardianWaitlist = waitlistRecord({
      sessionId: fixture.guardian.sessionId,
      studentId: fixture.guardian.studentId,
      membershipId: fixture.guardian.membershipId,
      position: 1,
      requestedAt: firstRequestedAt,
      actorId: guardian.uid,
    });
    const secondAdultWaitlist = waitlistRecord({
      sessionId: fixture.adult.sessionId,
      studentId: "student-t060-adult-second",
      membershipId: "membership-t060-adult-second",
      position: 2,
      requestedAt: secondRequestedAt,
      actorId: owner.uid,
    });
    const secondGuardianWaitlist = waitlistRecord({
      sessionId: fixture.guardian.sessionId,
      studentId: "student-t060-guardian-second",
      membershipId: "membership-t060-guardian-second",
      position: 2,
      requestedAt: secondRequestedAt,
      actorId: administrator.uid,
    });
    const rbacWaitlist = waitlistRecord({
      sessionId: fixture.rbac.sessionId,
      studentId: fixture.rbac.studentId,
      membershipId: fixture.rbac.membershipId,
      position: 1,
      requestedAt: firstRequestedAt,
      actorId: owner.uid,
    });

    const writes = [
      [
        `academies/${academyId}/users/${adult.uid}`,
        {
          userId: adult.uid,
          academyId,
          accountType: "client",
          displayName: "Synthetic T060 Adult",
          email: emails.adult,
          phoneNumber: "+441534555060",
          ...adultAudit,
        },
      ],
      [
        `academies/${academyId}/students/${adult.uid}`,
        {
          studentId: adult.uid,
          academyId,
          familyId: fixture.adult.familyId,
          userId: adult.uid,
          fullName: "Synthetic T060 Adult",
          dateOfBirth: "1990-01-01",
          phoneNumber: "+441534555060",
          email: emails.adult,
          trainingCenter: "Town",
          trainingTimePreferences: ["evening"],
          participantType: "adult",
          ...adultAudit,
        },
      ],
      [
        `academies/${academyId}/families/${fixture.adult.familyId}`,
        {
          familyId: fixture.adult.familyId,
          academyId,
          primaryContactUserId: adult.uid,
          billingContactUserId: adult.uid,
          ...adultAudit,
        },
      ],
      [
        `academies/${academyId}/memberships/${fixture.adult.membershipId}`,
        membershipRecord({
          membershipId: fixture.adult.membershipId,
          familyId: fixture.adult.familyId,
          studentId: adult.uid,
          planId: fixture.adult.planId,
          actorId: adult.uid,
          createdAt,
        }),
      ],
      [
        `academies/${academyId}/users/${guardian.uid}`,
        {
          userId: guardian.uid,
          academyId,
          accountType: "client",
          displayName: "Synthetic T060 Guardian",
          email: emails.guardian,
          phoneNumber: "+441534555061",
          ...guardianAudit,
        },
      ],
      [
        `academies/${academyId}/students/${fixture.guardian.studentId}`,
        {
          studentId: fixture.guardian.studentId,
          academyId,
          familyId: fixture.guardian.familyId,
          fullName: "Synthetic T060 Junior",
          dateOfBirth: "2015-01-01",
          trainingCenter: "Town",
          trainingTimePreferences: ["afternoon"],
          participantType: "minor",
          ...guardianAudit,
        },
      ],
      [
        `academies/${academyId}/families/${fixture.guardian.familyId}`,
        {
          familyId: fixture.guardian.familyId,
          academyId,
          primaryContactUserId: guardian.uid,
          billingContactUserId: guardian.uid,
          ...guardianAudit,
        },
      ],
      [
        `academies/${academyId}/relationships/${fixture.guardian.familyId}--${fixture.guardian.studentId}`,
        {
          relationshipId: `${fixture.guardian.familyId}--${fixture.guardian.studentId}`,
          academyId,
          familyId: fixture.guardian.familyId,
          studentId: fixture.guardian.studentId,
          adultUserId: guardian.uid,
          relationshipType: "guardian",
          permissions: ["readProfile"],
          validFrom: createdAt,
          active: true,
          status: "active",
          schemaVersion: "1",
          createdAt,
          createdBy: administrator.uid,
          updatedAt: createdAt,
          updatedBy: administrator.uid,
        },
      ],
      [
        `academies/${academyId}/memberships/${fixture.guardian.membershipId}`,
        membershipRecord({
          membershipId: fixture.guardian.membershipId,
          familyId: fixture.guardian.familyId,
          studentId: fixture.guardian.studentId,
          planId: fixture.guardian.planId,
          actorId: administrator.uid,
          createdAt,
        }),
      ],
      [
        `academies/${academyId}/plans/${fixture.adult.planId}`,
        planRecord(fixture.adult.planId, owner.uid, createdAt),
      ],
      [
        `academies/${academyId}/plans/${fixture.guardian.planId}`,
        planRecord(fixture.guardian.planId, administrator.uid, createdAt),
      ],
      [
        `academies/${academyId}/programs/${fixture.adult.programId}`,
        programRecord(fixture.adult.programId, "T060 Adult programme", "adult"),
      ],
      [
        `academies/${academyId}/programs/${fixture.guardian.programId}`,
        programRecord(fixture.guardian.programId, "T060 Junior programme", "kids"),
      ],
      ...sessionValues.flatMap(({ value, suffix, actorId, startAt, endAt }) => {
        const booking = bookingRecord(value.sessionId, suffix, actorId, createdAt);
        return [
          [
            `academies/${academyId}/sessions/${value.sessionId}`,
            sessionRecord(value, startAt, endAt, actorId, createdAt),
          ],
          [`academies/${academyId}/bookings/${booking.bookingId}`, booking],
        ];
      }),
      ...[
        adultWaitlist,
        secondAdultWaitlist,
        guardianWaitlist,
        secondGuardianWaitlist,
        rbacWaitlist,
      ].map((entry) => [`academies/${academyId}/waitlistEntries/${entry.waitlistId}`, entry]),
    ];

    const batch = firestore.batch();
    for (const [path, value] of writes) batch.set(firestore.doc(path), value);
    batch.set(
      firestore.doc(`academies/${academyId}/waitlistPositionStates/${fixture.adult.sessionId}`),
      {
        academyId,
        sessionId: fixture.adult.sessionId,
        lastPosition: 2,
        revision: 2,
        schemaVersion: "1",
        updatedAt: secondRequestedAt,
        updatedBy: owner.uid,
      },
    );
    batch.set(
      firestore.doc(`academies/${academyId}/waitlistPositionStates/${fixture.guardian.sessionId}`),
      {
        academyId,
        sessionId: fixture.guardian.sessionId,
        lastPosition: 2,
        revision: 2,
        schemaVersion: "1",
        updatedAt: secondRequestedAt,
        updatedBy: administrator.uid,
      },
    );
    batch.set(
      firestore.doc(`academies/${academyId}/waitlistPositionStates/${fixture.rbac.sessionId}`),
      {
        academyId,
        sessionId: fixture.rbac.sessionId,
        lastPosition: 1,
        revision: 1,
        schemaVersion: "1",
        updatedAt: firstRequestedAt,
        updatedBy: owner.uid,
      },
    );
    await batch.commit();

    console.log(
      JSON.stringify({
        fixture: "T060 waitlist offers",
        projectId,
        academyId,
        sessions: sessionIds.length,
        firestoreHost,
        authHost,
      }),
    );
  } finally {
    await deleteApp(app);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "T060 offer Emulator seed failed");
  process.exitCode = 1;
});
