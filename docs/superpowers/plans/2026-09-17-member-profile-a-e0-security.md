# Member profile Plan A: E0 security fix (Regyfit password removal and masked identifiers) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop serving the imported Regyfit app password anywhere, and serve `idCardNumber`,
`healthNumber` and `vatNumber` masked, with a purpose-bound, rate-limited, audited
`revealRegyfitRecordField` callable behind a "Reveal" text button.

**Architecture:** The domain contract drops `appAccess.password` and gains a stored-document parser
that strips the legacy key before the strict parse, a pure masking function and the reveal
input/output schemas. `getRegyfitMemberRecord` returns the masked record. The reveal is one more
method on the existing `CanonicalMemberDirectoryReadService`, so it reuses `runRestricted` as is:
provisioned-actor check, the per-actor `studentRestrictedReadLimits` budget (20 reads / 5 min) and a
restricted audit event, with a new audit action `regyfit.record.field.read`. The callable lives in
`member-directory-callables.ts` next to `getMemberDetail`. The web panel loses the Password row and
gets a Reveal button per masked field. Purging the passwords already stored in production is a
script plus an operator-gated runbook step; nothing in the automated tasks touches production.

**Tech Stack:** TypeScript strict, zod 4, Firebase Functions v2 `onCall`, Vitest (`node` + `web`
projects), React 19 / Next.js 16 static export, Node 22 ESM script with `firebase-admin`.

**Spec:** `docs/superpowers/specs/2026-09-17-member-profile-e0-e2-design.md` §4 (E0), §2 decision 4,
§7 cross-cutting, §8 risk "Existing passwords in production".

## Global Constraints

- CLAUDE.md layering: contracts in `packages/domain`, pure logic in the functions service, callable
  wrapper in `*-callables.ts` exported from `apps/functions/src/index.ts`, web client in
  `apps/web/src/lib/*-client.ts`. `packages/domain` never imports Firebase. This plan adds no new
  domain module: everything goes into the existing `./members/regyfit-records` and `./audit`
  subpath exports, so `packages/domain/package.json` does not change.
- Commands always from the repo root via `corepack pnpm`. Node `>=22.13 <25`.
- DESIGN.md binding rules that apply here: tokens purple `#2F2483`, canvas `#F2F1ED`, ink
  `#1A1A18`, muted `#65635D`, line `#8A8880`, Purple Wash `#F0EFFF`/`#D9D6FF`; square corners; status
  as text + coloured left border, never a pill (do not add new badges); Barlow Condensed display /
  Source Sans 3 body; tabular numbers for identifiers; ≥44px targets and 3px purple focus outline
  (reuse `.regyfit-filter-button`, `apps/web/src/app/admin/admin.css:1282-1311`, min-height 2.75rem);
  no icon-only buttons, the button text is the word "Reveal"; no emojis; UK English copy; one column
  below 50rem, no horizontal scroll (the reveal wrapper wraps). Reuse existing admin CSS; add at most
  one small rule.
- Frontend security: no `dangerouslySetInnerHTML`; zod-parse every callable response; safe
  user-facing error strings only (never raw Firebase errors); validate the input with the domain
  schema before calling; a revealed value lives only in React component state — never in URLs,
  `console`, logs, analytics, `localStorage`/`sessionStorage`; no new origins.
- Backend security: App Check (`enforceAppCheck: true` via `memberDirectoryCallableOptions`), existing
  role helpers (`requireCanonicalMemberDirectoryActor` → owner/administrator + active provisioning),
  academy scope from the verified claim only, strict zod input, restricted read audited and counted,
  Firestore rules stay deny-direct (`firestore.rules:9-11` already denies
  `regyfitMemberRecords`; no rules change). An existence check is not a functioning check: each new
  guard has a test that fails when the guard is removed (Task 4 Step 6 proves it for the audit).
- Audit never repeats the Confidential value: the reveal audit event targets the reader's rate-limit
  document, exactly like the existing restricted reads (`packages/domain/src/audit/audit-event.ts:270-279`).
- Ponytail: smallest diff, reuse before create, no new dependencies, no speculative abstractions; mark
  deliberate simplifications with `// ponytail:` comments naming the ceiling.
- No production deploy, destructive migration or production write without the operator's explicit OK
  in chat. Task 8 is an **operator gate**: it is a runbook, never executed by an agent.
- Commits: one per task, message ends with the `(T051V2)` tag in the subject and the trailer
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Never run prettier on `tasksv2.md`.

## Interfaces (shared names this plan introduces)

Domain `@bpt-jersey/domain/members/regyfit-records`
(`packages/domain/src/members/regyfit-member-record-contracts.ts`):

- `regyfitAppAccessSchema` = strict `{ login?, logins?, lastLogin? }` (no `password`).
- `parseStoredRegyfitMemberRecord(value: unknown): Result<RegyfitMemberRecord, readonly ValidationIssue[]>`
  — drops top-level `academyId` and `appAccess.password`, then strict parse.
- `regyfitRevealableFields = ["idCardNumber", "healthNumber", "vatNumber"]`, type `RegyfitRevealableField`.
- `regyfitRecordRevealPurposes = ["regyfit-record-review"]`, type `RegyfitRecordRevealPurpose`.
- `revealRegyfitRecordFieldInputSchema` = strict `{ recordId, field, purpose }`, type `RevealRegyfitRecordFieldInput`.
- `revealRegyfitRecordFieldResultSchema` = strict `{ value: string }`, type `RevealRegyfitRecordFieldResult`.
- `maskRegyfitRestrictedValue(value: string): string` — `"•••"` + last 3 characters; `"•••"` alone
  when the value has 3 characters or fewer.
- `maskRegyfitMemberRecord(record: RegyfitMemberRecord): RegyfitMemberRecord`.

Domain `@bpt-jersey/domain/audit`: new restricted read action `"regyfit.record.field.read"`, purpose
`"regyfit-record-review"`, results `completed | not-found | unavailable | rate-limited`.

Functions: `CanonicalMemberDirectoryReadService.regyfitRecordFieldReveal(command)`,
`revealRegyfitRecordFieldHandler(request, services)`, callable `revealRegyfitRecordField`.

Web: `revealRegyfitRecordField(recordId: string, field: RegyfitRevealableField): Promise<string>` in
`apps/web/src/lib/members-client.ts`.

Script: `qa/scripts/purge-regyfit-record-passwords.mjs` exporting `hasStoredPassword(data)`,
`resolvePurgeTarget(env)`, `productionConfirmation`.

## File Structure

| File                                                                         | Change | Responsibility                                        |
| ---------------------------------------------------------------------------- | ------ | ----------------------------------------------------- |
| `packages/domain/src/members/regyfit-member-record-contracts.ts`             | Modify | Drop password, stored parser, masking, reveal schemas |
| `packages/domain/src/members/regyfit-member-record-contracts.test.ts`        | Modify | Contract tests                                        |
| `packages/domain/src/audit/audit-event.ts`                                   | Modify | New restricted read action                            |
| `packages/domain/src/audit/audit-event.test.ts`                              | Modify | Accept/reject the new evidence                        |
| `packages/domain/src/contracts.test.ts`                                      | Modify | Exact action list                                     |
| `apps/functions/src/audit/audit-writer.ts`                                   | Modify | Stored result for the new restricted action           |
| `apps/functions/src/regyfit/member-records.ts`                               | Modify | Strip on read, mask on output                         |
| `apps/functions/src/regyfit/member-records.test.ts`                          | Modify | Strip + mask tests                                    |
| `qa/scripts/import-regyfit-member-records.mjs`                               | Modify | Never write `password`                                |
| `apps/functions/src/members/canonical-member-directory-read-service.ts`      | Modify | `regyfitRecordFieldReveal`                            |
| `apps/functions/src/members/canonical-member-directory-read-service.test.ts` | Modify | Reveal audit/budget/not-found tests                   |
| `apps/functions/src/members/member-directory-callables.ts`                   | Modify | Handler + `onCall`                                    |
| `apps/functions/src/members/member-directory-callables.test.ts`              | Modify | Handler tests                                         |
| `apps/functions/src/index.ts`                                                | Modify | Export callable                                       |
| `apps/web/src/lib/members-client.ts`                                         | Modify | `revealRegyfitRecordField`                            |
| `apps/web/src/lib/members-client.test.ts`                                    | Modify | Client tests                                          |
| `apps/web/src/app/admin/members/search/member-profile-panel.tsx`             | Modify | Remove Password row, Reveal button                    |
| `apps/web/src/app/admin/members/search/page.test.tsx`                        | Modify | Panel tests                                           |
| `apps/web/src/app/admin/admin.css`                                           | Modify | One wrapper rule                                      |
| `qa/scripts/purge-regyfit-record-passwords.mjs` (+ `.d.mts`)                 | Create | Dry-run count / gated purge                           |
| `qa/unit/regyfit-password-purge.test.ts`                                     | Create | Script guard tests                                    |

