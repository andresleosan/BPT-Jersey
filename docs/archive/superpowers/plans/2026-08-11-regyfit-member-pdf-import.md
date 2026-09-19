# Regyfit Member PDF Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a safe, preview-first import flow for the eight real Regyfit member-report PDF layouts, including deduplication, matching, confirmed writes, and an accessible admin page.

**Architecture:** Keep PDF parsing and normalization pure in `member-pdf-import.ts`; Functions own PDF extraction, tenant authorization, preview persistence, and transactional member writes; the web client only uploads to backend-issued R2 URLs and submits opaque session/preview identifiers. Real PDFs remain local reference material and never enter source control, tests, logs, or QA artifacts.

**Tech Stack:** TypeScript strict, Firebase Functions v2, Firestore, private Cloudflare R2, `pdf-parse`, Zod, Next.js 16, React 19, Vitest, React Testing Library.

## Global Constraints

- Support only the eight Regyfit member-report layouts observed in `Varios`; reject unknown layouts and arbitrary PDFs.
- Do not copy real PDFs, real rows, names, emails, phones, extracted text, screenshots, or PII into the repository, tests, logs, or QA artifacts.
- The browser never chooses `academyId`, ownership, status, audit fields, timestamps, actor fields, or member IDs.
- Preview performs no member writes; confirmation requires a server-issued preview token and `confirm: true`.
- Rows without `membershipNumber` and email are valid new members with a server-generated `memberId` and empty identifiers.
- Matching priority is `membershipNumber`, then `email` if present; empty PDF fields never overwrite existing values.
- Duplicate or contradictory identifiers are conflicts and block the whole confirmation; missing identifiers alone do not block it.
- Maximum five PDFs and 10 MiB per file; retain the existing private R2 session and cleanup journal.
- UI copy is English, responsive, keyboard accessible, and reports generic sanitized errors.
- No production deployment, migration, real-data import, or new paid API usage is part of this plan.

---

## File Map

**Domain and parser**

- Modify `packages/domain/src/members/member-contracts.ts` only if preview contracts need a narrowly defined field extension; preserve raw-value exclusion.
- Create `apps/functions/src/members/member-pdf-import.ts` for title detection, text layout validation, row parsing, normalization, deduplication, and pure classification helpers.
- Create `apps/functions/src/members/member-pdf-import.test.ts` with synthetic text fixtures only.

**Functions**

- Modify `apps/functions/package.json` and `pnpm-lock.yaml` to pin `pdf-parse` after dependency audit.
- Modify `apps/functions/src/members/member-callables.ts` to extract PDFs, persist previews, classify against canonical members, and confirm writes.
- Modify `apps/functions/src/members/member-callables.test.ts` for preview/confirmation authorization, no-write-before-confirmation, conflicts, and idempotency.
- Modify `apps/functions/src/members/member-service.ts` to expose bounded canonical lookup and transactional create/update operations needed by import confirmation.
- Create `apps/functions/src/members/member-import-storage.ts` and test it if preview persistence is split from the existing session store.
- Modify `apps/functions/src/index.ts` only when new callable exports are required.

**Web**

- Create `apps/web/src/lib/member-import-client.ts` and its test for exact callable payloads, file validation, signed uploads, preview, and confirmation.
- Create `apps/web/src/app/admin/members/import/page.tsx` and its test for multi-file selection, progress/error states, preview summary, conflict blocking, and confirmation.
- Modify `apps/web/src/app/admin/admin-shell.tsx` to add `/admin/members/import` beside the existing Members route without legacy placeholders.

---

## Task 1: Freeze Synthetic Parser Contracts

**Files:**

- Create: `apps/functions/src/members/member-pdf-import.ts`
- Test: `apps/functions/src/members/member-pdf-import.test.ts`
- Modify: `apps/functions/package.json`, `pnpm-lock.yaml`

**Interfaces:**

