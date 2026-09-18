# Legacy member recovery

Approved in chat on 2026-09-18. Implementation only; production deployment is separate.

## Scope

Add recovery from member login. All application text, new code, contracts and feature documents use English. Preserve existing member, staff, registration and Google login flows. No unrelated UI changes. Work on branch `feature/legacy-member-recovery` in an isolated worktree.

The member enters their full registered name and previous email, then chooses Google or email/password authentication. Google is not restricted to gmail.com. An existing email/password account can sign in without creating another account. New password accounts verify their email before any membership access. Firebase owns passwords; recovery never stores or logs them.

## Identity and matching

Begin performs server-side matching but returns the same opaque, expiring recovery ticket for a match or miss. No public membership oracle, IDs, email hints or member data. Normalise name accents/case/repeated whitespace and trim/lowercase email. App Check and bounded persistent rate limits protect all public operations. Academy is server configuration, never client input.

The backend reloads the Auth user, rejects disabled users and foreign academy/staff claims, and binds each ticket to one authenticated account. Same registered verified email plus one full-name match may recover automatically. A different email, absent email, ambiguous names or a conflicting existing link requires explicit owner/administrator review. Verification of a new email alone never proves ownership of the old member. Admin reviews require live role checks, App Check and an explicit identity-confirmed action. This approved policy supersedes ADR-009 section 9 only for the verified-email recovery described here; unverified name/email matching remains insufficient.

## Persistence

Reuse the canonical directory invariants: transactional uniqueness of account and member identities, restore/state guards, one control-plane revision, receipts and audit. Reuse a canonical student when one already represents the legacy record. Keep legacy sources intact and link provenance; never duplicate canonical students on retry or concurrent recovery, overwrite a linked account, invent memberships or reset a suspended/expired status. Claims are granted only after a durable link and are repairable on retry.

Regyfit records may lack valid date of birth, phone, training centre or preferences. After verified identity, request the missing required profile fields, preserving valid imported data. No fabricated DOB, phone, guardian or class preference. Under-18 cases require the established guardian process/review and cannot become adult students through self-service.

## User flow

1. `Already a member? Recover your access` opens `/login/recover`.
2. `Full name` and `Previous email address` -> `Find my membership`.
3. Generic continuation explains that the account must be verified before recovery. `Continue with Google` or email/password; existing-account sign-in and reset link available.
4. Password registration sends verification through Firebase. `I have verified my email` reloads Auth and retries; `Resend verification email` is available. Keep only the opaque recovery ticket in session storage, not personal fields or passwords. Reload can resume the ticket after authentication.
5. Backend returns verification required, review pending, required profile completion, linked or rejected. Only linked proceeds to `/account`, after refreshing claims. A pending request can be checked again later from the recovery page.
6. Owner/administrator queue under Members shows recovery requests, loads protected detail, and approves a selected candidate after independent identity confirmation or rejects the request. Approval does not grant immediate access to an unverified or changed account.

## API boundary

- `beginMemberRecovery({fullName,email})` -> `{recoveryId,expiresAt}`.
- `completeMemberRecovery({recoveryId,profile?})` -> `{status,profile?}`; status is `verify-email`, `pending-review`, `profile-required`, `linked` or `rejected`.
- Profile completion: `dateOfBirth`, `phoneNumber`, `trainingCenter`, `trainingTimePreferences`; server supplies safe prefill only after identity authorisation.
- `listMemberRecoveryRequests(null)` -> `{requests,truncated}`.
- `getMemberRecoveryDetail({requestId})` -> protected request + candidate details.
- `reviewMemberRecovery({requestId,decision,candidateId?,identityConfirmed?})` -> `{status}`.

## Validation

Synthetic tests cover name normalisation, privacy-equivalent match/miss, rate limiting, unverified/disabled/cross-tenant users, new-email review, duplicate candidates, competing tickets, replay, expired tickets, old identity preservation, canonical uniqueness, claim repair, minors, and authorised review. UI tests cover both authentication choices, existing-account sign-in, verification/resume, profile completion, pending and error states, and English labels. Check typecheck, lint, selected tests, production static build and a local synthetic browser smoke. No production writes or real emails during tests.