---

### Task 1: Domain — drop `password`, strip it from stored documents, masking and reveal schemas

**Files:**

- Modify: `packages/domain/src/members/regyfit-member-record-contracts.ts:63-68` (schema), append after `:220`
- Test: `packages/domain/src/members/regyfit-member-record-contracts.test.ts`

**Interfaces:**

- Consumes: existing `parseRegyfitMemberRecord`, `canonicalText`, `recordIdPattern`, `isPlainData`, `err`.
- Produces: `parseStoredRegyfitMemberRecord`, `regyfitRevealableFields`, `RegyfitRevealableField`,
  `regyfitRecordRevealPurposes`, `RegyfitRecordRevealPurpose`, `revealRegyfitRecordFieldInputSchema`,
  `RevealRegyfitRecordFieldInput`, `revealRegyfitRecordFieldResultSchema`,
  `RevealRegyfitRecordFieldResult`, `maskRegyfitRestrictedValue`, `maskRegyfitMemberRecord`.

- [ ] **Step 1: Write the failing tests**

In `regyfit-member-record-contracts.test.ts`, change the fixture line 23 to
`appAccess: { login: "a1", logins: 0 },` and add `idCardNumber: "ID-000789",` and
`vatNumber: "VAT12",` after `country: "Jersey",`. Extend the import:

```ts
import {
  maskRegyfitMemberRecord,
  maskRegyfitRestrictedValue,
  parseRegyfitMemberDirectoryPage,
  parseRegyfitMemberRecord,
  parseStoredRegyfitMemberRecord,
  revealRegyfitRecordFieldInputSchema,
  revealRegyfitRecordFieldResultSchema,
  toRegyfitMemberDirectoryRow,
  type RegyfitMemberRecord,
} from "./regyfit-member-record-contracts";
```

Append inside the `describe`:

```ts
it("rejects an app password in a record", () => {
  const result = parseRegyfitMemberRecord({
    ...record,
    appAccess: { ...record.appAccess, password: "104569" },
  });

  expect(result.ok).toBe(false);
});

it("strips academyId and a legacy stored password before the strict parse", () => {
  const result = parseStoredRegyfitMemberRecord({
    ...record,
    academyId: "academy-1",
    appAccess: { ...record.appAccess, password: "104569" },
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toEqual(record);
    expect(JSON.stringify(result.value)).not.toContain("104569");
  }
  expect(parseStoredRegyfitMemberRecord({ ...record, extra: true }).ok).toBe(false);
  expect(parseStoredRegyfitMemberRecord(null).ok).toBe(false);
  expect(parseStoredRegyfitMemberRecord([record]).ok).toBe(false);
});

it("masks restricted identifiers to their last three characters", () => {
  expect(maskRegyfitRestrictedValue("ID-000789")).toBe("•••789");
  expect(maskRegyfitRestrictedValue("abc")).toBe("•••");
  expect(maskRegyfitRestrictedValue("a")).toBe("•••");

  const masked = maskRegyfitMemberRecord({ ...record, healthNumber: "HN-4455" });

  expect(masked.idCardNumber).toBe("•••789");
  expect(masked.vatNumber).toBe("•••T12");
  expect(masked.healthNumber).toBe("•••455");
  expect(masked.fullName).toBe(record.fullName);
  expect(JSON.stringify(masked)).not.toContain("ID-000789");
  expect(parseRegyfitMemberRecord(masked).ok).toBe(true);
  expect(maskRegyfitMemberRecord({ ...record, idCardNumber: undefined })).not.toHaveProperty(
    "idCardNumber",
    expect.anything(),
  );
});

it("binds a reveal to one record, one closed field and one closed purpose", () => {
  const input = { recordId: "152", field: "idCardNumber", purpose: "regyfit-record-review" };

  expect(revealRegyfitRecordFieldInputSchema.safeParse(input).success).toBe(true);
  for (const candidate of [
    { ...input, field: "password" },
    { ...input, field: "email" },
    { ...input, purpose: "curiosity" },
    { ...input, recordId: "../152" },
    { ...input, extra: true },
    { recordId: "152", field: "idCardNumber" },
  ]) {
    expect(revealRegyfitRecordFieldInputSchema.safeParse(candidate).success).toBe(false);
  }
  expect(revealRegyfitRecordFieldResultSchema.safeParse({ value: "ID-000789" }).success).toBe(true);
  expect(
    revealRegyfitRecordFieldResultSchema.safeParse({ value: "ID-000789", recordId: "152" }).success,
  ).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run --project node packages/domain/src/members/regyfit-member-record-contracts.test.ts`
Expected: FAIL — `parseStoredRegyfitMemberRecord` / `maskRegyfitMemberRecord` are not exported, and
"rejects an app password in a record" fails because `password` is still accepted.

- [ ] **Step 3: Implement**

Replace lines 63-68 with:

```ts
// The Regyfit app password is never stored or served (spec 2026-09-17 §4, decision 4).
export const regyfitAppAccessSchema = z.strictObject({
  login: canonicalText(64).optional(),
  logins: countSchema.optional(),
  lastLogin: canonicalText(64).optional(),
});
```

Append at the end of the file:

```ts
export const regyfitRevealableFields = Object.freeze([
  "idCardNumber",
  "healthNumber",
  "vatNumber",
] as const);
export type RegyfitRevealableField = (typeof regyfitRevealableFields)[number];

// ponytail: one purpose today; a second purpose also needs adding to the audit allowlist.
export const regyfitRecordRevealPurposes = Object.freeze(["regyfit-record-review"] as const);
export type RegyfitRecordRevealPurpose = (typeof regyfitRecordRevealPurposes)[number];

export const revealRegyfitRecordFieldInputSchema = z.strictObject({
  recordId: z.string().regex(recordIdPattern),
  field: z.enum(regyfitRevealableFields),
  purpose: z.enum(regyfitRecordRevealPurposes),
});
export type RevealRegyfitRecordFieldInput = Readonly<
  z.infer<typeof revealRegyfitRecordFieldInputSchema>
>;

export const revealRegyfitRecordFieldResultSchema = z.strictObject({
  value: canonicalText(64),
});
export type RevealRegyfitRecordFieldResult = Readonly<
  z.infer<typeof revealRegyfitRecordFieldResultSchema>
>;

const maskPrefix = "•••";

export function maskRegyfitRestrictedValue(value: string): string {
  return value.length <= 3 ? maskPrefix : `${maskPrefix}${value.slice(-3)}`;
}

export function maskRegyfitMemberRecord(record: RegyfitMemberRecord): RegyfitMemberRecord {
  const masked: Record<string, unknown> = { ...record };
  for (const field of regyfitRevealableFields) {
    const value = record[field];
    if (value !== undefined) masked[field] = maskRegyfitRestrictedValue(value);
  }
  return Object.freeze(masked) as RegyfitMemberRecord;
}

function withoutKey(value: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([entry]) => entry !== key));
}

/**
 * A Firestore document carries `academyId`, and records imported before 2026-09-17 still carry
 * `appAccess.password` until the production purge runs. Both are dropped here, explicitly, so the
 * strict schema keeps rejecting anything else instead of failing the whole panel.
 */
export function parseStoredRegyfitMemberRecord(
  value: unknown,
): Result<RegyfitMemberRecord, readonly ValidationIssue[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return err(Object.freeze([{ path: Object.freeze([]), code: "invalid_plain_data" }]));
  }
  const record = withoutKey(value as Record<string, unknown>, "academyId");
  const access = record.appAccess;
  if (typeof access === "object" && access !== null && !Array.isArray(access)) {
    record.appAccess = withoutKey(access as Record<string, unknown>, "password");
  }
  return parseRegyfitMemberRecord(record);
}
```

