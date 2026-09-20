# Finite courses and seminars

Finite weekly programmes use the ordinary calendar and coach attendance screen, canonical students/families and existing invoices/payments. Each participant sends one bank-transfer reference and screenshot. Staff retain their roles; office management requires no personal membership.

## Future authorised release

Code publication is separate from deployment. No deployment or feature activation is authorised by this document. Keep `academies/<academy>/settings/courseFeatures.coursesEnabled` false or absent; deploy Firestore indexes and compatible backend; configure `COURSES_ACADEMY_ID`; point the web build's `NEXT_PUBLIC_COURSES_API_URL` to the deployed `coursePublic` HTTPS endpoint; deploy the frontend; activate sales only when authorised. Existing bank instructions must be valid. Evidence uses the existing private R2 configuration and canonical identity secrets.

Routes: `/courses`, `/courses/view?course=<uuid>`, `/account/courses`, `/account/courses/calendar` and `/admin/courses`. The personal course calendar reuses MemberCalendar for eligible account roles. Coach sessions use the existing interface. Drafts remain hidden until all dates are prepared.

Disabling courses closes new reservations, waitlist offers, publication and the public catalogue. Existing approved access, attendance, payment review, refunds and cancellation remain available. After v2 documents exist, retain v2 readers during rollback; prefer compatible repair over deploying old code.

## Reservations and payments

Holds and offers last 24 hours. Evidence awaiting review holds its seat indefinitely; a correction starts a new 24-hour window. Expiry/rejection releases the seat once. FIFO promotion uses the shared course transaction and scheduler. Waitlisted users do not pay until offered a place. Late evidence opens an incident without taking someone else's place. Late approval requires eligibility, future dates, spare capacity and no earlier waiting request.

Price and accepted terms are snapshots. Approval records one full payment and includes remaining sessions automatically. Course bookings use string schemaVersion 2, null membership and an explicit course/enrolment source. Finance uses numeric schemaVersion 2 and a user/family payer. Ordinary records remain v1. Course attendance does not consume ordinary quotas or count towards graduation or no-show fees.

A withdrawal keeps access until office confirmation. Refunds are manual records: pending does not mean paid; recorded requires a completed transfer date and bank reference. No bank transfer is automated. Cancellation closes future entitlement immediately and processes session cancellation, notices and incidents in batches. Attendance and financial history remain.

## Recovery

- Partial publication: retry the same job from Processing issues. A changed draft requires publication of its current revision. Prepared sessions remain hidden until completion.
- Approval timeout: repeat the same request ID. The client retains its nonce after uncertain failures. Refresh after a revision conflict.
- Identity created before payment failure: retry using the canonical receipt. Do not create a second person to bypass an identity conflict. Adult enrolment reuses the account's existing guardian family.
- Booking projection delayed: calendar and roster derive approved access; check-in materialises and revalidates the booking. Worker retries fill projections.
- Upload without submission: retry the same upload request to recover its proof ID. Unattached uploads older than 48 hours are claimed for deletion only after checking references. Attached evidence is retained after rejection/cancellation. Failed object deletion leaves a retryable tombstone.
- Repeated job failure: five failed attempts leave a failed task in Processing issues. Retry retains its cursor and rechecks publication revision. Lease tokens prevent superseded workers committing batches. Error codes omit personal data and file URLs.

Batches write at most 93 documents including progress, below the ceiling of 100. Scheduler work has a 40-second budget; transactions already in flight may finish later. Queue and maintenance cursors rotate. No timing benchmark has been run.

For counter reconciliation: pause sales, preserve a consistent course/enrolment snapshot, review committed seats, identity aliases and operation receipts, then apply an individually reviewed and audited correction. Do not reset all counters or bypass FIFO. No automatic repair endpoint is included.

## Privacy and backup

Course collections deny direct client Firestore access. Public HTTP returns an explicit programme allowlist. Private callables require App Check and live academy/role authority. Coaches receive sporting roster fields only. PNG/JPEG proofs are decoded and re-encoded with metadata stripped, capped at 2 MiB and 20 megapixels. Private image URLs expire after one minute and request no-store caching. Never paste signed URLs into logs or tickets.

Office subject export is paginated at 30, scoped by applicant UID, omits storage keys and signed URLs, and omits minor candidate identity from an adult export. Participant-specific requests and financial retention need office review of linked canonical records. It is not a self-service destructive erasure endpoint. No proposed ADR-008 retention policy is enabled.

Backup inventory: courses, publicCourses, courseCandidates, courseCandidateKeys, courseParticipantAccounts, courseStudentAliases, courseIdentityReceipts, courseEnrolments, courseParticipantLocks, courseProofs, coursePaymentIncidents, courseRefunds, courseEvidenceKeys, courseOperations, courseAudit, courseRateLimits, courseJobs, courseWorkerState and courseNotices. R2 uses `academies/<academy>/course-proofs/<enrolment>/<proof>.jpg`. Firestore metadata backup does not copy image objects; authorised object backup/restore must preserve references separately. Technical rate buckets expire separately from financial evidence.

## Verification status

Source inspection and Git delivery evidence only. Per operator instruction, no tests, browser sessions, Lighthouse, full-workspace type/lint checks or builds have run. No live member data or production actions have been exercised. Runtime behaviour and performance have not been measured.
