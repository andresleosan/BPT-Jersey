# Members And Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the canonical member model, the `Add New Members` and `Search Members` modules, PDF migration preview, and the eight derived PDF reports.

**Architecture:** Members are stored once in Firestore under the academy tenant. Domain contracts and pure report predicates stay in `packages/domain`; Functions own validation, authorization, imports, and projections; Next.js owns forms and tables. Report buttons query the canonical member collection and never create report-specific collections.

**Tech Stack:** TypeScript strict, Next.js 16, React 19, Firebase Auth, Firebase Functions v2, Firestore, Zod, Vitest, React Testing Library, `pdf-parse` for server-side text extraction.

## Global Constraints

- Do not reuse the parked `feat/admin-access-requests` UI worktree as the new panel structure.
- Store one canonical member record; reports are derived projections.
- The browser never chooses `academyId`, ownership, status, audit fields, or timestamps.
- PDF imports are staged and require explicit confirmation after preview.
- Never put real member PDFs, names, emails, phones, or extracted rows in Git, logs, tests, or screenshots.
- `membershipNumber` is optional; when absent, import matching requires manual review unless name and birth date produce one unambiguous candidate.
- No production migration or deployment is part of this plan.

---

## File Map

**Domain**

- Create `packages/domain/src/members/member-contracts.ts`: member fields, search filters, report keys, and import preview types.
- Create `packages/domain/src/members/member-contracts.test.ts`: validation and report predicate tests.
- Modify `packages/domain/src/index.ts`: export public member types.

**Functions**

- Create `apps/functions/src/storage/r2-client.ts`: private R2 upload/download/delete adapter with signed URLs.
- Test `apps/functions/src/storage/r2-client.test.ts`: credential boundary, expiry, and failure behavior.
- Create `apps/functions/src/members/member-service.ts`: Firestore-agnostic member validation, search filter parsing, and report predicates.
- Create `apps/functions/src/members/member-callables.ts`: authenticated callable boundaries for create, search, report, import preview, and import confirmation.
- Create `apps/functions/src/members/member-callables.test.ts`: service-level security and idempotency tests.
- Create `apps/functions/src/members/member-import-storage.ts`: temporary import-session paths and cleanup.
- Create `apps/functions/src/members/member-import-storage.test.ts`: path ownership, expiry, and cleanup tests.
- Create `apps/functions/src/members/member-pdf-import.ts`: PDF text extraction, report identification, normalization, matching, and conflict classification.
- Create `apps/functions/src/members/member-pdf-import.test.ts`: sanitized synthetic PDF/text fixtures and parser tests.
- Modify `apps/functions/src/index.ts`: export member callables.
- Modify `firestore.rules`: deny direct member reads/writes from browsers.
- Modify `docs/integrations/cloudflare-r2.md`: document private bucket paths, credentials, signed URL expiry, cleanup, and degraded behavior.

**Web**

- Create `apps/web/src/lib/members-client.ts`: sanitized callable boundary.
- Create `apps/web/src/lib/members-client.test.ts`: exact payload and response tests.
- Create `apps/web/src/lib/member-import-client.ts`: request an import session and upload PDFs to returned Storage paths.
- Create `apps/web/src/lib/member-import-client.test.ts`: exact session payload and file validation tests.
- Create `apps/web/src/app/admin/members/add/page.tsx`: first-version member form.
- Create `apps/web/src/app/admin/members/add/page.test.tsx`: validation and success tests.
- Create `apps/web/src/app/admin/members/search/page.tsx`: filters, counters, table, pagination, and report buttons.
- Create `apps/web/src/app/admin/members/search/page.test.tsx`: filter and report interaction tests.
- Create `apps/web/src/app/admin/members/import/page.tsx`: multi-file PDF upload, preview, conflicts, and confirmation.
- Create `apps/web/src/app/admin/members/import/page.test.tsx`: no-write-before-confirmation tests.
- Modify `apps/web/src/app/admin/admin-shell.tsx`: link the two member routes without legacy placeholder modules.

---

## Task 1: Freeze Member Contracts

**Files:**

