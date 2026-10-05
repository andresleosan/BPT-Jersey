# Optional age capacities and waitlist invitations

Implemented 2026-10-05. Production activation is separate from GitHub publication.
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

## Review boundary

Source inspection and an independent code review covered shared capacity enforcement,
read-before-write transaction ordering, renewal/alias handling, bounded pagination, resumable
publication and mobile/desktop CSS. No automated tests, browser tests, compilation, lint or
typecheck were run, following the operator's current project instructions. Production behaviour
and rendered layouts have not been verified by this implementation task.
