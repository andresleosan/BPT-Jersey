# T018 — Versioned waiver and acceptance design

## Scope

T018 implements the technical consent boundary for the synthetic pilot:

- one currently published waiver per academy;
- immutable, server-hashed waiver versions;
- the four required clause categories: photo/video, medical treatment, hygiene and data protection;
- authenticated acceptance by an adult student for themself or by an active legal guardian for a linked minor;
- independent response per clause, with publication-controlled required/optional semantics;
- server timestamp, typed-name confirmation, audit trail and a generated private PDF linked to the consent;
- non-destructive revocation and renewal through a later waiver version;
- client registration UI and owner/administrator publication UI.

The repository contains the registration requirements in BPTJ FUNCTIONS APP.docx, but it does not
contain the legal waiver text referenced in asks.md. The implementation therefore ships no legal
copy and no default published version. It fails closed until an authorized operator publishes text
that has been reviewed for the intended environment. Production and real data remain blocked by
T011 and the environment gates.

## Source decisions

- Registration requires an explicit disclaimer decision.
- A minor cannot sign and has no account; only an active linked guardian can act for the minor.
- Administration can add, revise and withdraw disclaimers.
- A revision never overwrites prior text. Publishing creates a new immutable version and marks the
  prior published version as superseded.
- Renewal means accepting a newly published version. A revoked acceptance cannot be silently
  reactivated or overwritten.
- The authenticated user identity, canonical display name and server time are authoritative. A typed
  name is an explicit confirmation and must match the canonical display name after safe normalization.
- The four clause responses are stored separately. Every clause must receive an explicit response;
  a clause marked required by the published version must be accepted.

## Data model

### cademies/{academyId}/waiverVersions/{waiverVersionId}

Immutable content fields:

- waiverVersionId, cademyId, ersionLabel, itle, introduction;
- clauses: exactly one ordered item for each fixed clause key, with heading, ody,
  equired;
- contentHash: SHA-256 of the normalized content contract;
- effectiveAt;
- status: published | superseded | withdrawn;
- supersededAt, nullable;
- schemaVersion, timestamps and actors.

Only one record may have status = published. Publication and withdrawal are backend-only,
transactional operations. Published content is never edited.

### cademies/{academyId}/consents/{consentId}

- deterministic identity for academy + subject + waiver version;
- subjectType: dult | minor; subjectId references students;
- waiverVersionId, ersionLabel, waiverContentHash;
- signedBy references the authenticated adult users identity;
- signatureMethod = authenticated_typed_name;
- four explicit clauseResponses (ccepted | declined);
- signedAt, nullable
  evokedAt, status = accepted | revoked;
- evidenceDocumentId references documents;
- schemaVersion, timestamps and actors.

The acceptance row retains its original signing facts after revocation. Revocation only changes the
state, revocation timestamp and update audit fields.

### cademies/{academyId}/documents/{documentId} and R2

Acceptance generates a PDF on the server containing the exact versioned text, clause decisions,
subject identifier, canonical signer name, signature method and server timestamp. The PDF is stored
under the existing tenant-scoped private object prefix. Its SHA-256, size and signing timestamp are
stored in the existing T024 document contract. Firestore consent and document metadata are committed
together after the R2 write; an unsuccessful transaction triggers best-effort object cleanup.

## Authorization

- owner | administrator: publish or withdraw the current waiver and inspect only the current
  version projection; they cannot sign on behalf of a participant.
- dultStudent: accept/revoke only for the active adult students record whose userId equals the
  authenticated actor.
- guardian: accept/revoke only for an active minor with an active, currently valid relationship
  whose dultUserId equals the authenticated actor.
- headCoach | coach: no waiver content, acceptance or evidence access.
- Browser Firestore access remains denied. All operations go through callable Functions and derive
  cademyId, actor and role from verified claims.
- Every callable fails closed unless BPT_SYNTHETIC_PILOT=true.

## Callables

- getWaiverRegistration(null) — current published version plus only the actor's eligible subjects
  and their current-version acceptance state.
- cceptWaiver({ studentId, waiverVersionId, contentHash, typedName, clauseResponses }) — validates
  current version, canonical signer, subject authority and all clause decisions; creates PDF,
  document, consent and audit evidence idempotently.
-

evokeWaiverConsent({ consentId }) — subject/guardian-scoped, non-destructive revocation of both
consent state and active evidence-document state.

- getWaiverEvidenceDownload({ consentId }) — exact-consent authorization and a short-lived HTTPS
  signed URL.
- getCurrentWaiverAdmin(null) — owner/administrator projection of the current version.
- publishWaiverVersion({ versionLabel, title, introduction, clauses, effectiveAt, confirmReviewed: true }) — immutable
  publication and supersession with a server-computed content hash.
- withdrawCurrentWaiver({ waiverVersionId }) — fail-closed withdrawal without deletion.

All payloads and responses use strict Zod schemas plus a pre-validation plain-data check so unknown,
symbol, accessor, sparse-array and prototype-manipulated input is rejected.

## UI

- /account/waiver: authenticated client route with loading/empty/error states, subject selector,
  full versioned text, one labelled decision group per clause, typed-name confirmation, explicit
  acceptance, revocation and evidence download.
- /admin/waivers: authenticated admin route for publishing the four fixed clause categories and
  withdrawing the current version. It clearly states that no legal template is supplied.
- /account and admin navigation expose the new routes.
- Form errors are associated with fields, summarized in an alert and focus the first invalid control.
  Status changes use live regions; controls remain keyboard-operable and responsive.

## Failure and rollback

- No migration, deployment or production write is part of T018.
- Additive code/schema rollback: remove the routes, callable exports and domain module before any
  environment activation. Existing pilot records remain retained and inaccessible under default-deny
  rules; do not hard-delete consent/evidence history.
- If R2 storage fails, no Firestore acceptance is committed. If the Firestore commit fails after an
  object write, the backend performs best-effort R2 cleanup and returns a generic precondition error.
- A missing current waiver, stale hash/version, missing relationship, inactive subject, absent R2
  configuration or malformed stored record blocks the operation.

## Verification

- Domain contract tests for valid and hostile values, fixed clause coverage, hashing inputs and
  non-destructive states.
- Service tests for publication uniqueness, adult self scope, guardian scope, stale versions,
  required/optional clauses, idempotency, PDF/hash linkage, cleanup and revocation.
- Callable tests for pilot gate, role matrix, strict payloads and sanitized errors.
- Web client/page tests for response allowlists, all UI states, accessible validation and exact
  callable payloads.
- Emulator integration for atomic consent/document/audit metadata and tenant isolation.
- Firestore Rules negative tests for waiverVersions, consents and documents.
- Focused tests first, then typecheck, lint, full unit/rules/integration suites and build.