```ts
export type ParsedMemberRow = Readonly<{
  sourceReport: MemberReportKey;
  sourceRowNumber: number;
  membershipNumber?: string;
  fullName: string;
  idCardNumber?: string;
  birthDate?: string;
  vatNumber?: string;
  mobileNumber?: string;
  inactiveAt?: string;
  membershipStatus?: "active" | "inactive" | "suspended";
  paymentStatus?: "regularized";
}>;

export type ParsedMemberReport = Readonly<{
  report: MemberReportKey;
  declaredCount: number;
  rows: readonly ParsedMemberRow[];
  sourceHash: string;
}>;

export function identifyMemberReport(text: string): MemberReportKey;
export function parseMemberReport(text: string): ParsedMemberReport;
export function deduplicateMemberRows(
  reports: readonly ParsedMemberReport[],
): Readonly<{ rows: readonly ParsedMemberRow[]; duplicates: readonly ImportDuplicate[] }>;
```

- [ ] **Step 1: Write failing parser tests with synthetic fixtures.** Include English and Portuguese headings, all eight report keys, repeated page headers/footers, rows with and without membership numbers, `Inactive` extra column, `DD Mon YYYY` dates, HTML phone entities, malformed dates, unknown headings, and contradictory duplicate rows. Fixtures must contain synthetic names such as `Synthetic Member One`, never real PDF values.
- [ ] **Step 2: Run the focused parser test and verify the expected missing-module/layout failures.**

Run: `corepack pnpm exec vitest run apps/functions/src/members/member-pdf-import.test.ts`

Expected: FAIL because the parser module and dependency-backed extraction boundary do not yet exist.

- [ ] **Step 3: Add the pinned `pdf-parse` dependency and implement title/header/footer detection.** Normalize accents/case for matching only, preserve approved field values, reject unknown titles or incompatible headers, ignore repeated page furniture, and validate declared count against parsed row count.
- [ ] **Step 4: Implement row extraction and normalization.** Parse the six common columns plus `Data inativo`; treat absent values as `undefined`; normalize dates with a fixed English month map; decode numeric and named HTML entities without executing markup; remove control characters; derive status/payment signals from the report key.
- [ ] **Step 5: Implement deterministic deduplication.** Prefer normalized membership number, otherwise normalized email when available, otherwise a source-row fingerprint; merge non-empty fields only. Emit a duplicate record for exact compatible repeats and a conflict marker for contradictory values.
- [ ] **Step 6: Run parser tests and Functions typecheck.**

Run: `corepack pnpm exec vitest run apps/functions/src/members/member-pdf-import.test.ts && corepack pnpm --filter @bpt-jersey/functions typecheck`

Expected: all synthetic parser tests pass and typecheck exits 0.

---

## Task 2: Add Preview Classification And Persistence

**Files:**

- Modify: `apps/functions/src/members/member-callables.ts`
- Modify: `apps/functions/src/members/member-callables.test.ts`
- Modify: `apps/functions/src/members/member-service.ts`
- Create or modify: `apps/functions/src/members/member-import-storage.ts` and test
- Modify: `packages/domain/src/members/member-contracts.ts` only for an exact preview-safe contract extension

**Interfaces:**

```ts
export type MemberImportPreviewStore = Readonly<{
  save: (preview: MemberImportPreviewRecord) => Promise<void>;
  get: (previewId: string) => Promise<MemberImportPreviewRecord | undefined>;
  remove: (previewId: string) => Promise<void>;
}>;

export type MemberImportPreviewRecord = Readonly<{
  previewId: string;
  sessionId: string;
  academyId: string;
  actorId: string;
  expiresAt: string;
  sourceHash: string;
  reportKeys: readonly MemberReportKey[];
  preview: MemberImportPreview;
  status: "pending" | "confirmed" | "expired";
}>;
```

