# Optional age capacities and waitlist invitations

Implemented and activated 2026-10-05. Production activation is separate from GitHub publication.
No data migration is required. Missing `ageCapacities` means the existing total-capacity policy.

## Coordinated activation

Keep `NEXT_PUBLIC_AGE_WAITLIST_ENABLED` absent/false while publishing the backend. Cloudflare
Pages can publish main automatically, so this gate prevents the new UI from calling functions
that have not been deployed. This document does not authorise deployment.

With production deployment authorised:

1. Publish the additive indexes in `firestore.indexes.json` and wait for them to be ready.
2. Publish the new callables: `getSessionAgeAvailability`, `getWaitlistClassSource`,
   `createWaitlistClass`, `listWaitlistClassInvitations`, `respondWaitlistClassInvitation`,
   `listWaitlistClassHistory`, and `listPendingPastWaitlists`.
3. Publish existing consumers of the changed booking/session stores together: ordinary office
   and member bookings, bulk eligible bookings, trial and walk-in bookings, waitlist join/offer/
   acceptance, group registrations and their recurring processing, session save/update/copy and
   weekly materialisation, and the member calendar week reader. Trace their exports from
   `apps/functions/src/index.ts`; deploying only the new callables leaves old booking routes
   without age enforcement. Do not activate partial backend revisions.
4. Set the web build variable `NEXT_PUBLIC_AGE_WAITLIST_ENABLED=true` and publish the frontend.
   This is a build-time public flag, not a runtime switch or a credential.

Existing App Check, authentication, academy boundaries and Firestore rules remain unchanged.
New collections are accessed only through authorised server callables; no client rules are added.

## Operations and recovery

- Only the owner configures age caps. Ages without a row keep existing rules. Removing a row
  clears that extra limit. Owners cannot set fewer places than confirmed bookings and live holds.
- Occupancy is recalculated on save. A new age row can display unknown occupancy until saving.
  Missing date of birth in a capped class requires correcting the canonical member profile.
- `Create next class` retains the original type and opens the existing editor with its settings.
  Choose a future date after the source session. Invitations appear in the member account;
  they neither hold seats nor create bookings until the member explicitly confirms.
- Each create operation uses a stable ID. If the page closes during publication, use
  Waitlist → All next classes and responses → Resume invitations. Completed batches are not
  duplicated. This history is available even when the original queue is empty.
- Declining or failing eligibility/capacity keeps the member waiting for the original session.
  A changed date/time requires refreshing and reviewing the invitation before acceptance.
- Server history: `ageCapacityHistory`, `waitlistClassOperations`, `waitlistClassInvitations`,
  and `waitlistInvitationHistory`, under the academy. Acceptance records the booking ID.
  Original queue entries keep the existing schema and cancellation/expiry semantics.
- To hide the new interface, publish with the flag false. Keep backend enforcement deployed
  while any sessions have caps; hiding UI must not silently remove capacity protection.
  Do not delete historical records or bulk-clear limits as a rollback shortcut.

## Production deployment evidence — 2026-10-05

The operator explicitly authorised production deployment after GitHub publication. The release
uses source commit `ea0114093e9246c79ae0f3c31aebf1d6588d259a`, which adds the runtime import
mapping required to package the age-capacity modules on top of implementation `c03baf2`.

Firebase reported successful deployment of 27 functions in `europe-west9`:

- New: `getSessionAgeAvailability`, `getWaitlistClassSource`, `createWaitlistClass`,
  `listWaitlistClassInvitations`, `respondWaitlistClassInvitation`, `listWaitlistClassHistory`,
  `listPendingPastWaitlists`.
- Existing: `requestBooking`, `bulkBookEligibleSessions`, `walkInCheckIn`,
  `staffWalkInAttendance`, `joinWaitlist`, `issueNextWaitlistOffer`, `acceptWaitlistOffer`,
  `saveSession`, `updateSession`, `copyWeek`, `listSessions`, `getMemberCalendarWeek`,
  `registerMemberGroup`, `groupSessionWritten`, `groupAssignmentWritten`, `memberGroupWritten`,
  `groupMembershipWritten`, `groupStudentWritten`, `reconcileGroupRegistrations`,
  `sweepSessionQuorumsSchedule`.

The two invitation indexes and the booking session/student index were confirmed `READY` before
enabling the frontend. Rules, IAM policy definitions and member records were not modified.
Cloudflare Pages production flag `NEXT_PUBLIC_AGE_WAITLIST_ENABLED` was set to `true`; all
other environment variables were verified unchanged. Deployment
`8ce1b534-8ff5-4f54-8935-9db4a479fbf5` completed successfully at 22:34:53 UTC and was confirmed as
the canonical production deployment for the source commit above. The four affected routes
responded with HTTP 200 on `www.bptjersey.com`.

## Review boundary

Source inspection and an independent code review covered shared capacity enforcement,
read-before-write transaction ordering, renewal/alias handling, bounded pagination, resumable
publication and mobile/desktop CSS. The authorised deployment compiled the Firebase artifact
and the static web build, including the web build's TypeScript phase. No automated test suites,
browser tests, standalone lint or standalone typecheck were run. Deployment metadata, index
readiness and public HTTP responses were checked; authenticated booking behaviour and rendered
layouts were not exercised against production member data.
