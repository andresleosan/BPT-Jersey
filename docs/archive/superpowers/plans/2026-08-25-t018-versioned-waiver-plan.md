# T018 — Versioned waiver implementation plan

## Goal

Implement the approved synthetic-pilot consent flow described in
docs/superpowers/specs/2026-08-25-t018-versioned-waiver-design.md, without inventing legal text,
using the existing profile/family, audit, R2 and PDF boundaries.

## Task 1: Contracts first

- Add failing tests for strict version, clause, consent, publication and client projection schemas.
- Implement shared Zod schemas/types and deterministic ID/content canonicalization helpers.
- Export the new domain entry point and add the pinned workspace Zod dependency.
- Run the focused domain tests and typecheck.

## Task 2: PDF evidence and consent service

- Add failing PDF tests proving the exact version, decisions, signer and timestamp are present while
  control characters and unsupported glyphs are normalized.
- Implement the pdf-lib waiver evidence generator.
- Add failing store tests for current-version publication, supersession/withdrawal, adult self and
  guardian authorization, required/optional clauses, stale hashes, idempotency, R2 cleanup,
  consent/document linkage, revocation and exact evidence download.
- Implement the transactional store with audit events and no direct browser data path.
- Run focused Functions tests.

## Task 3: Callable boundary

- Add failing tests for BPT_SYNTHETIC_PILOT, exact Zod payloads, role matrix and sanitized errors.
- Implement and export the seven callables from pps/functions/src/index.ts.
- Extend audit action contracts for publish, withdraw, accept and revoke events.
- Run focused domain/Functions tests and typecheck.

## Task 4: Client and responsive UI

- Add failing client tests for strict response parsing, HTTPS evidence URLs and exact callable
  payloads.
- Implement waiver-client.ts.
- Add failing account/admin page tests for loading, unavailable, published, accepted, revoked,
  invalid form, submit, download and withdrawal flows.
- Implement /account/waiver and /admin/waivers, then update account/admin navigation and styles.
- Run focused web tests, accessibility assertions and web typecheck.

## Task 5: Persistence, rules and operational docs

- Update docs/data/firestore-data-model.md and the backup collection allowlist.
- Add explicit default-deny rules and negative tests for waiver versions, consent records and
  evidence documents.
- Add an emulator integration test for the real Firestore adapter, atomic metadata and cross-tenant
  denial.
- Document that there is no bundled legal text and production remains blocked by T011/operator
  review.

## Task 6: Autocrítica and ledger

- Run focused tests, full unit suite, Rules suite, typecheck, lint, formatting, build and diff checks.
- Execute the required self-critique order: correctness, security, QA/accessibility, then performance
  only where the change introduces a material query/render risk.
- Fix all critical/high findings and repeat affected checks.
- Record RED/GREEN evidence, residual production gates and changed-file evidence in asks.md, then
  mirror the final state in Lista/Lista.js.
- Do not deploy, migrate, commit, push, access real data or enable production configuration.
