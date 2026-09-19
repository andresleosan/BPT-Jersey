# Manual subscriptions from each member profile

## Verified production data map (2026-09-18)

Project: `bptjersey-f5a25`, academy: `demo-academy`. Read-only Google Firestore queries and Firebase MCP confirm the project. The academy parent document is absent, but its subcollections exist.

| Collection below academies/demo-academy | Count | Role |
| --- | ---: | --- |
| regyfitMemberRecords | 249 | Imported member profiles, historical plan and payment text |
| regyfitMemberLinks | 1 | Account-recovery link to a canonical student |
| students | 2 | Operational member identity |
| studentAdminProfiles | 2 | Administrative identifiers |
| studentIdentityKeys | 2 | Reserved identity keys |
| memberships | 0 | Operational subscriptions |
| plans | 11 | Actual managed plan catalogue |
| invoices | 0 | Operational amounts due |
| payments | 0 | Recorded manual receipts |

The screenshot profile resolves to imported record 161. No personal data is reproduced here. Imported history is evidence, not an operational payment receipt. Do not automatically claim money was received based on plan text or imported ACTIVE labels.

Current chain: Search members -> regyfit record -> member number lookup -> canonical student -> memberships. The lookup returns HTTP 403 in recent production logs even when Auth and App Check verification are VALID. CORS preflight succeeds; Cloud Run public invoker is configured. Thus CORS/App Check bypass is not a fix. Current source contains stronger, explicit staff provisioning checks; compare runtime source/version and actor checks before deploying.

Directory state: canonical reader and writer, open, idle, identity coverage complete. Preserve its identity reservations, restore guards, audit and idempotency rules.

Cloudflare MCP cannot access the production account (authentication error). Existing GitHub deployment checks and the public domain remain alternative verification sources. Do not change DNS or add another database.

## Required outcome

From Search members -> member number -> Membership, office can register an imported member without requiring a member login, assign a subscription when absent, change any active catalogue plan without collecting a charge, grant complimentary access, record money already received, and explicitly mark a period unpaid. Paid and complimentary periods give active access; unpaid periods remain distinguishable. Dates and expiry notices use the same operational memberships. Payment history is visible from that member, including preserved imported evidence, and feeds the existing billing/Overview records.

## Implementation sequence

1. Resolve by the imported record ID and durable canonical link, using number reservations only as a verified fallback. Return actionable missing-link states instead of a retry loop. Diagnose the current authorization rejection without relaxing controls.
2. Add explicit office registration for adults and minors, preserving canonical writer control-plane and identity guarantees. Represent billing contacts honestly for members without an online account; do not invent Auth users or guardian access. Keep later account recovery compatible.
3. Add an atomic, idempotent manual subscription command. Store real memberships/invoices/payments through existing contracts; record complimentary grants distinctly from money received. Preserve history and protect against concurrent edits and retry duplicates. Paid-existing-invoice updates must also activate the corresponding subscription in the same transaction.
4. Reuse one editor in directory rows and imported member profiles. Keep plan/status/dates/payment actions together. Load only the selected member's data; avoid repeated full-catalogue loads. Preserve BPT colours, square controls, visible focus, and 44px touch targets. Stack forms on mobile, keep labels and buttons readable, use explicit saving/success/error states.
5. Focused backend checks: access and tenant denial, canonical link replay, free assignment, unpaid-to-paid activation, plan changes, duplicate retries and concurrent edits. Focused UI checks and browser inspection at 390 and 1440px. Typecheck/lint touched areas. Do not run broad unrelated suites.
6. Commit only these changes, deploy the relevant functions/frontend through the existing main workflow, and verify actual deployment and the integrated flow. Do not alter real member payments just to test.

## Completion evidence still required

Working live member resolver; office registration and real persisted subscription/payment flows; phone/desktop rendering; targeted negative authorization checks; current deployment evidence. Discovery alone is not completion.

## Implementation and local evidence

Implemented imported-record resolution and office registration, including children and members without online accounts. The shared profile editor assigns, changes and renews subscriptions; paid, unpaid and complimentary settlement use actual membership, invoice and payment records. Invoice history is retained, existing Billing invoices are settled without duplication, and retries reuse the same request. Account recovery can subsequently claim an office-created family.

Focused Vitest run: 109 tests passed across seven files (directory, recovery, manual subscriptions, finance, family contracts, profile search and editor). Both package typechecks, touched-file ESLint and functions deployment-artifact build passed. The web production build produced 59 static routes. No real member or payment data was changed for these checks.

Rendered the actual profile/editor components with synthetic data in an isolated local Chromium session at 390 × 1000 and 1440 × 1000. Reviewed screenshots at both widths. Document width equals viewport width; keyboard focus is visible; form labels are 16px; controls and tab targets are at least 44px. Assignment, complimentary selection, failure and enabled retry were exercised. This verifies the components, not an authenticated production session. No loading-time improvement is claimed without production measurements.

Production runtime service-account roles were inspected read-only: editor, Eventarc receiver, App Check verifier and Run invoker. These do not establish the cause of the older identity-lookup 403; the new live resolver still needs verification. Cloudflare rejected exporting the local preview bundle to an account not verified as BPT's; local browser review was used instead.

Deployment and authenticated production verification remain pending.