(`parseRegyfitMemberRecord` still runs `isPlainData`, so a non-plain prototype is rejected there.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm vitest run --project node packages/domain/src/members/regyfit-member-record-contracts.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/members/regyfit-member-record-contracts.ts packages/domain/src/members/regyfit-member-record-contracts.test.ts
git commit -m "feat(domain): drop Regyfit app password, mask restricted identifiers, reveal contract (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

(Functions/web typecheck is red until Tasks 3 and 7 update their fixtures; that is expected between
tasks. Do not run the full `typecheck` here.)

---

### Task 2: Audit — restricted read action `regyfit.record.field.read`

**Files:**

- Modify: `packages/domain/src/audit/audit-event.ts:76-78` (action list), `:115-128` (variant), `:274-279`
  (purposes), `:344-345` (fields), `:547-551` (validator), `:918-926` (result branch)
- Modify: `apps/functions/src/audit/audit-writer.ts:44-53`
- Test: `packages/domain/src/audit/audit-event.test.ts`, `packages/domain/src/contracts.test.ts:250-251`

**Interfaces:**

- Consumes: `memberDetailReadAuditResults`, `MemberDetailReadAuditResult`, `restrictedMemberReadFields`.
- Produces: audit action `"regyfit.record.field.read"` accepted by `parseAuditEventDraft` only with
  purpose `"regyfit-record-review"`, target `academies/{academyId}/studentRestrictedReadLimits/{actorId}`
  and a result in `completed | not-found | unavailable | rate-limited`; stored with its own result.

- [ ] **Step 1: Write the failing tests**

In `audit-event.test.ts`, append a third entry to `restrictedMemberReadDrafts` (before `] as const;`):

```ts
  {
    ...common,
    action: "regyfit.record.field.read",
    targetRef: "academies/academy-1/studentRestrictedReadLimits/admin-1",
    purpose: "regyfit-record-review",
    correlationId: "restricted-audit-reveal-1",
    result: "not-found",
  },
```

In the test "rejects non-minimal or incorrectly scoped restricted member read evidence", change the
destructuring to `const [detail, lookup, reveal] = restrictedMemberReadDrafts;` and add to the
candidate list:

```ts
      { ...reveal, purpose: "member-record-maintenance" },
      { ...reveal, result: "no-match" },
      { ...reveal, targetRef: "academies/academy-1/regyfitMemberRecords/152" },
      { ...reveal, field: "idCardNumber" },
      { ...reveal, value: "ID-000789" },
```

In `packages/domain/src/contracts.test.ts`, after `"member.directory.initialized",` (line 251) add
`"regyfit.record.field.read",`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run --project node packages/domain/src/audit/audit-event.test.ts packages/domain/src/contracts.test.ts`
Expected: FAIL — the reveal draft is rejected (unknown action) and the action list differs.

- [ ] **Step 3: Implement**

`audit-event.ts`:

1. Action list: after `"member.directory.initialized",` (line 77) add `"regyfit.record.field.read",`.
2. Variant union (after the `enrolment.request.detail.read` member, line 127):

```ts
  | Readonly<{
      action: "regyfit.record.field.read";
      result: MemberDetailReadAuditResult;
    }>;
```

(move the terminating `;` from the previous member to this one). 3. `restrictedReadPurposes`: add `"regyfit.record.field.read": "regyfit-record-review",`. 4. `fieldsByAction`: after `"enrolment.request.detail.read": restrictedMemberReadFields,` add
`"regyfit.record.field.read": restrictedMemberReadFields,`. 5. Validator condition (line 547-551): add `|| parsedAction === "regyfit.record.field.read"` to the
`if` (the existing `allowedResults` ternary already falls back to `memberDetailReadAuditResults`). 6. Result branch: after the `enrolment.request.detail.read` block (line 926) add

```ts
if (parsedAction === "regyfit.record.field.read") {
  return ok(
    Object.freeze({
      ...base,
      action: parsedAction,
      result: snapshot.result as MemberDetailReadAuditResult,
    }),
  );
}
```

`apps/functions/src/audit/audit-writer.ts` `storedResult`: add
`|| draft.action === "regyfit.record.field.read"` to the condition, so a not-found reveal is not
stored as "completed" (the comment at lines 39-43 explains why that would be false evidence).

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm vitest run --project node packages/domain/src/audit/audit-event.test.ts packages/domain/src/contracts.test.ts apps/functions/src/audit/audit-writer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/audit/audit-event.ts packages/domain/src/audit/audit-event.test.ts packages/domain/src/contracts.test.ts apps/functions/src/audit/audit-writer.ts
git commit -m "feat(audit): restricted read action for Regyfit record field reveal (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Functions — strip on read, mask on output; importer never writes `password`

**Files:**

- Modify: `apps/functions/src/regyfit/member-records.ts:5-10` (imports), `:53-70` (`parseStoredRecord`), `:117-121` (return)
- Modify: `qa/scripts/import-regyfit-member-records.mjs:20`, `:75`
- Test: `apps/functions/src/regyfit/member-records.test.ts`

**Interfaces:**

- Consumes: `parseStoredRegyfitMemberRecord`, `maskRegyfitMemberRecord` (Task 1).
- Produces: `getRegyfitMemberRecord` output = masked `RegyfitMemberRecord` without `password`;
  `listRegyfitMemberRecords` keeps working over stored documents that still carry `password`.

- [ ] **Step 1: Write the failing tests**

In `member-records.test.ts`:

- Fixture line 23 becomes `appAccess: { login: "a1", logins: 0 },` and add
  `idCardNumber: "ID-000789",` and `healthNumber: "HN-4455",` after `birthDate: "2019-06-12",`.
- Add a helper after `record()`:

```ts
function storedWithLegacyPassword(overrides: Partial<RegyfitMemberRecord> = {}) {
  const base = record(overrides);
  return { ...base, appAccess: { ...base.appAccess, password: "104569" } };
}
```

- Replace the test "returns the full record for the actor's academy only" with:

```ts
it("returns the record masked and without the legacy password, for the actor's academy only", async () => {
  const { services, paths } = servicesFor([storedWithLegacyPassword()]);

  const result = await getRegyfitMemberRecordHandler(
    request("owner", { recordId: "152" }),
    services,
  );

  expect(result).toEqual({
    ...record({}),
    idCardNumber: "•••789",
    healthNumber: "•••455",
  });
  expect(result.appAccess).toEqual({ login: "a1", logins: 0 });
  expect(JSON.stringify(result)).not.toContain("104569");
  expect(JSON.stringify(result)).not.toContain("ID-000789");
  expect(JSON.stringify(result)).not.toContain("HN-4455");
  expect(result).not.toHaveProperty("academyId");
  expect(paths).toEqual([`academies/${academyId}/regyfitMemberRecords/152`]);
  await expect(
    getRegyfitMemberRecordHandler(request("owner", { recordId: "152" }, "other"), services),
  ).rejects.toMatchObject({ code: "not-found" });
});

it("still lists directories whose stored records carry a legacy password", async () => {
  const { services } = servicesFor([storedWithLegacyPassword()]);

  const page = await listRegyfitMemberRecordsHandler(request("administrator"), services);

  expect(page.total).toBe(1);
  expect(JSON.stringify(page)).not.toContain("104569");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run --project node apps/functions/src/regyfit/member-records.test.ts`
Expected: FAIL — stored documents with `password` throw `internal` ("A stored Regyfit member record
is invalid") and the returned identifiers are unmasked.

- [ ] **Step 3: Implement**

`member-records.ts` imports:

```ts
import {
  maskRegyfitMemberRecord,
  parseStoredRegyfitMemberRecord,
  toRegyfitMemberDirectoryRow,
  type RegyfitMemberDirectoryPage,
  type RegyfitMemberRecord,
} from "@bpt-jersey/domain/members/regyfit-records";
```

Replace `parseStoredRecord` (lines 53-70) with:

```ts
function parseStoredRecord(value: unknown): RegyfitMemberRecord {
  const parsed = parseStoredRegyfitMemberRecord(value);
  if (!parsed.ok) {
    throw new HttpsError("internal", "A stored Regyfit member record is invalid");
  }
  return parsed.value;
}
```

In `getRegyfitMemberRecordHandler` replace `return record;` (line 121) with
`return maskRegyfitMemberRecord(record);`.

`qa/scripts/import-regyfit-member-records.mjs`: line 20 imports `parseStoredRegyfitMemberRecord`
instead of `parseRegyfitMemberRecord`, and line 75 becomes
`const result = parseStoredRegyfitMemberRecord(candidate);`. Add above line 75:

```js
// Drops a captured appAccess.password: the importer never writes it (spec 2026-09-17 §4).
```

Because the importer writes with `batch.set` (full replace), a record it writes never carries
`password`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm vitest run --project node apps/functions/src/regyfit/member-records.test.ts`
Expected: PASS.

Run: `corepack pnpm --filter @bpt-jersey/domain build:runtime && node -e "import('./packages/domain/lib/members/regyfit-member-record-contracts.js').then(m => { const r = m.parseStoredRegyfitMemberRecord({recordId:'1',fullName:'A',gender:'unknown',membershipState:'active',appAccess:{password:'x'},graduation:{},plan:{},attendance:{records:[]},payments:[],capturedAt:'2026-09-04T18:04:32.000Z',source:'regyfit-admin-capture',schemaVersion:'1'}); console.log(r.ok, JSON.stringify(r.value.appAccess)); })"`
Expected output: `true {}`

Run: `grep -n "password" qa/scripts/import-regyfit-member-records.mjs`
Expected: only the comment line.

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/regyfit/member-records.ts apps/functions/src/regyfit/member-records.test.ts qa/scripts/import-regyfit-member-records.mjs
git commit -m "fix(regyfit): never serve or import the app password, mask restricted identifiers (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Functions — `regyfitRecordFieldReveal` on the restricted read service

**Files:**

- Modify: `apps/functions/src/members/canonical-member-directory-read-service.ts` — imports (after line 29),
  service type (after line 86), `RestrictedAction`/`RestrictedPurpose` (lines 163-166), path helper
  (after line 292), new method (before the final `});` at line 1008)
- Modify: `apps/functions/src/members/member-directory-callables.test.ts:74` (typed reader mock)
- Test: `apps/functions/src/members/canonical-member-directory-read-service.test.ts` (append)

**Interfaces:**

- Consumes: `revealRegyfitRecordFieldInputSchema`, `parseStoredRegyfitMemberRecord`,
  `RevealRegyfitRecordFieldResult` (Task 1); audit action `regyfit.record.field.read` (Task 2);
  private `runRestricted`, `parseInput`, `requireAuthorizedActor`, `requiredTimestamp`, `DirectoryDataIssue`.
- Produces: `regyfitRecordFieldReveal: (command: DirectoryReadCommand) => Promise<RevealRegyfitRecordFieldResult>`;
  throws `CanonicalMemberDirectoryReadError` with `unauthorized | invalid | not-found | unavailable | rate-limited`.

- [ ] **Step 1: Write the failing tests**

Append to `canonical-member-directory-read-service.test.ts`:

```ts
describe("Regyfit record field reveal", () => {
  const recordPath = "academies/academy-1/regyfitMemberRecords/152";
  const command = Object.freeze({
    actor: actor(),
    value: { recordId: "152", field: "idCardNumber", purpose: "regyfit-record-review" },
    now,
  });

  function storedRecord(overrides: Readonly<Record<string, unknown>> = {}) {
    return {
      recordId: "152",
      fullName: "Synthetic Child",
      idCardNumber: "ID-000789",
      gender: "unknown",
      membershipState: "inactive",
      appAccess: { login: "a1", password: "104569" },
      graduation: {},
      plan: {},
      attendance: { records: [] },
      payments: [],
      capturedAt: "2026-09-04T18:04:32.000Z",
      source: "regyfit-admin-capture",
      schemaVersion: "1",
      academyId: "academy-1",
      ...overrides,
    };
  }

  it("returns exactly the one requested value", async () => {
    const harness = fakeStore({ ...seed(), [recordPath]: storedRecord() });

    const result = await service(harness.store).regyfitRecordFieldReveal(command);

    expect(result).toEqual({ value: "ID-000789" });
  });

  it("audits the reveal and spends it from the shared restricted read budget", async () => {
    const harness = fakeStore({ ...seed(), [recordPath]: storedRecord() });

    await service(harness.store).regyfitRecordFieldReveal(command);

    const audit = harness.records.get("academies/academy-1/auditEvents/restricted-audit-1");
    expect(audit).toEqual(
      expect.objectContaining({
        action: "regyfit.record.field.read",
        targetRef: "academies/academy-1/studentRestrictedReadLimits/owner-1",
        purpose: "regyfit-record-review",
        result: "completed",
      }),
    );
    expect(JSON.stringify(audit)).not.toContain("ID-000789");
    expect(harness.records.get("academies/academy-1/studentRestrictedReadLimits/owner-1")).toEqual(
      expect.objectContaining({ attemptCount: 1 }),
    );
  });

  it("audits a miss for an absent record or an empty field", async () => {
    const missing = fakeStore(seed());
    await expect(service(missing.store).regyfitRecordFieldReveal(command)).rejects.toMatchObject({
      code: "not-found",
    });
    expect(missing.records.get("academies/academy-1/auditEvents/restricted-audit-1")).toEqual(
      expect.objectContaining({ action: "regyfit.record.field.read", result: "not-found" }),
    );

    const empty = fakeStore({ ...seed(), [recordPath]: storedRecord() });
    await expect(
      service(empty.store).regyfitRecordFieldReveal({
        ...command,
        value: { ...command.value, field: "vatNumber" },
      }),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("blocks over the budget without reading the record", async () => {
    const seeded = seed();
    seeded["academies/academy-1/studentRestrictedReadLimits/owner-1"] = {
      actorId: "owner-1",
      academyId: "academy-1",
      windowStartedAt: "2026-09-03T20:00:00.000Z",
      attemptCount: 20,
      overLimitObserved: false,
      schemaVersion: "1",
      updatedAt: "2026-09-03T20:00:00.000Z",
    };
    const harness = fakeStore({ ...seeded, [recordPath]: storedRecord() });

    await expect(service(harness.store).regyfitRecordFieldReveal(command)).rejects.toMatchObject({
      code: "rate-limited",
    });
    expect(harness.readPaths).not.toContain(recordPath);
  });

  it("rejects fields and purposes outside the closed lists before any transaction", async () => {
    const harness = fakeStore({ ...seed(), [recordPath]: storedRecord() });
    const reader = service(harness.store);

    for (const value of [
      { ...command.value, field: "password" },
      { ...command.value, field: "email" },
      { ...command.value, purpose: "member-record-maintenance" },
      { ...command.value, recordId: "../152" },
    ]) {
      await expect(reader.regyfitRecordFieldReveal({ ...command, value })).rejects.toMatchObject({
        code: "invalid",
      });
    }
    expect(harness.transactions).toBe(0);
  });

  it("refuses a coach and an actor the academy no longer provisions", async () => {
    const harness = fakeStore({ ...seed(), [recordPath]: storedRecord() });
    await expect(
      service(harness.store).regyfitRecordFieldReveal({
        ...command,
        actor: { ...actor(), role: "coach" as never },
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });

    const withoutActor = seed();
    delete withoutActor["academies/academy-1/users/owner-1"];
    const unprovisioned = fakeStore({ ...withoutActor, [recordPath]: storedRecord() });
    await expect(
      service(unprovisioned.store).regyfitRecordFieldReveal(command),
    ).rejects.toMatchObject({ code: "unauthorized" });
    expect(unprovisioned.readPaths).not.toContain(recordPath);
  });

  it("treats a stored record that disagrees with its path as unavailable", async () => {
    const harness = fakeStore({ ...seed(), [recordPath]: storedRecord({ recordId: "153" }) });

    await expect(service(harness.store).regyfitRecordFieldReveal(command)).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
```

In `member-directory-callables.test.ts`, inside the `reader` mock of `services()` (after the
`enrolmentRequestDetail` entry that ends near line 90), add:

```ts
      regyfitRecordFieldReveal: vi.fn(async () => ({ value: "ID-000789" })),
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run --project node apps/functions/src/members/canonical-member-directory-read-service.test.ts`
Expected: FAIL — `regyfitRecordFieldReveal is not a function`.

- [ ] **Step 3: Implement**

Imports (after line 29):

```ts
import {
  parseStoredRegyfitMemberRecord,
  revealRegyfitRecordFieldInputSchema,
  type RevealRegyfitRecordFieldResult,
} from "@bpt-jersey/domain/members/regyfit-records";
```

Service type, after `enrolmentRequestDetail: ...;` (line 86):

```ts
/**
 * One restricted identifier of an imported Regyfit record, revealed on purpose. Same machinery
 * as the enrolment request read: provisioned actor, shared budget, audit event. A Regyfit record
 * is not a canonical directory record, so the canonical reader precondition does not apply.
 */
regyfitRecordFieldReveal: (command: DirectoryReadCommand) =>
  Promise<RevealRegyfitRecordFieldResult>;
```

Lines 163-166:

```ts
type RestrictedAction =
  | "member.detail.read"
  | "member.identity.lookup"
  | "enrolment.request.detail.read"
  | "regyfit.record.field.read";
type RestrictedPurpose =
  | "member-record-maintenance"
  | "member-identity-lookup"
  | "enrolment-request-review"
  | "regyfit-record-review";
```

Path helper after `enrolmentRequestPath` (line 292):

```ts
function regyfitMemberRecordPath(academyId: string, recordId: string): string {
  return `academies/${academyId}/regyfitMemberRecords/${recordId}`;
}
```

New method, after the `lookup` method (before the final `  });` of the returned object):

```ts
    async regyfitRecordFieldReveal(command) {
      requireAuthorizedActor(command.actor);
      const now = requiredTimestamp(command.now);
      const value = parseInput(revealRegyfitRecordFieldInputSchema, command.value);
      return runRestricted<RevealRegyfitRecordFieldResult>({
        command: Object.freeze({ ...command, now }),
        action: "regyfit.record.field.read",
        purpose: value.purpose,
        dependencies,
        requiresCanonicalReader: false,
        operation: async (transaction) => {
          const document = await transaction.get(
            regyfitMemberRecordPath(command.actor.academyId, value.recordId),
          );
          if (!document.exists) {
            return Object.freeze({ kind: "failure", code: "not-found", auditResult: "not-found" });
          }
          const parsed = parseStoredRegyfitMemberRecord(document.data);
          if (
            !parsed.ok ||
            parsed.value.recordId !== value.recordId ||
            document.id !== value.recordId
          ) {
            throw new DirectoryDataIssue("Stored Regyfit member record is unreadable");
          }
          const revealed = parsed.value[value.field];
          if (revealed === undefined) {
            return Object.freeze({ kind: "failure", code: "not-found", auditResult: "not-found" });
          }
          return Object.freeze({
            kind: "success",
            value: Object.freeze({ value: revealed }),
            auditResult: "completed",
          });
        },
      });
    },
```

(The error message for `not-found` comes from `runRestricted`: "Member record was not found"; it
never echoes the record id or value.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm vitest run --project node apps/functions/src/members/canonical-member-directory-read-service.test.ts apps/functions/src/members/member-directory-callables.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck functions**

Run: `corepack pnpm --filter @bpt-jersey/functions typecheck`
Expected: exit 0.

- [ ] **Step 6: Prove the audit guard is functioning (then restore)**

Temporarily comment out the second `appendRestrictedAuditEvent({ ... auditEventId: generatedAuditId, ... })`
call inside `runRestricted` (around line 683-690). Run:
`corepack pnpm vitest run --project node apps/functions/src/members/canonical-member-directory-read-service.test.ts -t "Regyfit record field reveal"`
Expected: FAIL in "audits the reveal and spends it from the shared restricted read budget" and
"audits a miss for an absent record or an empty field". Restore the call (`git diff` shows no change
to that block) and rerun: PASS. Record both outputs as evidence for the T051V2 ledger row.

- [ ] **Step 7: Commit**

```bash
git add apps/functions/src/members/canonical-member-directory-read-service.ts apps/functions/src/members/canonical-member-directory-read-service.test.ts apps/functions/src/members/member-directory-callables.test.ts
git commit -m "feat(members): audited, rate-limited Regyfit record field reveal (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Functions — callable `revealRegyfitRecordField`

**Files:**

- Modify: `apps/functions/src/members/member-directory-callables.ts` (handler after line 163, `onCall` after line 309)
- Modify: `apps/functions/src/index.ts:32-39`
- Test: `apps/functions/src/members/member-directory-callables.test.ts`

**Interfaces:**

- Consumes: `CanonicalMemberDirectoryReadService.regyfitRecordFieldReveal` (Task 4),
  `requireCanonicalMemberDirectoryActor`, `mapDirectoryError`, `memberDirectoryCallableOptions`.
- Produces: `revealRegyfitRecordFieldHandler(request: CallableRequest<unknown>, services: MemberDirectoryCallableServices)`;
  exported callable `revealRegyfitRecordField` (App Check enforced; `resource-exhausted` "Restricted
  member read rate limit exceeded" when over budget).

- [ ] **Step 1: Write the failing tests**

Add `revealRegyfitRecordFieldHandler,` to the import list from `./member-directory-callables.js`, and
append inside `describe("canonical member directory callables", ...)`:

```ts
it("reveals a Regyfit field only for an App-Checked active owner or administrator", async () => {
  const value = { recordId: "152", field: "idCardNumber", purpose: "regyfit-record-review" };

  const current = services();
  await expect(
    revealRegyfitRecordFieldHandler(
      request(value, { role: "administrator", uid: "admin-1" }),
      current,
    ),
  ).resolves.toEqual({ value: "ID-000789" });
  expect(current.reader.regyfitRecordFieldReveal).toHaveBeenCalledWith({
    actor: {
      actorId: "admin-1",
      academyId: "academy-1",
      role: "administrator",
      active: true,
      appCheckVerified: true,
    },
    value,
    now,
  });

  for (const role of ["coach", "headCoach", "anonymous"]) {
    const denied = services();
    await expect(
      revealRegyfitRecordFieldHandler(request(value, { role }), denied),
    ).rejects.toMatchObject({ code: expect.stringMatching(/permission-denied|unauthenticated/) });
    expect(denied.reader.regyfitRecordFieldReveal).not.toHaveBeenCalled();
  }

  const noAppCheck = services();
  await expect(
    revealRegyfitRecordFieldHandler(request(value, { appCheck: false }), noAppCheck),
  ).rejects.toMatchObject({ code: "unauthenticated" });
  expect(noAppCheck.reader.regyfitRecordFieldReveal).not.toHaveBeenCalled();

  const limited = services();
  vi.mocked(limited.reader.regyfitRecordFieldReveal).mockRejectedValue(
    new CanonicalMemberDirectoryReadError("rate-limited", "raw ID-000789"),
  );
  await expect(revealRegyfitRecordFieldHandler(request(value), limited)).rejects.toMatchObject({
    code: "resource-exhausted",
    message: "Restricted member read rate limit exceeded",
  });
});
```

Add a check to the existing callable export test pattern (end of the same `describe`):

```ts
it("exports the reveal callable from the deploy surface", async () => {
  const index = await import("../index.js");
  expect(index.revealRegyfitRecordField).toBeDefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run --project node apps/functions/src/members/member-directory-callables.test.ts`
Expected: FAIL — `revealRegyfitRecordFieldHandler` is not exported.

- [ ] **Step 3: Implement**

After `lookupMemberIdentityHandler` (line 163):

```ts
export async function revealRegyfitRecordFieldHandler(
  request: CallableRequest<unknown>,
  services: MemberDirectoryCallableServices,
) {
  const actor = await requireCanonicalMemberDirectoryActor(request, services.isActorActive);
  try {
    return await services.reader.regyfitRecordFieldReveal({
      actor,
      value: request.data,
      now: services.now(),
    });
  } catch (error) {
    return mapDirectoryError(error);
  }
}
```

At the end of the file:

```ts
export const revealRegyfitRecordField = onCall(memberDirectoryCallableOptions, async (request) =>
  revealRegyfitRecordFieldHandler(request, defaultServices()),
);
```

`apps/functions/src/index.ts` lines 32-39 become:

```ts
export {
  createCanonicalMember as createMember,
  getMemberDetail,
  initializeCanonicalMemberDirectory,
  listMembers,
  lookupMemberIdentity,
  revealRegyfitRecordField,
  updateCanonicalMember as updateMember,
} from "./members/member-directory-callables.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm vitest run --project node apps/functions/src/members/member-directory-callables.test.ts apps/functions/src/regyfit/member-records.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/members/member-directory-callables.ts apps/functions/src/members/member-directory-callables.test.ts apps/functions/src/index.ts
git commit -m "feat(functions): export revealRegyfitRecordField callable (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Web client — `revealRegyfitRecordField`

**Files:**

- Modify: `apps/web/src/lib/members-client.ts:17-22` (imports), constants after line 42, function after line 314
- Test: `apps/web/src/lib/members-client.test.ts`

**Interfaces:**

- Consumes: `revealRegyfitRecordFieldInputSchema`, `revealRegyfitRecordFieldResultSchema`,
  `RegyfitRevealableField`, `RevealRegyfitRecordFieldInput` (Task 1); callable name `revealRegyfitRecordField` (Task 5).
- Produces: `revealRegyfitRecordField(recordId: string, field: RegyfitRevealableField): Promise<string>`;
  rejects only with `"Unable to reveal this value. Please try again."` or
  `"Too many restricted reads. Wait five minutes and try again."`.

- [ ] **Step 1: Write the failing test**

Add `revealRegyfitRecordField,` to the import list and append inside the top-level `describe`:

```ts
it("reveals one Regyfit field with its closed purpose and sanitizes every failure", async () => {
  mocks.callable.mockResolvedValueOnce({ data: { value: "ID-000789" } });
  await expect(revealRegyfitRecordField("152", "idCardNumber")).resolves.toBe("ID-000789");
  expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "revealRegyfitRecordField");
  expect(mocks.callable).toHaveBeenCalledWith({
    recordId: "152",
    field: "idCardNumber",
    purpose: "regyfit-record-review",
  });

  mocks.callable.mockResolvedValueOnce({ data: { value: "ID-000789", recordId: "152" } });
  await expect(revealRegyfitRecordField("152", "idCardNumber")).rejects.toThrow(
    "Unable to reveal this value. Please try again.",
  );

  mocks.callable.mockRejectedValueOnce({ code: "functions/resource-exhausted", message: "raw" });
  await expect(revealRegyfitRecordField("152", "idCardNumber")).rejects.toThrow(
    "Too many restricted reads. Wait five minutes and try again.",
  );

  mocks.callable.mockRejectedValueOnce(new Error("private Firebase stack detail"));
  await expect(revealRegyfitRecordField("152", "vatNumber")).rejects.toThrow(
    "Unable to reveal this value. Please try again.",
  );

  mocks.callable.mockClear();
  await expect(revealRegyfitRecordField("../152", "idCardNumber")).rejects.toThrow(
    "Unable to reveal this value. Please try again.",
  );
  expect(mocks.callable).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/members-client.test.ts -t "reveals one Regyfit field"`
Expected: FAIL — `revealRegyfitRecordField` is not exported.

- [ ] **Step 3: Implement**

Imports (lines 17-22):

```ts
import {
  regyfitMemberDirectoryPageSchema,
  regyfitMemberRecordSchema,
  revealRegyfitRecordFieldInputSchema,
  revealRegyfitRecordFieldResultSchema,
  type RegyfitMemberDirectoryPage,
  type RegyfitMemberRecord,
  type RegyfitRevealableField,
  type RevealRegyfitRecordFieldInput,
} from "@bpt-jersey/domain/members/regyfit-records";
```

After line 42:

```ts
const safeRevealError = "Unable to reveal this value. Please try again.";
const revealRateLimitedError = "Too many restricted reads. Wait five minutes and try again.";
```

After `getRegyfitMemberRecord` (line 314):

```ts
export async function revealRegyfitRecordField(
  recordId: string,
  field: RegyfitRevealableField,
): Promise<string> {
  const input = revealRegyfitRecordFieldInputSchema.safeParse({
    recordId,
    field,
    purpose: "regyfit-record-review",
  });
  if (!input.success) throw new Error(safeRevealError);
  try {
    const callable = httpsCallable<RevealRegyfitRecordFieldInput, unknown>(
      getFirebaseFunctions(),
      "revealRegyfitRecordField",
    );
    const result = await callable(input.data);
    const parsed = revealRegyfitRecordFieldResultSchema.safeParse(result.data);
    if (!parsed.success) throw new Error(safeRevealError);
    return parsed.data.value;
  } catch (error) {
    const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
    throw new Error(code.endsWith("resource-exhausted") ? revealRateLimitedError : safeRevealError);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/members-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/members-client.ts apps/web/src/lib/members-client.test.ts
git commit -m "feat(web): client for revealing a masked Regyfit field (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Web panel — remove the Password row, Reveal text buttons

**Files:**

- Modify: `apps/web/src/app/admin/members/search/member-profile-panel.tsx:3-9` (imports), `:88-97`, `:153-162`
- Modify: `apps/web/src/app/admin/admin.css` (after `.admin-member-profile-fields dd`, line ~3632)
- Test: `apps/web/src/app/admin/members/search/page.test.tsx`

**Interfaces:**

- Consumes: `revealRegyfitRecordField` (Task 6), `RegyfitRevealableField` (Task 1); the record from
  `getRegyfitMemberRecord` now arrives masked (Task 3).
- Produces: no new exports. Accessible names: buttons "Reveal ID card Nº", "Reveal Health number",
  "Reveal VAT number" with visible text "Reveal".

- [ ] **Step 1: Write the failing tests**

In `page.test.tsx`:

- `clientMocks` gains `revealRegyfitRecordField: vi.fn(),` and `afterEach` gains
  `clientMocks.revealRegyfitRecordField.mockReset();`.
- The `regyfitRecord` fixture: line 42 becomes
  `appAccess: { login: "a1", logins: 0, lastLogin: "----" },` and add
  `idCardNumber: "•••789",` after `country: "Jersey",` (the server already masks).
- In "opens the full Regyfit record when a member number is clicked", replace
  `expect(within(profile).getByText("104569")).toBeVisible();` with
  `expect(within(profile).queryByText("Password")).not.toBeInTheDocument();`.
- Append:

```ts
  it("shows restricted identifiers masked and reveals one on an explicit action", async () => {
    const user = userEvent.setup();
    clientMocks.listRegyfitMemberRecords.mockResolvedValue(directoryPage);
    clientMocks.getRegyfitMemberRecord.mockResolvedValue(regyfitRecord);
    clientMocks.revealRegyfitRecordField.mockResolvedValue("ID-000789");
    render(<SearchMembersPage />);
    await screen.findByText("Synthetic Child");
    await user.click(screen.getByRole("button", { name: "Open full record for Synthetic Child" }));
    const profile = await screen.findByRole("region", { name: "Synthetic Child" });

    await user.click(within(profile).getByRole("tab", { name: "Details" }));
    expect(within(profile).getByText("•••789")).toBeVisible();
    expect(clientMocks.revealRegyfitRecordField).not.toHaveBeenCalled();
    expect(
      within(profile).queryByRole("button", { name: "Reveal VAT number" }),
    ).not.toBeInTheDocument();

    await user.click(within(profile).getByRole("button", { name: "Reveal ID card Nº" }));

    expect(clientMocks.revealRegyfitRecordField).toHaveBeenCalledWith("152", "idCardNumber");
    expect(await within(profile).findByText("ID-000789")).toBeVisible();
    expect(
      within(profile).queryByRole("button", { name: "Reveal ID card Nº" }),
    ).not.toBeInTheDocument();
    expect(window.location.href).not.toContain("ID-000789");
  });

  it("sanitizes a reveal failure next to the field", async () => {
    const user = userEvent.setup();
    clientMocks.listRegyfitMemberRecords.mockResolvedValue(directoryPage);
    clientMocks.getRegyfitMemberRecord.mockResolvedValue(regyfitRecord);
    clientMocks.revealRegyfitRecordField.mockRejectedValue(
      new Error("Too many restricted reads. Wait five minutes and try again."),
    );
    render(<SearchMembersPage />);
    await screen.findByText("Synthetic Child");
    await user.click(screen.getByRole("button", { name: "Open full record for Synthetic Child" }));
    const profile = await screen.findByRole("region", { name: "Synthetic Child" });
    await user.click(within(profile).getByRole("tab", { name: "Details" }));

    await user.click(within(profile).getByRole("button", { name: "Reveal ID card Nº" }));

    expect(await within(profile).findByRole("alert")).toHaveTextContent(
      "Too many restricted reads. Wait five minutes and try again.",
    );
    expect(within(profile).getByText("•••789")).toBeVisible();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/members/search/page.test.tsx`
Expected: FAIL — no "Reveal ID card Nº" button; the Password row still renders its label.

- [ ] **Step 3: Implement**

`member-profile-panel.tsx` imports (lines 3-9):

```tsx
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type {
  RegyfitAttendanceStatus,
  RegyfitMemberRecord,
  RegyfitRevealableField,
} from "@bpt-jersey/domain/members/regyfit-records";

import { revealRegyfitRecordField } from "../../../../lib/members-client";
import { AdminStatusBadge } from "../../admin-ui";
```

Delete line 92 (`["Password", displayValue(appAccess.password)],`).

Add after `EmptySection` (line 65):

```tsx
/**
 * A masked identifier with an explicit, audited reveal. The revealed value lives only in this
 * component's state: it is gone on tab change, record change or reload, and never reaches the URL,
 * storage or the console.
 */
function RevealableValue({
  recordId,
  field,
  label,
  masked,
}: {
  recordId: string;
  field: RegyfitRevealableField;
  label: string;
  masked: string | undefined;
}) {
  const [revealed, setRevealed] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  if (masked === undefined) return <>—</>;

  async function reveal(): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      setRevealed(await revealRegyfitRecordField(recordId, field));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to reveal this value. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="admin-member-profile-reveal">
      <span>{revealed ?? masked}</span>
      {revealed === undefined ? (
        <button
          aria-label={`Reveal ${label}`}
          className="regyfit-filter-button"
          disabled={pending}
          onClick={() => void reveal()}
          type="button"
        >
          Reveal
        </button>
      ) : null}
      {error === undefined ? null : <span role="alert">{error}</span>}
    </span>
  );
}
```

Replace the "Documents and numbers" entries (lines 156-159) with:

```tsx
            [
              "ID card Nº",
              <RevealableValue
                field="idCardNumber"
                key={`${record.recordId}-idCardNumber`}
                label="ID card Nº"
                masked={record.idCardNumber}
                recordId={record.recordId}
              />,
            ],
            ["ID card due date", displayValue(record.idCardDue)],
            [
              "Health number",
              <RevealableValue
                field="healthNumber"
                key={`${record.recordId}-healthNumber`}
                label="Health number"
                masked={record.healthNumber}
                recordId={record.recordId}
              />,
            ],
            [
              "VAT number",
              <RevealableValue
                field="vatNumber"
                key={`${record.recordId}-vatNumber`}
                label="VAT number"
                masked={record.vatNumber}
                recordId={record.recordId}
              />,
            ],
```

`admin.css`, after the `.admin-member-profile-fields dd { ... }` block:

```css
.admin-member-profile-reveal {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  font-variant-numeric: tabular-nums;
  gap: 0.5rem;
  justify-content: flex-end;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/members/search/page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full static gates**

Run: `corepack pnpm --filter @bpt-jersey/domain build:runtime && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm format:check`
Expected: all exit 0 (if the sparse checkout lacks `Lista`/`Listav2`, materialise them first per
the VPS emulator note; that failure is pre-existing and unrelated).

Run: `grep -rn "password" apps/web/src/app/admin/members apps/functions/src/regyfit packages/domain/src/members/regyfit-member-record-contracts.ts`
Expected: only the contract comment, the stored-parser strip and test fixtures that assert rejection
or absence.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/admin/members/search/member-profile-panel.tsx apps/web/src/app/admin/members/search/page.test.tsx apps/web/src/app/admin/admin.css
git commit -m "fix(web): remove Regyfit password row, reveal masked identifiers on demand (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Password purge script (tested) and operator-gated production runbook

**Files:**

- Create: `qa/scripts/purge-regyfit-record-passwords.mjs`
- Create: `qa/scripts/purge-regyfit-record-passwords.d.mts`
- Test: `qa/unit/regyfit-password-purge.test.ts`

**Interfaces:**

- Consumes: pattern of `qa/scripts/import-regyfit-member-records.mjs:37-64` (target guard) and
  `qa/scripts/regyfit-classes-services-map.d.mts` (type surface for qa unit tests).
- Produces: `productionConfirmation = "regyfit-password-purge-production-v1"`,
  `hasStoredPassword(data: unknown): boolean`,
  `resolvePurgeTarget(env: Record<string, string | undefined>): { target: "emulator" | "production"; projectId: string; apply: boolean }`.
  CLI prints counts only: `{ target, projectId, academyId, scanned, withPassword, purged }`.

- [ ] **Step 1: Write the failing test**

`qa/unit/regyfit-password-purge.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  hasStoredPassword,
  productionConfirmation,
  resolvePurgeTarget,
} from "../scripts/purge-regyfit-record-passwords.mjs";

describe("Regyfit password purge guards", () => {
  it("detects only a present appAccess.password key", () => {
    expect(hasStoredPassword({ appAccess: { login: "a1", password: "104569" } })).toBe(true);
    expect(hasStoredPassword({ appAccess: { login: "a1", password: "" } })).toBe(true);
    expect(hasStoredPassword({ appAccess: { login: "a1" } })).toBe(false);
    expect(hasStoredPassword({ password: "104569" })).toBe(false);
    expect(hasStoredPassword(undefined)).toBe(false);
  });

  it("dry-runs by default and only on a loopback emulator", () => {
    expect(
      resolvePurgeTarget({
        REGYFIT_PURGE_TARGET: "emulator",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      }),
    ).toEqual({ target: "emulator", projectId: "demo-bpt-jersey", apply: false });
    expect(() =>
      resolvePurgeTarget({
        REGYFIT_PURGE_TARGET: "emulator",
        FIRESTORE_EMULATOR_HOST: "10.0.0.5:8080",
      }),
    ).toThrow(/loopback/);
    expect(() => resolvePurgeTarget({})).toThrow(/REGYFIT_PURGE_TARGET/);
  });

  it("requires the production project for a production dry run and the confirmation to apply", () => {
    expect(() =>
      resolvePurgeTarget({ REGYFIT_PURGE_TARGET: "production", GCLOUD_PROJECT: "other" }),
    ).toThrow(/bptjersey-f5a25/);
    expect(() =>
      resolvePurgeTarget({
        REGYFIT_PURGE_TARGET: "production",
        GCLOUD_PROJECT: "bptjersey-f5a25",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      }),
    ).toThrow(/FIRESTORE_EMULATOR_HOST/);
    expect(
      resolvePurgeTarget({ REGYFIT_PURGE_TARGET: "production", GCLOUD_PROJECT: "bptjersey-f5a25" }),
    ).toEqual({ target: "production", projectId: "bptjersey-f5a25", apply: false });
    expect(() =>
      resolvePurgeTarget({
        REGYFIT_PURGE_TARGET: "production",
        GCLOUD_PROJECT: "bptjersey-f5a25",
        REGYFIT_PURGE_APPLY: "yes",
      }),
    ).toThrow(/confirmation/);
    expect(
      resolvePurgeTarget({
        REGYFIT_PURGE_TARGET: "production",
        GCLOUD_PROJECT: "bptjersey-f5a25",
        REGYFIT_PURGE_APPLY: "yes",
        REGYFIT_OPERATOR_CONFIRMATION: productionConfirmation,
      }),
    ).toEqual({ target: "production", projectId: "bptjersey-f5a25", apply: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run --project node qa/unit/regyfit-password-purge.test.ts`
Expected: FAIL — cannot resolve `../scripts/purge-regyfit-record-passwords.mjs`.

- [ ] **Step 3: Implement**

`qa/scripts/purge-regyfit-record-passwords.mjs`:

```js
// Removes the legacy appAccess.password key from stored Regyfit member records.
//
// usage (dry run, counts only — the default):
//   REGYFIT_ACADEMY_ID=<academyId> REGYFIT_PURGE_TARGET=emulator|production \
//   node qa/scripts/purge-regyfit-record-passwords.mjs
//
// apply (deletes the key, nothing else):
//   add REGYFIT_PURGE_APPLY=yes
// Production additionally requires GCLOUD_PROJECT=bptjersey-f5a25 (dry run and apply) and, to apply,
//   REGYFIT_OPERATOR_CONFIRMATION=regyfit-password-purge-production-v1
// Production runs only after the operator's explicit OK in chat (plan 2026-09-17-member-profile-a, Task 8).

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const productionProjectId = "bptjersey-f5a25";
export const productionConfirmation = "regyfit-password-purge-production-v1";

function isLoopbackHost(value) {
  if (!value) return false;
  const host = value.split(":")[0]?.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function hasStoredPassword(data) {
  const access = data?.appAccess;
  return typeof access === "object" && access !== null && Object.hasOwn(access, "password");
}

export function resolvePurgeTarget(env) {
  const target = env.REGYFIT_PURGE_TARGET?.trim();
  const apply = env.REGYFIT_PURGE_APPLY === "yes";
  if (target === "emulator") {
    if (!isLoopbackHost(env.FIRESTORE_EMULATOR_HOST)) {
      throw new Error("Emulator purges require FIRESTORE_EMULATOR_HOST on a loopback host");
    }
    return { target, projectId: env.GCLOUD_PROJECT?.trim() || "demo-bpt-jersey", apply };
  }
  if (target === "production") {
    if (env.FIRESTORE_EMULATOR_HOST) {
      throw new Error("Production purges must not run with FIRESTORE_EMULATOR_HOST set");
    }
    if (env.GCLOUD_PROJECT?.trim() !== productionProjectId) {
      throw new Error(`Production purges require GCLOUD_PROJECT=${productionProjectId}`);
    }
    if (apply && env.REGYFIT_OPERATOR_CONFIRMATION !== productionConfirmation) {
      throw new Error("Applying in production requires the operator confirmation value");
    }
    return { target, projectId: productionProjectId, apply };
  }
  throw new Error("REGYFIT_PURGE_TARGET must be emulator or production");
}

async function main() {
  const academyId = process.env.REGYFIT_ACADEMY_ID?.trim();
  if (!academyId) throw new Error("Missing required environment: REGYFIT_ACADEMY_ID");
  const { target, projectId, apply } = resolvePurgeTarget(process.env);

  const requireFromFunctions = createRequire(
    new URL("../../apps/functions/package.json", import.meta.url),
  );
  const { getApps, initializeApp } = requireFromFunctions("firebase-admin/app");
  const { FieldValue, getFirestore } = requireFromFunctions("firebase-admin/firestore");
  const app = getApps()[0] ?? initializeApp({ projectId });
  const firestore = getFirestore(app);

  const snapshot = await firestore.collection(`academies/${academyId}/regyfitMemberRecords`).get();
  const targets = snapshot.docs.filter((document) => hasStoredPassword(document.data()));

  let purged = 0;
  if (apply) {
    // ponytail: one pass in 400-write batches; 249 records today, re-run is idempotent.
    for (let index = 0; index < targets.length; index += 400) {
      const batch = firestore.batch();
      for (const document of targets.slice(index, index + 400)) {
        batch.update(document.ref, { "appAccess.password": FieldValue.delete() });
      }
      await batch.commit();
      purged += Math.min(400, targets.length - index);
    }
  }

  console.log(
    JSON.stringify({
      target,
      projectId,
      academyId,
      scanned: snapshot.size,
      withPassword: targets.length,
      purged,
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
```

`qa/scripts/purge-regyfit-record-passwords.d.mts`:

```ts
// Type surface of purge-regyfit-record-passwords.mjs for the qa unit tests. Keep it in step with
// the exports of the .mjs.

export declare const productionConfirmation: "regyfit-password-purge-production-v1";
export declare function hasStoredPassword(data: unknown): boolean;
export declare function resolvePurgeTarget(env: Record<string, string | undefined>): {
  target: "emulator" | "production";
  projectId: string;
  apply: boolean;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run --project node qa/unit/regyfit-password-purge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Prove the apply path on the emulator (no production)**

Create `.tmp/purge-verify.sh` (`.tmp/` is gitignored):

```bash
set -euo pipefail
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-bpt-jersey
export REGYFIT_ACADEMY_ID=academy-1 REGYFIT_PURGE_TARGET=emulator
node --input-type=module -e '
import { createRequire } from "node:module";
const r = createRequire(new URL("file:///root/BPT-Jersey/apps/functions/package.json"));
const { initializeApp } = r("firebase-admin/app");
const { getFirestore } = r("firebase-admin/firestore");
const db = getFirestore(initializeApp({ projectId: "demo-bpt-jersey" }));
await db.doc("academies/academy-1/regyfitMemberRecords/152").set({ recordId: "152", appAccess: { login: "a1", password: "104569" } });
await db.doc("academies/academy-1/regyfitMemberRecords/153").set({ recordId: "153", appAccess: { login: "a2" } });
'
node qa/scripts/purge-regyfit-record-passwords.mjs
REGYFIT_PURGE_APPLY=yes node qa/scripts/purge-regyfit-record-passwords.mjs
node qa/scripts/purge-regyfit-record-passwords.mjs
```

Run (VPS recipe: port 8080 is code-server, so the emulator runs in the no-network container):

```bash
docker run --rm --network none -e COREPACK_ENABLE_NETWORK=0 -v /root/BPT-Jersey:/root/BPT-Jersey -v /root/.cache/firebase:/root/.cache/firebase -v /root/.cache/node:/root/.cache/node -w /root/BPT-Jersey bpt-emu:local bash -lc 'node_modules/.bin/firebase emulators:exec --project demo-bpt-jersey --only firestore "bash .tmp/purge-verify.sh"'
```

Expected, three JSON lines in order:
`{"target":"emulator","projectId":"demo-bpt-jersey","academyId":"academy-1","scanned":2,"withPassword":1,"purged":0}`,
`{... "scanned":2,"withPassword":1,"purged":1}`,
`{... "scanned":2,"withPassword":0,"purged":0}`. Then `rm .tmp/purge-verify.sh`.

- [ ] **Step 6: Commit**

```bash
git add qa/scripts/purge-regyfit-record-passwords.mjs qa/scripts/purge-regyfit-record-passwords.d.mts qa/unit/regyfit-password-purge.test.ts
git commit -m "feat(qa): guarded purge of legacy Regyfit app passwords, dry run by default (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: OPERATOR GATE — production runbook (never executed by an agent)**

Preconditions, all required, in this order:

1. Tasks 1-7 merged and the functions (`getRegyfitMemberRecord`, `listRegyfitMemberRecords`,
   `revealRegyfitRecordField`) plus web deployed with the operator's explicit OK. Purging before the
   new read path is live is harmless; deploying the new strict schema is what makes the old
   documents readable only through the strip, so deploy first.
2. The operator confirms in chat: "OK dry run purge contraseñas Regyfit producción".
3. Dry run (read-only, counts only), run by the operator from a machine with production Application
   Default Credentials, repo root:

   ```bash
   REGYFIT_ACADEMY_ID=<production academy id> REGYFIT_PURGE_TARGET=production GCLOUD_PROJECT=bptjersey-f5a25 node qa/scripts/purge-regyfit-record-passwords.mjs
   ```

   Expected: one JSON line, `scanned` ≈ 249, `withPassword` = N, `purged` = 0. Record N in the T051V2
   evidence (it also answers the open count noted in T125).

4. The operator confirms in chat, quoting N: "OK aplicar purge de N contraseñas".
5. Apply:

   ```bash
   REGYFIT_ACADEMY_ID=<production academy id> REGYFIT_PURGE_TARGET=production GCLOUD_PROJECT=bptjersey-f5a25 REGYFIT_PURGE_APPLY=yes REGYFIT_OPERATOR_CONFIRMATION=regyfit-password-purge-production-v1 node qa/scripts/purge-regyfit-record-passwords.mjs
   ```

   Expected: `withPassword` = N, `purged` = N.

6. Verify: rerun step 3. Expected `withPassword` = 0.
7. Irreversible: the passwords are not recoverable from Firestore afterwards (the raw capture outside
   the repo still holds them; its retention is a separate operator decision). No agent runs steps 3-6.

## Self-review

- Spec §4 coverage: remove `password` from `regyfitAppAccessSchema` (Task 1); read path strips before
  strict parse, tested (Tasks 1, 3); importer drops it (Task 3); panel row removed (Task 7); handler
  output masked last 3 characters (Tasks 1, 3); `revealRegyfitRecordField({recordId, field, purpose})`
  owner/administrator, closed purpose enum, rate-limited, audited, returns one value (Tasks 1, 2, 4, 5);
  "Reveal" text button (Task 7); production purge with dry run first, operator-gated (Task 8). Spec tests
  line: contract rejects/strips (Task 1), no "Password" text (Task 7), masked output (Task 3), reveal
  requires admin + audit event + disabled audit write fails the test (Tasks 4 Step 6, 5).
- Placeholders: only `<production academy id>` in the operator runbook, which the operator supplies.
- Names are consistent: `regyfitRecordFieldReveal` (service method), `revealRegyfitRecordFieldHandler`,
  `revealRegyfitRecordField` (callable and web client), `regyfit.record.field.read`,
  `regyfit-record-review`, `parseStoredRegyfitMemberRecord`, `maskRegyfitMemberRecord`.