- [ ] **Step 1: Write failing callable tests.** Cover same-tenant admin preview, cross-tenant rejection, invalid PDF bytes, unknown layout, no member writes during preview, persistence of opaque preview metadata, and cleanup of preview records.
- [ ] **Step 2: Run the focused callable tests and confirm they fail for the missing parser/store behavior.**

Run: `corepack pnpm exec vitest run apps/functions/src/members/member-callables.test.ts`

Expected: FAIL in the new preview assertions while existing session/cleanup tests remain green.

- [ ] **Step 3: Add the injected preview store and Firestore adapter.** Validate every stored field, tenant, actor, ISO expiry, allowlisted report keys, and preview shape. Never persist raw extracted text or row values beyond the approved preview contract.
- [ ] **Step 4: Replace the empty preview implementation.** For every session object, verify PDF signature, parse text with the pinned parser, combine/deduplicate reports, load bounded canonical members through `memberService`, and classify additions/updates/duplicates/conflicts. Rows without identifiers become additions; duplicate/contradictory identifiers become conflicts.
- [ ] **Step 5: Make preview expiration and cleanup idempotent.** Save the preview only after all files parse and classification succeeds; remove/expire prior preview state on re-preview; ensure failed parsing does not create a usable preview.
- [ ] **Step 6: Run focused callable, parser, R2, and type tests.**

Run: `corepack pnpm exec vitest run apps/functions/src/members/member-pdf-import.test.ts apps/functions/src/members/member-callables.test.ts apps/functions/src/storage/r2-client.test.ts && corepack pnpm --filter @bpt-jersey/functions typecheck`

Expected: all tests pass with no member writes during preview.

---

## Task 3: Implement Confirmed Member Writes

**Files:**

- Modify: `apps/functions/src/members/member-service.ts`
- Modify: `apps/functions/src/members/member-callables.ts`
- Modify: `apps/functions/src/members/member-callables.test.ts`
- Modify: `firestore.rules` only if the existing deny boundary needs the new backend-owned collection explicitly documented

**Interfaces:**

```ts
export type MemberImportWriteResult = Readonly<{
  imported: number;
  updated: number;
  conflicts: number;
}>;

export type MemberService = Readonly<{
  // existing methods remain unchanged
  applyImportPreview: (
    input: Readonly<{
      academyId: string;
      actorId: string;
      preview: MemberImportPreview;
      now: string;
      createId: () => string;
    }>,
  ) => Promise<MemberImportWriteResult>;
}>;
```

- [ ] **Step 1: Write failing confirmation tests.** Assert conflicts reject with `failed-precondition`, missing/forged preview rejects, empty fields preserve stored values, new rows without identifiers receive server IDs, matching rows update only non-empty approved fields, and repeated confirmation cannot duplicate writes.
- [ ] **Step 2: Run the focused confirmation tests and verify failure.**

Run: `corepack pnpm exec vitest run apps/functions/src/members/member-callables.test.ts`

Expected: FAIL because the preview is not yet applied to canonical members.

- [ ] **Step 3: Implement bounded canonical lookup and atomic application.** Resolve identifiers inside the academy tenant, reject ambiguous matches, validate all changes before the first write, then use Firestore transactions/batches with deterministic import operation IDs for idempotency. Preserve existing values for undefined fields and derive server-owned timestamps/actor fields.
- [ ] **Step 4: Add sanitized audit summary and preview state transition.** Record counts/report keys/hash/actor/time only; mark the preview confirmed only after all writes succeed. A retry returns the original result and does not write again.
- [ ] **Step 5: Run confirmation, parser, integration, and Functions tests.**

Run: `corepack pnpm exec vitest run apps/functions/src/members/member-pdf-import.test.ts apps/functions/src/members/member-callables.test.ts && corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore "node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts"`

Expected: all unit tests and Firestore adapter/integration tests pass; conflict previews produce zero writes.

---

## Task 4: Add Upload Client And Import Page

**Files:**