- Create: `packages/domain/src/members/member-contracts.ts`
- Test: `packages/domain/src/members/member-contracts.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- `MembershipStatus = "active" | "inactive" | "suspended"`.
- `PaymentStatus = "regularized" | "notRegularized" | "unknown"`.
- `MemberGender = "male" | "female" | "unknown"`.
- `MemberOrderBy = "membershipNumber" | "name" | "idCardNumber" | "gender" | "email" | "birthDate" | "loginTimes" | "registrationDate" | "inactiveAt"`.
- `MemberRecord` fields are `memberId`, `academyId`, optional `membershipNumber`, `fullName`, optional `email`, optional `idCardNumber`, optional `vatNumber`, optional ISO `birthDate`, optional `mobileNumber`, optional `frequency`, `paymentStatus`, `gender`, optional `trainingCenter`, `membershipStatus`, optional ISO `inactiveAt`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `source`, and `schemaVersion`.
- `MemberSearchFilters` fields are optional `membershipNumber`, `name`, `email`, `idCardNumber`, `vatNumber`, `mobileNumber`, `frequency`, `paymentOrStatus` (`PaymentStatus | MembershipStatus`), `gender` (`MemberGender`), `trainingCenter`, and `orderBy` (`MemberOrderBy`).
- `MemberReportKey = "total" | "active" | "withNumber" | "noNumber" | "inactive" | "regularized" | "activeRegularized" | "suspended"`.
- `MemberAuditMetadata` is the server-owned tuple `academyId`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, and `schemaVersion`.
- `MemberImportPreview` contains `previewId`, `expiresAt`, `sourceReports`, `additions`, `updates`, `duplicates`, and `conflicts`; each change contains only a stable key, row numbers, and field names, never raw member values.

- [ ] **Step 1: Write failing tests.** Test valid records, optional numbers, all report keys, strict filter parsing, and that `activeRegularized` requires both predicates.
- [ ] **Step 2: Run focused tests and verify failure.**

Run: `corepack pnpm exec vitest run packages/domain/src/members/member-contracts.test.ts`

Expected: FAIL because the member contracts do not exist.

- [ ] **Step 3: Implement the minimal contracts.** Export immutable types and pure helpers; do not import Firebase or browser code into the domain package.
- [ ] **Step 4: Run tests and domain typecheck.**

Run: `corepack pnpm exec vitest run packages/domain/src/members/member-contracts.test.ts && corepack pnpm --filter @bpt-jersey/domain typecheck`

Expected: all tests pass and typecheck exits 0.

---

## Task 2: Implement Backend Member Boundaries

**Files:**

- Create: `apps/functions/src/storage/r2-client.ts`
- Test: `apps/functions/src/storage/r2-client.test.ts`
- Create: `apps/functions/src/members/member-service.ts`
- Create: `apps/functions/src/members/member-callables.ts`
- Test: `apps/functions/src/members/member-callables.test.ts`
- Modify: `apps/functions/src/index.ts`
- Modify: `firestore.rules`
- Create: `qa/rules/admin-members.test.ts`
- Modify: `apps/functions/package.json` and `pnpm-lock.yaml` for the pinned R2 SDK dependencies.
- Create: `docs/integrations/cloudflare-r2.md`

**Interfaces:**

- `createMember(request) -> { memberId: string }` accepts a strict member input without `academyId`, status, timestamps, or actor fields.
- `searchMembers(request) -> { members: readonly MemberProjection[]; nextPageToken?: string }` accepts strict filters and a fixed page size.
- `getMemberReport(request) -> { report: MemberReportKey; members: readonly MemberProjection[]; generatedAt: string }`.
- `createMemberPdfImportSession(request) -> { sessionId: string; uploads: readonly { objectKey: string; uploadUrl: string }[]; expiresAt: string }` validates file metadata and returns backend-owned R2 upload URLs.
- `previewMemberPdfImport(request) -> MemberImportPreview` reads only the temporary session objects and performs no member writes.
- `confirmMemberPdfImport(request) -> { imported: number; updated: number; conflicts: number }` accepts only a server-issued preview token and explicit confirmation.
- `cleanupExpiredMemberImportSessions() -> void` removes expired temporary objects and preview records without exposing file contents.

- [ ] **Step 1: Write failing Functions tests.** Cover unauthenticated calls, non-admin calls, direct client Rules denial, strict payload rejection, academy scoping, fixed limits, and create/search/report projections with no password or IP fields.
- [ ] **Step 2: Run focused tests and verify failure.**

Run: `corepack pnpm exec vitest run apps/functions/src/members/member-callables.test.ts`

Expected: FAIL because the callables do not exist.

- [ ] **Step 3: Implement service and callable boundaries.** Derive academy scope from verified auth/configuration, validate with Zod, use Firestore transactions for create/update, and return only safe projections.
- [ ] **Step 4: Add direct-access deny rules and R2 import sessions.** Rules must deny browser reads and writes for the member collection. The R2 adapter allows temporary PDF objects only through backend-issued signed URLs with type/size limits; expired objects are cleaned up and Functions remain the only data path for member records.
- [ ] **Step 5: Run focused tests, R2 adapter tests, and Functions typecheck.**

Run: `corepack pnpm exec vitest run apps/functions/src/storage/r2-client.test.ts apps/functions/src/members/member-callables.test.ts && corepack pnpm --filter @bpt-jersey/functions typecheck`

Expected: all tests pass and typecheck exits 0.

---

## Task 3: Build Add New Members

**Files:**

- Create: `apps/web/src/lib/members-client.ts`
- Test: `apps/web/src/lib/members-client.test.ts`
- Create: `apps/web/src/app/admin/members/add/page.tsx`
- Test: `apps/web/src/app/admin/members/add/page.test.tsx`

**Interfaces:**

- `createMember(input: CreateMemberInput): Promise<{ memberId: string }>` sends only member-owned form fields.
- The page renders required fields, optional membership number, success confirmation, and generic sanitized errors.

- [ ] **Step 1: Write failing client and component tests.** Assert exact callable payloads, required name validation, optional number, valid date handling, duplicate-submit prevention, success state, and no password field.
- [ ] **Step 2: Run focused web tests and verify failure.**

Run: `corepack pnpm exec vitest run apps/web/src/lib/members-client.test.ts apps/web/src/app/admin/members/add/page.test.tsx`

Expected: FAIL because the boundary and route do not exist.

- [ ] **Step 3: Implement the client boundary.** Parse responses, sanitize callable errors, and never expose internal Firebase details.
- [ ] **Step 4: Implement the form.** Use the approved BPT design language, accessible labels, keyboard focus, mobile layout, and a single submit action.
- [ ] **Step 5: Run focused tests and web typecheck.**

Run: `corepack pnpm exec vitest run apps/web/src/lib/members-client.test.ts apps/web/src/app/admin/members/add/page.test.tsx && corepack pnpm --filter @bpt-jersey/web typecheck`

Expected: all tests pass and typecheck exits 0.

---

## Task 4: Build Search Members And Reports

**Files:**

- Modify: `apps/web/src/lib/members-client.ts`
- Modify: `apps/web/src/lib/members-client.test.ts`
- Modify: `apps/functions/src/members/member-callables.ts` and test.
- Create: `apps/functions/src/members/member-report-pdf.ts` and test.
- Modify: `apps/functions/package.json` and `pnpm-lock.yaml` for the audited PDF generator dependency.
- Create: `apps/web/src/app/admin/members/search/page.tsx`
- Test: `apps/web/src/app/admin/members/search/page.test.tsx`
- Modify: `apps/web/src/app/admin/admin-shell.tsx`

**Interfaces:**

- `searchMembers(filters: MemberSearchFilters, pageToken?: string): Promise<MemberSearchResult>`.
- `getMemberReport(report: MemberReportKey): Promise<MemberReportResult>`.
- `getMemberReportSummary(report: MemberReportKey): Promise<{ report: MemberReportKey; count: number }>` returns only the bounded aggregate used by counters.
- `getMemberReportPdf(report: MemberReportKey): Promise<{ downloadUrl: string; expiresAt: string }>`; the payload contains only the allowlisted report key.
- Report buttons are named with stable accessible labels and never send arbitrary query parameters.

- [ ] **Step 1: Write failing tests.** Cover all eleven filters, order selector, eight counters, pagination, empty state, generic error, and report button payloads.
- [ ] **Step 2: Run focused web tests and verify failure.**

Run: `corepack pnpm exec vitest run apps/web/src/app/admin/members/search/page.test.tsx`

Expected: FAIL because the page and client methods do not exist.

- [ ] **Step 3: Implement the search boundary and page.** Keep filter state local to the module, defer the query until `SEARCH`, and render responsive table/card projections.
- [ ] **Step 4: Implement bounded report summaries and rate limits.** Add a server-side aggregate for the eight counters, cap report generation at a documented maximum row count, and enforce a per-administrator Firestore-backed rate limit with a sanitized `resource-exhausted` response.
- [ ] **Step 5: Implement server-side PDF generation.** Create a durable temporary export session/journal before the R2 `PUT`, generate the report from the canonical projection with the approved columns, issue a short-lived signed download URL, and delete expired files through the cleanup path. Add a pinned/audited PDF generator dependency; never log rows or raw PDF content.
- [ ] **Step 6: Wire the eight report actions.** Open only the signed URL returned by the backend; do not construct PDF URLs from user input.
- [ ] **Step 7: Run tests, typecheck, lint, and format.**

Run: `corepack pnpm exec vitest run apps/web/src/app/admin/members/search/page.test.tsx && corepack pnpm --filter @bpt-jersey/web typecheck && corepack pnpm lint && corepack pnpm format:check`

Expected: all tests pass, typecheck/lint/format exit 0.

---

## Task 5: Add PDF Import Preview And Confirmation

**Files:**

- Create: `apps/functions/src/members/member-pdf-import.ts`
- Test: `apps/functions/src/members/member-pdf-import.test.ts`
- Create: `apps/web/src/app/admin/members/import/page.tsx`
- Test: `apps/web/src/app/admin/members/import/page.test.tsx`
- Modify: `apps/functions/package.json`: add the pinned `pdf-parse` runtime dependency through the repository package manager.

**Interfaces:**

- `identifyMemberReport(text: string): MemberReportKey` detects the report title and rejects unknown layouts.
- `parseMemberReport(text: string): readonly ParsedMemberRow[]` extracts only the approved columns.
- `buildMemberImportPreview(reports: readonly ParsedMemberReport[]): MemberImportPreview` deduplicates and classifies conflicts without writes.
- The web page sends multiple files, renders additions/updates/conflicts, and confirms only a server-issued preview token.

- [ ] **Step 1: Write failing parser tests with synthetic text.** Include all eight report headings, missing values, rows without member numbers, overlapping rows, malformed dates, and contradictory statuses. Do not use real names or exported PDFs.
- [ ] **Step 2: Run parser tests and verify failure.**

Run: `corepack pnpm exec vitest run apps/functions/src/members/member-pdf-import.test.ts`

Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Add the pinned parser dependency and implement extraction.** Read PDFs only from the temporary R2 session through the adapter, keep parsing pure after text extraction, normalize dates and phone strings, and preserve ambiguous source text only inside the preview object.
- [ ] **Step 4: Implement preview-token persistence and cleanup.** Store a short-lived server-side preview record with a hash, actor, academy, expiry, and classified changes; delete temporary R2 objects after preview/confirmation expiry and never retain raw PDF content after the session.
- [ ] **Step 5: Implement the upload client and UI.** Request a backend import session, upload only to returned signed URLs, validate multiple files, show progress and conflicts, disable confirmation while invalid, and show an import summary after confirmation.
- [ ] **Step 6: Run parser, Functions, and web tests.**

Run: `corepack pnpm exec vitest run apps/functions/src/members/member-pdf-import.test.ts apps/functions/src/members/member-callables.test.ts apps/functions/src/members/member-import-storage.test.ts apps/web/src/lib/member-import-client.test.ts apps/web/src/app/admin/members/import/page.test.tsx`

Expected: all tests pass with no writes occurring before confirmation.

---

## Task 6: Add CSV And Excel Transfer

**Files:**

- Create: `apps/functions/src/members/member-tabular-transfer.ts`
- Test: `apps/functions/src/members/member-tabular-transfer.test.ts`
- Modify: `apps/functions/src/members/member-callables.ts` and test.
- Modify: `apps/web/src/lib/member-import-client.ts` and test.
- Modify: `apps/web/src/app/admin/members/import/page.tsx` and test.
- Modify: `apps/functions/package.json`: add the audited, pinned `xlsx` dependency through the repository package manager.

**Interfaces:**

- `previewMemberTabularImport(request) -> MemberImportPreview` accepts CSV or XLSX from a backend-issued temporary session.
- `exportMembers({ format: "csv" | "xlsx" }) -> { downloadPath: string; expiresAt: string }` generates a projection without passwords, tokens, or internal claims.
- `exportOrders({ format: "csv" | "xlsx" }) -> { downloadPath: string; expiresAt: string }` is restricted to administrators and academy scope.

- [ ] **Step 1: Write failing transfer tests.** Cover the versioned column template, missing required columns, invalid dates, duplicate keys, row-level errors, safe projections, and expiring downloads.
- [ ] **Step 2: Run transfer tests and verify failure.**

Run: `corepack pnpm exec vitest run apps/functions/src/members/member-tabular-transfer.test.ts`

Expected: FAIL because tabular transfer does not exist.

- [ ] **Step 3: Add the audited dependency and implement CSV/XLSX normalization.** Reuse the same canonical matching and conflict rules as PDF imports; never bypass the preview/confirmation flow.
- [ ] **Step 4: Implement exports.** Generate only approved columns, use backend-owned temporary R2 signed download URLs, and delete expired files.
- [ ] **Step 5: Add the format selector to the import/export UI.** Show row-level errors and require explicit confirmation for imports.
- [ ] **Step 6: Run focused tests and typechecks.**

Run: `corepack pnpm exec vitest run apps/functions/src/members/member-tabular-transfer.test.ts apps/functions/src/members/member-callables.test.ts apps/web/src/app/admin/members/import/page.test.tsx && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm format:check`

Expected: all pass.

---

## Task 7: Verify The Members Deliverable

**Files:**

- Modify: `qa/rules/admin-members.test.ts` or create it if absent.
- Create: `qa/tests/admin-members.spec.ts`.
- Modify: `docs/data/firestore-data-model.md`.

- [ ] **Step 1: Add Rules tests.** Prove anonymous, client, and admin browser clients cannot directly read/write member documents.
- [ ] **Step 2: Add Playwright tests.** Cover add member, search filters, report buttons, multi-PDF preview, conflict display, and confirmation without raw data in the console.
- [ ] **Step 3: Run verification.**

Run: `corepack pnpm test && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm format:check`

Expected: all existing and new tests pass. E2E requires the approved synthetic test environment and must not use production member data.