- Create: `apps/web/src/lib/member-import-client.ts`
- Test: `apps/web/src/lib/member-import-client.test.ts`
- Create: `apps/web/src/app/admin/members/import/page.tsx`
- Test: `apps/web/src/app/admin/members/import/page.test.tsx`
- Modify: `apps/web/src/app/admin/admin-shell.tsx`
- Modify: `apps/web/src/lib/members-client.ts` only if shared response guards are reused

**Interfaces:**

```ts
export type MemberImportFile = Readonly<{
  fileName: string;
  contentType: "application/pdf";
  sizeBytes: number;
  file: File;
}>;

export function validateMemberImportFiles(files: readonly File[]): readonly MemberImportFile[];
export function createMemberImportSession(
  files: readonly MemberImportFile[],
): Promise<MemberImportSessionResponse>;
export function previewMemberImport(sessionId: string): Promise<MemberImportPreview>;
export function confirmMemberImport(
  sessionId: string,
  previewId: string,
): Promise<MemberImportWriteResult>;
```

- [ ] **Step 1: Write failing client/page tests.** Cover exact session payloads, five-file/10 MiB validation, upload to only returned HTTPS URLs, all loading/error states, preview summary, conflict blocking, explicit confirmation, success summary, responsive landmarks, and no confirm call before the user action.
- [ ] **Step 2: Run focused web tests and verify failure.**

Run: `corepack pnpm exec vitest run apps/web/src/lib/member-import-client.test.ts apps/web/src/app/admin/members/import/page.test.tsx`

Expected: FAIL because the import client and route do not exist.

- [ ] **Step 3: Implement the client boundary.** Validate exact response shapes, allow only HTTPS upload URLs from Functions, send only `{ sessionId }` for preview and `{ sessionId, previewId, confirm: true }` for confirmation, and sanitize all callable errors.
- [ ] **Step 4: Implement the page.** Match the existing admin language, add accessible file input and status regions, upload multiple files with progress, render counts/conflicts, disable confirmation under invalid states, and show the server result after confirmation.
- [ ] **Step 5: Link the route without legacy placeholders.** Add only `/admin/members/import` to the existing Members navigation structure and derive `aria-current` from the current pathname.
- [ ] **Step 6: Run focused web tests and web typecheck.**

Run: `corepack pnpm exec vitest run apps/web/src/lib/member-import-client.test.ts apps/web/src/app/admin/members/import/page.test.tsx && corepack pnpm --filter @bpt-jersey/web typecheck`

Expected: all tests pass and typecheck exits 0.

---

## Task 5: Full Verification And Review Package

**Files:**

- Modify: `tasks.md`
- Modify: `.superpowers/sdd/2026-08-11-members-and-reports/task-4-report.md` only if shared Task 4 evidence must be corrected

- [ ] **Step 1: Run the full unit suite.**

Run: `corepack pnpm test`

Expected: zero failures.

- [ ] **Step 2: Run typecheck, lint, format, and builds.**

Run: `corepack pnpm typecheck; corepack pnpm lint; corepack pnpm format:check; corepack pnpm build`

Expected: every command exits 0.

- [ ] **Step 3: Run local Firestore integration and QA smoke sequentially.**

Run: `corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore "node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts"` and then build with `NEXT_PUBLIC_ADMIN_E2E=true` before `corepack pnpm --dir qa test:e2e:smoke`.

Expected: integration passes with synthetic data only; browser smoke passes desktop/mobile without console errors or overflow.

- [ ] **Step 4: Run security and diff checks.**

Run: `corepack pnpm audit --audit-level high` and `git diff --check`.

Expected: no high/critical vulnerabilities and no whitespace errors; document existing moderate advisories without hiding them.

- [ ] **Step 5: Review the changed files against the approved spec.** Confirm real PDFs are absent from Git, preview performs no writes, conflicts block confirmation, and no logs contain PII or raw PDF text. Leave the task in `revisión` until independently reviewed.
