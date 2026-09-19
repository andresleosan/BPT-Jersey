# Member profile Plan B: E1 canonical member record — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give office and coaches a canonical member record at `/admin/members/profile?id=<studentId>`
— header with birthday badge, eight ARIA tabs, PROFILE cards, a DETAILS form with every Regyfit
field — reached from a canonical-first search page and from the overview birthday band, with the
output trimmed by role on the server.

**Architecture:** The new DETAILS fields live in one optional `details` object on the existing
restricted `studentAdminProfiles` document (no new collection, no migration). They are written
through the existing `updateMember` callable (`updateCanonicalMember`), which already reserves the
member number in `studentIdentityKeys` inside its transaction; omitting `details` preserves what is
stored, so the old search-page editor cannot wipe it. A new `getMemberProfile` callable branches on
role: owner/administrator go through a new audited, rate-limited method on the canonical read
service (same budget and audit action as `getMemberDetail`) and a small profile service that adds
account managers, the current membership and the next free member number; headCoach/coach go
through the level authorization (`resolveStudent`) and receive the header only. A
`searchMemberNames` callable gives all four staff roles a name-only search.

**Tech Stack:** TypeScript strict, zod 4.4.3, Firebase Functions v2 `onCall`, Next.js 16 static
export (client components), Vitest (`node` + `web` projects), `@firebase/rules-unit-testing`.

**Spec:** `docs/superpowers/specs/2026-09-17-member-profile-e0-e2-design.md` §5 (E1), §7, §9, grill
G1, G6, G8 (schemas only). Shared brief of plans A–D (fixed interface names) is restated in the
Interfaces block below. Decisions: `docs/adr/ADR-009-students-canonical-member-directory.md`,
`docs/adr/ADR-010-coach-office-powers.md`.

## Order and dependencies

- Run **after Plan A** (E0). Plan A edits `member-profile-panel.tsx`, `members-client.ts`,
  `canonical-member-directory-read-service.ts` (adds `regyfitRecordFieldReveal`) and
  `member-directory-callables.test.ts` (reader mock). Task 5 and Task 7 of this plan add one more
  method to the same reader type and mock; rebase on Plan A's result, do not re-add its members.
- **Plan C** consumes `profile-tab.tsx`'s `ibjjfCardSlot` insertion point and `member-record.tsx`'s
  `view=manage` routing. **Plan D** consumes `studentAdminDetailsSchema` (the backfill target) and
  `memberHowHeardOptions` / `memberInitialContactOptions`.

## Interfaces this plan fixes (consumed by Plans C and D)

Domain `@bpt-jersey/domain/members/directory` (`packages/domain/src/members/member-directory-contracts.ts`):

- `studentAdminDetailsSchema` — strict, readonly; the stored shape of `StudentAdminProfile.details`.
- `StudentAdminDetails = Readonly<z.infer<typeof studentAdminDetailsSchema>>`
- `studentAdminDetailsInputSchema` — the write shape (normalises `healthNumber`, closes `howHeard` /
  `initialContact` to the option lists).
- `StudentAdminProfile.details?: StudentAdminDetails`; `AdminUpdateStudentInput.details?: StudentAdminDetailsInput`.
- `memberHowHeardOptions`, `memberInitialContactOptions` (readonly tuples, seeded Regyfit values).

Domain `@bpt-jersey/domain/members/profile` (`packages/domain/src/members/member-profile-contracts.ts`):

- `BirthdayBadge = { kind: "today" } | { kind: "inDays"; days: number } | null`
- `deriveBirthdayBadge(dateOfBirth: string, today: string): BirthdayBadge`
- `deriveBmi(weightKg: number | undefined, heightCm: number | undefined): { value: number; category: "underweight" | "healthy" | "overweight" | "obese" } | null`
- `academyDateOf(nowIso: string): string` — `YYYY-MM-DD` in `Europe/Jersey`.
- `deriveShortNameVariants(fullName: string): readonly string[]`
- `nextFreeMemberNumber(existing: readonly (string | undefined)[]): string`
- `wholeMonthsBetween(from: string, to: string): number`
- `memberProfileRequestSchema` = strict `{ studentId }`
- `memberProfileHeaderSchema`, `MemberProfileHeader = { studentId, fullName, age, participantType, status, maskedMemberReference?, birthdayBadge }`
- `memberProfileCardsSchema`, `MemberProfileCards = { memberSince, monthsAsMember, profession?, accountManagers, currentMembership }`
- `memberDetailsSchema`, `MemberDetails` (all maintenance-detail fields + `details?`)
- `updateMemberDetailsInputSchema` (= the extended `adminUpdateStudentInputSchema`), `UpdateMemberDetailsInput`
- `memberProfileSchema` — discriminated union on `view`: `{ view: "full"; header; cards; details; nextFreeMemberNumber? }` | `{ view: "coach"; header }` (coach header has no `maskedMemberReference`).
- `MemberProfile`, `FullMemberProfile`, `CoachMemberProfile`
- `memberNameSearchRequestSchema` = strict `{ query }` (2–80 chars), `memberNameSearchResultSchema` = `{ members: { studentId, fullName }[] ≤ 20 }`, `MemberNameSearchResult`
- `memberRecordTabs = ["profile","details","plan","documents","payments","classes","communication","notes"]`, `MemberRecordTab`

Functions (exported from `apps/functions/src/index.ts`):

- `getMemberProfile` — input `{ studentId }`, output `MemberProfile`.
- `searchMemberNames` — input `{ query }`, output `MemberNameSearchResult`.
- DETAILS are saved through the **existing** `updateMember` callable (no new write callable).

Web:

- `apps/web/src/lib/member-profile-client.ts`: `getMemberProfile(studentId: string): Promise<MemberProfile>`,
  `saveMemberDetails(input: UpdateMemberDetailsInput): Promise<void>`,
  `searchMemberNames(query: string): Promise<MemberNameSearchResult["members"]>`,
  `MemberDetailsConflictError` (member number already reserved).
- `apps/web/src/app/admin/members/profile/page.tsx` (route), `member-record.tsx` (`MemberRecord`,
  reads `?id`, `?tab`, `&view`), `profile-tab.tsx` (`ProfileTab`, prop `ibjjfCardSlot?: ReactNode`
  — Plan C passes `<IbjjfCard studentId={...} />`), `details-tab.tsx` (`DetailsTab`),
  `record-empty-tab.tsx` (`RecordEmptyTab`).

## Global Constraints

- CLAUDE.md layering: domain contract → `*-service.ts` (pure, in-memory fakes) → `*-firestore.ts`
  → `*-callables.ts` → `apps/web/src/lib/*-client.ts` → route. `packages/domain` never imports
  Firebase. A new domain module is added to `packages/domain/package.json` subpath exports **and**
  to `packages/domain/tsconfig.runtime.json` `include` (functions import the compiled `lib/`).
  Every new callable is exported from `apps/functions/src/index.ts`.
- Commands from the repo root via Corepack: `corepack pnpm vitest run --project node <file>`,
  `corepack pnpm vitest run --project web <file>`. Before `typecheck` / full `test`, the sparse
  checkout needs `git sparse-checkout add Lista Listav2`; restore afterwards with
  `git sparse-checkout set '/*' '!/Lista' '!/Listav2'`. Emulator work (rules tests)
  runs in Docker `bpt-emu:local --network none` on this VPS (port 8080 is code-server).
- Never run prettier on `tasksv2.md`. Commit messages end with the tag `(T051V2)` and the line
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Test fixtures are synthetic only: names like "Test Member A", numbers like "0000", e-mails on
  `example.test`. No real member data in the repo, tests, logs or commit messages.
- DESIGN.md binding rules: tokens purple `#2F2483`, canvas `#F2F1ED`, ink `#1A1A18`, muted
  `#65635D`, line `#8A8880`, Purple Wash `#F0EFFF` / `#D9D6FF` (use the CSS custom properties
  already in `admin.css`: `var(--bpt-purple)`, `var(--muted)`, `var(--line)`); square corners;
  hard offset shadows only; status = text + coloured left border, never a pill (so the new screens
  do not use `AdminStatusBadge`); Barlow Condensed display / Source Sans 3 body; eyebrow 0.72rem
  700 uppercase 0.15em; `font-variant-numeric: tabular-nums` for numbers and dates; buttons
  ≥ 3.15rem tall with a 3px purple focus outline; labels above inputs; inline row actions, no kebab
  menu; skeletons, not spinners; empty state = eyebrow + headline + one sentence + one button; one
  column below 50rem; no horizontal scroll; ≥ 44px targets; `prefers-reduced-motion` disables
  transitions; UK English copy; no emojis; no icon-only buttons; belt colours only inside
  `.belt-bar` / `.belt-tip` / `.levels-colour` (DESIGN.md §10). Reuse `admin.css`
  (`.admin-member-profile-*`, `.admin-panel-card`, `.admin-eyebrow`, `.admin-auth-button`,
  `.login-field`), `admin-ui.tsx` and `admin-data-table.tsx` before adding CSS; new rules go in
  `admin.css` next to `.admin-member-profile-*` (around line 3506) with a `member-record-` prefix.
- Frontend security: no `dangerouslySetInnerHTML`; every callable response is zod-parsed in the
  client; only fixed, safe user-facing error strings; `?id=` is validated against
  `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/` before any call; no restricted value (member number,
  ID card, tax, health number, weight, height, notes, date of birth) in URLs, `console`, logs,
  analytics or web storage; no new external origins.
- Backend security: App Check enforced in options **and** checked in the handler (existing actor
  helpers do both); role checks only through existing helpers
  (`requireCanonicalMemberDirectoryActor`, `createFirebaseLevelAuthorization().requireActor` /
  `resolveStudent`); academy taken from the verified claim, never from the payload; strict zod
  input; restricted reads audited and rate-limited through `runRestricted`; Firestore rules stay
  deny-direct. For each new guard there is a test that fails if the guard is removed (LECCIONES.md
  §4–§5): run it, comment the guard out, watch it fail, restore.
- Stored-document compatibility: `studentAdminProfileSchema` stays strict. `details` is added as an
  **optional** key, so every document written before this plan (no `details`) still parses; the
  migration executors (`member-directory-forward-executor.ts:361`,
  `member-directory-bootstrap-executor.ts:116`, `member-directory-forward-dry-run.ts:339`), the PDF
  import (`canonical-member-import-service.ts:1076`) and the families writer
  (`family-service.ts:700`) never produce `details` and keep parsing. No digest or MAC covers the
  stored profile document, so no frozen plan or restore guard changes.
- Health data (health number, weight, height, BMI) is an operator exception to t011 decision 4
  (spec §2.5, §8). **Operator gate:** these fields must not be deployed to production until the
  operator amends the policy or approves a DPIA, confirmed in chat. This plan does not deploy.
- Ponytail: smallest diff, reuse before create, no new dependencies, no speculative abstractions;
  every deliberate simplification carries a `// ponytail:` comment naming its ceiling.
- No production deploy, destructive migration or production write in any task. Deploying
  `getMemberProfile`, `searchMemberNames` and the extended `updateMember` is an **operator gate**
  after the whole of E0–E2 passes `verify:mvp`.

## File Structure

Domain (`packages/domain`):

- Modify `src/members/member-directory-contracts.ts` — `studentAdminDetailsSchema` (stored),
  `studentAdminDetailsInputSchema` (write), option lists, optional `details` on the profile base
  shape, update input and maintenance detail; `toMemberRecordMaintenanceDetail` copies `details`.
- Modify `src/members/member-directory-contracts.test.ts` — compatibility and bounds tests.
- Create `src/members/member-profile-contracts.ts` — pure derivations and the profile/search
  request/response schemas.
- Create `src/members/member-profile-contracts.test.ts`.
- Modify `package.json` (subpath `./members/profile`), `tsconfig.runtime.json` (include).

Functions (`apps/functions/src/members`):

- Modify `canonical-member-directory-service.ts` — `buildUpdatedAdminProfile` preserves `details`
  when omitted; `updateAdminMember` creates an `admin`-source profile when none exists.
- Modify `canonical-member-directory-service.test.ts`.
- Modify `canonical-member-directory-read-service.ts` — `memberProfileRecord` restricted method.
- Modify `canonical-member-directory-read-service.test.ts`.
- Create `member-profile-service.ts` — pure composition of full and coach profiles and the name
  search, over a `MemberProfileStore` port.
- Create `member-profile-service.test.ts`.
- Create `member-profile-firestore.ts` — `MemberProfileStore` over Admin SDK.
- Create `member-profile-callables.ts` — `getMemberProfileHandler`, `searchMemberNamesHandler`,
  `getMemberProfile`, `searchMemberNames`.
- Create `member-profile-callables.test.ts`.
- Modify `member-directory-callables.ts` — export `memberDirectoryCallableOptions` and
  `defaultMemberDirectoryCallableServices` (renamed from the private `defaultServices`).
- Modify `member-directory-callables.test.ts` — reader mock gains `memberProfileRecord`.
- Modify `apps/functions/src/index.ts` — export the two callables.

Web (`apps/web/src`):

- Create `lib/member-profile-client.ts`, `lib/member-profile-client.test.ts`.
- Create `app/admin/members/profile/page.tsx`, `page.test.tsx`.
- Create `app/admin/members/profile/member-record.tsx`, `member-record.test.tsx`.
- Create `app/admin/members/profile/record-empty-tab.tsx`, `record-format.ts` (date and label
  formatting shared by the record components).
- Create `app/admin/members/profile/profile-tab.tsx`, `profile-tab.test.tsx`.
- Create `app/admin/members/profile/details-tab.tsx`, `details-tab.test.tsx`.
- Create `app/admin/members/profile/details-form-model.ts`, `details-form-model.test.ts` — draft ⇄
  payload mapping, phone split, country list (keeps `details-tab.tsx` about rendering).
- Modify `app/admin/members/search/page.tsx`, `page.test.tsx` — canonical results first, archive
  below, no inline colours, coach name-only search.
- Modify `app/admin/overview-page.tsx`, `overview-page.test.tsx` — birthday names link to the record.
- Modify `app/admin/admin-routes.ts`, `admin-routes.test.ts`, `app/admin/admin-shell.tsx` — coach
  access to search and record; "Member search" menu item.
- Modify `app/admin/admin.css` — `member-record-*` rules.

Docs and QA:

- Modify `docs/adr/ADR-010-coach-office-powers.md` — amendment 2026-09-17 (G6).
- Modify `qa/rules/member-directory-boundary.test.ts` — a profile carrying `details` stays deny-direct.
- Create `qa/tests/member-record-visual.spec.ts` — synthetic-fixture screenshots (1440 px, 390 px)
  for the design audit.

---

### Task 1: Domain — stored and write schemas for the DETAILS extension

**Files:**

- Modify: `packages/domain/src/members/member-directory-contracts.ts` — new block after
  `postalAddressSchema` (after line 117); `studentAdminProfileBaseShape` (lines 119–134);
  `memberRecordMaintenanceDetailSchema` (lines 325–339); `administrativeIdentifierInputSchema`
  (lines 367–375, moved up); `adminUpdateStudentInputSchema` (lines 438–457);
  `toMemberRecordMaintenanceDetail` (lines 594–623).
- Test: `packages/domain/src/members/member-directory-contracts.test.ts` (new `describe` at the end).

**Interfaces:**

- Consumes: existing `canonicalText`, `dateOnlySchema`, `opaqueIdentifierSchema`,
  `administrativeIdentifierSchema`, `administrativeIdentifierInputSchema` in the same file.
- Produces: `memberHowHeardOptions`, `MemberHowHeardOption`, `memberInitialContactOptions`,
  `MemberInitialContactOption`, `studentAdminDetailsSchema`, `StudentAdminDetails`,
  `studentAdminDetailsInputSchema`, `StudentAdminDetailsInput`; optional `details` on
  `StudentAdminProfile`, `MemberRecordMaintenanceDetail` and `AdminUpdateStudentInput`.

Design notes for the implementer:

- `details` is one optional nested object so that the existing full-replacement update can say
  "not sent = keep" for the whole block (Task 4) without changing the meaning of the old flat fields.
- Fields that already exist are **not** duplicated inside `details`: full name, date of birth,
  e-mail, phone (`students`); member number = `membershipNumber`, ID card no. = `idCardNumber`,
  tax no. = `vatNumber`, gender, emergency contact, address + postal code = `postalAddress`
  (`studentAdminProfiles`).
- `howHeard` / `initialContact` are stored as bounded text (a later editable academy list does not
  invalidate stored documents) but the write schema closes them to the seeded lists.
- Internal notes may contain line breaks, so they get their own text rule (tab and line feed
  allowed, every other control character refused).

- [ ] **Step 1: Write the failing tests**

Add `memberHowHeardOptions`, `memberInitialContactOptions`, `studentAdminDetailsInputSchema` and
`studentAdminDetailsSchema` to the existing import from `./member-directory-contracts`, then append:

```ts
describe("member record DETAILS extension (T051V2)", () => {
  const details = {
    shortName: "Test A",
    nickname: "Tester",
    city: "St Helier",
    country: "JE",
    idCardExpiresOn: "2030-01-31",
    healthNumber: "HN0000",
    profession: "Tester",
    weightKg: 70.5,
    heightCm: 175,
    registeredOn: "2026-01-15",
    recommendedByStudentId: "student-2",
    howHeard: "Friends",
    initialContact: "In person",
    internalNotes: "Line one\nLine two",
  } as const;

  it("parses a stored profile written before the extension and one carrying details", () => {
    expect(studentAdminProfileSchema.safeParse(adminProfile).success).toBe(true);
    const parsed = studentAdminProfileSchema.safeParse({ ...adminProfile, details });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.details).toEqual(details);
  });

  it("keeps the stored details strict and bounded", () => {
    for (const bad of [
      { ...details, unknownField: "x" },
      { ...details, weightKg: 0 },
      { ...details, weightKg: 401 },
      { ...details, heightCm: 29 },
      { ...details, heightCm: 251 },
      { ...details, country: "Jersey" },
      { ...details, idCardExpiresOn: "2030-02-30" },
      { ...details, shortName: " padded " },
      { ...details, internalNotes: "x".repeat(2001) },
      { ...details, internalNotes: `bell${String.fromCharCode(7)}` },
      { ...details, recommendedByStudentId: "../student" },
    ]) {
      expect(studentAdminDetailsSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("seeds the academy option lists with the Regyfit values", () => {
    expect(memberHowHeardOptions).toEqual([
      "Friends",
      "Social networks",
      "Radio",
      "Television",
      "Flyers",
      "Website",
      "WhatsApp",
      "Others",
    ]);
    expect(memberInitialContactOptions).toEqual([
      "Phone",
      "Facebook",
      "In person",
      "Instagram",
      "Website",
      "WhatsApp",
    ]);
  });

  it("normalises the health number and closes the option lists on write", () => {
    const parsed = studentAdminDetailsInputSchema.safeParse({
      ...details,
      healthNumber: " hn0000 ",
    });
    expect(parsed.success && parsed.data.healthNumber).toBe("HN0000");
    expect(
      studentAdminDetailsInputSchema.safeParse({ ...details, howHeard: "Carrier pigeon" }).success,
    ).toBe(false);
    expect(
      studentAdminDetailsInputSchema.safeParse({ ...details, initialContact: "Fax" }).success,
    ).toBe(false);
  });

  it("accepts details on the full-replacement update and refuses self-recommendation", () => {
    const update = {
      studentId: "student-1",
      requestId: "41cbb1aa-7020-4bb5-88a4-dbc73c5f0123",
      fullName: "Test Member A",
      dateOfBirth: "2000-01-02",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      gender: "unknown",
    } as const;
    expect(adminUpdateStudentInputSchema.safeParse(update).success).toBe(true);
    expect(adminUpdateStudentInputSchema.safeParse({ ...update, details }).success).toBe(true);
    expect(
      adminUpdateStudentInputSchema.safeParse({
        ...update,
        details: { ...details, recommendedByStudentId: "student-1" },
      }).success,
    ).toBe(false);
  });

  it("carries stored details into the maintenance detail and omits the key when absent", () => {
    const withDetails = toMemberRecordMaintenanceDetail(student, {
      ...adminProfile,
      details,
    } as StudentAdminProfile);
    expect(withDetails.details).toEqual(details);
    expect(memberRecordMaintenanceDetailSchema.safeParse(withDetails).success).toBe(true);
    const without = toMemberRecordMaintenanceDetail(student, adminProfile as StudentAdminProfile);
    expect(Object.hasOwn(without, "details")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project node packages/domain/src/members/member-directory-contracts.test.ts`
Expected: FAIL — `memberHowHeardOptions` and `studentAdminDetailsSchema` are undefined, and the
"carrying details" parse returns `success: false` (unrecognized key `details`).

- [ ] **Step 3: Implement the schemas**

Move the `administrativeIdentifierInputSchema` declaration (lines 367–375, unchanged) up to sit
directly after `export type PostalAddress = …` (line 117). It calls
`normalizeAdministrativeIdentifier`, a hoisted `function` declaration, so the move is safe. Then add,
right after it:

```ts
// T051V2 (E1): the DETAILS fields Regyfit shows that the canonical record did not hold yet. They
// live in one optional block of the Restricted admin profile, so documents written before it still
// parse and the full-replacement update can treat "not sent" as "keep" for the whole block.
export const memberHowHeardOptions = Object.freeze([
  "Friends",
  "Social networks",
  "Radio",
  "Television",
  "Flyers",
  "Website",
  "WhatsApp",
  "Others",
] as const);
export type MemberHowHeardOption = (typeof memberHowHeardOptions)[number];

export const memberInitialContactOptions = Object.freeze([
  "Phone",
  "Facebook",
  "In person",
  "Instagram",
  "Website",
  "WhatsApp",
] as const);
export type MemberInitialContactOption = (typeof memberInitialContactOptions)[number];

// ponytail: the option lists are code constants, not an academy setting with a manage dialog.
// Stored values are bounded text, so moving the lists into academy settings later needs no migration.

// Tab (0x09) and line feed (0x0a) are allowed in notes; every other C0 control and DEL is not.
const notesControlCharacterPattern = /[\u0000-\u0008\u000b-\u001f\u007f]/u;
const internalNotesSchema = z
  .string()
  .min(1)
  .max(2000)
  .refine((value) => value === value.trim() && !notesControlCharacterPattern.test(value), {
    message: "Notes must be trimmed and contain no control characters other than line breaks",
  });

const studentAdminDetailsBaseShape = {
  shortName: canonicalText(64).optional(),
  nickname: canonicalText(64).optional(),
  city: canonicalText(120).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/u)
    .optional(),
  idCardExpiresOn: dateOnlySchema.optional(),
  profession: canonicalText(120).optional(),
  weightKg: z.number().finite().min(1).max(400).optional(),
  heightCm: z.number().finite().min(30).max(250).optional(),
  registeredOn: dateOnlySchema.optional(),
  recommendedByStudentId: opaqueIdentifierSchema.optional(),
  internalNotes: internalNotesSchema.optional(),
} as const;

export const studentAdminDetailsSchema = z
  .strictObject({
    ...studentAdminDetailsBaseShape,
    healthNumber: administrativeIdentifierSchema.optional(),
    howHeard: canonicalText(64).optional(),
    initialContact: canonicalText(64).optional(),
  })
  .readonly();

export type StudentAdminDetails = Readonly<z.infer<typeof studentAdminDetailsSchema>>;

export const studentAdminDetailsInputSchema = z
  .strictObject({
    ...studentAdminDetailsBaseShape,
    healthNumber: administrativeIdentifierInputSchema.optional(),
    howHeard: z.enum(memberHowHeardOptions).optional(),
    initialContact: z.enum(memberInitialContactOptions).optional(),
  })
  .readonly();

export type StudentAdminDetailsInput = Readonly<z.infer<typeof studentAdminDetailsInputSchema>>;
```

(The `\u0000`-style escapes above are regex source text typed as six characters each, exactly like
the existing `controlCharacterPattern` on line 63.)

In `studentAdminProfileBaseShape` **and** in `memberRecordMaintenanceDetailSchema`, after
`postalAddress: postalAddressSchema.optional(),` add:

```ts
  details: studentAdminDetailsSchema.optional(),
```

Replace `adminUpdateStudentInputSchema` (lines 438–457) with:

```ts
export const adminUpdateStudentInputSchema = z
  .strictObject({
    studentId: opaqueIdentifierSchema,
    requestId: z.string().regex(uuidV4Pattern),
    fullName: canonicalText(160),
    dateOfBirth: dateOnlySchema,
    phoneNumber: canonicalText(64).optional(),
    email: z.string().email().max(320).refine(isCanonicalText).optional(),
    trainingCenter: z.enum(trainingCenters),
    trainingTimePreferences: createTrainingPreferencesSchema,
    membershipNumber: administrativeIdentifierInputSchema.optional(),
    idCardNumber: administrativeIdentifierInputSchema.optional(),
    vatNumber: administrativeIdentifierInputSchema.optional(),
    gender: z.enum(memberGenders),
    frequencyNote: canonicalText(256).optional(),
    emergencyContact: emergencyContactSchema.optional(),
    postalAddress: postalAddressSchema.optional(),
    /** Absent = keep the stored block; present = replace it (T051V2). */
    details: studentAdminDetailsInputSchema.optional(),
  })
  .refine((value) => value.details?.recommendedByStudentId !== value.studentId, {
    path: ["details", "recommendedByStudentId"],
    message: "A member cannot recommend themselves",
  })
  .readonly();
```

In `toMemberRecordMaintenanceDetail`, after the `postalAddress` spread (line 622), add:

```ts
    ...(profile.details === undefined ? {} : { details: Object.freeze({ ...profile.details }) }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run --project node packages/domain/src/members/member-directory-contracts.test.ts`
Expected: PASS (existing tests plus the 6 new ones).

- [ ] **Step 5: Prove the compatibility claim over every existing profile parser**

Run: `corepack pnpm vitest run --project node apps/functions/src/members apps/functions/src/families packages/domain/src/members`
Expected: PASS with no edits to those tests — documents without `details` parse exactly as before.
Also run `corepack pnpm vitest run --project web apps/web/src/lib/members-client.test.ts apps/web/src/app/admin/members`
Expected: PASS (the web imports the same schemas).

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/members/member-directory-contracts.ts packages/domain/src/members/member-directory-contracts.test.ts
git commit -m "feat(domain): optional DETAILS block on the restricted admin profile (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Domain — pure record derivations (birthday badge, BMI, age helpers, member number)

**Files:**

- Create: `packages/domain/src/members/member-profile-contracts.ts`
- Test: `packages/domain/src/members/member-profile-contracts.test.ts`
- Modify: `packages/domain/package.json` — subpath after `"./members/engagement"` (line 72)
- Modify: `packages/domain/tsconfig.runtime.json` — include after `src/members/member-engagement-contracts.ts`

**Interfaces:**

- Consumes: `deriveUpcomingBirthdays` (`packages/domain/src/birthdays/upcoming-birthday-contracts.ts:123`),
  `ageInCompletedYears` (`packages/domain/src/levels/level-contracts.ts:865`).
- Produces: `BirthdayBadge`, `deriveBirthdayBadge(dateOfBirth: string, today: string): BirthdayBadge`,
  `BmiCategory`, `deriveBmi(weightKg: number | undefined, heightCm: number | undefined): { value: number; category: BmiCategory } | null`,
  `academyDateOf(nowIso: string): string`, `memberAgeOn(dateOfBirth: string, today: string): number | null`,
  `wholeMonthsBetween(from: string, to: string): number`,
  `deriveShortNameVariants(fullName: string): readonly string[]`,
  `nextFreeMemberNumber(existing: readonly (string | undefined)[]): string`.

- [ ] **Step 1: Write the failing tests**

Create `packages/domain/src/members/member-profile-contracts.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  academyDateOf,
  deriveBirthdayBadge,
  deriveBmi,
  deriveShortNameVariants,
  memberAgeOn,
  nextFreeMemberNumber,
  wholeMonthsBetween,
} from "./member-profile-contracts";

describe("birthday badge (reuses deriveUpcomingBirthdays)", () => {
  const today = "2026-09-17";

  it("is today, a count of 1..7 days, or nothing", () => {
    expect(deriveBirthdayBadge("1990-09-17", today)).toEqual({ kind: "today" });
    expect(deriveBirthdayBadge("1990-09-18", today)).toEqual({ kind: "inDays", days: 1 });
    expect(deriveBirthdayBadge("1990-09-24", today)).toEqual({ kind: "inDays", days: 7 });
    expect(deriveBirthdayBadge("1990-09-25", today)).toBeNull();
    expect(deriveBirthdayBadge("1990-09-16", today)).toBeNull();
  });

  it("crosses the year boundary", () => {
    expect(deriveBirthdayBadge("2001-01-02", "2026-12-30")).toEqual({ kind: "inDays", days: 3 });
  });

  it("greets 29 February on 28 February in a non-leap year", () => {
    expect(deriveBirthdayBadge("2000-02-29", "2027-02-28")).toEqual({ kind: "today" });
    expect(deriveBirthdayBadge("2000-02-29", "2028-02-28")).toEqual({ kind: "inDays", days: 1 });
  });

  it("returns nothing for an unusable date", () => {
    expect(deriveBirthdayBadge("not-a-date", today)).toBeNull();
    expect(deriveBirthdayBadge("1990-02-30", today)).toBeNull();
  });
});

describe("BMI", () => {
  it("rounds to one decimal and uses the WHO adult bands", () => {
    expect(deriveBmi(70.5, 175)).toEqual({ value: 23, category: "healthy" });
    expect(deriveBmi(50, 175)).toEqual({ value: 16.3, category: "underweight" });
    expect(deriveBmi(56.65625, 175)).toEqual({ value: 18.5, category: "healthy" });
    expect(deriveBmi(80, 175)).toEqual({ value: 26.1, category: "overweight" });
    expect(deriveBmi(95, 175)).toEqual({ value: 31, category: "obese" });
  });

  it("is absent when either measurement is missing or out of range", () => {
    expect(deriveBmi(undefined, 175)).toBeNull();
    expect(deriveBmi(70, undefined)).toBeNull();
    expect(deriveBmi(0, 175)).toBeNull();
    expect(deriveBmi(70, 29)).toBeNull();
    expect(deriveBmi(Number.NaN, 175)).toBeNull();
  });
});

describe("dates and ages", () => {
  it("reads the academy day in Europe/Jersey", () => {
    expect(academyDateOf("2026-06-30T23:30:00.000Z")).toBe("2026-07-01");
    expect(academyDateOf("2026-12-31T23:30:00.000Z")).toBe("2026-12-31");
  });

  it("computes completed years and whole months", () => {
    expect(memberAgeOn("2000-09-18", "2026-09-17")).toBe(25);
    expect(memberAgeOn("2000-09-17", "2026-09-17")).toBe(26);
    expect(memberAgeOn("bad", "2026-09-17")).toBeNull();
    expect(wholeMonthsBetween("2026-01-15", "2026-09-17")).toBe(8);
    expect(wholeMonthsBetween("2026-01-31", "2026-02-28")).toBe(0);
    expect(wholeMonthsBetween("2026-09-18", "2026-09-17")).toBe(0);
  });
});

describe("DETAILS helpers", () => {
  it("offers short name variants from the full name", () => {
    expect(deriveShortNameVariants("Test Member Alpha")).toEqual([
      "Test",
      "Test Alpha",
      "Test A.",
      "Test Member",
    ]);
    expect(deriveShortNameVariants("Tester")).toEqual(["Tester"]);
    expect(deriveShortNameVariants("  Test   Member ")).toEqual(["Test", "Test Member", "Test M."]);
  });

  it("suggests the next free numeric member number", () => {
    expect(nextFreeMemberNumber(["1", "0152", "A-7", undefined, "99"])).toBe("153");
    expect(nextFreeMemberNumber([])).toBe("1");
    expect(nextFreeMemberNumber(["BPT 0001"])).toBe("1");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project node packages/domain/src/members/member-profile-contracts.test.ts`
Expected: FAIL — `Failed to resolve import "./member-profile-contracts"`.

- [ ] **Step 3: Implement the module**

Create `packages/domain/src/members/member-profile-contracts.ts`:

```ts
import { deriveUpcomingBirthdays } from "../birthdays/upcoming-birthday-contracts";
import { ageInCompletedYears } from "../levels/level-contracts";

/**
 * T051V2 (E1): what the canonical member record derives instead of storing. Nothing here reads a
 * clock: callers pass the academy day, so the server and the tests agree on "today".
 */

export type BirthdayBadge =
  Readonly<{ kind: "today" }> | Readonly<{ kind: "inDays"; days: number }> | null;

export const birthdayBadgeWindowDays = 7;

/**
 * The badge in the record header. It asks the existing birthday derivation about one synthetic,
 * eligible candidate, so the 29 February rule and the day arithmetic live in one place only.
 */
export function deriveBirthdayBadge(dateOfBirth: string, today: string): BirthdayBadge {
  const [match] = deriveUpcomingBirthdays({
    today,
    windowDays: birthdayBadgeWindowDays,
    candidates: [
      {
        studentId: "record",
        fullName: "record",
        dateOfBirth,
        participantType: "adult",
        trainingCenter: "Town",
        active: true,
        status: "active",
      },
    ],
  });
  if (match === undefined) return null;
  return match.daysAway === 0
    ? Object.freeze({ kind: "today" as const })
    : Object.freeze({ kind: "inDays" as const, days: match.daysAway });
}

export type BmiCategory = "underweight" | "healthy" | "overweight" | "obese";

/** Computed on read, never stored (spec §5.5). Bounds match the DETAILS input limits. */
export function deriveBmi(
  weightKg: number | undefined,
  heightCm: number | undefined,
): Readonly<{ value: number; category: BmiCategory }> | null {
  if (
    weightKg === undefined ||
    heightCm === undefined ||
    !Number.isFinite(weightKg) ||
    !Number.isFinite(heightCm) ||
    weightKg < 1 ||
    weightKg > 400 ||
    heightCm < 30 ||
    heightCm > 250
  ) {
    return null;
  }
  const metres = heightCm / 100;
  const raw = weightKg / (metres * metres);
  const category: BmiCategory =
    raw < 18.5 ? "underweight" : raw < 25 ? "healthy" : raw < 30 ? "overweight" : "obese";
  return Object.freeze({ value: Math.round(raw * 10) / 10, category });
}

const jerseyDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Jersey",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar day at the academy for an instant (spec §5.3: Europe/Jersey). */
export function academyDateOf(nowIso: string): string {
  return jerseyDay.format(new Date(nowIso));
}

export function memberAgeOn(dateOfBirth: string, today: string): number | null {
  return ageInCompletedYears(dateOfBirth, today);
}

/** Whole calendar months from one date-only value to another; 0 when `to` is before `from`. */
export function wholeMonthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  if (
    [fromYear, fromMonth, fromDay, toYear, toMonth, toDay].some((part) => !Number.isInteger(part))
  ) {
    return 0;
  }
  let months = (toYear! - fromYear!) * 12 + (toMonth! - fromMonth!);
  if (toDay! < fromDay!) months -= 1;
  return Math.max(0, months);
}

/** The short-name choices the DETAILS select offers, most common first, each at most 64 chars. */
export function deriveShortNameVariants(fullName: string): readonly string[] {
  const tokens = fullName
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length > 0);
  const [first] = tokens;
  if (first === undefined) return Object.freeze([]);
  const last = tokens.at(-1);
  const variants =
    tokens.length === 1 || last === undefined
      ? [first]
      : [
          first,
          `${first} ${last}`,
          `${first} ${last.charAt(0)}.`,
          ...(tokens.length >= 3 ? [`${first} ${tokens[1]}`] : []),
        ];
  return Object.freeze([...new Set(variants)].filter((variant) => variant.length <= 64));
}

/**
 * The number the DETAILS form proposes for a member without one: the highest purely numeric member
 * number plus one. Non-numeric numbers are ignored.
 * ponytail: numbers above 9 digits are ignored too; the academy issues sequential small numbers.
 */
export function nextFreeMemberNumber(existing: readonly (string | undefined)[]): string {
  let highest = 0;
  for (const value of existing) {
    if (value === undefined || !/^\d{1,9}$/u.test(value)) continue;
    highest = Math.max(highest, Number(value));
  }
  return String(highest + 1);
}
```

In `packages/domain/package.json`, after the `"./members/engagement"` entry (line 72) add:

```json
    "./members/profile": {
      "types": "./src/members/member-profile-contracts.ts",
      "import": "./src/members/member-profile-contracts.ts",
      "default": "./lib/members/member-profile-contracts.js"
    },
```

In `packages/domain/tsconfig.runtime.json`, after `"src/members/member-engagement-contracts.ts",` add:

```json
    "src/members/member-profile-contracts.ts",
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run --project node packages/domain/src/members/member-profile-contracts.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Verify the runtime build picks the module up**

Run: `corepack pnpm --filter @bpt-jersey/domain build:runtime && ls packages/domain/lib/members/member-profile-contracts.js`
Expected: the build exits 0 and `ls` prints the path.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/members/member-profile-contracts.ts packages/domain/src/members/member-profile-contracts.test.ts packages/domain/package.json packages/domain/tsconfig.runtime.json
git commit -m "feat(domain): member record derivations - birthday badge, BMI, member number (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Domain — role-trimmed profile and name-search contracts

**Files:**

- Modify: `packages/domain/src/members/member-profile-contracts.ts` (append; add imports at the top)
- Test: `packages/domain/src/members/member-profile-contracts.test.ts` (append)

**Interfaces:**

- Consumes: Task 1 `memberRecordMaintenanceDetailSchema` (now carrying `details`),
  `adminUpdateStudentInputSchema`; `participantTypes` (`packages/domain/src/profiles/profile-contracts.ts:10`);
  `currentMembershipStatuses` (`packages/domain/src/memberships/membership-contracts.ts:14`).
- Produces: `memberRecordTabs`, `MemberRecordTab`, `memberProfileRequestSchema`,
  `MemberProfileRequest`, `birthdayBadgeSchema`, `memberProfileHeaderSchema`, `MemberProfileHeader`,
  `coachMemberProfileHeaderSchema`, `memberProfileCardsSchema`, `MemberProfileCards`,
  `memberDetailsSchema`, `MemberDetails`, `updateMemberDetailsInputSchema`,
  `UpdateMemberDetailsInput`, `memberProfileSchema`, `MemberProfile`, `FullMemberProfile`,
  `CoachMemberProfile`, `memberNameSearchLimit` (= 20), `memberNameSearchRequestSchema`,
  `memberNameSearchResultSchema`, `MemberNameSearchResult`.

Design notes: `memberDetailsSchema` is the existing maintenance detail (which Task 1 extended with
`details`), and `updateMemberDetailsInputSchema` is the existing update input — aliases, not copies,
so there is one definition of each field. Both views are `strictObject`s: an extra key in a response
is a parse failure in the web client, which is what makes "coach gets header only" enforceable on
both sides.

- [ ] **Step 1: Write the failing tests**

Append to `packages/domain/src/members/member-profile-contracts.test.ts` (extend the import with
`memberNameSearchRequestSchema`, `memberNameSearchResultSchema`, `memberProfileRequestSchema`,
`memberProfileSchema`, `memberRecordTabs`, `updateMemberDetailsInputSchema`):

```ts
describe("member profile contracts", () => {
  const coachHeader = {
    studentId: "student-1",
    fullName: "Test Member A",
    age: 26,
    participantType: "adult",
    status: "active",
    birthdayBadge: { kind: "inDays", days: 3 },
  } as const;
  const fullProfile = {
    view: "full",
    header: { ...coachHeader, maskedMemberReference: "****0000" },
    cards: {
      memberSince: "2026-01-15",
      monthsAsMember: 8,
      profession: "Tester",
      accountManagers: [{ displayName: "Test Guardian", familyId: "family-1" }],
      currentMembership: {
        membershipId: "membership-1",
        planName: "Test Plan",
        status: "active",
        validUntil: "2026-12-31",
      },
    },
    details: {
      studentId: "student-1",
      fullName: "Test Member A",
      dateOfBirth: "2000-09-20",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      participantType: "adult",
      active: true,
      status: "active",
      gender: "unknown",
      membershipNumber: "00000000",
      details: { heightCm: 175, weightKg: 70 },
    },
    nextFreeMemberNumber: "12",
  } as const;

  it("lists the eight record tabs in Regyfit order", () => {
    expect(memberRecordTabs).toEqual([
      "profile",
      "details",
      "plan",
      "documents",
      "payments",
      "classes",
      "communication",
      "notes",
    ]);
  });

  it("accepts only a strict studentId request", () => {
    expect(memberProfileRequestSchema.safeParse({ studentId: "student-1" }).success).toBe(true);
    for (const bad of [
      {},
      { studentId: "" },
      { studentId: "../x" },
      { studentId: "student-1", academyId: "academy-2" },
      { studentId: "student-1", view: "full" },
    ]) {
      expect(memberProfileRequestSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("parses the full view and the coach view", () => {
    expect(memberProfileSchema.safeParse(fullProfile).success).toBe(true);
    expect(memberProfileSchema.safeParse({ view: "coach", header: coachHeader }).success).toBe(
      true,
    );
  });

  it("refuses a coach view carrying anything beyond the header", () => {
    for (const bad of [
      { view: "coach", header: { ...coachHeader, maskedMemberReference: "****0000" } },
      { view: "coach", header: coachHeader, details: fullProfile.details },
      { view: "coach", header: coachHeader, cards: fullProfile.cards },
      { view: "coach", header: { ...coachHeader, dateOfBirth: "2000-09-20" } },
    ]) {
      expect(memberProfileSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("bounds the badge and refuses unknown keys in the full view", () => {
    expect(
      memberProfileSchema.safeParse({
        ...fullProfile,
        header: { ...fullProfile.header, birthdayBadge: { kind: "inDays", days: 8 } },
      }).success,
    ).toBe(false);
    expect(memberProfileSchema.safeParse({ ...fullProfile, auditId: "audit-1" }).success).toBe(
      false,
    );
    expect(
      memberProfileSchema.safeParse({
        ...fullProfile,
        header: { ...fullProfile.header, birthdayBadge: null },
        cards: { ...fullProfile.cards, currentMembership: null, accountManagers: [] },
      }).success,
    ).toBe(true);
  });

  it("uses the directory update input for DETAILS saves", () => {
    expect(
      updateMemberDetailsInputSchema.safeParse({
        studentId: "student-1",
        requestId: "41cbb1aa-7020-4bb5-88a4-dbc73c5f0123",
        fullName: "Test Member A",
        dateOfBirth: "2000-09-20",
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
        gender: "unknown",
        details: { howHeard: "Website" },
      }).success,
    ).toBe(true);
  });

  it("keeps the name search small and closed", () => {
    expect(memberNameSearchRequestSchema.safeParse({ query: " te " }).success).toBe(true);
    for (const bad of [{ query: "t" }, { query: "x".repeat(81) }, { query: "test", limit: 500 }]) {
      expect(memberNameSearchRequestSchema.safeParse(bad).success).toBe(false);
    }
    const member = { studentId: "student-1", fullName: "Test Member A" };
    expect(memberNameSearchResultSchema.safeParse({ members: [member] }).success).toBe(true);
    expect(
      memberNameSearchResultSchema.safeParse({ members: Array.from({ length: 21 }, () => member) })
        .success,
    ).toBe(false);
    expect(
      memberNameSearchResultSchema.safeParse({
        members: [{ ...member, dateOfBirth: "2000-01-01" }],
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project node packages/domain/src/members/member-profile-contracts.test.ts`
Expected: FAIL — `memberRecordTabs` / `memberProfileSchema` are undefined.

- [ ] **Step 3: Implement the contracts**

At the top of `member-profile-contracts.ts`, replace the two imports with:

```ts
import { z } from "zod";

import { deriveUpcomingBirthdays } from "../birthdays/upcoming-birthday-contracts";
import { ageInCompletedYears } from "../levels/level-contracts";
import { currentMembershipStatuses } from "../memberships/membership-contracts";
import { participantTypes } from "../profiles/profile-contracts";
import {
  adminUpdateStudentInputSchema,
  memberRecordMaintenanceDetailSchema,
} from "./member-directory-contracts";
```

Append:

```ts
export const memberRecordTabs = Object.freeze([
  "profile",
  "details",
  "plan",
  "documents",
  "payments",
  "classes",
  "communication",
  "notes",
] as const);
export type MemberRecordTab = (typeof memberRecordTabs)[number];

const opaqueIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const displayText = (max: number) => z.string().min(1).max(max);

export const memberProfileRequestSchema = z.strictObject({ studentId: opaqueIdSchema }).readonly();
export type MemberProfileRequest = Readonly<z.infer<typeof memberProfileRequestSchema>>;

export const birthdayBadgeSchema = z.union([
  z.strictObject({ kind: z.literal("today") }),
  z.strictObject({ kind: z.literal("inDays"), days: z.number().int().min(1).max(7) }),
  z.null(),
]);

const headerShape = {
  studentId: opaqueIdSchema,
  fullName: displayText(160),
  age: z.number().int().min(0).max(130).nullable(),
  participantType: z.enum(participantTypes),
  status: z.enum(["active", "inactive", "suspended"]),
  birthdayBadge: birthdayBadgeSchema,
} as const;

/** What headCoach and coach receive (grill G6): no identifier of any kind. */
export const coachMemberProfileHeaderSchema = z.strictObject(headerShape);

export const memberProfileHeaderSchema = z.strictObject({
  ...headerShape,
  maskedMemberReference: z
    .string()
    .regex(/^\*{4}.{4}$/u)
    .optional(),
});
export type MemberProfileHeader = Readonly<z.infer<typeof memberProfileHeaderSchema>>;

export const memberProfileCardsSchema = z.strictObject({
  memberSince: dateOnlySchema,
  monthsAsMember: z.number().int().min(0),
  profession: displayText(120).optional(),
  accountManagers: z
    .array(z.strictObject({ displayName: displayText(160), familyId: opaqueIdSchema }))
    .max(10),
  currentMembership: z
    .strictObject({
      membershipId: opaqueIdSchema,
      planName: displayText(160),
      status: z.enum(currentMembershipStatuses),
      validUntil: dateOnlySchema.nullable(),
    })
    .nullable(),
});
export type MemberProfileCards = Readonly<z.infer<typeof memberProfileCardsSchema>>;

/** One definition of every DETAILS field: the maintenance detail, extended in T051V2. */
export const memberDetailsSchema = memberRecordMaintenanceDetailSchema;
export type MemberDetails = Readonly<z.infer<typeof memberDetailsSchema>>;

/** DETAILS are saved through the existing `updateMember` callable (full replacement). */
export const updateMemberDetailsInputSchema = adminUpdateStudentInputSchema;
export type UpdateMemberDetailsInput = Readonly<z.infer<typeof updateMemberDetailsInputSchema>>;

const fullMemberProfileSchema = z.strictObject({
  view: z.literal("full"),
  header: memberProfileHeaderSchema,
  cards: memberProfileCardsSchema,
  details: memberDetailsSchema,
  nextFreeMemberNumber: z
    .string()
    .regex(/^\d{1,10}$/u)
    .optional(),
});
const coachMemberProfileSchema = z.strictObject({
  view: z.literal("coach"),
  header: coachMemberProfileHeaderSchema,
});

export const memberProfileSchema = z.discriminatedUnion("view", [
  fullMemberProfileSchema,
  coachMemberProfileSchema,
]);
export type MemberProfile = Readonly<z.infer<typeof memberProfileSchema>>;
export type FullMemberProfile = Readonly<z.infer<typeof fullMemberProfileSchema>>;
export type CoachMemberProfile = Readonly<z.infer<typeof coachMemberProfileSchema>>;

export const memberNameSearchLimit = 20;

export const memberNameSearchRequestSchema = z
  .strictObject({ query: z.string().trim().min(2).max(80) })
  .readonly();

export const memberNameSearchResultSchema = z.strictObject({
  members: z
    .array(z.strictObject({ studentId: opaqueIdSchema, fullName: displayText(160) }))
    .max(memberNameSearchLimit),
});
export type MemberNameSearchResult = Readonly<z.infer<typeof memberNameSearchResultSchema>>;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run --project node packages/domain/src/members/member-profile-contracts.test.ts`
Expected: PASS (19 tests).

- [ ] **Step 5: Typecheck the domain package**

Run: `corepack pnpm --filter @bpt-jersey/domain typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/members/member-profile-contracts.ts packages/domain/src/members/member-profile-contracts.test.ts
git commit -m "feat(domain): role-trimmed member profile and name search contracts (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Functions writer — keep `details` when omitted, create a missing admin profile

**Files:**

- Modify: `apps/functions/src/members/canonical-member-directory-service.ts` — `buildUpdatedAdminProfile`
  (lines 463–492), new `emptyAdminProfile` beside it, `updateAdminMember` profile read (lines 1080–1116)
  and the profile write (line 1211).
- Test: `apps/functions/src/members/canonical-member-directory-service.test.ts` (new `describe` at the end).

**Interfaces:**

- Consumes: Task 1 `AdminUpdateStudentInput.details`, `StudentAdminProfile.details`.
- Produces: no new exports. Behaviour: `updateMember` with `details` replaces the stored block
  (an empty object clears it); without `details` keeps the stored block; for a student without a
  `studentAdminProfiles` document it creates one (`source: "admin"`) inside the same transaction.
  Member number uniqueness keeps using the existing `studentIdentityKeys` reservation in the same
  transaction (`conflict` → callable `already-exists`).

Why the missing-profile case is here: minors created through Families only get an admin profile when
the waiver carried optional blocks (`family-service.ts:686-701`), and `updateAdminMember` currently
answers `unavailable` for them (`documentData` at line 1086 throws "Student admin profile is
missing"). Without this, DETAILS could never be saved for those members.

- [ ] **Step 1: Write the failing tests**

Append to `canonical-member-directory-service.test.ts`:

```ts
describe("DETAILS block on the canonical update (T051V2)", () => {
  const profilePath = "academies/academy-1/studentAdminProfiles/student-existing-1";
  const details = { profession: "Tester", heightCm: 175, howHeard: "Website" } as const;

  it("replaces the details block when sent and keeps it when omitted", async () => {
    const harness = fakeFirestore(existingMemberSeed());
    const writer = service(harness.firestore);

    await writer.updateAdminMember({
      actor: actor(),
      value: { ...updateInput("11111111-1111-4111-8111-111111111111"), details },
      now,
    });
    expect(harness.records.get(profilePath)).toEqual(expect.objectContaining({ details }));

    await writer.updateAdminMember({
      actor: actor(),
      value: updateInput("22222222-2222-4222-8222-222222222222"),
      now,
    });
    expect(harness.records.get(profilePath)).toEqual(expect.objectContaining({ details }));

    await writer.updateAdminMember({
      actor: actor(),
      value: { ...updateInput("33333333-3333-4333-8333-333333333333"), details: {} },
      now,
    });
    expect(Object.hasOwn(harness.records.get(profilePath) ?? {}, "details")).toBe(false);
  });

  it("replays a details save exactly once", async () => {
    const harness = fakeFirestore(existingMemberSeed());
    const writer = service(harness.firestore);
    const value = { ...updateInput("44444444-4444-4444-8444-444444444444"), details };
    await writer.updateAdminMember({ actor: actor(), value, now });
    const writes = harness.committedWritePaths.length;
    await expect(writer.updateAdminMember({ actor: actor(), value, now })).resolves.toEqual({
      memberId: "student-existing-1",
      studentId: "student-existing-1",
    });
    expect(harness.committedWritePaths).toHaveLength(writes);
  });

  it("refuses a member number reserved by another student and writes no details", async () => {
    const conflictKey = buildStudentIdentityKey({
      academyId: "academy-1",
      kind: "membership-number",
      value: "NEW 0001",
      ownerStudentId: "student-other",
      secretMaterial: identitySecret,
      secretVersion: "identity-v1",
      now: "2026-09-03T20:00:00.000Z",
      actorId: "system-1",
    });
    const harness = fakeFirestore(
      existingMemberSeed({
        [`academies/academy-1/studentIdentityKeys/${conflictKey.keyId}`]: conflictKey,
      }),
    );
    await expect(
      service(harness.firestore).updateAdminMember({
        actor: actor(),
        value: { ...updateInput(), details },
        now,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(harness.committedWritePaths).toEqual([]);
    expect(Object.hasOwn(harness.records.get(profilePath) ?? {}, "details")).toBe(false);
  });

  it("creates an admin profile for a member who has none", async () => {
    const seeded = existingMemberSeed();
    delete seeded[profilePath];
    for (const path of Object.keys(seeded)) {
      if (path.includes("/studentIdentityKeys/")) delete seeded[path];
    }
    const harness = fakeFirestore(seeded);

    // An explicit payload without identifiers: spreading `updateInput()` and overriding with
    // `undefined` would leave keys whose value is undefined, which `isPlainData` refuses.
    await service(harness.firestore).updateAdminMember({
      actor: actor(),
      value: {
        studentId: "student-existing-1",
        requestId: "55555555-5555-4555-8555-555555555555",
        fullName: "Updated Synthetic Adult",
        dateOfBirth: "2000-01-02",
        trainingCenter: "West",
        trainingTimePreferences: ["morning"],
        gender: "female",
        details,
      },
      now,
    });

    expect(harness.records.get(profilePath)).toEqual({
      studentId: "student-existing-1",
      academyId: "academy-1",
      gender: "female",
      details,
      source: "admin",
      schemaVersion: "1",
      createdAt: now,
      createdBy: "owner-1",
      updatedAt: now,
      updatedBy: "owner-1",
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project node apps/functions/src/members/canonical-member-directory-service.test.ts -t "DETAILS block"`
Expected: FAIL — the second update drops `details` (full replacement), and the missing-profile test
rejects with `code: "unavailable"`.

- [ ] **Step 3: Implement**

Replace `buildUpdatedAdminProfile` (lines 463–492) with:

```ts
function buildUpdatedAdminProfile(
  existing: StudentAdminProfile,
  input: AdminUpdateStudentInput,
  actorId: string,
  now: string,
): StudentAdminProfile {
  // T051V2: `details` is the one block an older caller does not know about, so "not sent" keeps it
  // and an empty object clears it. Every other field keeps its full-replacement meaning.
  const nextDetails = input.details ?? existing.details;
  const parsed = studentAdminProfileSchema.safeParse({
    studentId: existing.studentId,
    academyId: existing.academyId,
    ...(input.membershipNumber === undefined ? {} : { membershipNumber: input.membershipNumber }),
    ...(input.idCardNumber === undefined ? {} : { idCardNumber: input.idCardNumber }),
    ...(input.vatNumber === undefined ? {} : { vatNumber: input.vatNumber }),
    gender: input.gender,
    ...(input.frequencyNote === undefined ? {} : { frequencyNote: input.frequencyNote }),
    ...(input.emergencyContact === undefined
      ? {}
      : { emergencyContact: { ...input.emergencyContact } }),
    ...(input.postalAddress === undefined ? {} : { postalAddress: { ...input.postalAddress } }),
    ...(nextDetails === undefined || Object.keys(nextDetails).length === 0
      ? {}
      : { details: { ...nextDetails } }),
    ...profileProvenance(existing),
    schemaVersion: existing.schemaVersion,
    createdAt: existing.createdAt,
    createdBy: existing.createdBy,
    updatedAt: now,
    updatedBy: actorId,
  });
  if (!parsed.success) {
    throw new CanonicalMemberDirectoryError("invalid", "Invalid updated admin profile");
  }
  return Object.freeze(parsed.data);
}

/**
 * The profile a member without one starts from when office first saves their record: no
 * identifiers, so no reservation is released, and `admin` provenance because office creates it.
 */
function emptyAdminProfile(
  student: StudentProfile,
  actorId: string,
  now: string,
): StudentAdminProfile {
  return Object.freeze(
    studentAdminProfileSchema.parse({
      studentId: student.studentId,
      academyId: student.academyId,
      gender: "unknown",
      source: "admin",
      schemaVersion: "1",
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
    }),
  );
}
```

In `updateAdminMember`, replace the block from `const existingStudent = parseStudentProfileAt(`
(line 1083) through the closing `}` of the `if (…) { throw … "Canonical member record is unavailable" }`
(line 1109) with:

```ts
const existingStudent = parseStudentProfileAt(
  documentData(studentSnapshot, "Student"),
  now.slice(0, 10),
);
if (
  !existingStudent.ok ||
  studentSnapshot.id !== studentId ||
  existingStudent.value.studentId !== studentId ||
  existingStudent.value.academyId !== academyId
) {
  throw new CanonicalMemberDirectoryError("unavailable", "Canonical member record is unavailable");
}
const profileIsNew = !profileSnapshot.exists;
const storedProfile = profileIsNew
  ? undefined
  : studentAdminProfileSchema.safeParse(documentData(profileSnapshot, "Student admin profile"));
if (
  storedProfile !== undefined &&
  (!storedProfile.success ||
    profileSnapshot.id !== studentId ||
    storedProfile.data.studentId !== studentId ||
    storedProfile.data.academyId !== academyId)
) {
  throw new CanonicalMemberDirectoryError("unavailable", "Canonical member record is unavailable");
}
const existingProfile =
  storedProfile?.success === true
    ? storedProfile.data
    : emptyAdminProfile(existingStudent.value, actorId, now);
```

Then, in the rest of `updateAdminMember`, replace every `existingProfile.data` with `existingProfile`
(two places: the `buildUpdatedAdminProfile(` call and `buildKeys(existingProfile.data, dependencies)`),
and replace `transaction.set(profileRef, nextProfile);` (line 1211) with:

```ts
if (profileIsNew) transaction.create(profileRef, nextProfile);
else transaction.set(profileRef, nextProfile);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run --project node apps/functions/src/members/canonical-member-directory-service.test.ts`
Expected: PASS — all existing writer tests plus the 4 new ones.

- [ ] **Step 5: Prove the new branch is load-bearing**

Temporarily change `const nextDetails = input.details ?? existing.details;` to
`const nextDetails = input.details;` and re-run the command from Step 4.
Expected: FAIL in "replaces the details block when sent and keeps it when omitted". Restore the line
and re-run: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/functions/src/members/canonical-member-directory-service.ts apps/functions/src/members/canonical-member-directory-service.test.ts
git commit -m "feat(functions): canonical update keeps DETAILS when omitted and creates a missing admin profile (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Functions read service — audited `memberProfileRecord`

**Files:**

- Modify: `apps/functions/src/members/canonical-member-directory-read-service.ts` — imports (lines 14–29),
  `CanonicalMemberDirectoryReadService` type (lines 73–87), new method inside the returned object
  (after `detail`, line 875).
- Modify: `apps/functions/src/members/member-directory-callables.test.ts` — reader mock in `services()`
  (after `lookup`, line 74).
- Test: `apps/functions/src/members/canonical-member-directory-read-service.test.ts` (new `describe` at the end).

**Interfaces:**

- Consumes: Task 3 `memberProfileRequestSchema`; existing `runRestricted`, `parseStudent`,
  `parseOptionalAdminProfile`, `studentPath`, `profilePath`.
- Produces:
  - `export type MemberProfileRecord = Readonly<{ student: StudentProfile; adminProfile?: StudentAdminProfile }>`
  - `CanonicalMemberDirectoryReadService.memberProfileRecord: (command: DirectoryReadCommand) => Promise<MemberProfileRecord>`
  - Same restricted budget (20 per 5 minutes per actor) and the same audit action/purpose as
    `getMemberDetail`: `member.detail.read` / `member-record-maintenance`. No audit vocabulary change.

- [ ] **Step 1: Write the failing tests**

Append to `canonical-member-directory-read-service.test.ts`:

```ts
describe("member profile record read (T051V2)", () => {
  it("returns the student and the admin profile, audited on the shared budget", async () => {
    const harness = fakeStore();
    const reader = service(harness.store);

    const record = await reader.memberProfileRecord({
      actor: actor(),
      value: { studentId: "student-1" },
      now,
    });

    expect(record.student).toEqual(expect.objectContaining({ studentId: "student-1" }));
    expect(record.adminProfile).toEqual(
      expect.objectContaining({ studentId: "student-1", membershipNumber: "BPT 00000001" }),
    );
    expect(harness.records.get("academies/academy-1/auditEvents/restricted-audit-1")).toEqual(
      expect.objectContaining({
        action: "member.detail.read",
        purpose: "member-record-maintenance",
        result: "completed",
      }),
    );
    expect(harness.records.get("academies/academy-1/studentRestrictedReadLimits/owner-1")).toEqual(
      expect.objectContaining({ attemptCount: 1 }),
    );
  });

  it("answers a student without an admin profile", async () => {
    const seeded = seed();
    delete seeded["academies/academy-1/studentAdminProfiles/student-2"];
    const reader = service(fakeStore(seeded).store);
    const record = await reader.memberProfileRecord({
      actor: actor(),
      value: { studentId: "student-2" },
      now,
    });
    expect(record.adminProfile).toBeUndefined();
    expect(record.student.studentId).toBe("student-2");
  });

  it("audits a miss as not-found", async () => {
    const harness = fakeStore();
    await expect(
      service(harness.store).memberProfileRecord({
        actor: actor(),
        value: { studentId: "student-missing" },
        now,
      }),
    ).rejects.toMatchObject({ code: "not-found" });
    expect(harness.records.get("academies/academy-1/auditEvents/restricted-audit-1")).toEqual(
      expect.objectContaining({ result: "not-found" }),
    );
  });

  it("refuses coaches and loose input before any transaction", async () => {
    const harness = fakeStore();
    const reader = service(harness.store);
    await expect(
      reader.memberProfileRecord({
        actor: { ...actor(), role: "coach" as never },
        value: { studentId: "student-1" },
        now,
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
    for (const value of [{}, { studentId: "student-1", purpose: "x" }, { studentId: "../x" }]) {
      await expect(
        reader.memberProfileRecord({ actor: actor(), value, now }),
      ).rejects.toMatchObject({ code: "invalid" });
    }
    expect(harness.transactions).toBe(0);
  });

  it("stops at the shared limit of 20 restricted reads", async () => {
    const harness = fakeStore();
    const reader = service(harness.store);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await reader.memberProfileRecord({ actor: actor(), value: { studentId: "student-1" }, now });
    }
    await expect(
      reader.memberProfileRecord({ actor: actor(), value: { studentId: "student-1" }, now }),
    ).rejects.toMatchObject({ code: "rate-limited" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project node apps/functions/src/members/canonical-member-directory-read-service.test.ts -t "member profile record"`
Expected: FAIL — `reader.memberProfileRecord is not a function`.

- [ ] **Step 3: Implement**

Add to the imports:

```ts
import { memberProfileRequestSchema } from "@bpt-jersey/domain/members/profile";
```

After `export type ExactMemberLookupResult = …` (line 65) add:

```ts
/** The canonical halves of one member record, read under the restricted-read budget (T051V2). */
export type MemberProfileRecord = Readonly<{
  student: StudentProfile;
  adminProfile?: StudentAdminProfile;
}>;
```

In `CanonicalMemberDirectoryReadService`, after `lookup: …` add:

```ts
/**
 * The member record page's office read. Same budget, same audit action and purpose as `detail`:
 * it exposes the same restricted fields, so it must cost the same. Unlike `detail`, a student
 * without an admin profile is a valid record (minors enrolled without waiver blocks).
 */
memberProfileRecord: (command: DirectoryReadCommand) => Promise<MemberProfileRecord>;
```

In the returned object, after the `detail` method, add:

```ts
    async memberProfileRecord(command) {
      requireAuthorizedActor(command.actor);
      const now = requiredTimestamp(command.now);
      const value = parseInput(memberProfileRequestSchema, command.value);
      return runRestricted<MemberProfileRecord>({
        command: Object.freeze({ ...command, now }),
        action: "member.detail.read",
        purpose: "member-record-maintenance",
        dependencies,
        operation: async (transaction) => {
          const [studentDocument, profileDocument] = await Promise.all([
            transaction.get(studentPath(command.actor.academyId, value.studentId)),
            transaction.get(profilePath(command.actor.academyId, value.studentId)),
          ]);
          if (!studentDocument.exists) {
            return Object.freeze({ kind: "failure", code: "not-found", auditResult: "not-found" });
          }
          const student = parseStudent(
            studentDocument,
            command.actor.academyId,
            value.studentId,
            now.slice(0, 10),
          );
          const adminProfile = parseOptionalAdminProfile(
            profileDocument,
            command.actor.academyId,
            value.studentId,
          );
          return Object.freeze({
            kind: "success",
            value: Object.freeze({ student, ...(adminProfile === undefined ? {} : { adminProfile }) }),
            auditResult: "completed",
          });
        },
      });
    },
```

`parseInput` is typed `z.ZodType<T>`; `memberProfileRequestSchema` is a `ZodReadonly` and satisfies it.

In `member-directory-callables.test.ts`, inside `reader: { … }` after `lookup: vi.fn(…),` add:

```ts
      memberProfileRecord: vi.fn(async () => {
        throw new Error("not used by these handlers");
      }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run --project node apps/functions/src/members/canonical-member-directory-read-service.test.ts apps/functions/src/members/member-directory-callables.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the role guard is load-bearing**

Comment out `requireAuthorizedActor(command.actor);` in `memberProfileRecord` and re-run the first
command of Step 4. Expected: FAIL in "refuses coaches and loose input before any transaction".
Restore the line; re-run: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/functions/src/members/canonical-member-directory-read-service.ts apps/functions/src/members/canonical-member-directory-read-service.test.ts apps/functions/src/members/member-directory-callables.test.ts
git commit -m "feat(functions): audited member profile record read on the restricted budget (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Functions — member profile service and its Firestore adapter

**Files:**

- Create: `apps/functions/src/members/member-profile-service.ts`
- Create: `apps/functions/src/members/member-profile-firestore.ts`
- Test: `apps/functions/src/members/member-profile-service.test.ts`

**Interfaces:**

- Consumes: Task 5 `MemberProfileRecord`; Task 2/3 `deriveBirthdayBadge`, `memberAgeOn`,
  `academyDateOf`, `wholeMonthsBetween`, `nextFreeMemberNumber`, `memberProfileSchema`,
  `memberNameSearchRequestSchema`, `memberNameSearchResultSchema`, `memberNameSearchLimit`;
  existing `maskMembershipReference`, `toMemberRecordMaintenanceDetail`, `memberNamesLimit`
  (`member-directory-contracts.ts:317`), `currentMembershipStatuses`, `FamilyRelationship`,
  `FamilyRecord`, `MembershipRecord`, `StudentProfile`.
- Produces:
  - `export type MemberProfileStore = Readonly<{ getFamily(academyId: string, familyId: string): Promise<FamilyRecord | undefined>; listStudentRelationships(academyId: string, studentId: string): Promise<readonly FamilyRelationship[]>; getUserDisplayName(academyId: string, userId: string): Promise<string | undefined>; listStudentMemberships(academyId: string, studentId: string): Promise<readonly MembershipRecord[]>; getPlanDisplayName(academyId: string, planId: string): Promise<string | undefined>; listMembershipNumbers(academyId: string, limit: number): Promise<readonly (string | undefined)[]>; listStudentNames(academyId: string, limit: number): Promise<readonly Readonly<{ studentId: string; fullName: string }>[]>; }>`
  - `export class MemberProfileError extends Error { code: "invalid" | "unavailable" }`
  - `export type MemberProfileService = Readonly<{ fullProfile(input: { academyId: string; record: MemberProfileRecord; now: string }): Promise<FullMemberProfile>; coachProfile(input: { student: StudentProfile; now: string }): CoachMemberProfile; searchNames(input: { academyId: string; value: unknown }): Promise<MemberNameSearchResult>; }>`
  - `export function createMemberProfileService(dependencies: { store: MemberProfileStore }): MemberProfileService`
  - `export function createMemberProfileFirestoreStore(firestore: Firestore): MemberProfileStore`

Rules the service implements (spec §5.4, §5.6):

- Header: age in completed years on the academy day; `maskedMemberReference` only in the full view
  and only when `maskMembershipReference` yields one (numbers shorter than 8 characters give none —
  existing ADR-009 masking rule, unchanged).
- Member since = `details.registeredOn` when present, else the day the canonical student was created.
- Account managers: for a minor, the adults of active, currently valid guardian relationships; for
  an adult in a family, the family's primary contact when that is somebody else. Names come from
  `academies/{academyId}/users/{userId}.displayName`; an unreadable user is skipped.
- Current membership: the latest-starting membership whose status is trial/active/paused/overdue;
  plan name from the plan document, falling back to the plan id.
- `nextFreeMemberNumber` only when the member has no member number (one extra bounded read).
- Name search: case- and accent-insensitive substring over every canonical student of the academy,
  sorted by name, at most 20, `{ studentId, fullName }` only; more than 2000 students → `unavailable`
  instead of a partial answer (same ceiling as `listMemberNames`).
- Every response is parsed with the domain schema before it leaves the service, so a projection bug
  fails closed instead of leaking a key.

- [ ] **Step 1: Write the failing tests**

Create `apps/functions/src/members/member-profile-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { FamilyRecord, FamilyRelationship } from "@bpt-jersey/domain/families";
import type { StudentAdminProfile } from "@bpt-jersey/domain/members/directory";
import type { MembershipRecord } from "@bpt-jersey/domain/memberships/lifecycle";
import type { StudentProfile } from "@bpt-jersey/domain/profiles";

import { createMemberProfileService, type MemberProfileStore } from "./member-profile-service.js";

const now = "2026-09-17T09:00:00.000Z";
const audit = {
  schemaVersion: "1",
  createdAt: "2026-01-15T10:00:00.000Z",
  createdBy: "owner-1",
  updatedAt: "2026-01-15T10:00:00.000Z",
  updatedBy: "owner-1",
} as const;

function adult(overrides: Partial<StudentProfile> = {}): StudentProfile {
  return {
    studentId: "student-a",
    academyId: "academy-1",
    familyId: "family-a",
    userId: "user-a",
    fullName: "Test Member A",
    dateOfBirth: "2000-09-20",
    email: "member-a@example.test",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    ...audit,
    ...overrides,
  } as StudentProfile;
}

// Built explicitly: `exactOptionalPropertyTypes` forbids overriding userId/email with undefined.
function minor(): StudentProfile {
  return {
    studentId: "student-b",
    academyId: "academy-1",
    familyId: "family-b",
    fullName: "Test Member B",
    dateOfBirth: "2016-03-01",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "minor",
    active: true,
    status: "active",
    ...audit,
  } as StudentProfile;
}

const profileA: StudentAdminProfile = {
  studentId: "student-a",
  academyId: "academy-1",
  membershipNumber: "00000000",
  gender: "unknown",
  details: { registeredOn: "2025-12-01", profession: "Tester", heightCm: 175 },
  source: "admin",
  ...audit,
};

function relationship(overrides: Partial<FamilyRelationship> = {}): FamilyRelationship {
  return {
    relationshipId: "family-b--student-b",
    academyId: "academy-1",
    familyId: "family-b",
    studentId: "student-b",
    adultUserId: "guardian-1",
    relationshipType: "guardian",
    permissions: ["readProfile"],
    validFrom: "2026-01-01T00:00:00.000Z",
    active: true,
    status: "active",
    ...audit,
    ...overrides,
  } as FamilyRelationship;
}

function membership(overrides: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    membershipId: "membership-1",
    academyId: "academy-1",
    familyId: "family-a",
    studentId: "student-a",
    planId: "town-adult",
    status: "active",
    startsAt: "2026-02-01T00:00:00.000Z",
    endsAt: "2026-12-31T23:59:59.000Z",
    nextBillingAt: null,
    ...audit,
    ...overrides,
  } as MembershipRecord;
}

function store(overrides: Partial<MemberProfileStore> = {}): MemberProfileStore {
  const family: FamilyRecord = {
    familyId: "family-a",
    academyId: "academy-1",
    primaryContactUserId: "user-a",
    billingContactUserId: "user-a",
    active: true,
    status: "active",
    ...audit,
  };
  return {
    getFamily: async () => family,
    listStudentRelationships: async () => [],
    getUserDisplayName: async (_academyId, userId) =>
      ({ "guardian-1": "Test Guardian", "guardian-2": "Old Guardian", "user-a": "Test Member A" })[
        userId
      ],
    listStudentMemberships: async () => [],
    getPlanDisplayName: async () => "Test Plan",
    listMembershipNumbers: async () => ["00000000", "7", "12"],
    listStudentNames: async () => [],
    ...overrides,
  };
}

describe("member profile service (T051V2)", () => {
  it("builds the full view for office with exactly the agreed keys", async () => {
    const service = createMemberProfileService({
      store: store({
        listStudentMemberships: async () => [
          membership({
            membershipId: "old",
            status: "cancelled",
            startsAt: "2026-03-01T00:00:00.000Z",
          }),
          membership({
            membershipId: "older",
            status: "paused",
            startsAt: "2026-01-01T00:00:00.000Z",
          }),
          membership(),
        ],
      }),
    });

    const profile = await service.fullProfile({
      academyId: "academy-1",
      record: { student: adult(), adminProfile: profileA },
      now,
    });

    expect(Object.keys(profile).sort()).toEqual(["cards", "details", "header", "view"]);
    expect(profile.header).toEqual({
      studentId: "student-a",
      fullName: "Test Member A",
      age: 25,
      participantType: "adult",
      status: "active",
      maskedMemberReference: "****0000",
      birthdayBadge: { kind: "inDays", days: 3 },
    });
    expect(profile.cards).toEqual({
      memberSince: "2025-12-01",
      monthsAsMember: 9,
      profession: "Tester",
      accountManagers: [],
      currentMembership: {
        membershipId: "membership-1",
        planName: "Test Plan",
        status: "active",
        validUntil: "2026-12-31",
      },
    });
    expect(profile.details).toEqual(
      expect.objectContaining({ membershipNumber: "00000000", details: profileA.details }),
    );
  });

  it("names a minor's current guardians and proposes a member number when there is none", async () => {
    const service = createMemberProfileService({
      store: store({
        listStudentRelationships: async () => [
          relationship(),
          relationship({
            relationshipId: "family-b--student-b-old",
            adultUserId: "guardian-2",
            validTo: "2026-06-01T00:00:00.000Z",
          }),
        ],
      }),
    });

    const profile = await service.fullProfile({
      academyId: "academy-1",
      record: { student: minor() },
      now,
    });

    expect(profile.cards.accountManagers).toEqual([
      { displayName: "Test Guardian", familyId: "family-b" },
    ]);
    expect(profile.cards.currentMembership).toBeNull();
    expect(profile.cards.memberSince).toBe("2026-01-15");
    expect(profile.nextFreeMemberNumber).toBe("13");
    expect(profile.details.gender).toBe("unknown");
    expect(profile.header).not.toHaveProperty("maskedMemberReference");
  });

  it("does not list an adult as their own account manager", async () => {
    const profile = await createMemberProfileService({ store: store() }).fullProfile({
      academyId: "academy-1",
      record: { student: adult(), adminProfile: profileA },
      now,
    });
    expect(profile.cards.accountManagers).toEqual([]);
  });

  it("gives coaches the header only, with no identifier", () => {
    const profile = createMemberProfileService({ store: store() }).coachProfile({
      student: adult(),
      now,
    });
    expect(profile).toEqual({
      view: "coach",
      header: {
        studentId: "student-a",
        fullName: "Test Member A",
        age: 25,
        participantType: "adult",
        status: "active",
        birthdayBadge: { kind: "inDays", days: 3 },
      },
    });
    expect(Object.keys(profile.header).sort()).toEqual([
      "age",
      "birthdayBadge",
      "fullName",
      "participantType",
      "status",
      "studentId",
    ]);
  });

  it("searches names without case or accents and returns only id and name", async () => {
    const names = [
      { studentId: "s3", fullName: "Test Zélia" },
      { studentId: "s1", fullName: "Test Zelia Two" },
      { studentId: "s2", fullName: "Other Person" },
    ];
    const service = createMemberProfileService({
      store: store({ listStudentNames: async () => names }),
    });
    await expect(
      service.searchNames({ academyId: "academy-1", value: { query: "ZELIA" } }),
    ).resolves.toEqual({
      members: [
        { studentId: "s3", fullName: "Test Zélia" },
        { studentId: "s1", fullName: "Test Zelia Two" },
      ],
    });
    await expect(
      service.searchNames({ academyId: "academy-1", value: { query: "x" } }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("caps results at 20 and refuses a partial scan above 2000 students", async () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      studentId: `s${String(index).padStart(2, "0")}`,
      fullName: `Test Member ${String(index).padStart(2, "0")}`,
    }));
    const service = createMemberProfileService({
      store: store({ listStudentNames: async () => many }),
    });
    const result = await service.searchNames({ academyId: "academy-1", value: { query: "test" } });
    expect(result.members).toHaveLength(20);

    const tooMany = createMemberProfileService({
      store: store({
        listStudentNames: async () =>
          Array.from({ length: 2001 }, (_, index) => ({
            studentId: `s${index}`,
            fullName: "Test",
          })),
      }),
    });
    await expect(
      tooMany.searchNames({ academyId: "academy-1", value: { query: "test" } }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project node apps/functions/src/members/member-profile-service.test.ts`
Expected: FAIL — `Failed to resolve import "./member-profile-service.js"`.

- [ ] **Step 3: Implement the service**

Create `apps/functions/src/members/member-profile-service.ts`:

```ts
import type { FamilyRecord, FamilyRelationship } from "@bpt-jersey/domain/families";
import {
  maskMembershipReference,
  memberNamesLimit,
  toMemberRecordMaintenanceDetail,
  type StudentAdminProfile,
} from "@bpt-jersey/domain/members/directory";
import {
  academyDateOf,
  deriveBirthdayBadge,
  memberAgeOn,
  memberNameSearchLimit,
  memberNameSearchRequestSchema,
  memberNameSearchResultSchema,
  memberProfileSchema,
  nextFreeMemberNumber,
  wholeMonthsBetween,
  type CoachMemberProfile,
  type FullMemberProfile,
  type MemberNameSearchResult,
  type MemberProfileCards,
} from "@bpt-jersey/domain/members/profile";
import {
  currentMembershipStatuses,
  type MembershipRecord,
} from "@bpt-jersey/domain/memberships/lifecycle";
import type { StudentProfile } from "@bpt-jersey/domain/profiles";

import type { MemberProfileRecord } from "./canonical-member-directory-read-service.js";

export type MemberProfileStore = Readonly<{
  getFamily: (academyId: string, familyId: string) => Promise<FamilyRecord | undefined>;
  listStudentRelationships: (
    academyId: string,
    studentId: string,
  ) => Promise<readonly FamilyRelationship[]>;
  getUserDisplayName: (academyId: string, userId: string) => Promise<string | undefined>;
  listStudentMemberships: (
    academyId: string,
    studentId: string,
  ) => Promise<readonly MembershipRecord[]>;
  getPlanDisplayName: (academyId: string, planId: string) => Promise<string | undefined>;
  listMembershipNumbers: (
    academyId: string,
    limit: number,
  ) => Promise<readonly (string | undefined)[]>;
  listStudentNames: (
    academyId: string,
    limit: number,
  ) => Promise<readonly Readonly<{ studentId: string; fullName: string }>[]>;
}>;

export class MemberProfileError extends Error {
  public constructor(
    public readonly code: "invalid" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "MemberProfileError";
  }
}

export type MemberProfileService = Readonly<{
  fullProfile: (
    input: Readonly<{ academyId: string; record: MemberProfileRecord; now: string }>,
  ) => Promise<FullMemberProfile>;
  coachProfile: (input: Readonly<{ student: StudentProfile; now: string }>) => CoachMemberProfile;
  searchNames: (
    input: Readonly<{ academyId: string; value: unknown }>,
  ) => Promise<MemberNameSearchResult>;
}>;

const maxAccountManagers = 10;

function headerBase(student: StudentProfile, today: string) {
  return {
    studentId: student.studentId,
    fullName: student.fullName,
    age: memberAgeOn(student.dateOfBirth, today),
    participantType: student.participantType,
    status: student.status,
    birthdayBadge: deriveBirthdayBadge(student.dateOfBirth, today),
  };
}

/** A member with no admin profile is shown with the defaults the writer would create (Task 4). */
function profileOrDefault(
  student: StudentProfile,
  profile: StudentAdminProfile | undefined,
): StudentAdminProfile {
  return (
    profile ?? {
      studentId: student.studentId,
      academyId: student.academyId,
      gender: "unknown",
      source: "admin",
      schemaVersion: "1",
      createdAt: student.createdAt,
      createdBy: student.createdBy,
      updatedAt: student.updatedAt,
      updatedBy: student.updatedBy,
    }
  );
}

function isCurrentGuardian(relationship: FamilyRelationship, student: StudentProfile, now: string) {
  return (
    relationship.studentId === student.studentId &&
    relationship.academyId === student.academyId &&
    relationship.relationshipType === "guardian" &&
    relationship.active &&
    relationship.status === "active" &&
    relationship.validFrom <= now &&
    (relationship.validTo === undefined || relationship.validTo > now)
  );
}

function normalizeName(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function createMemberProfileService(
  dependencies: Readonly<{ store: MemberProfileStore }>,
): MemberProfileService {
  const { store } = dependencies;

  async function accountManagers(
    academyId: string,
    student: StudentProfile,
    now: string,
  ): Promise<MemberProfileCards["accountManagers"]> {
    const candidates: { userId: string; familyId: string }[] = [];
    if (student.participantType === "minor") {
      const relationships = await store.listStudentRelationships(academyId, student.studentId);
      for (const relationship of relationships) {
        if (isCurrentGuardian(relationship, student, now)) {
          candidates.push({ userId: relationship.adultUserId, familyId: relationship.familyId });
        }
      }
    } else if (student.familyId !== undefined) {
      const family = await store.getFamily(academyId, student.familyId);
      if (family !== undefined && family.active && family.primaryContactUserId !== student.userId) {
        candidates.push({ userId: family.primaryContactUserId, familyId: family.familyId });
      }
    }
    const seen = new Set<string>();
    const managers: { displayName: string; familyId: string }[] = [];
    for (const candidate of candidates) {
      if (seen.has(candidate.userId) || managers.length >= maxAccountManagers) continue;
      seen.add(candidate.userId);
      const displayName = (await store.getUserDisplayName(academyId, candidate.userId))?.trim();
      if (displayName !== undefined && displayName.length > 0) {
        managers.push({ displayName, familyId: candidate.familyId });
      }
    }
    return managers;
  }

  async function currentMembership(
    academyId: string,
    studentId: string,
  ): Promise<MemberProfileCards["currentMembership"]> {
    const memberships = await store.listStudentMemberships(academyId, studentId);
    const current = memberships
      .filter((membership) =>
        (currentMembershipStatuses as readonly string[]).includes(membership.status),
      )
      .sort((left, right) => right.startsAt.localeCompare(left.startsAt))[0];
    if (current === undefined) return null;
    const planName = (await store.getPlanDisplayName(academyId, current.planId)) ?? current.planId;
    return {
      membershipId: current.membershipId,
      planName,
      status: current.status as (typeof currentMembershipStatuses)[number],
      validUntil: current.endsAt === null ? null : current.endsAt.slice(0, 10),
    };
  }

  return Object.freeze({
    async fullProfile({ academyId, record, now }) {
      const today = academyDateOf(now);
      const { student, adminProfile } = record;
      const profile = profileOrDefault(student, adminProfile);
      const maskedMemberReference = maskMembershipReference(profile.membershipNumber);
      const memberSince = profile.details?.registeredOn ?? student.createdAt.slice(0, 10);
      const [managers, membership, numbers] = await Promise.all([
        accountManagers(academyId, student, now),
        currentMembership(academyId, student.studentId),
        profile.membershipNumber === undefined
          ? store.listMembershipNumbers(academyId, memberNamesLimit)
          : Promise.resolve(undefined),
      ]);
      const parsed = memberProfileSchema.safeParse({
        view: "full",
        header: {
          ...headerBase(student, today),
          ...(maskedMemberReference === undefined ? {} : { maskedMemberReference }),
        },
        cards: {
          memberSince,
          monthsAsMember: wholeMonthsBetween(memberSince, today),
          ...(profile.details?.profession === undefined
            ? {}
            : { profession: profile.details.profession }),
          accountManagers: managers,
          currentMembership: membership,
        },
        details: toMemberRecordMaintenanceDetail(student, profile),
        ...(numbers === undefined ? {} : { nextFreeMemberNumber: nextFreeMemberNumber(numbers) }),
      });
      if (!parsed.success || parsed.data.view !== "full") {
        throw new MemberProfileError("unavailable", "Member profile projection is invalid");
      }
      return parsed.data;
    },

    coachProfile({ student, now }) {
      const parsed = memberProfileSchema.safeParse({
        view: "coach",
        header: headerBase(student, academyDateOf(now)),
      });
      if (!parsed.success || parsed.data.view !== "coach") {
        throw new MemberProfileError("unavailable", "Member profile projection is invalid");
      }
      return parsed.data;
    },

    async searchNames({ academyId, value }) {
      const request = memberNameSearchRequestSchema.safeParse(value);
      if (!request.success) throw new MemberProfileError("invalid", "Invalid name search");
      const students = await store.listStudentNames(academyId, memberNamesLimit + 1);
      if (students.length > memberNamesLimit) {
        throw new MemberProfileError("unavailable", "Too many members to search at once");
      }
      const needle = normalizeName(request.data.query);
      // ponytail: in-memory scan of at most 2000 names per search; an indexed search is the next step.
      const members = students
        .filter((student) => normalizeName(student.fullName).includes(needle))
        .sort((left, right) => left.fullName.localeCompare(right.fullName, "en-GB"))
        .slice(0, memberNameSearchLimit)
        .map((student) => ({ studentId: student.studentId, fullName: student.fullName }));
      const parsed = memberNameSearchResultSchema.safeParse({ members });
      if (!parsed.success) throw new MemberProfileError("unavailable", "Name search is invalid");
      return parsed.data;
    },
  });
}
```

Check the sort expectation in the first search test: `"Test Zelia Two"` vs `"Test Zélia"` with
`localeCompare(…, "en-GB")` — base letters compare equal up to "Test Zelia", then the shorter string
sorts first, so `"Test Zélia"` precedes `"Test Zelia Two"`, matching the test.

- [ ] **Step 4: Implement the Firestore adapter**

Create `apps/functions/src/members/member-profile-firestore.ts`:

```ts
import type { Firestore } from "firebase-admin/firestore";

import { parseFamilyRecord, parseFamilyRelationship } from "@bpt-jersey/domain/families";
import { parsePlanRecord } from "@bpt-jersey/domain/memberships";
import { parseMembershipRecord } from "@bpt-jersey/domain/memberships/lifecycle";
import { parseUserProfile } from "@bpt-jersey/domain/profiles";

import type { MemberProfileStore } from "./member-profile-service.js";

const maxRelationships = 100;
const maxMemberships = 100;

/**
 * Admin SDK reads for the member record. Every document is parsed with its domain parser and a
 * document that does not parse is skipped: a broken guardian link must not hide the record.
 * All queries are single-field equality or plain collection reads (no composite index).
 */
export function createMemberProfileFirestoreStore(firestore: Firestore): MemberProfileStore {
  const academy = (academyId: string) => firestore.collection("academies").doc(academyId);
  return Object.freeze({
    async getFamily(academyId, familyId) {
      const snapshot = await academy(academyId).collection("families").doc(familyId).get();
      const parsed = snapshot.exists ? parseFamilyRecord(snapshot.data()) : undefined;
      return parsed?.ok === true && parsed.value.academyId === academyId ? parsed.value : undefined;
    },
    async listStudentRelationships(academyId, studentId) {
      const snapshot = await academy(academyId)
        .collection("relationships")
        .where("studentId", "==", studentId)
        .limit(maxRelationships)
        .get();
      return snapshot.docs.flatMap((document) => {
        const parsed = parseFamilyRelationship(document.data());
        return parsed.ok && parsed.value.relationshipId === document.id ? [parsed.value] : [];
      });
    },
    async getUserDisplayName(academyId, userId) {
      const snapshot = await academy(academyId).collection("users").doc(userId).get();
      const parsed = snapshot.exists ? parseUserProfile(snapshot.data()) : undefined;
      return parsed?.ok === true ? parsed.value.displayName : undefined;
    },
    async listStudentMemberships(academyId, studentId) {
      const snapshot = await academy(academyId)
        .collection("memberships")
        .where("studentId", "==", studentId)
        .limit(maxMemberships)
        .get();
      return snapshot.docs.flatMap((document) => {
        const parsed = parseMembershipRecord(document.data());
        return parsed.ok && parsed.value.academyId === academyId ? [parsed.value] : [];
      });
    },
    async getPlanDisplayName(academyId, planId) {
      const snapshot = await academy(academyId).collection("plans").doc(planId).get();
      const parsed = snapshot.exists ? parsePlanRecord(snapshot.data()) : undefined;
      return parsed?.ok === true ? parsed.value.displayName : undefined;
    },
    async listMembershipNumbers(academyId, limit) {
      const snapshot = await academy(academyId)
        .collection("studentAdminProfiles")
        .select("membershipNumber")
        .limit(limit)
        .get();
      return snapshot.docs.map((document) => {
        const value = document.get("membershipNumber") as unknown;
        return typeof value === "string" ? value : undefined;
      });
    },
    async listStudentNames(academyId, limit) {
      const snapshot = await academy(academyId)
        .collection("students")
        .select("fullName")
        .limit(limit)
        .get();
      return snapshot.docs.flatMap((document) => {
        const fullName = document.get("fullName") as unknown;
        return typeof fullName === "string" && fullName.trim().length > 0
          ? [{ studentId: document.id, fullName: fullName.trim() }]
          : [];
      });
    },
  });
}
```

`parseUserProfile` validates `accountType: "client"`, so a staff guardian document would be skipped;
guardians are client accounts, so that is the intended filter.

- [ ] **Step 5: Run the tests and the functions typecheck**

Run: `corepack pnpm vitest run --project node apps/functions/src/members/member-profile-service.test.ts`
Expected: PASS (6 tests).
Run: `corepack pnpm --filter @bpt-jersey/functions typecheck`
Expected: exits 0 (the adapter has no unit test; it is exercised by Plan C's emulator Playwright run).

- [ ] **Step 6: Prove the coach projection cannot leak**

In `coachProfile`, temporarily add `maskedMemberReference: "****0000"` to the `header` object and
re-run the test file. Expected: FAIL in "gives coaches the header only" (schema refuses the key →
`MemberProfileError`). Remove it; re-run: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/functions/src/members/member-profile-service.ts apps/functions/src/members/member-profile-service.test.ts apps/functions/src/members/member-profile-firestore.ts
git commit -m "feat(functions): member profile service - full and coach views, name search (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Functions — `getMemberProfile` and `searchMemberNames` callables (role-trimmed)

**Files:**

- Create: `apps/functions/src/members/member-profile-callables.ts`
- Test: `apps/functions/src/members/member-profile-callables.test.ts`
- Modify: `apps/functions/src/members/member-directory-callables.ts` — export `mapDirectoryError`
  (line 53) as `mapMemberDirectoryError`; rename `defaultServices` (line 223) to exported
  `defaultMemberDirectoryCallableServices` and update its three-plus call sites in the same file;
  export `memberDirectoryCallableOptions` (line 280).
- Modify: `apps/functions/src/index.ts` — after `export { listMemberNames } …` (line 40).
- Modify: `docs/adr/ADR-010-coach-office-powers.md` — append an amendment.

**Interfaces:**

- Consumes: Task 5 `CanonicalMemberDirectoryReadService.memberProfileRecord`; Task 6
  `MemberProfileService`, `MemberProfileError`, `createMemberProfileService`,
  `createMemberProfileFirestoreStore`; Task 3 `memberProfileRequestSchema`; existing
  `requireUserActor` (`apps/functions/src/auth/user-authorization.ts:55`),
  `requireCanonicalMemberDirectoryActor` (`canonical-actor.ts:106`),
  `createFirebaseLevelAuthorization` / `LevelAuthorizationService` (`levels/level-authorization.ts:44,324`).
- Produces:
  - `export type MemberProfileCallableServices = Readonly<{ directory: MemberDirectoryCallableServices; levelAuthorization: LevelAuthorizationService; profiles: MemberProfileService }>`
  - `export type MemberNameSearchCallableServices = Readonly<{ levelAuthorization: LevelAuthorizationService; profiles: MemberProfileService }>`
  - `export async function getMemberProfileHandler(request: CallableRequest<unknown>, services: MemberProfileCallableServices): Promise<MemberProfile>`
  - `export async function searchMemberNamesHandler(request: CallableRequest<unknown>, services: MemberNameSearchCallableServices): Promise<MemberNameSearchResult>`
  - `export const getMemberProfile`, `export const searchMemberNames` (deployed names).
  - Error contract for the web client: `unauthenticated`, `permission-denied`, `invalid-argument`,
    `not-found`, `resource-exhausted` (restricted read budget), `failed-precondition` (directory or
    projection unavailable).

Routing (grill G6): the role claim chooses the door, and each door re-verifies the actor with the
helper that already guards that data — owner/administrator through the canonical directory actor
(App Check in the handler, provisioned staff document, no role lock) and the audited restricted read;
headCoach/coach through the level authorization (App Check, active staff document, one active staff
profile with that role) and `resolveStudent`, which answers only the canonical student document.
Guardians and adult students are refused before any read.

- [ ] **Step 1: Write the failing tests**

Create `apps/functions/src/members/member-profile-callables.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import type { StudentProfile } from "@bpt-jersey/domain/profiles";

import { CanonicalMemberDirectoryReadError } from "./canonical-member-directory-read-service.js";
import type { MemberDirectoryCallableServices } from "./member-directory-callables.js";
import {
  getMemberProfileHandler,
  searchMemberNamesHandler,
  type MemberProfileCallableServices,
} from "./member-profile-callables.js";
import { createMemberProfileService, type MemberProfileStore } from "./member-profile-service.js";

const now = "2026-09-17T09:00:00.000Z";

const student = {
  studentId: "student-a",
  academyId: "academy-1",
  fullName: "Test Member A",
  dateOfBirth: "2000-09-20",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
  participantType: "adult",
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: "2026-01-15T10:00:00.000Z",
  createdBy: "owner-1",
  updatedAt: "2026-01-15T10:00:00.000Z",
  updatedBy: "owner-1",
} as StudentProfile;

function request(data: unknown, input: Readonly<{ role?: string; appCheck?: boolean }> = {}) {
  const role = input.role ?? "owner";
  return {
    data,
    auth:
      role === "anonymous"
        ? undefined
        : { uid: "actor-1", token: { academyId: "academy-1", role } },
    ...(input.appCheck === false ? {} : { app: { appId: "web-app-1" } }),
  } as never;
}

const store: MemberProfileStore = {
  getFamily: async () => undefined,
  listStudentRelationships: async () => [],
  getUserDisplayName: async () => undefined,
  listStudentMemberships: async () => [],
  getPlanDisplayName: async () => undefined,
  listMembershipNumbers: async () => ["7"],
  listStudentNames: async () => [{ studentId: "student-a", fullName: "Test Member A" }],
};

function services() {
  const memberProfileRecord = vi.fn(async () => ({ student }));
  const requireActor = vi.fn(async (req: { auth?: { token: { role: string } } }) => ({
    kind: "user" as const,
    userId: "actor-1",
    academyId: "academy-1",
    role: req.auth?.token.role,
    staffId: null,
  }));
  const resolveStudent = vi.fn(async () => student);
  const isActorActive = vi.fn(async () => true);
  const value: MemberProfileCallableServices = {
    directory: {
      reader: { memberProfileRecord },
      isActorActive,
      now: () => now,
    } as unknown as MemberDirectoryCallableServices,
    levelAuthorization: { requireActor, resolveStudent } as never,
    profiles: createMemberProfileService({ store }),
  };
  return { value, memberProfileRecord, requireActor, resolveStudent, isActorActive };
}

describe("getMemberProfile (T051V2, grill G6)", () => {
  it("gives owner and administrator the full view through the audited restricted read", async () => {
    for (const role of ["owner", "administrator"] as const) {
      const harness = services();
      const profile = await getMemberProfileHandler(
        request({ studentId: "student-a" }, { role }),
        harness.value,
      );
      expect(profile.view).toBe("full");
      expect(Object.keys(profile).sort()).toEqual([
        "cards",
        "details",
        "header",
        "nextFreeMemberNumber",
        "view",
      ]);
      expect(harness.memberProfileRecord).toHaveBeenCalledWith({
        actor: expect.objectContaining({ role, academyId: "academy-1", appCheckVerified: true }),
        value: { studentId: "student-a" },
        now,
      });
      expect(harness.resolveStudent).not.toHaveBeenCalled();
    }
  });

  it("gives headCoach and coach the header only, never touching the restricted reader", async () => {
    for (const role of ["headCoach", "coach"] as const) {
      const harness = services();
      const profile = await getMemberProfileHandler(
        request({ studentId: "student-a" }, { role }),
        harness.value,
      );
      expect(Object.keys(profile).sort()).toEqual(["header", "view"]);
      expect(profile.view).toBe("coach");
      expect(Object.keys(profile.header).sort()).toEqual([
        "age",
        "birthdayBadge",
        "fullName",
        "participantType",
        "status",
        "studentId",
      ]);
      expect(JSON.stringify(profile)).not.toMatch(/dateOfBirth|membership|details|cards/u);
      expect(harness.resolveStudent).toHaveBeenCalledWith(
        expect.objectContaining({ role }),
        "student-a",
      );
      expect(harness.memberProfileRecord).not.toHaveBeenCalled();
      expect(harness.isActorActive).not.toHaveBeenCalled();
    }
  });

  it("refuses client roles and anonymous callers before any read", async () => {
    for (const role of ["guardian", "adultStudent"]) {
      const harness = services();
      await expect(
        getMemberProfileHandler(request({ studentId: "student-a" }, { role }), harness.value),
      ).rejects.toMatchObject({ code: "permission-denied" });
      expect(harness.memberProfileRecord).not.toHaveBeenCalled();
      expect(harness.resolveStudent).not.toHaveBeenCalled();
    }
    const harness = services();
    await expect(
      getMemberProfileHandler(
        request({ studentId: "student-a" }, { role: "anonymous" }),
        harness.value,
      ),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("requires App Check in the handler for office", async () => {
    const harness = services();
    await expect(
      getMemberProfileHandler(
        request({ studentId: "student-a" }, { role: "owner", appCheck: false }),
        harness.value,
      ),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(harness.memberProfileRecord).not.toHaveBeenCalled();
  });

  it("validates the coach payload before resolving the student", async () => {
    const harness = services();
    await expect(
      getMemberProfileHandler(
        request({ studentId: "student-a", view: "full" }, { role: "coach" }),
        harness.value,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(harness.resolveStudent).not.toHaveBeenCalled();
  });

  it("maps the restricted read failures to safe callable codes", async () => {
    for (const [code, expected] of [
      ["not-found", "not-found"],
      ["rate-limited", "resource-exhausted"],
      ["invalid", "invalid-argument"],
    ] as const) {
      const harness = services();
      harness.memberProfileRecord.mockRejectedValueOnce(
        new CanonicalMemberDirectoryReadError(code, "synthetic"),
      );
      await expect(
        getMemberProfileHandler(request({ studentId: "student-a" }), harness.value),
      ).rejects.toMatchObject({ code: expected });
    }
  });
});

describe("searchMemberNames (T051V2)", () => {
  it("lets every staff role search by name", async () => {
    for (const role of ["owner", "administrator", "headCoach", "coach"]) {
      const harness = services();
      await expect(
        searchMemberNamesHandler(request({ query: "test" }, { role }), harness.value),
      ).resolves.toEqual({ members: [{ studentId: "student-a", fullName: "Test Member A" }] });
    }
  });

  it("refuses client roles and invalid queries", async () => {
    for (const role of ["guardian", "adultStudent"]) {
      await expect(
        searchMemberNamesHandler(request({ query: "test" }, { role }), services().value),
      ).rejects.toMatchObject({ code: "permission-denied" });
    }
    await expect(
      searchMemberNamesHandler(request({ query: "t" }, { role: "coach" }), services().value),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project node apps/functions/src/members/member-profile-callables.test.ts`
Expected: FAIL — `Failed to resolve import "./member-profile-callables.js"`.

- [ ] **Step 3: Expose what the new callables reuse**

In `apps/functions/src/members/member-directory-callables.ts`:

- line 53: `function mapDirectoryError(error: unknown): never {` →
  `export function mapMemberDirectoryError(error: unknown): never {`, and rename its five call sites
  in the same file (`return mapDirectoryError(error);` → `return mapMemberDirectoryError(error);`).
- line 223: `function defaultServices(): MemberDirectoryCallableServices {` →
  `export function defaultMemberDirectoryCallableServices(): MemberDirectoryCallableServices {`, and
  rename the five `defaultServices()` call sites at the bottom of the file.
- line 280: `const memberDirectoryCallableOptions = {` → `export const memberDirectoryCallableOptions = {`.

Run: `corepack pnpm vitest run --project node apps/functions/src/members/member-directory-callables.test.ts`
Expected: PASS (pure rename).

- [ ] **Step 4: Implement the callables**

Create `apps/functions/src/members/member-profile-callables.ts`:

```ts
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  memberProfileRequestSchema,
  type MemberNameSearchResult,
  type MemberProfile,
} from "@bpt-jersey/domain/members/profile";

import { requireUserActor } from "../auth/user-authorization.js";
import {
  createFirebaseLevelAuthorization,
  type LevelAuthorizationService,
} from "../levels/level-authorization.js";
import { requireCanonicalMemberDirectoryActor } from "./canonical-actor.js";
import {
  defaultMemberDirectoryCallableServices,
  mapMemberDirectoryError,
  memberDirectoryCallableOptions,
  type MemberDirectoryCallableServices,
} from "./member-directory-callables.js";
import { createMemberProfileFirestoreStore } from "./member-profile-firestore.js";
import {
  MemberProfileError,
  createMemberProfileService,
  type MemberProfileService,
} from "./member-profile-service.js";

export type MemberProfileCallableServices = Readonly<{
  directory: MemberDirectoryCallableServices;
  levelAuthorization: LevelAuthorizationService;
  profiles: MemberProfileService;
}>;

export type MemberNameSearchCallableServices = Readonly<{
  levelAuthorization: LevelAuthorizationService;
  profiles: MemberProfileService;
}>;

const officeRoles: ReadonlySet<string> = new Set(["owner", "administrator"]);
const matRoles: ReadonlySet<string> = new Set(["headCoach", "coach"]);

function mapProfileError(error: unknown): never {
  if (error instanceof MemberProfileError) {
    if (error.code === "invalid")
      throw new HttpsError("invalid-argument", "Invalid member request");
    throw new HttpsError("failed-precondition", "Member record is unavailable");
  }
  return mapMemberDirectoryError(error);
}

/**
 * T051V2 (grill G6): one record, trimmed by role on the server. Office reads everything through the
 * audited restricted read; the mat gets the header only; clients get nothing.
 */
export async function getMemberProfileHandler(
  request: CallableRequest<unknown>,
  services: MemberProfileCallableServices,
): Promise<MemberProfile> {
  const claimed = requireUserActor(request);

  if (officeRoles.has(claimed.role)) {
    const actor = await requireCanonicalMemberDirectoryActor(
      request,
      services.directory.isActorActive,
    );
    try {
      const now = services.directory.now();
      const record = await services.directory.reader.memberProfileRecord({
        actor,
        value: request.data,
        now,
      });
      return await services.profiles.fullProfile({ academyId: actor.academyId, record, now });
    } catch (error) {
      return mapProfileError(error);
    }
  }

  if (matRoles.has(claimed.role)) {
    // `requireActor` re-reads the Auth user and refuses unless its custom claims equal the token's,
    // so the verified role is the claimed one; a second role check here would be dead weight.
    const actor = await services.levelAuthorization.requireActor(request);
    const input = memberProfileRequestSchema.safeParse(request.data);
    if (!input.success) throw new HttpsError("invalid-argument", "Invalid member request");
    const student = await services.levelAuthorization.resolveStudent(actor, input.data.studentId);
    try {
      return services.profiles.coachProfile({ student, now: services.directory.now() });
    } catch (error) {
      return mapProfileError(error);
    }
  }

  throw new HttpsError("permission-denied", "Member record access is not permitted");
}

export async function searchMemberNamesHandler(
  request: CallableRequest<unknown>,
  services: MemberNameSearchCallableServices,
): Promise<MemberNameSearchResult> {
  const actor = await services.levelAuthorization.requireActor(request);
  if (!officeRoles.has(actor.role) && !matRoles.has(actor.role)) {
    throw new HttpsError("permission-denied", "Member search is not permitted");
  }
  try {
    return await services.profiles.searchNames({ academyId: actor.academyId, value: request.data });
  } catch (error) {
    return mapProfileError(error);
  }
}

function profileService(): MemberProfileService {
  return createMemberProfileService({ store: createMemberProfileFirestoreStore(getFirestore()) });
}

export const getMemberProfile = onCall(memberDirectoryCallableOptions, async (request) =>
  getMemberProfileHandler(request, {
    directory: defaultMemberDirectoryCallableServices(),
    levelAuthorization: createFirebaseLevelAuthorization(),
    profiles: profileService(),
  }),
);

/** Needs no directory secret: it reads names only, under the level authorization. */
export const searchMemberNames = onCall({ enforceAppCheck: true }, async (request) =>
  searchMemberNamesHandler(request, {
    levelAuthorization: createFirebaseLevelAuthorization(),
    profiles: profileService(),
  }),
);
```

`searchMemberNamesHandler` receives `MemberProfileCallableServices` in the tests; that type is a
structural superset of `MemberNameSearchCallableServices`, so it type-checks.

In `apps/functions/src/index.ts`, after line 40 add:

```ts
export { getMemberProfile, searchMemberNames } from "./members/member-profile-callables.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm vitest run --project node apps/functions/src/members/member-profile-callables.test.ts apps/functions/src/members/member-directory-callables.test.ts`
Expected: PASS.

- [ ] **Step 6: Prove each role guard is load-bearing**

a) In `getMemberProfileHandler`, temporarily change `const matRoles … new Set(["headCoach", "coach"])`
to `new Set<string>()` and `const officeRoles … new Set(["owner", "administrator", "headCoach", "coach"])`
(coach routed through the office door). Re-run the test file. Expected: FAIL in "gives headCoach
and coach the header only" (`requireCanonicalMemberDirectoryActor` refuses them with
permission-denied). Restore.
b) Change `if (matRoles.has(claimed.role)) {` to `if (!officeRoles.has(claimed.role)) {` (every
non-office role through the mat door). Re-run. Expected: FAIL in "refuses client roles and
anonymous callers before any read" (`resolveStudent` is called for a guardian). Restore.
c) Delete the `if (!officeRoles.has(actor.role) && !matRoles.has(actor.role))` block in
`searchMemberNamesHandler`. Re-run. Expected: FAIL in "refuses client roles and invalid queries".
Restore and re-run: PASS.

- [ ] **Step 7: Record the ADR-010 amendment**

Append to `docs/adr/ADR-010-coach-office-powers.md`:

```markdown
## Enmienda 2026-09-17

Decision del operador en chat (grill G6 de `docs/superpowers/specs/2026-09-17-member-profile-e0-e2-design.md`):
`headCoach` y `coach` abren la ficha canonica de un alumno en `/admin/members/profile` y lo buscan
por nombre en `/admin/members/search`.

- `getMemberProfile` recorta en el servidor: owner/administrator reciben la ficha completa por la
  lectura restringida auditada (mismo presupuesto y accion `member.detail.read` que `getMemberDetail`);
  headCoach/coach reciben solo la cabecera (nombre, edad, tipo de participante, estado, aviso de
  cumpleanos), autorizados con la autorizacion de niveles (`resolveStudent`), sin identificadores,
  fecha de nacimiento, datos de DETAILS, membresia ni responsables. Guardian y adultStudent: denegado.
- `searchMemberNames` devuelve como maximo 20 `{ studentId, fullName }` por nombre para los cuatro roles
  de staff. No abre `listMembers`, `listMemberNames`, `lookupMemberIdentity` ni `getMemberDetail`, que
  siguen siendo de la oficina.
- La interfaz muestra al coach solo la pestana PROFILE (tarjeta IBJJF y Manage, E2). Ocultar pestanas
  no es el control: los tests de `member-profile-callables.test.ts` fijan el conjunto exacto de claves
  por rol.
```

- [ ] **Step 8: Commit**

```bash
git add apps/functions/src/members/member-profile-callables.ts apps/functions/src/members/member-profile-callables.test.ts apps/functions/src/members/member-directory-callables.ts apps/functions/src/index.ts docs/adr/ADR-010-coach-office-powers.md
git commit -m "feat(functions): role-trimmed getMemberProfile and staff name search; ADR-010 amendment (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Web client — `member-profile-client.ts`

**Files:**

- Create: `apps/web/src/lib/member-profile-client.ts`
- Test: `apps/web/src/lib/member-profile-client.test.ts`

**Interfaces:**

- Consumes: Task 3 `memberProfileSchema`, `memberNameSearchResultSchema`,
  `updateMemberDetailsInputSchema`, `MemberProfile`, `MemberNameSearchResult`,
  `UpdateMemberDetailsInput`; callables `getMemberProfile`, `searchMemberNames`, `updateMember`
  (Task 7 and existing); `getFirebaseFunctions` (`apps/web/src/lib/firebase-client.ts`).
- Produces:
  - `export const memberRecordIdPattern: RegExp` and `export function isMemberRecordId(value: string | null): value is string`
  - `export class MemberRecordLoadError extends Error` (message is always one of the fixed strings below)
  - `export class MemberDetailsConflictError extends Error`
  - `export async function getMemberProfile(studentId: string): Promise<MemberProfile>`
  - `export async function saveMemberDetails(input: UpdateMemberDetailsInput): Promise<void>`
  - `export async function searchMemberNames(query: string): Promise<MemberNameSearchResult["members"]>`
  - Fixed user-facing strings: `"This member record link is not valid."`,
    `"This member record was not found."`, `"You do not have access to this member record."`,
    `"Too many member records opened in a few minutes. Wait a moment and try again."`,
    `"Unable to load this member record. Please try again."`,
    `"That member number is already used by another member."`,
    `"Unable to save member details. Please try again."`,
    `"Unable to search members. Please try again."`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/member-profile-client.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  getFirebaseFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(),
}));

vi.mock("./firebase-client", () => ({ getFirebaseFunctions: mocks.getFirebaseFunctions }));
vi.mock("firebase/functions", () => ({ httpsCallable: mocks.httpsCallable }));

import {
  MemberDetailsConflictError,
  getMemberProfile,
  isMemberRecordId,
  saveMemberDetails,
  searchMemberNames,
} from "./member-profile-client";

const coachProfile = {
  view: "coach",
  header: {
    studentId: "student-1",
    fullName: "Test Member A",
    age: 26,
    participantType: "adult",
    status: "active",
    birthdayBadge: { kind: "today" },
  },
} as const;

const detailsInput = {
  studentId: "student-1",
  requestId: "41cbb1aa-7020-4bb5-88a4-dbc73c5f0123",
  fullName: "Test Member A",
  dateOfBirth: "2000-09-17",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
  gender: "unknown",
  membershipNumber: " 0000 ",
  details: { healthNumber: " hn0000 ", howHeard: "Website" },
} as const;

describe("member profile web client", () => {
  beforeEach(() => {
    mocks.callable.mockReset();
    mocks.httpsCallable.mockReset();
    mocks.httpsCallable.mockReturnValue(mocks.callable);
  });

  it("validates the record id before any call", async () => {
    expect(isMemberRecordId("student-1")).toBe(true);
    for (const bad of [null, "", "../student", "a/b", "x".repeat(129), "student 1"]) {
      expect(isMemberRecordId(bad)).toBe(false);
    }
    await expect(getMemberProfile("../student")).rejects.toThrow(
      "This member record link is not valid.",
    );
    expect(mocks.httpsCallable).not.toHaveBeenCalled();
  });

  it("parses the role-trimmed response and refuses anything extra", async () => {
    mocks.callable.mockResolvedValue({ data: coachProfile });
    await expect(getMemberProfile("student-1")).resolves.toEqual(coachProfile);
    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "getMemberProfile");
    expect(mocks.callable).toHaveBeenCalledWith({ studentId: "student-1" });

    mocks.callable.mockResolvedValue({
      data: { ...coachProfile, header: { ...coachProfile.header, dateOfBirth: "2000-09-17" } },
    });
    await expect(getMemberProfile("student-1")).rejects.toThrow(
      "Unable to load this member record. Please try again.",
    );
  });

  it("maps callable failures to fixed, safe messages", async () => {
    for (const [code, message] of [
      ["functions/not-found", "This member record was not found."],
      ["functions/permission-denied", "You do not have access to this member record."],
      [
        "functions/resource-exhausted",
        "Too many member records opened in a few minutes. Wait a moment and try again.",
      ],
      ["functions/internal", "Unable to load this member record. Please try again."],
    ] as const) {
      mocks.callable.mockRejectedValueOnce({ code, message: "raw backend detail student-1" });
      const error = await getMemberProfile("student-1").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(message);
    }
  });

  it("saves DETAILS through updateMember with the normalised payload", async () => {
    mocks.callable.mockResolvedValue({ data: { memberId: "student-1", studentId: "student-1" } });
    await expect(saveMemberDetails(detailsInput)).resolves.toBeUndefined();
    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "updateMember");
    expect(mocks.callable).toHaveBeenCalledWith({
      ...detailsInput,
      membershipNumber: "0000",
      details: { healthNumber: "HN0000", howHeard: "Website" },
    });
  });

  it("names a member number conflict and hides every other failure", async () => {
    mocks.callable.mockRejectedValueOnce({ code: "functions/already-exists" });
    await expect(saveMemberDetails(detailsInput)).rejects.toBeInstanceOf(
      MemberDetailsConflictError,
    );
    mocks.callable.mockRejectedValueOnce({ code: "functions/internal", message: "raw" });
    await expect(saveMemberDetails(detailsInput)).rejects.toThrow(
      "Unable to save member details. Please try again.",
    );
    mocks.callable.mockReset();
    await expect(
      saveMemberDetails({ ...detailsInput, details: { howHeard: "Pigeon" } } as never),
    ).rejects.toThrow("Unable to save member details. Please try again.");
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it("searches by name only from two characters and parses the rows", async () => {
    await expect(searchMemberNames(" t ")).resolves.toEqual([]);
    expect(mocks.httpsCallable).not.toHaveBeenCalled();

    mocks.callable.mockResolvedValue({
      data: { members: [{ studentId: "student-1", fullName: "Test Member A" }] },
    });
    await expect(searchMemberNames(" test ")).resolves.toEqual([
      { studentId: "student-1", fullName: "Test Member A" },
    ]);
    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "searchMemberNames");
    expect(mocks.callable).toHaveBeenCalledWith({ query: "test" });

    mocks.callable.mockResolvedValue({
      data: { members: [{ studentId: "student-1", fullName: "Test", email: "a@example.test" }] },
    });
    await expect(searchMemberNames("test")).rejects.toThrow(
      "Unable to search members. Please try again.",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/member-profile-client.test.ts`
Expected: FAIL — `Failed to resolve import "./member-profile-client"`.

- [ ] **Step 3: Implement the client**

Create `apps/web/src/lib/member-profile-client.ts`:

```ts
import { httpsCallable } from "firebase/functions";

import {
  memberNameSearchResultSchema,
  memberProfileSchema,
  updateMemberDetailsInputSchema,
  type MemberNameSearchResult,
  type MemberProfile,
  type UpdateMemberDetailsInput,
} from "@bpt-jersey/domain/members/profile";

import { getFirebaseFunctions } from "./firebase-client";

/**
 * T051V2: the canonical member record. Every response is parsed against the role-trimmed schema, and
 * every failure becomes one fixed sentence: no backend message, identifier or value reaches the page.
 */
export const memberRecordIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function isMemberRecordId(value: string | null): value is string {
  return value !== null && memberRecordIdPattern.test(value);
}

const invalidLinkError = "This member record link is not valid.";
const notFoundError = "This member record was not found.";
const deniedError = "You do not have access to this member record.";
const rateLimitedError =
  "Too many member records opened in a few minutes. Wait a moment and try again.";
const loadError = "Unable to load this member record. Please try again.";
const conflictError = "That member number is already used by another member.";
const saveError = "Unable to save member details. Please try again.";
const searchError = "Unable to search members. Please try again.";

export class MemberRecordLoadError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MemberRecordLoadError";
  }
}

export class MemberDetailsConflictError extends Error {
  public constructor() {
    super(conflictError);
    this.name = "MemberDetailsConflictError";
  }
}

function errorCode(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
    ? (error as { code: string }).code
    : "";
}

export async function getMemberProfile(studentId: string): Promise<MemberProfile> {
  if (!isMemberRecordId(studentId)) throw new MemberRecordLoadError(invalidLinkError);
  let data: unknown;
  try {
    const callable = httpsCallable<Readonly<{ studentId: string }>, unknown>(
      getFirebaseFunctions(),
      "getMemberProfile",
    );
    data = (await callable({ studentId })).data;
  } catch (error) {
    const code = errorCode(error);
    if (code.endsWith("not-found")) throw new MemberRecordLoadError(notFoundError);
    if (code.endsWith("permission-denied")) throw new MemberRecordLoadError(deniedError);
    if (code.endsWith("resource-exhausted")) throw new MemberRecordLoadError(rateLimitedError);
    throw new MemberRecordLoadError(loadError);
  }
  const parsed = memberProfileSchema.safeParse(data);
  if (!parsed.success || parsed.data.header.studentId !== studentId) {
    throw new MemberRecordLoadError(loadError);
  }
  return parsed.data;
}

export async function saveMemberDetails(input: UpdateMemberDetailsInput): Promise<void> {
  const parsed = updateMemberDetailsInputSchema.safeParse(input);
  if (!parsed.success) throw new Error(saveError);
  let data: unknown;
  try {
    const callable = httpsCallable<UpdateMemberDetailsInput, unknown>(
      getFirebaseFunctions(),
      "updateMember",
    );
    data = (await callable(parsed.data)).data;
  } catch (error) {
    if (errorCode(error).endsWith("already-exists")) throw new MemberDetailsConflictError();
    throw new Error(saveError);
  }
  if (
    typeof data !== "object" ||
    data === null ||
    (data as { studentId?: unknown }).studentId !== parsed.data.studentId
  ) {
    throw new Error(saveError);
  }
}

export async function searchMemberNames(query: string): Promise<MemberNameSearchResult["members"]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  try {
    const callable = httpsCallable<Readonly<{ query: string }>, unknown>(
      getFirebaseFunctions(),
      "searchMemberNames",
    );
    const parsed = memberNameSearchResultSchema.safeParse(
      (await callable({ query: trimmed.slice(0, 80) })).data,
    );
    if (!parsed.success) throw new Error(searchError);
    return parsed.data.members;
  } catch {
    throw new Error(searchError);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/member-profile-client.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Prove the id guard is load-bearing**

Comment out `if (!isMemberRecordId(studentId)) throw new MemberRecordLoadError(invalidLinkError);`
and re-run. Expected: FAIL in "validates the record id before any call". Restore; re-run: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/member-profile-client.ts apps/web/src/lib/member-profile-client.test.ts
git commit -m "feat(web): member profile client - parsed role-trimmed record, DETAILS save, name search (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Web — record styles, empty tabs and the PROFILE tab

**Files:**

- Modify: `apps/web/src/app/admin/admin.css` — new `member-record-*` block after the
  `@media (max-width: 700px)` block that closes the `.admin-member-profile-*` rules (around line 3656).
- Create: `apps/web/src/app/admin/members/profile/record-format.ts`
- Create: `apps/web/src/app/admin/members/profile/record-empty-tab.tsx`
- Create: `apps/web/src/app/admin/members/profile/profile-tab.tsx`
- Test: `apps/web/src/app/admin/members/profile/profile-tab.test.tsx`

**Interfaces:**

- Consumes: Task 3 `MemberProfile`, `FullMemberProfile`, `MemberRecordTab`.
- Produces:
  - `record-format.ts`: `formatRecordDate(date: string): string` ("15 Jan 2026"),
    `participantTypeLabel(value: "adult" | "minor"): string`, `statusLabel(value: "active" | "inactive" | "suspended"): string`.
  - `record-empty-tab.tsx`: `export type RecordEmptyTabKey = Exclude<MemberRecordTab, "profile" | "details">`;
    `export function RecordEmptyTab(props: { tab: RecordEmptyTabKey; studentId: string; canOpenDetails: boolean; onOpenDetails: () => void }): JSX.Element`.
  - `profile-tab.tsx`: `export function ProfileTab(props: { profile: MemberProfile; ibjjfCardSlot?: ReactNode }): JSX.Element`.
    **Plan C insertion point:** `ibjjfCardSlot` is rendered first, full width, for both views;
    Plan C passes `<IbjjfCard studentId={profile.header.studentId} />` from `member-record.tsx`.
    When the slot is absent, the coach view shows an empty state that opens `/admin/levels`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/admin/members/profile/profile-tab.test.tsx`:

```tsx
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MemberProfile } from "@bpt-jersey/domain/members/profile";

import { ProfileTab } from "./profile-tab";
import { RecordEmptyTab } from "./record-empty-tab";

afterEach(cleanup);

const header = {
  studentId: "student-1",
  fullName: "Test Member A",
  age: 26,
  participantType: "adult",
  status: "active",
  birthdayBadge: null,
} as const;

const full: MemberProfile = {
  view: "full",
  header,
  cards: {
    memberSince: "2026-01-15",
    monthsAsMember: 8,
    profession: "Tester",
    accountManagers: [{ displayName: "Test Guardian", familyId: "family-1" }],
    currentMembership: {
      membershipId: "membership-1",
      planName: "Test Plan",
      status: "active",
      validUntil: "2026-12-31",
    },
  },
  details: {
    studentId: "student-1",
    fullName: "Test Member A",
    dateOfBirth: "2000-09-17",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    gender: "unknown",
  },
};

describe("PROFILE tab", () => {
  it("renders member, account manager and plan cards for office", () => {
    render(<ProfileTab profile={full} />);
    const member = screen.getByRole("region", { name: "Member" });
    expect(within(member).getByText("15 Jan 2026 · 8 months")).toBeTruthy();
    expect(within(member).getByText("Tester")).toBeTruthy();
    const manager = screen.getByRole("region", { name: "Account manager" });
    expect(within(manager).getByText("Test Guardian")).toBeTruthy();
    expect(within(manager).getByRole("link", { name: "Open Families" }).getAttribute("href")).toBe(
      "/admin/families",
    );
    const plan = screen.getByRole("region", { name: "Plan" });
    expect(within(plan).getByText("Test Plan")).toBeTruthy();
    expect(within(plan).getByText("Active")).toBeTruthy();
    expect(within(plan).getByText("31 Dec 2026")).toBeTruthy();
    expect(within(plan).getByRole("link", { name: "Open Memberships" }).getAttribute("href")).toBe(
      "/admin/memberships?studentId=student-1",
    );
  });

  it("shows plain empty states when there is no manager or membership", () => {
    render(
      <ProfileTab
        profile={{
          ...full,
          cards: { ...full.cards, accountManagers: [], currentMembership: null },
        }}
      />,
    );
    expect(screen.getByText("No account manager")).toBeTruthy();
    expect(screen.getByText("No current membership")).toBeTruthy();
  });

  it("renders the IBJJF slot first, for both views", () => {
    const { unmount } = render(
      <ProfileTab profile={full} ibjjfCardSlot={<section aria-label="IBJJF slot" />} />,
    );
    const regions = screen.getAllByRole("region");
    expect(regions[0]?.getAttribute("aria-label")).toBe("IBJJF slot");
    unmount();
    render(
      <ProfileTab
        profile={{ view: "coach", header }}
        ibjjfCardSlot={<section aria-label="IBJJF slot" />}
      />,
    );
    expect(screen.getAllByRole("region")).toHaveLength(1);
    expect(screen.queryByText("Test Guardian")).toBeNull();
  });

  it("gives a coach without the IBJJF card a way to Levels, and nothing restricted", () => {
    render(<ProfileTab profile={{ view: "coach", header }} />);
    expect(screen.getByRole("link", { name: "Open Levels" }).getAttribute("href")).toBe(
      "/admin/levels",
    );
    expect(screen.queryByRole("region", { name: "Plan" })).toBeNull();
  });
});

describe("empty record tabs", () => {
  it.each([
    ["plan", "Open Memberships", "/admin/memberships?studentId=student-1"],
    ["documents", "Open Waivers", "/admin/waivers"],
    ["payments", "Open Billing", "/admin/billing"],
    ["classes", "Open Attendance", "/admin/attendance"],
    ["communication", "Open CRM", "/admin/crm"],
  ] as const)("%s links to the module that holds it today", (tab, name, href) => {
    render(
      <RecordEmptyTab tab={tab} studentId="student-1" canOpenDetails onOpenDetails={() => {}} />,
    );
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(href);
  });

  it("sends NOTES to the Details tab", async () => {
    const onOpenDetails = vi.fn();
    render(
      <RecordEmptyTab
        tab="notes"
        studentId="student-1"
        canOpenDetails
        onOpenDetails={onOpenDetails}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open Details" }));
    expect(onOpenDetails).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/members/profile/profile-tab.test.tsx`
Expected: FAIL — `Failed to resolve import "./profile-tab"`.

- [ ] **Step 3: Add the styles**

Append after the `.admin-member-profile-*` media block in `apps/web/src/app/admin/admin.css`:

```css
/* T051V2 member record (DESIGN.md: square, status as text + left rule, no pills, 44px targets). */
.member-record {
  display: grid;
  gap: 1.5rem;
  min-width: 0;
}

.member-record-header {
  border-top: 0.35rem solid var(--bpt-purple);
  background: var(--gi-white);
  padding: 1.25rem;
}

.member-record-header h2 {
  font-family: var(--font-display), Impact, sans-serif;
  font-size: clamp(2rem, 5vw, 3.2rem);
  letter-spacing: 0.035em;
  line-height: 1;
  margin: 0.35rem 0 0.9rem;
  overflow-wrap: anywhere;
  text-transform: uppercase;
}

.member-record-header h2:focus-visible,
.member-record-button:focus-visible,
.member-record-link:focus-visible {
  outline: 3px solid var(--bpt-purple);
  outline-offset: 4px;
}

.member-record-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.5rem;
  margin: 0;
}

.member-record-facts div {
  display: grid;
  gap: 0.15rem;
}

.member-record-facts dt {
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}

.member-record-facts dd {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  margin: 0;
}

.member-record-status {
  border-left: 0.35rem solid var(--line);
  padding-left: 0.5rem;
}

.member-record-status-active {
  border-left-color: #176b49;
  color: #176b49;
}

.member-record-status-inactive,
.member-record-status-suspended {
  border-left-color: #8d1c2f;
  color: #721626;
}

.member-record-birthday {
  background: #f0efff;
  border-left: 0.35rem solid var(--bpt-purple);
  font-weight: 700;
  margin: 1rem 0 0;
  padding: 0.6rem 0.9rem;
}

.member-record-cards {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
}

.member-record-cards > .member-record-wide {
  grid-column: 1 / -1;
}

.member-record-card {
  background: var(--gi-white);
  border: 1px solid var(--line);
  min-width: 0;
  padding: 1rem;
}

.member-record-card h3,
.member-record-empty h3 {
  font-family: var(--font-display), Impact, sans-serif;
  font-size: 1.6rem;
  letter-spacing: 0.035em;
  line-height: 1;
  margin: 0.35rem 0 0.6rem;
  text-transform: uppercase;
}

.member-record-card p {
  font-variant-numeric: tabular-nums;
  margin: 0.25rem 0;
}

.member-record-empty {
  background: var(--gi-white);
  border-left: 0.35rem solid var(--line);
  padding: 1.25rem;
}

.member-record-empty p:not(.admin-eyebrow) {
  color: var(--muted);
  margin: 0 0 1rem;
  max-width: 36rem;
}

.member-record-button,
.member-record-link {
  align-items: center;
  border: 1px solid var(--bpt-purple);
  border-radius: 0;
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.025em;
  min-height: 3.15rem;
  padding: 0.8rem 1.15rem;
  text-decoration: none;
  transition:
    background-color 160ms ease,
    transform 220ms ease;
}

.member-record-button {
  background: var(--bpt-purple);
  color: var(--gi-white);
}

.member-record-link {
  background: var(--gi-white);
  color: var(--bpt-purple);
}

.member-record-button:hover,
.member-record-link:hover {
  transform: translateY(-2px);
}

.member-record-button:disabled {
  border-color: var(--line);
  background: var(--line);
  cursor: not-allowed;
  transform: none;
}

.member-record-skeleton {
  display: grid;
  gap: 1rem;
}

.member-record-skeleton span {
  background: #e8e7e3;
  display: block;
  height: 7rem;
}

.member-record-skeleton span:first-child {
  height: 10rem;
}

.member-record-notice {
  background: #fff0f2;
  border-left: 0.35rem solid #8d1c2f;
  color: #5f1020;
  padding: 1rem 1.25rem;
}

.member-record-tabs {
  overflow-x: auto;
}

.member-record-tabs .admin-member-profile-tab {
  min-height: 2.75rem;
}

.member-record-form {
  display: grid;
  gap: 1.5rem;
}

.member-record-form fieldset {
  background: var(--gi-white);
  border: 1px solid var(--line);
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
  padding: 1rem;
}

.member-record-form legend {
  color: var(--bpt-purple);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  padding: 0 0.35rem;
  text-transform: uppercase;
}

.member-record-form .login-field select,
.member-record-form .login-field textarea {
  background: var(--canvas);
  border: 1px solid var(--line);
  border-radius: 0;
  color: var(--mat-ink);
  font: inherit;
  min-height: 3rem;
  padding: 0.75rem;
  width: 100%;
}

.member-record-form .login-field input:focus-visible,
.member-record-form .login-field select:focus-visible,
.member-record-form .login-field textarea:focus-visible {
  outline: 3px solid var(--bpt-purple);
  outline-offset: 2px;
}

.member-record-form .member-record-wide {
  grid-column: 1 / -1;
}

.member-record-hint {
  color: var(--muted);
  font-size: 0.85rem;
  margin: 0;
}

.member-record-save-bar {
  align-items: center;
  background: var(--canvas);
  border-top: 2px solid var(--mat-ink);
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  padding: 0.75rem 0;
  position: sticky;
}

@media (max-width: 50rem) {
  .member-record-form fieldset {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .member-record-button,
  .member-record-link {
    transition: none;
  }

  .member-record-button:hover,
  .member-record-link:hover {
    transform: none;
  }
}
```

(`.member-record-tabs` scrolls inside itself so the eight tabs never cause page-level horizontal
scroll at 390px. `position: sticky` keeps Save reachable; DESIGN.md allows no other positioning, and
sticky is in-flow, not absolute.)

- [ ] **Step 4: Implement the helpers and components**

Create `apps/web/src/app/admin/members/profile/record-format.ts`:

```ts
const recordDateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-01-15" → "15 Jan 2026". Date-only values are formatted in UTC so the day never shifts. */
export function formatRecordDate(date: string): string {
  return recordDateFormat.format(new Date(`${date}T00:00:00.000Z`));
}

export function participantTypeLabel(value: "adult" | "minor"): string {
  return value === "adult" ? "Adult" : "Minor";
}

export function statusLabel(value: "active" | "inactive" | "suspended"): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
```

Create `apps/web/src/app/admin/members/profile/record-empty-tab.tsx`:

```tsx
import Link from "next/link";

import type { MemberRecordTab } from "@bpt-jersey/domain/members/profile";

export type RecordEmptyTabKey = Exclude<MemberRecordTab, "profile" | "details">;

type LinkedEmptyTab = Readonly<{
  eyebrow: string;
  headline: string;
  sentence: string;
  action: string;
  href: (studentId: string) => string;
}>;

const linkedTabs: Readonly<Record<Exclude<RecordEmptyTabKey, "notes">, LinkedEmptyTab>> = {
  plan: {
    eyebrow: "Plan",
    headline: "Plan history is on its way",
    sentence: "Until then, Memberships shows this member's current plan and lets you change it.",
    action: "Open Memberships",
    href: (studentId) => `/admin/memberships?studentId=${encodeURIComponent(studentId)}`,
  },
  documents: {
    eyebrow: "Documents",
    headline: "Documents are on their way",
    sentence: "Signed waivers are managed in Waivers for now.",
    action: "Open Waivers",
    href: () => "/admin/waivers",
  },
  payments: {
    eyebrow: "Payments",
    headline: "Payments are on their way",
    sentence: "Invoices and payments for this member are in Billing for now.",
    action: "Open Billing",
    href: () => "/admin/billing",
  },
  classes: {
    eyebrow: "Classes",
    headline: "Class history is on its way",
    sentence: "Attendance shows who trained in each session for now.",
    action: "Open Attendance",
    href: () => "/admin/attendance",
  },
  communication: {
    eyebrow: "Communication",
    headline: "Communication log is on its way",
    sentence: "Follow-ups and contact history are kept in CRM for now.",
    action: "Open CRM",
    href: () => "/admin/crm",
  },
};

/** DESIGN.md empty state: eyebrow + headline + one sentence + one button. */
export function RecordEmptyTab({
  tab,
  studentId,
  canOpenDetails,
  onOpenDetails,
}: {
  tab: RecordEmptyTabKey;
  studentId: string;
  canOpenDetails: boolean;
  onOpenDetails: () => void;
}) {
  if (tab === "notes") {
    return (
      <section className="member-record-empty" aria-labelledby="record-empty-notes">
        <p className="admin-eyebrow">Notes</p>
        <h3 id="record-empty-notes">Internal notes live in Details</h3>
        <p>Office notes are part of the member&apos;s details and are never shown to the member.</p>
        {canOpenDetails ? (
          <button className="member-record-button" onClick={onOpenDetails} type="button">
            Open Details
          </button>
        ) : null}
      </section>
    );
  }
  const content = linkedTabs[tab];
  return (
    <section className="member-record-empty" aria-labelledby={`record-empty-${tab}`}>
      <p className="admin-eyebrow">{content.eyebrow}</p>
      <h3 id={`record-empty-${tab}`}>{content.headline}</h3>
      <p>{content.sentence}</p>
      <Link className="member-record-link" href={content.href(studentId)}>
        {content.action}
      </Link>
    </section>
  );
}
```

Create `apps/web/src/app/admin/members/profile/profile-tab.tsx`:

```tsx
import Link from "next/link";
import type { ReactNode } from "react";

import type { FullMemberProfile, MemberProfile } from "@bpt-jersey/domain/members/profile";

import { formatRecordDate } from "./record-format";

function membershipStatusLabel(status: "trial" | "active" | "paused" | "overdue"): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  const id = `member-record-card-${title.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <section aria-labelledby={id} className="member-record-card">
      <p className="admin-eyebrow">Profile</p>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  );
}

function monthsLabel(months: number): string {
  return months === 1 ? "1 month" : `${months} months`;
}

function OfficeCards({ profile }: { profile: FullMemberProfile }) {
  const { cards, header } = profile;
  return (
    <>
      <Card title="Member">
        <p>
          Member since{" "}
          <span>{`${formatRecordDate(cards.memberSince)} · ${monthsLabel(cards.monthsAsMember)}`}</span>
        </p>
        {cards.profession === undefined ? null : <p>{cards.profession}</p>}
      </Card>
      <Card title="Account manager">
        {cards.accountManagers.length === 0 ? (
          <p>No account manager</p>
        ) : (
          <ul>
            {cards.accountManagers.map((manager) => (
              <li key={`${manager.familyId}-${manager.displayName}`}>{manager.displayName}</li>
            ))}
          </ul>
        )}
        {cards.accountManagers.length === 0 ? null : (
          <Link className="member-record-link" href="/admin/families">
            Open Families
          </Link>
        )}
      </Card>
      <Card title="Plan">
        {cards.currentMembership === null ? (
          <p>No current membership</p>
        ) : (
          <>
            <p>
              <strong>{cards.currentMembership.planName}</strong>
            </p>
            <p
              className={`member-record-status member-record-status-${
                cards.currentMembership.status === "active" ? "active" : "inactive"
              }`}
            >
              {membershipStatusLabel(cards.currentMembership.status)}
            </p>
            {cards.currentMembership.validUntil === null ? null : (
              <p>
                Valid until <span>{formatRecordDate(cards.currentMembership.validUntil)}</span>
              </p>
            )}
          </>
        )}
        <Link
          className="member-record-link"
          href={`/admin/memberships?studentId=${encodeURIComponent(header.studentId)}`}
        >
          Open Memberships
        </Link>
      </Card>
    </>
  );
}

/**
 * PROFILE (spec §5.4). `ibjjfCardSlot` is Plan C's insertion point for the JIU-JITSU IBJJF card; it is
 * the only card a coach sees.
 */
export function ProfileTab({
  profile,
  ibjjfCardSlot,
}: {
  profile: MemberProfile;
  ibjjfCardSlot?: ReactNode;
}) {
  return (
    <div className="member-record-cards">
      {ibjjfCardSlot === undefined ? null : (
        <div className="member-record-wide">{ibjjfCardSlot}</div>
      )}
      {profile.view === "full" ? <OfficeCards profile={profile} /> : null}
      {profile.view === "coach" && ibjjfCardSlot === undefined ? (
        <section
          aria-labelledby="record-empty-levels"
          className="member-record-empty member-record-wide"
        >
          <p className="admin-eyebrow">Jiu-jitsu</p>
          <h3 id="record-empty-levels">Belt and progress</h3>
          <p>Levels shows this member&apos;s belt, stripes and next graduation.</p>
          <Link className="member-record-link" href="/admin/levels">
            Open Levels
          </Link>
        </section>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/members/profile/profile-tab.test.tsx`
Expected: PASS (10 tests: 4 PROFILE, 5 linked empty tabs, 1 NOTES).

The "renders member … cards" test matches the text node `"15 Jan 2026 · 8 months"` inside the
`<span>`; the "Member since " prefix is a sibling text node, so `getByText` on the span matches exactly.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/admin/admin.css apps/web/src/app/admin/members/profile/record-format.ts apps/web/src/app/admin/members/profile/record-empty-tab.tsx apps/web/src/app/admin/members/profile/profile-tab.tsx apps/web/src/app/admin/members/profile/profile-tab.test.tsx
git commit -m "feat(web): member record PROFILE cards and empty tabs with module links (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Web — DETAILS form model (draft ⇄ payload)

**Files:**

- Create: `apps/web/src/app/admin/members/profile/details-form-model.ts`
- Test: `apps/web/src/app/admin/members/profile/details-form-model.test.ts`

**Interfaces:**

- Consumes: Task 3 `MemberDetails`, `UpdateMemberDetailsInput`, `updateMemberDetailsInputSchema`.
- Produces:
  - `export const dialCodes: readonly ["+44", "+351", "+353", "+33", "+34", "+48", "+49", "+39", "+55", "+1"]`
  - `export type DetailsDraft` (every value a string except `gender`), `export type DetailsDraftField = keyof DetailsDraft`
  - `export function draftFromDetails(details: MemberDetails): DetailsDraft`
  - `export function payloadFromDraft(details: MemberDetails, draft: DetailsDraft, requestId: string): { ok: true; payload: UpdateMemberDetailsInput } | { ok: false; fields: readonly DetailsDraftField[] }`
  - `export function isDraftDirty(baseline: DetailsDraft, draft: DetailsDraft): boolean`
  - `export function splitPhoneNumber(value: string | undefined): { countryCode: string; localNumber: string }`
  - `export function joinPhoneNumber(countryCode: string, localNumber: string): string | undefined`
  - `export function countryOptions(): readonly { code: string; name: string }[]`
  - `export function idExpiryNotice(expiresOn: string, today: string): { kind: "expired" } | { kind: "soon"; days: number } | null`

Design notes: the DETAILS form edits a full-replacement update, so fields Regyfit's DETAILS does not
show but the canonical record requires (`trainingCenter`, `trainingTimePreferences`,
`frequencyNote`) are carried through unchanged from the loaded record. The phone number stays one
stored string: the form splits a leading known dialling code into the select and joins it back.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/admin/members/profile/details-form-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { MemberDetails } from "@bpt-jersey/domain/members/profile";

import {
  countryOptions,
  draftFromDetails,
  idExpiryNotice,
  isDraftDirty,
  joinPhoneNumber,
  payloadFromDraft,
  splitPhoneNumber,
} from "./details-form-model";

const requestId = "41cbb1aa-7020-4bb5-88a4-dbc73c5f0123";

const details: MemberDetails = {
  studentId: "student-1",
  fullName: "Test Member A",
  dateOfBirth: "2000-09-17",
  phoneNumber: "+44 7700900000",
  email: "member-a@example.test",
  trainingCenter: "West",
  trainingTimePreferences: ["morning", "evening"],
  participantType: "adult",
  active: true,
  status: "active",
  membershipNumber: "0000",
  gender: "female",
  frequencyNote: "Twice weekly",
  postalAddress: { line: "1 Test Street", postCode: "JE0 0AA" },
  details: {
    shortName: "Test A",
    country: "JE",
    weightKg: 70.5,
    heightCm: 175,
    howHeard: "Website",
    internalNotes: "Line one\nLine two",
  },
};

describe("DETAILS form model", () => {
  it("round-trips a loaded record into the same update payload", () => {
    const draft = draftFromDetails(details);
    expect(draft.phoneCountryCode).toBe("+44");
    expect(draft.phoneLocalNumber).toBe("7700900000");
    expect(draft.weightKg).toBe("70.5");
    const result = payloadFromDraft(details, draft, requestId);
    expect(result).toEqual({
      ok: true,
      payload: {
        studentId: "student-1",
        requestId,
        fullName: "Test Member A",
        dateOfBirth: "2000-09-17",
        phoneNumber: "+44 7700900000",
        email: "member-a@example.test",
        trainingCenter: "West",
        trainingTimePreferences: ["morning", "evening"],
        membershipNumber: "0000",
        gender: "female",
        frequencyNote: "Twice weekly",
        postalAddress: { line: "1 Test Street", postCode: "JE0 0AA" },
        details: {
          shortName: "Test A",
          country: "JE",
          weightKg: 70.5,
          heightCm: 175,
          howHeard: "Website",
          internalNotes: "Line one\nLine two",
        },
      },
    });
    expect(isDraftDirty(draft, draftFromDetails(details))).toBe(false);
    expect(isDraftDirty(draft, { ...draft, nickname: "Tester" })).toBe(true);
  });

  it("sends an empty details object when every DETAILS field is cleared", () => {
    const draft = {
      ...draftFromDetails(details),
      shortName: "",
      country: "",
      weightKg: "",
      heightCm: "",
      howHeard: "",
      internalNotes: "   ",
    };
    const result = payloadFromDraft(details, draft, requestId);
    expect(result.ok && result.payload.details).toEqual({});
  });

  it("names the fields that stop a save", () => {
    const draft = draftFromDetails(details);
    expect(payloadFromDraft(details, { ...draft, weightKg: "500" }, requestId)).toEqual({
      ok: false,
      fields: ["weightKg"],
    });
    expect(payloadFromDraft(details, { ...draft, weightKg: "heavy" }, requestId)).toEqual({
      ok: false,
      fields: ["weightKg"],
    });
    expect(
      payloadFromDraft(details, { ...draft, emergencyContactFullName: "Test Contact" }, requestId),
    ).toEqual({
      ok: false,
      fields: ["emergencyContactRelationship", "emergencyContactPhoneNumber"],
    });
    expect(payloadFromDraft(details, { ...draft, postCode: "" }, requestId)).toEqual({
      ok: false,
      fields: ["postCode"],
    });
    expect(payloadFromDraft(details, { ...draft, fullName: " " }, requestId)).toEqual({
      ok: false,
      fields: ["fullName"],
    });
  });

  it("splits and joins phone numbers with a known dialling code only", () => {
    expect(splitPhoneNumber("+351 912000000")).toEqual({
      countryCode: "+351",
      localNumber: "912000000",
    });
    expect(splitPhoneNumber("07700 900000")).toEqual({
      countryCode: "",
      localNumber: "07700 900000",
    });
    expect(splitPhoneNumber("+999 1234")).toEqual({ countryCode: "", localNumber: "+999 1234" });
    expect(splitPhoneNumber(undefined)).toEqual({ countryCode: "", localNumber: "" });
    expect(joinPhoneNumber("+44", " 7700900000 ")).toBe("+44 7700900000");
    expect(joinPhoneNumber("", "07700 900000")).toBe("07700 900000");
    expect(joinPhoneNumber("+44", " ")).toBeUndefined();
  });

  it("lists ISO countries by English name without macro-regions", () => {
    const options = countryOptions();
    expect(options.find((option) => option.code === "JE")?.name).toBe("Jersey");
    expect(options.find((option) => option.code === "PT")?.name).toBe("Portugal");
    expect(options.some((option) => ["EU", "UN", "ZZ", "EZ", "QO"].includes(option.code))).toBe(
      false,
    );
    expect(options.length).toBeGreaterThan(240);
    expect(
      options.every(
        (option, index) =>
          index === 0 || options[index - 1]!.name.localeCompare(option.name, "en-GB") <= 0,
      ),
    ).toBe(true);
  });

  it("flags an expired ID card and one expiring within 30 days", () => {
    expect(idExpiryNotice("2026-09-16", "2026-09-17")).toEqual({ kind: "expired" });
    expect(idExpiryNotice("2026-09-17", "2026-09-17")).toEqual({ kind: "soon", days: 0 });
    expect(idExpiryNotice("2026-10-17", "2026-09-17")).toEqual({ kind: "soon", days: 30 });
    expect(idExpiryNotice("2026-10-18", "2026-09-17")).toBeNull();
    expect(idExpiryNotice("", "2026-09-17")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/members/profile/details-form-model.test.ts`
Expected: FAIL — `Failed to resolve import "./details-form-model"`.

- [ ] **Step 3: Implement the model**

Create `apps/web/src/app/admin/members/profile/details-form-model.ts`:

```ts
import {
  updateMemberDetailsInputSchema,
  type MemberDetails,
  type UpdateMemberDetailsInput,
} from "@bpt-jersey/domain/members/profile";

/**
 * T051V2: the DETAILS form edits strings; the update callable takes a strict full-replacement
 * payload. This module is the only place that converts between them.
 */
export const dialCodes = Object.freeze([
  "+44",
  "+351",
  "+353",
  "+33",
  "+34",
  "+48",
  "+49",
  "+39",
  "+55",
  "+1",
] as const);
// ponytail: ten dialling codes cover the academy's members; any other code is typed into the number.

export type DetailsDraft = Readonly<{
  fullName: string;
  shortName: string;
  membershipNumber: string;
  nickname: string;
  email: string;
  phoneCountryCode: string;
  phoneLocalNumber: string;
  emergencyContactFullName: string;
  emergencyContactRelationship: string;
  emergencyContactPhoneNumber: string;
  emergencyContactAlternatePhoneNumber: string;
  addressLine: string;
  city: string;
  postCode: string;
  country: string;
  idCardNumber: string;
  idCardExpiresOn: string;
  healthNumber: string;
  vatNumber: string;
  profession: string;
  gender: "male" | "female" | "unknown";
  dateOfBirth: string;
  weightKg: string;
  heightCm: string;
  registeredOn: string;
  recommendedByStudentId: string;
  howHeard: string;
  initialContact: string;
  internalNotes: string;
}>;

export type DetailsDraftField = keyof DetailsDraft;

export function splitPhoneNumber(value: string | undefined): {
  countryCode: string;
  localNumber: string;
} {
  if (value === undefined) return { countryCode: "", localNumber: "" };
  const match = /^(\+\d{1,4}) (.+)$/u.exec(value);
  const code = match?.[1];
  const local = match?.[2];
  if (
    code !== undefined &&
    local !== undefined &&
    (dialCodes as readonly string[]).includes(code)
  ) {
    return { countryCode: code, localNumber: local };
  }
  return { countryCode: "", localNumber: value };
}

export function joinPhoneNumber(countryCode: string, localNumber: string): string | undefined {
  const local = localNumber.trim();
  if (local.length === 0) return undefined;
  return countryCode === "" ? local : `${countryCode} ${local}`;
}

export function draftFromDetails(details: MemberDetails): DetailsDraft {
  const phone = splitPhoneNumber(details.phoneNumber);
  const extra = details.details;
  return {
    fullName: details.fullName,
    shortName: extra?.shortName ?? "",
    membershipNumber: details.membershipNumber ?? "",
    nickname: extra?.nickname ?? "",
    email: details.email ?? "",
    phoneCountryCode: phone.countryCode,
    phoneLocalNumber: phone.localNumber,
    emergencyContactFullName: details.emergencyContact?.fullName ?? "",
    emergencyContactRelationship: details.emergencyContact?.relationship ?? "",
    emergencyContactPhoneNumber: details.emergencyContact?.phoneNumber ?? "",
    emergencyContactAlternatePhoneNumber: details.emergencyContact?.alternatePhoneNumber ?? "",
    addressLine: details.postalAddress?.line ?? "",
    city: extra?.city ?? "",
    postCode: details.postalAddress?.postCode ?? "",
    country: extra?.country ?? "",
    idCardNumber: details.idCardNumber ?? "",
    idCardExpiresOn: extra?.idCardExpiresOn ?? "",
    healthNumber: extra?.healthNumber ?? "",
    vatNumber: details.vatNumber ?? "",
    profession: extra?.profession ?? "",
    gender: details.gender,
    dateOfBirth: details.dateOfBirth,
    weightKg: extra?.weightKg === undefined ? "" : String(extra.weightKg),
    heightCm: extra?.heightCm === undefined ? "" : String(extra.heightCm),
    registeredOn: extra?.registeredOn ?? "",
    recommendedByStudentId: extra?.recommendedByStudentId ?? "",
    howHeard: extra?.howHeard ?? "",
    initialContact: extra?.initialContact ?? "",
    internalNotes: extra?.internalNotes ?? "",
  };
}

export function isDraftDirty(baseline: DetailsDraft, draft: DetailsDraft): boolean {
  return (Object.keys(baseline) as DetailsDraftField[]).some((key) => baseline[key] !== draft[key]);
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Empty = absent; anything else must be a finite number, or it stays NaN and fails the schema. */
function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : Number(trimmed);
}

function defined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

const draftFieldNames = new Set<string>(
  Object.keys(
    draftFromDetails({
      studentId: "x",
      fullName: "x",
      dateOfBirth: "2000-01-01",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      participantType: "adult",
      active: true,
      status: "active",
      gender: "unknown",
    }),
  ),
);

function fieldForIssuePath(path: readonly PropertyKey[]): DetailsDraftField {
  const [head, sub] = path;
  if (head === "details" && typeof sub === "string" && draftFieldNames.has(sub)) {
    return sub as DetailsDraftField;
  }
  if (head === "phoneNumber") return "phoneLocalNumber";
  if (head === "emergencyContact") return "emergencyContactFullName";
  if (head === "postalAddress") return "addressLine";
  if (typeof head === "string" && draftFieldNames.has(head)) return head as DetailsDraftField;
  return "fullName";
}

export function payloadFromDraft(
  details: MemberDetails,
  draft: DetailsDraft,
  requestId: string,
):
  | Readonly<{ ok: true; payload: UpdateMemberDetailsInput }>
  | Readonly<{ ok: false; fields: readonly DetailsDraftField[] }> {
  const missing: DetailsDraftField[] = [];

  const contact = {
    fullName: optionalText(draft.emergencyContactFullName),
    relationship: optionalText(draft.emergencyContactRelationship),
    phoneNumber: optionalText(draft.emergencyContactPhoneNumber),
    alternatePhoneNumber: optionalText(draft.emergencyContactAlternatePhoneNumber),
  };
  const contactStarted = Object.values(contact).some((value) => value !== undefined);
  if (contactStarted) {
    if (contact.fullName === undefined) missing.push("emergencyContactFullName");
    if (contact.relationship === undefined) missing.push("emergencyContactRelationship");
    if (contact.phoneNumber === undefined) missing.push("emergencyContactPhoneNumber");
  }

  const line = optionalText(draft.addressLine);
  const postCode = optionalText(draft.postCode);
  if (line !== undefined && postCode === undefined) missing.push("postCode");
  if (line === undefined && postCode !== undefined) missing.push("addressLine");

  if (missing.length > 0) return { ok: false, fields: missing };

  const candidate = {
    studentId: details.studentId,
    requestId,
    fullName: draft.fullName.trim(),
    dateOfBirth: draft.dateOfBirth,
    ...defined({
      phoneNumber: joinPhoneNumber(draft.phoneCountryCode, draft.phoneLocalNumber),
      email: optionalText(draft.email),
    }),
    trainingCenter: details.trainingCenter,
    trainingTimePreferences: [...details.trainingTimePreferences],
    ...defined({
      membershipNumber: optionalText(draft.membershipNumber),
      idCardNumber: optionalText(draft.idCardNumber),
      vatNumber: optionalText(draft.vatNumber),
    }),
    gender: draft.gender,
    ...defined({ frequencyNote: details.frequencyNote }),
    ...(contactStarted ? { emergencyContact: defined(contact) } : {}),
    ...(line !== undefined && postCode !== undefined ? { postalAddress: { line, postCode } } : {}),
    details: defined({
      shortName: optionalText(draft.shortName),
      nickname: optionalText(draft.nickname),
      city: optionalText(draft.city),
      country: optionalText(draft.country),
      idCardExpiresOn: optionalText(draft.idCardExpiresOn),
      healthNumber: optionalText(draft.healthNumber),
      profession: optionalText(draft.profession),
      weightKg: optionalNumber(draft.weightKg),
      heightCm: optionalNumber(draft.heightCm),
      registeredOn: optionalText(draft.registeredOn),
      recommendedByStudentId: optionalText(draft.recommendedByStudentId),
      howHeard: optionalText(draft.howHeard),
      initialContact: optionalText(draft.initialContact),
      internalNotes: optionalText(draft.internalNotes),
    }),
  };

  const parsed = updateMemberDetailsInputSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, payload: parsed.data };
  const fields = [...new Set(parsed.error.issues.map((issue) => fieldForIssuePath(issue.path)))];
  return { ok: false, fields };
}

const excludedRegionCodes = new Set(["EU", "EZ", "QO", "UN", "XA", "XB", "ZZ"]);
let cachedCountries: readonly { code: string; name: string }[] | undefined;

/**
 * ISO 3166 alpha-2 codes named by the browser's own region names, so no country list ships in the
 * bundle. ponytail: a few withdrawn codes that ICU still names (for example "AN") may appear; the
 * stored value is only ever a two-letter code.
 */
export function countryOptions(): readonly { code: string; name: string }[] {
  if (cachedCountries !== undefined) return cachedCountries;
  const names = new Intl.DisplayNames(["en-GB"], { type: "region" });
  const options: { code: string; name: string }[] = [];
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second);
      if (excludedRegionCodes.has(code)) continue;
      let name: string | undefined;
      try {
        name = names.of(code);
      } catch {
        name = undefined;
      }
      if (name !== undefined && name !== code) options.push({ code, name });
    }
  }
  cachedCountries = Object.freeze(
    options.sort((left, right) => left.name.localeCompare(right.name, "en-GB")),
  );
  return cachedCountries;
}

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) / 86_400_000;
}

export function idExpiryNotice(
  expiresOn: string,
  today: string,
): Readonly<{ kind: "expired" }> | Readonly<{ kind: "soon"; days: number }> | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(expiresOn)) return null;
  const days = dayNumber(expiresOn) - dayNumber(today);
  if (Number.isNaN(days)) return null;
  if (days < 0) return { kind: "expired" };
  return days <= 30 ? { kind: "soon", days } : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/members/profile/details-form-model.test.ts`
Expected: PASS (6 tests). If the country count assertion fails because the jsdom Node build lacks
full ICU, stop and report it: Node ≥ 22.13 ships full ICU, so that would be an environment defect,
not a reason to weaken the test.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/members/profile/details-form-model.ts apps/web/src/app/admin/members/profile/details-form-model.test.ts
git commit -m "feat(web): DETAILS form model - draft to strict update payload (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Web — DETAILS tab (one form, Save + Ctrl/Cmd+S, dirty warning)

**Files:**

- Create: `apps/web/src/app/admin/members/profile/details-tab.tsx`
- Test: `apps/web/src/app/admin/members/profile/details-tab.test.tsx`

**Interfaces:**

- Consumes: Task 10 model; Task 8 `saveMemberDetails`, `searchMemberNames`, `MemberDetailsConflictError`;
  Task 1 `memberHowHeardOptions`, `memberInitialContactOptions`; Task 2/3 `academyDateOf`,
  `deriveBmi`, `deriveShortNameVariants`, `memberAgeOn`, `FullMemberProfile`.
- Produces: `export function DetailsTab(props: { profile: FullMemberProfile; onDirtyChange: (dirty: boolean) => void; onSaved: () => void }): JSX.Element`.
  Accessible names used by Task 11's tests and Plan C's Playwright: legends "Identification",
  "Contacts", "Address", "Documents", "Personal", "Registration", "Notes"; button "Save details";
  status "Details saved."; alerts "Check the highlighted fields.",
  "That member number is already used by another member.", "Unable to save member details. Please try again.".

UX rules applied (spec §5.5, DESIGN.md §4): labels above inputs, one Save for the whole form,
Ctrl/Cmd+S submits, the browser warns before leaving with unsaved changes (the record warns on tab
change, Task 12), invalid fields get `aria-invalid` and the first one receives focus, BMI is a
read-only `<output>`, the nickname and notes say they are internal. No restricted value is written to
the console, the URL or storage.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/admin/members/profile/details-tab.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FullMemberProfile } from "@bpt-jersey/domain/members/profile";

const client = vi.hoisted(() => {
  class MemberDetailsConflictError extends Error {}
  return {
    MemberDetailsConflictError,
    saveMemberDetails: vi.fn(),
    searchMemberNames: vi.fn(),
  };
});

vi.mock("../../../../lib/member-profile-client", () => client);

import { DetailsTab } from "./details-tab";

const profile: FullMemberProfile = {
  view: "full",
  header: {
    studentId: "student-1",
    fullName: "Test Member A",
    age: 26,
    participantType: "adult",
    status: "active",
    birthdayBadge: { kind: "today" },
  },
  cards: {
    memberSince: "2026-01-15",
    monthsAsMember: 8,
    accountManagers: [],
    currentMembership: null,
  },
  details: {
    studentId: "student-1",
    fullName: "Test Member A",
    dateOfBirth: "2000-09-17",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    gender: "unknown",
    membershipNumber: "0000",
    details: { weightKg: 70.5, heightCm: 175, idCardExpiresOn: "2026-09-30" },
  },
};

function renderTab(overrides: Partial<FullMemberProfile> = {}) {
  const onDirtyChange = vi.fn();
  const onSaved = vi.fn();
  render(
    <DetailsTab
      profile={{ ...profile, ...overrides }}
      onDirtyChange={onDirtyChange}
      onSaved={onSaved}
    />,
  );
  return { onDirtyChange, onSaved, user: userEvent.setup() };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-17T09:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("DETAILS tab", () => {
  it("groups every field in Regyfit's sections with labels above inputs", () => {
    renderTab();
    expect(
      screen.getAllByRole("group").map((group) => group.querySelector("legend")?.textContent),
    ).toEqual([
      "Identification",
      "Contacts",
      "Address",
      "Documents",
      "Personal",
      "Registration",
      "Notes",
    ]);
    for (const label of [
      "Full name",
      "Short name",
      "Member No.",
      "Nickname",
      "E-mail",
      "Mobile country code",
      "Mobile number",
      "Emergency contact name",
      "Emergency contact relationship",
      "Emergency contact phone",
      "Address",
      "City",
      "Postal code",
      "Country",
      "ID card no.",
      "ID expiry",
      "Health number",
      "Tax number",
      "Profession",
      "Gender",
      "Date of birth",
      "Weight (kg)",
      "Height (cm)",
      "Registration date",
      "How they heard",
      "Initial contact",
      "Internal notes",
    ]) {
      const control = screen.getByLabelText(label);
      const labelElement = document.querySelector(`label[for="${control.id}"]`);
      expect(labelElement).not.toBeNull();
      expect(
        labelElement!.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("derives age, BMI and the ID expiry notice without storing them", () => {
    renderTab();
    expect(screen.getByText("26 years old")).toBeTruthy();
    expect(screen.getByRole("status", { name: "BMI" }).textContent).toBe("23.0 · Healthy");
    expect(screen.getByText("ID card expires in 13 days")).toBeTruthy();
  });

  it("saves the whole form once and reports it", async () => {
    client.saveMemberDetails.mockResolvedValue(undefined);
    const { onDirtyChange, onSaved, user } = renderTab();
    await user.type(screen.getByLabelText("Nickname"), "Tester");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await user.click(screen.getByRole("button", { name: "Save details" }));

    expect(await screen.findByText("Details saved.")).toBeTruthy();
    expect(client.saveMemberDetails).toHaveBeenCalledOnce();
    expect(client.saveMemberDetails.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        studentId: "student-1",
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
        details: {
          nickname: "Tester",
          weightKg: 70.5,
          heightCm: 175,
          idCardExpiresOn: "2026-09-30",
        },
      }),
    );
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("saves with Ctrl+S and Cmd+S", async () => {
    client.saveMemberDetails.mockResolvedValue(undefined);
    const { user } = renderTab();
    await user.keyboard("{Control>}s{/Control}");
    await waitFor(() => expect(client.saveMemberDetails).toHaveBeenCalledTimes(1));
    await user.keyboard("{Meta>}s{/Meta}");
    await waitFor(() => expect(client.saveMemberDetails).toHaveBeenCalledTimes(2));
  });

  it("marks and focuses invalid fields without calling the backend", async () => {
    const { user } = renderTab();
    const weight = screen.getByLabelText("Weight (kg)");
    await user.clear(weight);
    await user.type(weight, "500");
    await user.click(screen.getByRole("button", { name: "Save details" }));
    expect(screen.getByRole("alert").textContent).toBe("Check the highlighted fields.");
    expect(weight.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(weight);
    expect(client.saveMemberDetails).not.toHaveBeenCalled();
  });

  it("explains a member number conflict on the member number field", async () => {
    client.saveMemberDetails.mockRejectedValue(new client.MemberDetailsConflictError("conflict"));
    const { user } = renderTab();
    await user.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "That member number is already used by another member.",
      ),
    );
    expect(screen.getByLabelText("Member No.").getAttribute("aria-invalid")).toBe("true");
  });

  it("offers the next free member number when the member has none", async () => {
    const { user } = renderTab({
      details: { ...profile.details, membershipNumber: undefined } as never,
      nextFreeMemberNumber: "13",
    });
    await user.click(screen.getByRole("button", { name: "Use next free number 13" }));
    expect((screen.getByLabelText("Member No.") as HTMLInputElement).value).toBe("13");
  });

  it("asks the browser to warn before leaving with unsaved changes", async () => {
    const { user } = renderTab();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    await user.type(screen.getByLabelText("Profession"), "Tester");
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it("picks the recommending member by name", async () => {
    client.searchMemberNames.mockResolvedValue([
      { studentId: "student-1", fullName: "Test Member A" },
      { studentId: "student-2", fullName: "Test Member B" },
    ]);
    client.saveMemberDetails.mockResolvedValue(undefined);
    const { user } = renderTab();
    await user.type(screen.getByLabelText("Recommended by"), "test");
    await user.click(screen.getByRole("button", { name: "Find member" }));
    expect(screen.queryByRole("button", { name: "Choose Test Member A" })).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Choose Test Member B" }));
    expect(screen.getByText("Test Member B")).toBeTruthy();
    fireEvent.submit(screen.getByRole("button", { name: "Save details" }).closest("form")!);
    await waitFor(() => expect(client.saveMemberDetails).toHaveBeenCalledOnce());
    expect(client.saveMemberDetails.mock.calls[0]![0].details.recommendedByStudentId).toBe(
      "student-2",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/members/profile/details-tab.test.tsx`
Expected: FAIL — `Failed to resolve import "./details-tab"`.

- [ ] **Step 3: Implement the tab**

Create `apps/web/src/app/admin/members/profile/details-tab.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  memberHowHeardOptions,
  memberInitialContactOptions,
} from "@bpt-jersey/domain/members/directory";
import {
  academyDateOf,
  deriveBmi,
  deriveShortNameVariants,
  memberAgeOn,
  type FullMemberProfile,
} from "@bpt-jersey/domain/members/profile";

import {
  MemberDetailsConflictError,
  saveMemberDetails,
  searchMemberNames,
} from "../../../../lib/member-profile-client";
import {
  countryOptions,
  dialCodes,
  draftFromDetails,
  idExpiryNotice,
  isDraftDirty,
  payloadFromDraft,
  type DetailsDraft,
  type DetailsDraftField,
} from "./details-form-model";

type SaveState = "idle" | "saving" | "saved" | "invalid" | "conflict" | "error";

const bmiLabels = {
  underweight: "Underweight",
  healthy: "Healthy",
  overweight: "Overweight",
  obese: "Obese",
} as const;

function fieldId(field: DetailsDraftField): string {
  return `member-details-${field}`;
}

function Field({
  field,
  label,
  hint,
  children,
  wide = false,
}: {
  field: DetailsDraftField | "recommendedBySearch" | "bmi";
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`login-field${wide ? " member-record-wide" : ""}`}>
      <label htmlFor={`member-details-${field}`}>{label}</label>
      {children}
      {hint === undefined ? null : (
        <p className="member-record-hint" id={`member-details-${field}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

function RecommendedByPicker({
  value,
  studentId,
  invalid,
  onChange,
}: {
  value: string;
  studentId: string;
  invalid: boolean;
  onChange: (studentId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly { studentId: string; fullName: string }[]>([]);
  const [chosenName, setChosenName] = useState<string>();
  const [searchState, setSearchState] = useState<"idle" | "searching" | "error">("idle");

  async function search(): Promise<void> {
    setSearchState("searching");
    try {
      const members = await searchMemberNames(query);
      setResults(members.filter((member) => member.studentId !== studentId));
      setSearchState("idle");
    } catch {
      setSearchState("error");
    }
  }

  if (value !== "") {
    return (
      <div className="login-field member-record-wide">
        <span className="member-record-hint">Recommended by</span>
        {/* ponytail: a stored recommender loaded from the record shows without a name; resolving it
            would spend a read per open. The name shows once chosen in this session. */}
        <p>{chosenName ?? "A member is recorded"}</p>
        <button
          className="member-record-link"
          onClick={() => {
            onChange("");
            setChosenName(undefined);
          }}
          type="button"
        >
          Clear recommended by
        </button>
      </div>
    );
  }

  return (
    <div className="login-field member-record-wide">
      <label htmlFor="member-details-recommendedBySearch">Recommended by</label>
      <input
        aria-invalid={invalid}
        autoComplete="off"
        id="member-details-recommendedBySearch"
        maxLength={80}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void search();
          }
        }}
        type="search"
        value={query}
      />
      <button
        className="member-record-link"
        disabled={searchState === "searching"}
        onClick={() => void search()}
        type="button"
      >
        Find member
      </button>
      {searchState === "error" ? (
        <p className="member-record-hint" role="alert">
          Unable to search members. Please try again.
        </p>
      ) : null}
      {results.length === 0 ? null : (
        <ul className="member-record-results">
          {results.map((member) => (
            <li key={member.studentId}>
              <span>{member.fullName}</span>{" "}
              <button
                aria-label={`Choose ${member.fullName}`}
                className="member-record-link"
                onClick={() => {
                  setChosenName(member.fullName);
                  setResults([]);
                  onChange(member.studentId);
                }}
                type="button"
              >
                Choose
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DetailsTab({
  profile,
  onDirtyChange,
  onSaved,
}: {
  profile: FullMemberProfile;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
}) {
  const [baseline, setBaseline] = useState<DetailsDraft>(() => draftFromDetails(profile.details));
  const [draft, setDraft] = useState<DetailsDraft>(baseline);
  const [requestId, setRequestId] = useState(() => globalThis.crypto.randomUUID());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [invalidFields, setInvalidFields] = useState<readonly DetailsDraftField[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = isDraftDirty(baseline, draft);
  const today = academyDateOf(new Date().toISOString());

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return undefined;
    function warn(event: BeforeUnloadEvent): void {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    function saveShortcut(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        formRef.current?.requestSubmit();
      }
    }
    window.addEventListener("keydown", saveShortcut);
    return () => window.removeEventListener("keydown", saveShortcut);
  }, []);

  function update(field: DetailsDraftField, value: string): void {
    setDraft((current) => ({ ...current, [field]: value }));
    // A changed draft is a different request; a retry of the same draft keeps its id (idempotent).
    setRequestId(globalThis.crypto.randomUUID());
    setInvalidFields((current) => current.filter((entry) => entry !== field));
    setSaveState((current) => (current === "saving" ? current : "idle"));
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saveState === "saving") return;
    const result = payloadFromDraft(profile.details, draft, requestId);
    if (!result.ok) {
      setInvalidFields(result.fields);
      setSaveState("invalid");
      const [first] = result.fields;
      if (first !== undefined) document.getElementById(fieldId(first))?.focus();
      return;
    }
    setInvalidFields([]);
    setSaveState("saving");
    try {
      await saveMemberDetails(result.payload);
      setBaseline(draft);
      setRequestId(globalThis.crypto.randomUUID());
      setSaveState("saved");
      onSaved();
    } catch (error) {
      if (error instanceof MemberDetailsConflictError) {
        setInvalidFields(["membershipNumber"]);
        setSaveState("conflict");
        document.getElementById(fieldId("membershipNumber"))?.focus();
      } else {
        setSaveState("error");
      }
    }
  }

  function text(
    field: DetailsDraftField,
    maxLength: number,
    type: "text" | "email" | "tel" | "date" = "text",
    extra: { required?: boolean; describedBy?: boolean } = {},
  ) {
    return (
      <input
        aria-describedby={extra.describedBy ? `${fieldId(field)}-hint` : undefined}
        aria-invalid={invalidFields.includes(field)}
        id={fieldId(field)}
        maxLength={type === "date" ? undefined : maxLength}
        onChange={(event) => update(field, event.target.value)}
        required={extra.required}
        type={type}
        value={draft[field]}
      />
    );
  }

  const shortNames = deriveShortNameVariants(draft.fullName);
  const shortNameOptions =
    draft.shortName === "" || shortNames.includes(draft.shortName)
      ? shortNames
      : [draft.shortName, ...shortNames];
  const age = memberAgeOn(draft.dateOfBirth, today);
  const bmi = deriveBmi(
    draft.weightKg.trim() === "" ? undefined : Number(draft.weightKg),
    draft.heightCm.trim() === "" ? undefined : Number(draft.heightCm),
  );
  const expiry = idExpiryNotice(draft.idCardExpiresOn, today);

  return (
    <form
      aria-label="Member details"
      className="member-record-form"
      noValidate
      onSubmit={(event) => void save(event)}
      ref={formRef}
    >
      <fieldset>
        <legend>Identification</legend>
        <Field field="fullName" label="Full name">
          {text("fullName", 160, "text", { required: true })}
        </Field>
        <Field field="shortName" label="Short name">
          <select
            id={fieldId("shortName")}
            onChange={(event) => update("shortName", event.target.value)}
            value={draft.shortName}
          >
            <option value="">Not set</option>
            {shortNameOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Field>
        <Field
          field="membershipNumber"
          label="Member No."
          hint={
            profile.nextFreeMemberNumber !== undefined && draft.membershipNumber === "" ? (
              <button
                className="member-record-link"
                onClick={() => update("membershipNumber", profile.nextFreeMemberNumber ?? "")}
                type="button"
              >
                {`Use next free number ${profile.nextFreeMemberNumber}`}
              </button>
            ) : undefined
          }
        >
          {text("membershipNumber", 64)}
        </Field>
        <Field field="nickname" label="Nickname" hint="Internal. Never shown to the member.">
          {text("nickname", 64, "text", { describedBy: true })}
        </Field>
      </fieldset>

      <fieldset>
        <legend>Contacts</legend>
        <Field field="email" label="E-mail">
          {text("email", 320, "email")}
        </Field>
        <Field field="phoneCountryCode" label="Mobile country code">
          <select
            id={fieldId("phoneCountryCode")}
            onChange={(event) => update("phoneCountryCode", event.target.value)}
            value={draft.phoneCountryCode}
          >
            <option value="">No code</option>
            {dialCodes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>
        <Field field="phoneLocalNumber" label="Mobile number">
          {text("phoneLocalNumber", 58, "tel")}
        </Field>
        <Field field="emergencyContactFullName" label="Emergency contact name">
          {text("emergencyContactFullName", 160)}
        </Field>
        <Field field="emergencyContactRelationship" label="Emergency contact relationship">
          {text("emergencyContactRelationship", 64)}
        </Field>
        <Field field="emergencyContactPhoneNumber" label="Emergency contact phone">
          {text("emergencyContactPhoneNumber", 64, "tel")}
        </Field>
        <Field
          field="emergencyContactAlternatePhoneNumber"
          label="Emergency contact alternate phone"
        >
          {text("emergencyContactAlternatePhoneNumber", 64, "tel")}
        </Field>
      </fieldset>

      <fieldset>
        <legend>Address</legend>
        <Field field="addressLine" label="Address" wide>
          {text("addressLine", 240)}
        </Field>
        <Field field="city" label="City">
          {text("city", 120)}
        </Field>
        <Field field="postCode" label="Postal code">
          {text("postCode", 16)}
        </Field>
        <Field field="country" label="Country">
          <select
            id={fieldId("country")}
            onChange={(event) => update("country", event.target.value)}
            value={draft.country}
          >
            <option value="">Not set</option>
            {countryOptions().map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>

      <fieldset>
        <legend>Documents</legend>
        <Field field="idCardNumber" label="ID card no.">
          {text("idCardNumber", 64)}
        </Field>
        <Field
          field="idCardExpiresOn"
          label="ID expiry"
          hint={
            expiry === null
              ? undefined
              : expiry.kind === "expired"
                ? "ID card expired"
                : expiry.days === 0
                  ? "ID card expires today"
                  : `ID card expires in ${expiry.days} days`
          }
        >
          {text("idCardExpiresOn", 10, "date", { describedBy: expiry !== null })}
        </Field>
        <Field field="healthNumber" label="Health number">
          {text("healthNumber", 64)}
        </Field>
        <Field field="vatNumber" label="Tax number">
          {text("vatNumber", 64)}
        </Field>
        <Field field="profession" label="Profession">
          {text("profession", 120)}
        </Field>
      </fieldset>

      <fieldset>
        <legend>Personal</legend>
        <Field field="gender" label="Gender">
          <select
            id={fieldId("gender")}
            onChange={(event) => update("gender", event.target.value)}
            value={draft.gender}
          >
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="unknown">Not stated</option>
          </select>
        </Field>
        <Field
          field="dateOfBirth"
          label="Date of birth"
          hint={age === null ? undefined : `${age} years old`}
        >
          {text("dateOfBirth", 10, "date", { required: true, describedBy: age !== null })}
        </Field>
        <Field field="weightKg" label="Weight (kg)">
          <input
            aria-invalid={invalidFields.includes("weightKg")}
            id={fieldId("weightKg")}
            inputMode="decimal"
            max={400}
            min={1}
            onChange={(event) => update("weightKg", event.target.value)}
            step={0.1}
            type="number"
            value={draft.weightKg}
          />
        </Field>
        <Field field="heightCm" label="Height (cm)">
          <input
            aria-invalid={invalidFields.includes("heightCm")}
            id={fieldId("heightCm")}
            inputMode="numeric"
            max={250}
            min={30}
            onChange={(event) => update("heightCm", event.target.value)}
            step={1}
            type="number"
            value={draft.heightCm}
          />
        </Field>
        <div className="login-field">
          <span className="member-record-hint" id="member-details-bmi-label">
            BMI
          </span>
          <output aria-labelledby="member-details-bmi-label" role="status">
            {bmi === null ? "—" : `${bmi.value.toFixed(1)} · ${bmiLabels[bmi.category]}`}
          </output>
        </div>
      </fieldset>

      <fieldset>
        <legend>Registration</legend>
        <Field field="registeredOn" label="Registration date">
          {text("registeredOn", 10, "date")}
        </Field>
        <Field field="howHeard" label="How they heard">
          <select
            id={fieldId("howHeard")}
            onChange={(event) => update("howHeard", event.target.value)}
            value={draft.howHeard}
          >
            <option value="">Not set</option>
            {memberHowHeardOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Field>
        <Field field="initialContact" label="Initial contact">
          <select
            id={fieldId("initialContact")}
            onChange={(event) => update("initialContact", event.target.value)}
            value={draft.initialContact}
          >
            <option value="">Not set</option>
            {memberInitialContactOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Field>
        <RecommendedByPicker
          invalid={invalidFields.includes("recommendedByStudentId")}
          onChange={(value) => update("recommendedByStudentId", value)}
          studentId={profile.header.studentId}
          value={draft.recommendedByStudentId}
        />
      </fieldset>

      <fieldset>
        <legend>Notes</legend>
        <Field
          field="internalNotes"
          label="Internal notes"
          hint="Internal. Never shown to the member."
          wide
        >
          <textarea
            aria-describedby={`${fieldId("internalNotes")}-hint`}
            aria-invalid={invalidFields.includes("internalNotes")}
            id={fieldId("internalNotes")}
            maxLength={2000}
            onChange={(event) => update("internalNotes", event.target.value)}
            rows={5}
            value={draft.internalNotes}
          />
        </Field>
      </fieldset>

      <div className="member-record-save-bar">
        <button className="member-record-button" disabled={saveState === "saving"} type="submit">
          {saveState === "saving" ? "Saving details" : "Save details"}
        </button>
        <p className="member-record-hint">
          {dirty ? "Unsaved changes. " : ""}Ctrl or Cmd + S saves.
        </p>
        {saveState === "saved" ? <p role="status">Details saved.</p> : null}
        {saveState === "invalid" ? <p role="alert">Check the highlighted fields.</p> : null}
        {saveState === "conflict" ? (
          <p role="alert">That member number is already used by another member.</p>
        ) : null}
        {saveState === "error" ? (
          <p role="alert">Unable to save member details. Please try again.</p>
        ) : null}
      </div>
    </form>
  );
}
```

Add to `admin.css`, inside the `member-record-*` block from Task 9, before the `@media (max-width: 50rem)` rule:

```css
.member-record-results {
  display: grid;
  gap: 0.5rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.member-record-results li {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: space-between;
}
```

The BMI `<output>` is found in the tests with `getByRole("status", { name: "BMI" })`; its name comes
from `aria-labelledby`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/members/profile/details-tab.test.tsx`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/members/profile/details-tab.tsx apps/web/src/app/admin/members/profile/details-tab.test.tsx apps/web/src/app/admin/admin.css
git commit -m "feat(web): DETAILS tab - one form, Ctrl/Cmd+S, dirty warning, derived age and BMI (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Web — record route, header and ARIA tabs (`?id`, `?tab`, `&view`)

**Files:**

- Create: `apps/web/src/app/admin/members/profile/member-record.tsx`
- Create: `apps/web/src/app/admin/members/profile/page.tsx`
- Test: `apps/web/src/app/admin/members/profile/member-record.test.tsx`

**Interfaces:**

- Consumes: Task 8 `getMemberProfile`, `isMemberRecordId`, `MemberRecordLoadError`; Task 9
  `ProfileTab`, `RecordEmptyTab`, `participantTypeLabel`, `statusLabel`; Task 11 `DetailsTab`;
  Task 3 `memberRecordTabs`, `MemberRecordTab`, `MemberProfile`, `MemberProfileHeader`.
- Produces:
  - `export type RecordLocation = Readonly<{ studentId: string | null; tab: MemberRecordTab; manage: boolean }>`
  - `export function readRecordLocation(search: string): RecordLocation`
  - `export function recordHref(studentId: string, tab?: MemberRecordTab, manage?: boolean): string`
    — used by Task 13 (search), Task 14 (overview) and Plan C (Manage link:
    `recordHref(id, "profile", true)` → `/admin/members/profile?id=<id>&view=manage`).
  - `export function MemberRecord(): JSX.Element`
  - **Plan C insertion points** (named constants inside `MemberRecord`): `ibjjfCardSlot` (passed to
    `ProfileTab`) and the `location.manage` branch, which Plan C turns into `<ManageView … />`.
  - Route `/admin/members/profile` (default export `MemberRecordRoute`).

URL rules: `?id=` must match the opaque id pattern or nothing is called; `?tab=` outside the visible
tabs falls back to `profile`; tab changes use `history.pushState` so Back works and every state is
linkable; `popstate` re-reads the URL. The static export has no dynamic segment, which is why the id
is a query parameter (spec §3).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/admin/members/profile/member-record.test.tsx`:

```tsx
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MemberProfile } from "@bpt-jersey/domain/members/profile";

const client = vi.hoisted(() => {
  class MemberRecordLoadError extends Error {}
  class MemberDetailsConflictError extends Error {}
  return {
    MemberRecordLoadError,
    MemberDetailsConflictError,
    getMemberProfile: vi.fn(),
    saveMemberDetails: vi.fn(),
    searchMemberNames: vi.fn(),
    isMemberRecordId: (value: string | null) =>
      value !== null && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value),
  };
});

vi.mock("../../../../lib/member-profile-client", () => client);

import { MemberRecord, readRecordLocation, recordHref } from "./member-record";

const header = {
  studentId: "student-1",
  fullName: "Test Member A",
  age: 26,
  participantType: "adult",
  status: "active",
  birthdayBadge: { kind: "today" },
} as const;

const full: MemberProfile = {
  view: "full",
  header: { ...header, maskedMemberReference: "****0000" },
  cards: {
    memberSince: "2026-01-15",
    monthsAsMember: 8,
    accountManagers: [],
    currentMembership: null,
  },
  details: {
    studentId: "student-1",
    fullName: "Test Member A",
    dateOfBirth: "2000-09-17",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    gender: "unknown",
    membershipNumber: "00000000",
  },
};

function open(search: string) {
  window.history.replaceState(null, "", `/admin/members/profile${search}`);
  render(<MemberRecord />);
  return userEvent.setup();
}

beforeEach(() => {
  client.getMemberProfile.mockResolvedValue(full);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("record location", () => {
  it("reads and writes linkable record URLs", () => {
    expect(readRecordLocation("?id=student-1&tab=details&view=manage")).toEqual({
      studentId: "student-1",
      tab: "details",
      manage: true,
    });
    expect(readRecordLocation("?id=../x&tab=secret")).toEqual({
      studentId: null,
      tab: "profile",
      manage: false,
    });
    expect(recordHref("student-1")).toBe("/admin/members/profile?id=student-1");
    expect(recordHref("student-1", "details")).toBe(
      "/admin/members/profile?id=student-1&tab=details",
    );
    expect(recordHref("student-1", "profile", true)).toBe(
      "/admin/members/profile?id=student-1&view=manage",
    );
  });
});

describe("member record page", () => {
  it("refuses an invalid id without calling the backend", async () => {
    open("?id=../student");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "This member record link is not valid.",
    );
    expect(client.getMemberProfile).not.toHaveBeenCalled();
  });

  it("shows a skeleton, then the header and eight tabs for office", async () => {
    let resolve: (value: MemberProfile) => void = () => {};
    client.getMemberProfile.mockReturnValue(new Promise<MemberProfile>((done) => (resolve = done)));
    open("?id=student-1");
    expect(screen.getByRole("status", { name: "Loading member record" })).toBeTruthy();
    resolve(full);

    expect(await screen.findByRole("heading", { level: 2, name: "Test Member A" })).toBeTruthy();
    expect(screen.getByText("****0000")).toBeTruthy();
    expect(screen.getByText("Birthday today")).toBeTruthy();
    expect(screen.getByText("Active").className).toContain("member-record-status-active");
    const tabs = within(
      screen.getByRole("tablist", { name: "Member record sections" }),
    ).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Profile",
      "Details",
      "Plan",
      "Documents",
      "Payments",
      "Classes",
      "Communication",
      "Notes",
    ]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(client.getMemberProfile).toHaveBeenCalledWith("student-1");
  });

  it("opens the tab named in the URL", async () => {
    open("?id=student-1&tab=details");
    expect(await screen.findByRole("form", { name: "Member details" })).toBeTruthy();
  });

  it("shows a coach only the Profile tab, whatever the URL asks for", async () => {
    client.getMemberProfile.mockResolvedValue({ view: "coach", header });
    open("?id=student-1&tab=details");
    await screen.findByRole("heading", { level: 2, name: "Test Member A" });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Profile"]);
    expect(screen.queryByRole("form", { name: "Member details" })).toBeNull();
    expect(screen.queryByText("Member reference")).toBeNull();
  });

  it("moves between tabs with arrow, Home and End keys and keeps the URL in step", async () => {
    const user = open("?id=student-1");
    const profileTab = await screen.findByRole("tab", { name: "Profile" });
    profileTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Details" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Details" }));
    expect(window.location.search).toBe("?id=student-1&tab=details");
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Notes" }).getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")).toBe("true");
    expect(window.location.search).toBe("?id=student-1");
  });

  it("warns before leaving Details with unsaved changes", async () => {
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const user = open("?id=student-1&tab=details");
    await user.type(await screen.findByLabelText("Nickname"), "Tester");

    await user.click(screen.getByRole("tab", { name: "Plan" }));
    expect(confirm).toHaveBeenCalledWith(
      "You have unsaved changes in Details. Leave without saving?",
    );
    expect(screen.getByRole("tab", { name: "Details" }).getAttribute("aria-selected")).toBe("true");

    await user.click(screen.getByRole("tab", { name: "Plan" }));
    expect(screen.getByRole("link", { name: "Open Memberships" })).toBeTruthy();
  });

  it("shows the safe load error and retries", async () => {
    client.getMemberProfile.mockRejectedValueOnce(
      new client.MemberRecordLoadError("This member record was not found."),
    );
    const user = open("?id=student-1");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "This member record was not found.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(client.getMemberProfile).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("heading", { level: 2, name: "Test Member A" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/members/profile/member-record.test.tsx`
Expected: FAIL — `Failed to resolve import "./member-record"`.

- [ ] **Step 3: Implement the record**

Create `apps/web/src/app/admin/members/profile/member-record.tsx`:

```tsx
"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import {
  memberRecordTabs,
  type MemberProfile,
  type MemberProfileHeader,
  type MemberRecordTab,
} from "@bpt-jersey/domain/members/profile";

import {
  MemberRecordLoadError,
  getMemberProfile,
  isMemberRecordId,
} from "../../../../lib/member-profile-client";
import { DetailsTab } from "./details-tab";
import { ProfileTab } from "./profile-tab";
import { RecordEmptyTab } from "./record-empty-tab";
import { participantTypeLabel, statusLabel } from "./record-format";

export type RecordLocation = Readonly<{
  studentId: string | null;
  tab: MemberRecordTab;
  manage: boolean;
}>;

const tabLabels: Readonly<Record<MemberRecordTab, string>> = {
  profile: "Profile",
  details: "Details",
  plan: "Plan",
  documents: "Documents",
  payments: "Payments",
  classes: "Classes",
  communication: "Communication",
  notes: "Notes",
};

const unsavedDetailsQuestion = "You have unsaved changes in Details. Leave without saving?";
const genericLoadError = "Unable to load this member record. Please try again.";

export function readRecordLocation(search: string): RecordLocation {
  const params = new URLSearchParams(search);
  const id = params.get("id");
  const tab = params.get("tab");
  return {
    studentId: isMemberRecordId(id) ? id : null,
    tab:
      tab !== null && (memberRecordTabs as readonly string[]).includes(tab)
        ? (tab as MemberRecordTab)
        : "profile",
    manage: params.get("view") === "manage",
  };
}

export function recordHref(
  studentId: string,
  tab: MemberRecordTab = "profile",
  manage = false,
): string {
  const params = new URLSearchParams({ id: studentId });
  if (tab !== "profile") params.set("tab", tab);
  if (manage) params.set("view", "manage");
  return `/admin/members/profile?${params.toString()}`;
}

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "invalid" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; profile: MemberProfile }>;

function RecordHeader({
  header,
  headingRef,
}: {
  header: MemberProfileHeader;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const badge = header.birthdayBadge;
  return (
    <header className="member-record-header">
      <p className="admin-eyebrow">Members / Record</p>
      <h2 ref={headingRef} tabIndex={-1}>
        {header.fullName}
      </h2>
      <dl className="member-record-facts">
        {header.maskedMemberReference === undefined ? null : (
          <div>
            <dt>Member reference</dt>
            <dd>{header.maskedMemberReference}</dd>
          </div>
        )}
        <div>
          <dt>Age</dt>
          <dd>{header.age === null ? "Unknown" : `${header.age} years`}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{participantTypeLabel(header.participantType)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd className={`member-record-status member-record-status-${header.status}`}>
            {statusLabel(header.status)}
          </dd>
        </div>
      </dl>
      {badge === null ? null : (
        <p className="member-record-birthday">
          {badge.kind === "today"
            ? "Birthday today"
            : `Birthday in ${badge.days} ${badge.days === 1 ? "day" : "days"}`}
        </p>
      )}
    </header>
  );
}

export function MemberRecord() {
  const [location, setLocation] = useState<RecordLocation | null>(null);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const detailsDirty = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    function sync(): void {
      setLocation(readRecordLocation(window.location.search));
    }
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const studentId = location === null ? undefined : location.studentId;

  useEffect(() => {
    if (studentId === undefined) return undefined;
    if (studentId === null) {
      setLoad({ status: "invalid" });
      return undefined;
    }
    let active = true;
    setLoad((current) =>
      current.status === "ready" && current.profile.header.studentId === studentId
        ? current
        : { status: "loading" },
    );
    getMemberProfile(studentId).then(
      (profile) => {
        if (active) setLoad({ status: "ready", profile });
      },
      (error: unknown) => {
        if (!active) return;
        setLoad({
          status: "error",
          message: error instanceof MemberRecordLoadError ? error.message : genericLoadError,
        });
      },
    );
    return () => {
      active = false;
    };
  }, [studentId, attempt]);

  const readyStudentId = load.status === "ready" ? load.profile.header.studentId : undefined;
  useEffect(() => {
    if (readyStudentId !== undefined) headingRef.current?.focus();
  }, [readyStudentId]);

  const onDirtyChange = useCallback((dirty: boolean) => {
    detailsDirty.current = dirty;
  }, []);

  const visibleTabs: readonly MemberRecordTab[] =
    load.status === "ready" && load.profile.view === "full" ? memberRecordTabs : ["profile"];
  const activeTab: MemberRecordTab =
    location !== null && visibleTabs.includes(location.tab) ? location.tab : "profile";

  function selectTab(tab: MemberRecordTab): boolean {
    if (location === null || location.studentId === null || tab === activeTab) return false;
    if (
      activeTab === "details" &&
      detailsDirty.current &&
      !window.confirm(unsavedDetailsQuestion)
    ) {
      return false;
    }
    detailsDirty.current = false;
    window.history.pushState(null, "", recordHref(location.studentId, tab));
    setLocation({ ...location, tab, manage: false });
    return true;
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const index = visibleTabs.indexOf(activeTab);
    const last = visibleTabs.length - 1;
    const nextIndex =
      event.key === "ArrowRight"
        ? (index + 1) % visibleTabs.length
        : event.key === "ArrowLeft"
          ? (index + last) % visibleTabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : undefined;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const next = visibleTabs[nextIndex];
    if (next !== undefined && selectTab(next)) {
      document.getElementById(`member-record-tab-${next}`)?.focus();
    }
  }

  // Plan C (E2) insertion points: `ibjjfCardSlot` becomes <IbjjfCard studentId={…} />, and the
  // `location.manage` branch below renders <ManageView … /> in place of the PROFILE cards.
  const ibjjfCardSlot: ReactNode = undefined;

  function panel(profile: MemberProfile): ReactNode {
    if (activeTab === "profile") {
      return <ProfileTab profile={profile} ibjjfCardSlot={ibjjfCardSlot} />;
    }
    if (activeTab === "details") {
      return profile.view === "full" ? (
        <DetailsTab
          onDirtyChange={onDirtyChange}
          onSaved={() => setAttempt((current) => current + 1)}
          profile={profile}
        />
      ) : null;
    }
    return (
      <RecordEmptyTab
        canOpenDetails={profile.view === "full"}
        onOpenDetails={() => {
          if (selectTab("details")) document.getElementById("member-record-tab-details")?.focus();
        }}
        studentId={profile.header.studentId}
        tab={activeTab}
      />
    );
  }

  return (
    <section aria-label="Member record" className="admin-module-page member-record">
      <div>
        <Link className="member-record-link" href="/admin/members/search">
          Back to member search
        </Link>
      </div>

      {load.status === "loading" ? (
        <div
          aria-busy="true"
          aria-label="Loading member record"
          className="member-record-skeleton"
          role="status"
        >
          <span />
          <span />
          <span />
        </div>
      ) : null}

      {load.status === "invalid" ? (
        <div className="member-record-notice" role="alert">
          <p className="admin-eyebrow">Members / Record</p>
          <p>This member record link is not valid.</p>
        </div>
      ) : null}

      {load.status === "error" ? (
        <div className="member-record-notice">
          <p className="admin-eyebrow">Members / Record</p>
          <p role="alert">{load.message}</p>
          <button
            className="member-record-button"
            onClick={() => setAttempt((current) => current + 1)}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : null}

      {load.status === "ready" ? (
        <>
          <RecordHeader header={load.profile.header} headingRef={headingRef} />
          <div
            aria-label="Member record sections"
            className="admin-member-profile-tabs member-record-tabs"
            onKeyDown={onTabKeyDown}
            role="tablist"
          >
            {visibleTabs.map((tab) => (
              <button
                aria-controls="member-record-panel"
                aria-selected={tab === activeTab}
                className={`admin-member-profile-tab${tab === activeTab ? " is-active" : ""}`}
                id={`member-record-tab-${tab}`}
                key={tab}
                onClick={() => selectTab(tab)}
                role="tab"
                tabIndex={tab === activeTab ? 0 : -1}
                type="button"
              >
                {tabLabels[tab]}
              </button>
            ))}
          </div>
          <div
            aria-labelledby={`member-record-tab-${activeTab}`}
            className="admin-member-profile-panel"
            id="member-record-panel"
            role="tabpanel"
            tabIndex={0}
          >
            {panel(load.profile)}
          </div>
        </>
      ) : null}
    </section>
  );
}
```

`MemberProfileHeader` includes the optional `maskedMemberReference`, and the coach header type is a
structural subset of it, so `RecordHeader` accepts both views. In the error branch the retry reuses
`attempt`, and a successful DETAILS save also bumps `attempt`: the record re-reads the profile while
the Details form stays mounted with its saved draft as baseline (it is not keyed on the reload).

Create `apps/web/src/app/admin/members/profile/page.tsx`:

```tsx
"use client";

import { MemberRecord } from "./member-record";

import "../../admin.css";

export default function MemberRecordRoute() {
  return <MemberRecord />;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/members/profile`
Expected: PASS (all files in the folder: profile-tab, details-form-model, details-tab, member-record).

- [ ] **Step 5: Prove the id guard on the page**

In `readRecordLocation`, temporarily replace `isMemberRecordId(id) ? id : null` with `id`. Re-run
`member-record.test.tsx`. Expected: FAIL in "reads and writes linkable record URLs" and in "refuses an
invalid id without calling the backend". Restore; re-run: PASS.

- [ ] **Step 6: Verify the static export builds the route**

Run: `corepack pnpm --filter @bpt-jersey/domain build:runtime && corepack pnpm --filter @bpt-jersey/web build`
Expected: build succeeds and `apps/web/out/admin/members/profile/index.html` (or `profile.html`,
depending on `trailingSlash`) exists.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/admin/members/profile/member-record.tsx apps/web/src/app/admin/members/profile/member-record.test.tsx apps/web/src/app/admin/members/profile/page.tsx
git commit -m "feat(web): member record route - header, birthday badge, eight ARIA tabs, linkable state (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Web — search page: canonical first, archive below, name-only search for coaches

**Files:**

- Modify (full rewrite shown below): `apps/web/src/app/admin/members/search/page.tsx`
- Modify: `apps/web/src/app/admin/members/search/page.test.tsx` (mocks, two tests removed, one
  changed, one `describe` appended — Plan A's reveal tests stay untouched)
- Modify: `apps/web/src/app/admin/admin.css` — `member-search-*` rules appended to the Task 9 block.

**Interfaces:**

- Consumes: Task 8 `searchMemberNames`; Task 12 `recordHref`; existing `lookupMemberIdentity`,
  `listRegyfitMemberRecords`, `getRegyfitMemberRecord` (`apps/web/src/lib/members-client.ts`),
  `MemberProfilePanel` (as left by Plan A), `useAdminOrStaffSession` (`apps/web/src/app/admin/admin-gate.tsx:269`).
- Produces: `SearchMembersPage` (unchanged export name). Accessible names: search form
  "Search members by name", input "Member name", button "Search", region "Member search results",
  row links "Open record for <name>", exact lookup region "Member lookup result" with link
  "Open record for <name>", archive heading "Regyfit archive (read only)".

Decisions recorded here:

- The inline "View restricted details" + "Edit member" editor on this page is **removed**: the
  record's DETAILS tab (Tasks 10–12) is now the single place to read and edit restricted fields, and
  keeping two editors of the same full-replacement update would let the older one drop fields it does
  not know. The exact identifier lookup stays for office and links to the record.
- Coaches see only the name search (grill G6). The Regyfit archive and exact lookup are not rendered
  and their callables are not called for them.
- Off-brand inline colours (`#4f46e5`, `#eef2ff`, `#4b5563`, `#6b7280`) and every `style={…}` are
  replaced by classes; count and state pills become plain text (DESIGN.md: no pills).

- [ ] **Step 1: Update the tests first**

In `apps/web/src/app/admin/members/search/page.test.tsx`:

1. After the `clientMocks` block add:

```tsx
const profileClientMocks = vi.hoisted(() => ({ searchMemberNames: vi.fn() }));
const gate = vi.hoisted(() => ({
  role: "owner" as "owner" | "administrator" | "headCoach" | "coach",
}));

vi.mock("../../../../lib/member-profile-client", () => profileClientMocks);
vi.mock("../../admin-gate", () => ({
  useAdminOrStaffSession: () => ({
    uid: "u-1",
    email: "u@example.test",
    displayName: "Test Staff",
    academyId: "academy-1",
    role: gate.role,
  }),
}));
```

2. Delete the tests "loads restricted detail only after an explicit action" and "edits only a loaded
   detail and keeps the UUID stable for an exact retry" (the editor they cover is removed).

3. In "sends an exact purpose-bound lookup and renders only the minimized row", after
   `expect(within(results).getByText("****0001")).toBeVisible();` add:

```tsx
expect(
  within(results).getByRole("link", { name: "Open record for Synthetic Adult" }),
).toHaveAttribute("href", "/admin/members/profile?id=student-1");
expect(within(results).queryByRole("button", { name: "View restricted details" })).toBeNull();
```

4. Append:

```tsx
describe("canonical name search (T051V2)", () => {
  afterEach(() => {
    cleanup();
    gate.role = "owner";
    profileClientMocks.searchMemberNames.mockReset();
    clientMocks.listRegyfitMemberRecords.mockReset();
    clientMocks.lookupMemberIdentity.mockReset();
  });

  it("puts the canonical search first and the read-only archive last, with no inline styles", async () => {
    clientMocks.listRegyfitMemberRecords.mockResolvedValue(directoryPage);
    const { container } = render(<SearchMembersPage />);
    await screen.findByText("Synthetic Child");
    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings.indexOf("Find a member")).toBe(0);
    expect(headings.indexOf("Regyfit archive (read only)")).toBe(headings.length - 1);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    expect(container.querySelectorAll(".admin-status-badge")).toHaveLength(0);
  });

  it("lists matching members with an inline Open record link", async () => {
    const user = userEvent.setup();
    profileClientMocks.searchMemberNames.mockResolvedValue([
      { studentId: "student-2", fullName: "Test Member B" },
    ]);
    clientMocks.listRegyfitMemberRecords.mockResolvedValue(directoryPage);
    render(<SearchMembersPage />);
    await user.type(screen.getByLabelText("Member name"), "test");
    await user.click(screen.getByRole("button", { name: "Search" }));

    const results = await screen.findByRole("region", { name: "Member search results" });
    expect(await within(results).findByText("Test Member B")).toBeVisible();
    expect(
      within(results).getByRole("link", { name: "Open record for Test Member B" }),
    ).toHaveAttribute("href", "/admin/members/profile?id=student-2");
    expect(profileClientMocks.searchMemberNames).toHaveBeenCalledWith("test");
  });

  it("asks for two letters and explains an empty or failed search", async () => {
    const user = userEvent.setup();
    clientMocks.listRegyfitMemberRecords.mockResolvedValue(directoryPage);
    profileClientMocks.searchMemberNames
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("raw backend detail"));
    render(<SearchMembersPage />);

    await user.type(screen.getByLabelText("Member name"), "t");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Type at least two letters of a name.");
    expect(profileClientMocks.searchMemberNames).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Member name"), "e");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("heading", { name: "No member found" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Search" }));
    const alert = await screen.findByText("Unable to search members. Please try again.");
    expect(alert).not.toHaveTextContent("raw backend detail");
  });

  it("gives coaches the name search only and never calls office reads", async () => {
    for (const role of ["headCoach", "coach"] as const) {
      gate.role = role;
      render(<SearchMembersPage />);
      expect(screen.getByLabelText("Member name")).toBeVisible();
      expect(screen.queryByLabelText("Exact identifier")).toBeNull();
      expect(screen.queryByText("Regyfit archive (read only)")).toBeNull();
      expect(clientMocks.listRegyfitMemberRecords).not.toHaveBeenCalled();
      cleanup();
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/members/search/page.test.tsx`
Expected: FAIL — no "Member name" field, no "Open record" link, inline `style` attributes present.

- [ ] **Step 3: Rewrite the page**

Replace the whole content of `apps/web/src/app/admin/members/search/page.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  AdminDirectoryRow,
  PublicAdminIdentifierLookupKind,
} from "@bpt-jersey/domain/members/directory";
import type {
  RegyfitMemberDirectoryPage,
  RegyfitMemberDirectoryRow,
  RegyfitMemberRecord,
} from "@bpt-jersey/domain/members/regyfit-records";

import { searchMemberNames } from "../../../../lib/member-profile-client";
import {
  getRegyfitMemberRecord,
  listRegyfitMemberRecords,
  lookupMemberIdentity,
} from "../../../../lib/members-client";
import { useAdminOrStaffSession } from "../../admin-gate";
import { recordHref } from "../profile/member-record";
import { MemberProfilePanel } from "./member-profile-panel";

import "../../admin.css";

type LookupState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "no-match" }>
  | Readonly<{ status: "match"; row: AdminDirectoryRow }>
  | Readonly<{ status: "error" }>;

type DirectoryState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "loaded"; page: RegyfitMemberDirectoryPage }>
  | Readonly<{ status: "error" }>;

type RecordState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading"; recordId: string }>
  | Readonly<{ status: "loaded"; record: RegyfitMemberRecord }>
  | Readonly<{ status: "error"; recordId: string }>;

type NameSearchState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "too-short" }>
  | Readonly<{ status: "searching" }>
  | Readonly<{ status: "done"; members: readonly { studentId: string; fullName: string }[] }>
  | Readonly<{ status: "error" }>;

function NameSearchSection() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<NameSearchState>({ status: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const value = query.trim();
    if (value.length < 2) {
      setSearch({ status: "too-short" });
      return;
    }
    setSearch({ status: "searching" });
    try {
      setSearch({ status: "done", members: await searchMemberNames(value) });
    } catch {
      setSearch({ status: "error" });
    }
  }

  return (
    <section aria-labelledby="member-name-search-title" className="admin-panel-card member-search">
      <p className="admin-eyebrow">Members / Search</p>
      <h2 id="member-name-search-title">Find a member</h2>
      <form
        aria-label="Search members by name"
        className="member-search-form"
        onSubmit={(event) => void submit(event)}
        role="search"
      >
        <div className="login-field">
          <label htmlFor="member-name-query">Member name</label>
          <input
            autoComplete="off"
            id="member-name-query"
            maxLength={80}
            onChange={(event) => setQuery(event.target.value)}
            type="search"
            value={query}
          />
        </div>
        <button
          className="member-record-button"
          disabled={search.status === "searching"}
          type="submit"
        >
          Search
        </button>
      </form>
      <div aria-label="Member search results" aria-live="polite" role="region">
        {search.status === "idle" ? (
          <p className="member-record-hint">Type at least two letters of a name.</p>
        ) : null}
        {search.status === "too-short" ? (
          <p role="alert">Type at least two letters of a name.</p>
        ) : null}
        {search.status === "searching" ? (
          <div aria-label="Searching members" className="member-record-skeleton" role="status">
            <span />
          </div>
        ) : null}
        {search.status === "error" ? (
          <p role="alert">Unable to search members. Please try again.</p>
        ) : null}
        {search.status === "done" && search.members.length === 0 ? (
          <div className="member-record-empty">
            <p className="admin-eyebrow">Search</p>
            <h3>No member found</h3>
            <p>Check the spelling or search for part of the name.</p>
            <button
              className="member-record-link"
              onClick={() => {
                setQuery("");
                setSearch({ status: "idle" });
              }}
              type="button"
            >
              Clear search
            </button>
          </div>
        ) : null}
        {search.status === "done" && search.members.length > 0 ? (
          <ul className="member-search-results">
            {search.members.map((member) => (
              <li key={member.studentId}>
                <span>{member.fullName}</span>
                <Link
                  aria-label={`Open record for ${member.fullName}`}
                  className="member-record-link"
                  href={recordHref(member.studentId)}
                >
                  Open record
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function matchesQuery(row: RegyfitMemberDirectoryRow, query: string): boolean {
  const haystacks = [row.fullName, row.memberNumber, row.email, row.mobile, row.birthDate];
  return haystacks.some((value) => value !== undefined && value.toLowerCase().includes(query));
}

function AcademyMemberDirectorySection({
  directory,
  onRetry,
  onSelectRecord,
  selectedRecordId,
}: {
  directory: DirectoryState;
  onRetry: () => void;
  onSelectRecord: (row: RegyfitMemberDirectoryRow) => void;
  selectedRecordId: string | undefined;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const rows = useMemo(
    () => (directory.status === "loaded" ? directory.page.rows : []),
    [directory],
  );
  const paymentModes = useMemo(
    () =>
      [...new Set(rows.map((row) => row.paymentMode).filter((mode) => mode !== undefined))].sort(),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return rows.filter(
      (row) =>
        (query.length === 0 || matchesQuery(row, query)) &&
        (stateFilter === "all" || row.membershipState === stateFilter) &&
        (paymentFilter === "all" || row.paymentMode === paymentFilter),
    );
  }, [rows, searchQuery, stateFilter, paymentFilter]);

  const totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
  const safePage = Math.min(page, totalPages - 1);
  const currentRows = filteredRows.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const activeCount = rows.filter((row) => row.membershipState === "active").length;
  const inactiveCount = rows.length - activeCount;
  const numberedCount = rows.filter((row) => row.memberNumber !== undefined).length;

  return (
    <section
      aria-labelledby="directory-search-heading"
      className="admin-panel-card member-search-archive"
    >
      <div className="admin-panel-card-heading">
        <div>
          <p className="admin-eyebrow">Members / Regyfit archive</p>
          <h3 id="directory-search-heading">Regyfit archive (read only)</h3>
        </div>
      </div>

      {directory.status === "loaded" ? (
        <ul className="member-search-counts">
          <li>Total: {rows.length}</li>
          <li>Active: {activeCount}</li>
          <li>Inactive: {inactiveCount}</li>
          <li>With member Nº: {numberedCount}</li>
          <li>No number: {rows.length - numberedCount}</li>
        </ul>
      ) : null}

      <p className="member-record-hint">
        Records captured from Regyfit
        {directory.status === "loaded" && directory.page.capturedAt !== undefined
          ? ` on ${directory.page.capturedAt.slice(0, 10)}`
          : ""}
        . They are not linked to the canonical record and cannot be edited here.
      </p>

      {directory.status === "loading" ? <p role="status">Loading academy directory...</p> : null}
      {directory.status === "error" ? (
        <div>
          <p aria-live="assertive" role="alert">
            Unable to load the academy directory. Please try again.
          </p>
          <button className="member-record-button" onClick={onRetry} type="button">
            Retry
          </button>
        </div>
      ) : null}

      {directory.status === "loaded" ? (
        <>
          <div className="member-search-filters">
            <div className="login-field">
              <label htmlFor="member-search-input">Search members</label>
              <input
                id="member-search-input"
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setPage(0);
                }}
                placeholder="Name, member Nº, email, mobile or birthdate"
                type="text"
                value={searchQuery}
              />
            </div>
            <div className="login-field">
              <label htmlFor="member-status-filter">Status filter</label>
              <select
                id="member-status-filter"
                onChange={(event) => {
                  setStateFilter(event.target.value);
                  setPage(0);
                }}
                value={stateFilter}
              >
                <option value="all">All statuses</option>
                <option value="active">Active ({activeCount})</option>
                <option value="inactive">Inactive ({inactiveCount})</option>
              </select>
            </div>
            <div className="login-field">
              <label htmlFor="member-payment-filter">Payment</label>
              <select
                id="member-payment-filter"
                onChange={(event) => {
                  setPaymentFilter(event.target.value);
                  setPage(0);
                }}
                value={paymentFilter}
              >
                <option value="all">All payment modes</option>
                {paymentModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="member-record-hint">
            Showing {filteredRows.length === 0 ? 0 : safePage * pageSize + 1} -{" "}
            {Math.min((safePage + 1) * pageSize, filteredRows.length)} of {filteredRows.length}{" "}
            members
          </p>

          <div className="admin-data-table-wrap">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Member Nº</th>
                  <th>Name</th>
                  <th>Birthdate</th>
                  <th>E-mail</th>
                  <th>Mobile Nº</th>
                  <th>Payment</th>
                  <th>Belt</th>
                  <th>Membership</th>
                </tr>
              </thead>
              <tbody>
                {currentRows.length === 0 ? (
                  <tr>
                    <td className="member-search-empty-cell" colSpan={8}>
                      No members match your search criteria.
                    </td>
                  </tr>
                ) : (
                  currentRows.map((row) => (
                    <tr
                      key={row.recordId}
                      {...(row.recordId === selectedRecordId
                        ? { "aria-current": "true" as const }
                        : {})}
                    >
                      <td>
                        <button
                          aria-label={`Open full record for ${row.fullName}`}
                          className="member-search-number"
                          onClick={() => onSelectRecord(row)}
                          type="button"
                        >
                          {row.memberNumber ?? `#${row.recordId}`}
                        </button>
                      </td>
                      <td>
                        <strong>{row.fullName}</strong>
                      </td>
                      <td>{row.birthDate ?? "—"}</td>
                      <td>{row.email ?? "—"}</td>
                      <td>{row.mobile ?? "—"}</td>
                      <td>{row.paymentMode ?? "—"}</td>
                      <td>{row.belt ?? "—"}</td>
                      <td>{row.membershipState === "active" ? "Active" : "Inactive"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 ? (
            <div className="member-search-pagination">
              <span>
                Page {safePage + 1} of {totalPages}
              </span>
              <div>
                <button
                  className="member-record-link"
                  disabled={safePage === 0}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                  type="button"
                >
                  Previous
                </button>
                <button
                  className="member-record-link"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
                  type="button"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function ExactLookupSection({
  lookupKind,
  identifier,
  lookup,
  onKindChange,
  onIdentifierChange,
  onSubmit,
}: {
  lookupKind: PublicAdminIdentifierLookupKind;
  identifier: string;
  lookup: LookupState;
  onKindChange: (kind: PublicAdminIdentifierLookupKind) => void;
  onIdentifierChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section aria-labelledby="member-search-title" className="admin-panel-card member-search">
      <p className="admin-eyebrow">Members / Exact lookup</p>
      <h3 id="member-search-title">Find by identifier</h3>
      <p className="member-record-hint">
        Search by one exact approved identifier. Every lookup is audited.
      </p>
      <form className="member-search-form" onSubmit={onSubmit}>
        <div className="login-field">
          <label htmlFor="member-lookup-kind">Identifier type</label>
          <select
            id="member-lookup-kind"
            onChange={(event) =>
              onKindChange(event.target.value as PublicAdminIdentifierLookupKind)
            }
            value={lookupKind}
          >
            <option value="membership-number">Membership number</option>
            <option value="id-card-number">ID card number</option>
            <option value="vat-number">VAT number</option>
          </select>
        </div>
        <div className="login-field">
          <label htmlFor="member-exact-identifier">Exact identifier</label>
          <input
            autoComplete="off"
            id="member-exact-identifier"
            onChange={(event) => onIdentifierChange(event.target.value)}
            required
            type="text"
            value={identifier}
          />
        </div>
        <button
          className="member-record-button"
          disabled={lookup.status === "loading"}
          type="submit"
        >
          {lookup.status === "loading" ? "Searching..." : "Search exact identifier"}
        </button>
      </form>

      <section aria-busy={lookup.status === "loading"} aria-label="Member lookup result">
        {lookup.status === "idle" ? (
          <p className="member-record-hint">Search to see a member.</p>
        ) : null}
        {lookup.status === "loading" ? <p role="status">Searching...</p> : null}
        {lookup.status === "no-match" ? (
          <p aria-live="polite" role="status">
            No matching student was found.
          </p>
        ) : null}
        {lookup.status === "error" ? (
          <p aria-live="assertive" role="alert">
            Unable to find member. Please try again.
          </p>
        ) : null}
        {lookup.status === "match" ? (
          <ul className="member-search-results">
            <li>
              <span>
                <strong>{lookup.row.fullName}</strong>{" "}
                <span>{lookup.row.membershipReference ?? "No reference"}</span>
              </span>
              <Link
                aria-label={`Open record for ${lookup.row.fullName}`}
                className="member-record-link"
                href={recordHref(lookup.row.studentId)}
              >
                Open record
              </Link>
            </li>
          </ul>
        ) : null}
      </section>
    </section>
  );
}

function SearchMembersContent() {
  const session = useAdminOrStaffSession();
  const office = session.role === "owner" || session.role === "administrator";
  const [lookupKind, setLookupKind] =
    useState<PublicAdminIdentifierLookupKind>("membership-number");
  const [identifier, setIdentifier] = useState("");
  const [lookup, setLookup] = useState<LookupState>({ status: "idle" });
  const [directory, setDirectory] = useState<DirectoryState>({ status: "loading" });
  const [directoryAttempt, setDirectoryAttempt] = useState(0);
  const [selected, setSelected] = useState<RecordState>({ status: "idle" });

  useEffect(() => {
    if (!office) return undefined;
    let cancelled = false;
    setDirectory({ status: "loading" });
    async function loadDirectory(): Promise<void> {
      try {
        const page = await listRegyfitMemberRecords();
        if (!Array.isArray(page?.rows)) throw new Error("directory unavailable");
        if (!cancelled) setDirectory({ status: "loaded", page });
      } catch {
        if (!cancelled) setDirectory({ status: "error" });
      }
    }
    void loadDirectory();
    return () => {
      cancelled = true;
    };
  }, [directoryAttempt, office]);

  async function runLookup(
    kind: PublicAdminIdentifierLookupKind,
    rawIdentifier: string,
  ): Promise<void> {
    const value = rawIdentifier.trim();
    if (value.length === 0) {
      setLookup({ status: "error" });
      return;
    }
    setLookup({ status: "loading" });
    try {
      const result = await lookupMemberIdentity(kind, value);
      setLookup(result.matched ? { status: "match", row: result.row } : { status: "no-match" });
    } catch {
      setLookup({ status: "error" });
    }
  }

  function handleCanonicalLookup(membershipNumber: string): void {
    setLookupKind("membership-number");
    setIdentifier(membershipNumber);
    void runLookup("membership-number", membershipNumber);
  }

  async function openRecord(row: RegyfitMemberDirectoryRow): Promise<void> {
    setSelected({ status: "loading", recordId: row.recordId });
    if (row.memberNumber !== undefined) {
      setLookupKind("membership-number");
      setIdentifier(row.memberNumber);
    }
    try {
      const record = await getRegyfitMemberRecord(row.recordId);
      setSelected((current) =>
        current.status === "loading" && current.recordId === row.recordId
          ? { status: "loaded", record }
          : current,
      );
    } catch {
      setSelected((current) =>
        current.status === "loading" && current.recordId === row.recordId
          ? { status: "error", recordId: row.recordId }
          : current,
      );
    }
  }

  let selectedRecordId: string | undefined;
  if (selected.status === "loaded") selectedRecordId = selected.record.recordId;
  else if (selected.status !== "idle") selectedRecordId = selected.recordId;

  return (
    <>
      <NameSearchSection />
      {office ? (
        <ExactLookupSection
          identifier={identifier}
          lookup={lookup}
          lookupKind={lookupKind}
          onIdentifierChange={setIdentifier}
          onKindChange={setLookupKind}
          onSubmit={(event) => {
            event.preventDefault();
            void runLookup(lookupKind, identifier);
          }}
        />
      ) : null}
      {office && selected.status === "loading" ? (
        <p className="admin-panel-card" role="status">
          Loading member record...
        </p>
      ) : null}
      {office && selected.status === "error" ? (
        <p aria-live="assertive" className="admin-panel-card" role="alert">
          Unable to load the member record. Please try again.
        </p>
      ) : null}
      {office && selected.status === "loaded" ? (
        <MemberProfilePanel
          onCanonicalLookup={handleCanonicalLookup}
          onClose={() => setSelected({ status: "idle" })}
          record={selected.record}
        />
      ) : null}
      {office ? (
        <AcademyMemberDirectorySection
          directory={directory}
          onRetry={() => setDirectoryAttempt((attempt) => attempt + 1)}
          onSelectRecord={(row) => void openRecord(row)}
          selectedRecordId={selectedRecordId}
        />
      ) : null}
    </>
  );
}

export function SearchMembersPage() {
  return <SearchMembersContent />;
}

export default function SearchMembersRoute() {
  return <SearchMembersPage />;
}
```

If Plan A changed `MemberProfilePanel`'s props, keep Plan A's call site props and only move the
element into the `office &&` branch shown above.

The Regyfit panel (`MemberProfilePanel`) opens above the archive table, so its heading sits between
"Find by identifier" and "Regyfit archive (read only)"; the heading-order test only pins the first
and the last heading.

Append to the `member-record-*` block in `apps/web/src/app/admin/admin.css` (before
`@media (max-width: 50rem)`):

```css
.member-search {
  display: grid;
  gap: 1rem;
}

.member-search-form,
.member-search-filters {
  align-items: end;
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
}

.member-search-results {
  display: grid;
  gap: 0;
  list-style: none;
  margin: 0;
  padding: 0;
}

.member-search-results li {
  align-items: center;
  border-bottom: 1px solid var(--line);
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: space-between;
  min-height: 3.5rem;
  padding: 0.5rem 0;
}

.member-search-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.5rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  list-style: none;
  margin: 1rem 0;
  padding: 0;
}

.member-search-archive {
  margin-bottom: 2.5rem;
}

.member-search-empty-cell {
  padding: 2rem;
  text-align: center;
}

.admin-data-table tr[aria-current="true"] {
  background: #f0efff;
  box-shadow: inset 0.35rem 0 0 var(--bpt-purple);
}

.member-search-number {
  background: none;
  border: 0;
  color: var(--bpt-purple);
  cursor: pointer;
  font: inherit;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  min-height: 2.75rem;
  text-decoration: underline;
}

.member-search-number:focus-visible {
  outline: 3px solid var(--bpt-purple);
  outline-offset: 2px;
}

.member-search-pagination {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: space-between;
  margin-top: 1rem;
}

.member-search-pagination div {
  display: flex;
  gap: 0.5rem;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/members/search/page.test.tsx`
Expected: PASS — Plan A's reveal tests, the updated exact-lookup tests, the Regyfit archive tests
and the 4 new name-search tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/members/search/page.tsx apps/web/src/app/admin/members/search/page.test.tsx apps/web/src/app/admin/admin.css
git commit -m "feat(web): member search - canonical name search first, read-only Regyfit archive, no inline colours (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Web — overview birthday links, coach routes and the "Member search" menu item

**Files:**

- Modify: `apps/web/src/app/admin/overview-page.tsx` — imports (lines 1–14), `BirthdayTodayBand`
  (lines 81–102), `NextBirthdaysCard` list item (lines 122–130).
- Modify: `apps/web/src/app/admin/overview-page.test.tsx` — the two birthday tests (lines 104–169).
- Modify: `apps/web/src/app/admin/admin-routes.ts` — `coachRoutes` (lines 11–18), `offMenuStaffRoutes` (lines 25–30).
- Modify: `apps/web/src/app/admin/admin-routes.test.ts` — line 23 and a new test.
- Modify: `apps/web/src/app/admin/admin-shell.tsx` — People group (lines 37–43) and the comment above it.
- Modify: `apps/web/src/app/admin/page.test.tsx` — `pilotNavigation` (lines 23–35) and the two
  coach/headCoach navigation lists (lines 232–239, 262–269).

**Interfaces:**

- Consumes: Task 12 `recordHref`.
- Produces: coach and headCoach may open `/admin/members/search` (menu) and `/admin/members/profile`
  (off menu); `/admin/members` itself stays office-only. Overview birthday names become links whose
  accessible name is the member's display name and whose `href` is `recordHref(studentId)`.

- [ ] **Step 1: Write the failing tests**

In `overview-page.test.tsx`, in "lists at most the three nearest birthdays…", after
`expect(items[0]).toHaveTextContent(/turns 30/);` add:

```tsx
expect(within(items[0] as HTMLElement).getByRole("link", { name: "Ana Coelho" })).toHaveAttribute(
  "href",
  "/admin/members/profile?id=s-1",
);
```

In "announces a birthday that is today", replace
`expect(within(band).getByText("Ana Coelho")).toBeVisible();` with:

```tsx
expect(within(band).getByRole("link", { name: "Ana Coelho" })).toHaveAttribute(
  "href",
  "/admin/members/profile?id=s-1",
);
```

Add to the same file a coach variant:

```tsx
it("links birthday names to the record for coaches too", async () => {
  gate.role = "coach";
  api.listUpcomingBirthdays.mockResolvedValue([
    {
      studentId: "s-1",
      displayName: "Test Member A",
      daysAway: 0,
      turningAge: 30,
      participantType: "adult",
      trainingCenter: "Town",
    },
  ]);
  render(<OverviewPage />);
  const band = await screen.findByRole("status", { name: "Birthday today" });
  expect(within(band).getByRole("link", { name: "Test Member A" })).toHaveAttribute(
    "href",
    "/admin/members/profile?id=s-1",
  );
});
```

In `admin-routes.test.ts`, change line 23 to
`expect(isStaffRouteAllowed("/admin/members/search", "coach")).toBe(true);`, update the first test's
expected list to:

```ts
expect(staffRoutes.coach).toEqual([
  "/admin",
  "/admin/attendance",
  "/admin/members/search",
  "/admin/members/requests",
  "/admin/members/medical",
  "/admin/classes-services",
  "/admin/levels",
]);
```

and append inside the `describe`:

```ts
it("opens the member record and name search to the mat, not the office directory (ADR-010, 2026-09-17)", () => {
  for (const role of ["coach", "headCoach"] as const) {
    expect(isStaffRouteAllowed("/admin/members/profile", role)).toBe(true);
    expect(isStaffRouteAllowed("/admin/members/search", role)).toBe(true);
    expect(isStaffRouteAllowed("/admin/members", role)).toBe(false);
    expect(isStaffRouteAllowed("/admin/members/add", role)).toBe(false);
    expect(isStaffRouteAllowed("/admin/members/import", role)).toBe(false);
  }
});
```

In `page.test.tsx`, insert `"Member search",` after `"Members",` in `pilotNavigation`, and insert
`"->Member search",` after `"->Attendance",` in both coach and head-coach expected navigation lists.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/overview-page.test.tsx apps/web/src/app/admin/admin-routes.test.ts apps/web/src/app/admin/page.test.tsx`
Expected: FAIL — no birthday links, `/admin/members/profile` refused for coaches, no "Member search" menu item.

- [ ] **Step 3: Implement**

`overview-page.tsx` — add the import after `import { useAdminOrStaffSession } from "./admin-gate";`:

```tsx
import { recordHref } from "./members/profile/member-record";
```

In `BirthdayTodayBand`, replace
`<span className="admin-birthday-badge">{entry.displayName}</span>` with:

```tsx
<Link className="admin-birthday-badge" href={recordHref(entry.studentId)}>
  {entry.displayName}
</Link>
```

In `NextBirthdaysCard`, replace `<strong>{entry.displayName}</strong>` with:

```tsx
<strong>
  <Link href={recordHref(entry.studentId)}>{entry.displayName}</Link>
</strong>
```

Add to `admin.css` after `.admin-birthday-badge { … }` (line 134):

```css
a.admin-birthday-badge {
  min-height: 2.75rem;
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}

a.admin-birthday-badge:focus-visible,
.admin-birthday-list a:focus-visible {
  outline: 3px solid var(--bpt-purple);
  outline-offset: 2px;
}
```

`admin-routes.ts` — replace `coachRoutes` and `offMenuStaffRoutes` with:

```ts
/**
 * What the mat can open inside /admin, in menu order. Operator decisions 2026-09-12 (ADR-010),
 * 2026-09-14 (Classes read-only, Levels) and 2026-09-17 (member record header and name search,
 * grill G6). The office directory (/admin/members and its add/import pages) stays office-only.
 */
const coachRoutes = Object.freeze([
  "/admin",
  "/admin/attendance",
  "/admin/members/search",
  "/admin/members/requests",
  "/admin/members/medical",
  "/admin/classes-services",
  "/admin/levels",
] as const);
```

```ts
const offMenuStaffRoutes = Object.freeze([
  "/admin/waitlists",
  "/admin/lesson-plans",
  // Kept so the mat still reaches the redirect that /admin/classes became on 2026-09-16.
  "/admin/classes",
  // The member record opens from search and the overview; `getMemberProfile` trims it to the header.
  "/admin/members/profile",
] as const);
```

`admin-shell.tsx` — in the People group insert after the Members item:

```tsx
      { label: "Member search", href: "/admin/members/search" },
```

and append to the doc comment above `navigationGroups`: `Member search was added for office and
coaches on 2026-09-17 (ADR-010 amendment, member record).`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/overview-page.test.tsx apps/web/src/app/admin/admin-routes.test.ts apps/web/src/app/admin/page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/overview-page.tsx apps/web/src/app/admin/overview-page.test.tsx apps/web/src/app/admin/admin-routes.ts apps/web/src/app/admin/admin-routes.test.ts apps/web/src/app/admin/admin-shell.tsx apps/web/src/app/admin/page.test.tsx apps/web/src/app/admin/admin.css
git commit -m "feat(web): birthday names open the member record; coaches reach search and record (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Rules — the extended admin profile stays deny-direct

**Files:**

- Modify: `qa/rules/member-directory-boundary.test.ts` — imports (lines 10–21) and a new `it` inside
  the existing `describe` (after line 102).

**Interfaces:**

- Consumes: `firestore.rules:29-31` (`studentAdminProfiles` → `allow read, write: if false`), unchanged.
- Produces: a rules test that pins the new `details` block (health number, weight, height, notes) as
  unreachable from any client SDK role, including owner, and by any query on its fields.

No rule changes: E1 adds no collection. The DETAILS block lives in `studentAdminProfiles`, and
account managers, memberships and plans are read by the Admin SDK inside callables only.

- [ ] **Step 1: Write the test**

Add `where` to the `firebase/firestore` import, then append inside
`describe("canonical member-directory direct-access boundary", …)`:

```ts
it("keeps the DETAILS block of the admin profile out of every client role (T051V2)", async () => {
  const path = "academies/academy-1/studentAdminProfiles/student-details-1";
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), {
      studentId: "student-details-1",
      academyId: "academy-1",
      gender: "unknown",
      details: {
        healthNumber: "HN0000",
        weightKg: 70,
        heightCm: 175,
        howHeard: "Website",
        internalNotes: "Test note",
      },
    });
  });

  for (const [roleIndex, role] of roles.entries()) {
    const firestore = contextFor(role, roleIndex).firestore();
    const profiles = collection(firestore, "academies/academy-1/studentAdminProfiles");
    await assertFails(getDoc(doc(firestore, path)));
    await assertFails(
      getDocs(query(profiles, where("details.howHeard", "==", "Website"), limit(1))),
    );
    await assertFails(updateDoc(doc(firestore, path), { "details.healthNumber": "HN0001" }));
    await assertFails(setDoc(doc(firestore, path), { details: { weightKg: 71 } }, { merge: true }));
  }
}, 60_000);
```

- [ ] **Step 2: Run the rules test against the emulator**

On this VPS the emulator runs in Docker (port 8080 on the host is code-server):

```bash
docker run --rm --network none \
  -v /root/BPT-Jersey:/root/BPT-Jersey \
  -v /root/.cache/firebase:/root/.cache/firebase \
  -v /root/.cache/node:/root/.cache/node \
  -e COREPACK_ENABLE_NETWORK=0 \
  -w /root/BPT-Jersey \
  bpt-emu:local \
  bash -lc 'node_modules/.bin/firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,database "node_modules/.bin/vitest run --project rules qa/rules/member-directory-boundary.test.ts"'
```

Expected: PASS (2 tests). On a machine with JDK 21 and a free port 8080, `corepack pnpm test:rules`
is equivalent.

- [ ] **Step 3: Prove the test guards the rule**

Temporarily change `firestore.rules` lines 29–31 to
`match /academies/{academyId}/studentAdminProfiles/{studentId} { allow read: if request.auth != null; allow write: if false; }`
and re-run the Step 2 command. Expected: FAIL in "keeps the DETAILS block…" (and in the existing
test). Restore the rule with `git checkout firestore.rules`, re-run: PASS.

- [ ] **Step 4: Commit**

```bash
git add qa/rules/member-directory-boundary.test.ts
git commit -m "test(rules): member DETAILS block stays deny-direct for every client role (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Design audit (impeccable + taste against DESIGN.md), fixes and the unit gate

**Files:**

- Create: `qa/tests/member-record-visual.spec.ts`
- Modify: whichever of `apps/web/src/app/admin/members/profile/*.tsx`,
  `apps/web/src/app/admin/members/search/page.tsx`, `apps/web/src/app/admin/admin.css` the audit
  findings require (each fix with its own test when it changes behaviour or accessible names).

**Interfaces:**

- Consumes: everything from Tasks 9–14; `installAdminFixture` (`qa/tests/admin-fixture.ts:59`).
- Produces: screenshots `qa/screenshots/member-record-*.png` (desktop 1440 px and `-phone` 390 px),
  a findings list in the commit body, and a green unit gate. Plan C's `qa/tests/member-profile.spec.ts`
  (B + C flows, axe) builds on the same fixtures.

- [ ] **Step 1: Write the visual capture spec**

Create `qa/tests/member-record-visual.spec.ts`:

```ts
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { installAdminFixture } from "./admin-fixture";

/**
 * T051V2 visual evidence for the member record (E1) against the NEXT_PUBLIC_ADMIN_E2E static build.
 * Every callable is answered by the fixture with synthetic data.
 */
const fullProfile = {
  view: "full",
  header: {
    studentId: "student-visual-1",
    fullName: "Test Member A",
    age: 26,
    participantType: "adult",
    status: "active",
    maskedMemberReference: "****0000",
    birthdayBadge: { kind: "inDays", days: 3 },
  },
  cards: {
    memberSince: "2026-01-15",
    monthsAsMember: 8,
    profession: "Tester",
    accountManagers: [{ displayName: "Test Guardian", familyId: "family-visual-1" }],
    currentMembership: {
      membershipId: "membership-visual-1",
      planName: "Test Plan",
      status: "active",
      validUntil: "2026-12-31",
    },
  },
  details: {
    studentId: "student-visual-1",
    fullName: "Test Member A",
    dateOfBirth: "2000-09-20",
    phoneNumber: "+44 7700900000",
    email: "member-a@example.test",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    gender: "unknown",
    membershipNumber: "00000000",
    postalAddress: { line: "1 Test Street", postCode: "JE0 0AA" },
    details: { country: "JE", weightKg: 70, heightCm: 175, idCardExpiresOn: "2026-10-01" },
  },
};

// The coach view carries no member reference at all (not even an undefined key).
const coachProfile = {
  view: "coach",
  header: {
    studentId: fullProfile.header.studentId,
    fullName: fullProfile.header.fullName,
    age: fullProfile.header.age,
    participantType: fullProfile.header.participantType,
    status: fullProfile.header.status,
    birthdayBadge: fullProfile.header.birthdayBadge,
  },
};

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const phone = testInfo.project.name === "mobile-chromium";
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(0);
  await page.screenshot({
    path: `screenshots/member-record-${name}${phone ? "-phone" : ""}.png`,
    fullPage: true,
    style: ".skip-link { display: none !important; }",
  });
}

test.describe("member record visual (T051V2)", () => {
  test.skip(process.env.NEXT_PUBLIC_ADMIN_E2E !== "true", "needs the admin E2E static build");

  test("office search, profile, details and an empty tab", async ({ page }, testInfo) => {
    await installAdminFixture(page, {
      callables: {
        getMemberProfile: fullProfile,
        searchMemberNames: {
          members: [{ studentId: "student-visual-1", fullName: "Test Member A" }],
        },
        listRegyfitMemberRecords: { rows: [], total: 0, capturedAt: "2026-09-04T18:04:32.000Z" },
      },
    });

    await page.goto("/admin/members/search");
    await page.getByLabel("Member name").fill("test");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("link", { name: "Open record for Test Member A" })).toBeVisible();
    await capture(page, testInfo, "search");

    await page.getByRole("link", { name: "Open record for Test Member A" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Test Member A" })).toBeVisible();
    await capture(page, testInfo, "profile");

    await page.getByRole("tab", { name: "Details" }).click();
    await expect(page.getByRole("form", { name: "Member details" })).toBeVisible();
    await capture(page, testInfo, "details");

    await page.getByRole("tab", { name: "Payments" }).click();
    await expect(page.getByRole("link", { name: "Open Billing" })).toBeVisible();
    await capture(page, testInfo, "payments-empty");
  });

  test("coach record shows the header and Profile only", async ({ page }, testInfo) => {
    await installAdminFixture(page, {
      role: "coach",
      callables: { getMemberProfile: coachProfile },
    });
    await page.goto("/admin/members/profile?id=student-visual-1&tab=details");
    await expect(page.getByRole("heading", { level: 2, name: "Test Member A" })).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(1);
    await capture(page, testInfo, "coach");
  });
});
```

- [ ] **Step 2: Build the admin E2E export and capture**

```bash
corepack pnpm --filter @bpt-jersey/domain build:runtime
NEXT_PUBLIC_ADMIN_E2E=true corepack pnpm --filter @bpt-jersey/web build
cd qa && NEXT_PUBLIC_ADMIN_E2E=true node run-e2e.mjs --grep "member record visual"
```

Expected: 4 passed (2 tests × desktop and mobile projects) and 10 PNG files in `qa/screenshots/`
named `member-record-{search,profile,details,payments-empty,coach}{,-phone}.png`. Open each PNG with
the Read tool and look at it before Step 3.

- [ ] **Step 3: Run the audits**

Invoke the Skill `impeccable` in audit mode and then the Skill `taste-skill`, giving both:
`DESIGN.md` as the binding spec, the 10 screenshots, and the files
`apps/web/src/app/admin/members/profile/{member-record,profile-tab,details-tab,record-empty-tab}.tsx`,
`apps/web/src/app/admin/members/search/page.tsx`, and the `member-record-*` / `member-search-*`
blocks of `apps/web/src/app/admin/admin.css`. Ask each for concrete findings only.

Then check these DESIGN.md rules yourself, one by one, and add any miss to the findings list:

1. No pill anywhere on the new screens; statuses are text + 0.35rem left rule.
2. Square corners; no blur shadow; no gradient; no colour outside the palette (grep the new CSS for
   `#` values: only `#176b49`, `#8d1c2f`, `#721626`, `#5f1020`, `#f0efff`, `#fff0f2`, `#e8e7e3`).
3. Eyebrow on every section; display face uppercase for record headings.
4. Every button and link-button ≥ 3.15rem tall; tabs and row actions ≥ 44px; 3px purple focus outline
   visible on keyboard focus (tab through the record in the browser).
5. Labels above inputs; helper text below; invalid state visible without colour alone.
6. Empty states are eyebrow + headline + one sentence + one button.
7. Skeleton while loading, no spinner, no "Loading…" text as the only loading cue on the record.
8. One column below 50rem; no horizontal page scroll at 390px (Step 1 asserts it).
9. Tabular numbers on dates, ages, member reference and BMI.
10. `prefers-reduced-motion` removes the hover lift.
11. UK English, no emojis, no icon-only buttons, no AI clichés in copy.
12. Belt colours absent from E1 screens.

- [ ] **Step 4: Fix the findings**

For each finding: change the smallest thing that resolves it; if it changes behaviour, an accessible
name or visible copy, update or add the Vitest test in the matching `*.test.tsx` first and see it fail.
Re-run:

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/members apps/web/src/app/admin/overview-page.test.tsx apps/web/src/app/admin/admin-routes.test.ts apps/web/src/app/admin/page.test.tsx`
Expected: PASS.

Re-run Step 2's capture command and re-open the screenshots. Repeat Steps 3–4 until both audits
return no finding that DESIGN.md makes binding. Findings the operator must decide (taste, not rule)
go in the commit body under "Open for the operator", unchanged.

- [ ] **Step 5: Unit gate**

```bash
git sparse-checkout add Lista Listav2
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
git sparse-checkout set '/*' '!/Lista' '!/Listav2'
```

Expected: every command exits 0. If `format:check` fails, run `corepack pnpm exec prettier --write`
on the files this plan touched only (never on `tasksv2.md`) and re-run. Known pre-existing flakes
(`member-calendar.test.tsx` real date, `schedule-security-boundary.test.ts` under the full suite) are
re-run once in isolation; any other failure is this plan's to fix.

- [ ] **Step 6: Commit**

```bash
git add qa/tests/member-record-visual.spec.ts apps/web/src/app/admin
git commit -m "fix(web): member record design audit findings (T051V2)

Audit: impeccable + taste-skill against DESIGN.md on search, profile, details, empty tab, coach view
(1440 px and 390 px). Findings fixed: <one line per finding, written from the audit output>.
Open for the operator: <taste findings not bound by DESIGN.md, or 'none'>.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

The two `<…>` lines in the commit body are filled with the real audit output at execution time;
they are the only part of this plan that depends on findings that do not exist yet.

---

## Spec gaps found and how this plan resolves them

1. **Coach name search had no callable.** `listMembers`, `listMemberNames` and `lookupMemberIdentity`
   are office-only (ADR-010 amendment 2026-09-16 kept them closed). Task 7 adds `searchMemberNames`
   (≤ 20 `{ studentId, fullName }`) and records an ADR-010 amendment for G6.
2. **Masked member reference is empty for short numbers.** `maskMembershipReference` returns nothing
   under 8 characters (ADR-009 rule); Regyfit member numbers are short, so most headers show no
   reference. Kept as is — changing the masking rule is an ADR-009 decision for the operator.
3. **"How they heard" / "Initial contact" as academy settings with a manage dialog** — shipped as code
   constants (`// ponytail:`); stored as bounded text so a later settings screen needs no migration.
4. **Members without an admin profile** (minors created through Families) could not be updated at
   all; Task 4 lets the canonical update create the profile.
5. **Two editors of the same record.** The search page's inline restricted editor is removed in
   Task 13; DETAILS is the single editor (the older editor would silently omit new fields).
6. **Restricted read budget.** Each record open and each DETAILS save reload spends one of the 20
   restricted reads per 5 minutes that `getMemberDetail` and the exact lookup already share; heavy
   office browsing can hit `resource-exhausted` (the page says so). Operator may want a larger
   budget later; not changed here.
7. **Member since** falls back to the canonical creation date, which for PDF-imported members is the
   import date until Plan D backfills `registeredOn`.
8. **Next free member number** ignores historic identity reservations (the writer never releases an
   old number, `canonical-member-directory-service.ts:1122-1128`), so a proposed number can still be
   refused as `already-exists`; the form explains it.
9. **Account manager → family link**: the Families page has no deep link by family id, so the card
   links to `/admin/families`.
10. **Recommended by** stored before this session shows "A member is recorded" instead of a name
    (resolving it would cost a read per open; `// ponytail:`).
11. **Mobile country code** is kept inside the single stored `phoneNumber` string.
12. Coaches' PROFILE shows a Levels link until Plan C inserts the IBJJF card.

## Operator gates (not automated by any task)

1. **Health data policy** — before any production deploy of E1, the operator amends
   `docs/operations/t011-retention-residency-erasure-policy.md` decision 4 or approves a DPIA for
   health number, weight, height and BMI (spec §2.5, §8). Confirmation in chat.
2. **Deploy** — `getMemberProfile`, `searchMemberNames`, the extended `updateMember` and the web
   export go out together, after E0–E2 pass `corepack pnpm verify:mvp`, only on the operator's OK.
3. **DETAILS backfill** — belongs to Plan D (G8); it writes only into `studentAdminDetailsSchema`
   fields that are empty, with the production confirmation token.

## Self-review (done while writing)

Spec coverage (§5, §7, §9, G6, G8 schemas):

| Spec item                                                                                                                                                                           | Task                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| §5.1 canonical search primary, inline "Open record", archive below read only, no off-brand colours, no restricted identifiers in results                                            | 13 (+7 name search returns id and name only)                               |
| §5.2 header (name, masked reference, age, type, status as text + left rule, birthday badge), 8 ARIA tabs, empty states linking to modules                                           | 12, 9                                                                      |
| §5.3 badge via `deriveUpcomingBirthdays` window 7, Europe/Jersey day, "Birthday today / in N days", "N years old", overview links                                                   | 2, 6, 11, 12, 14                                                           |
| §5.4 member since + months, profession, account manager from Families, plan summary from memberships, no placeholder cards                                                          | 6, 9                                                                       |
| §5.5 every DETAILS field, one form, Save + Ctrl/Cmd+S, dirty warning, labels above, option lists seeded, BMI on read, strict bounded schemas, member number unique in a transaction | 1, 2, 4, 10, 11, 12                                                        |
| §5.5 restricted fields only via `getMemberProfile` to owner/admin, audited, rate-limited, never in lists                                                                            | 5, 7, 13                                                                   |
| §5.6 role-trimmed output, coach header only, other roles denied, App Check, safe errors, exact key sets                                                                             | 3, 6, 7, 8                                                                 |
| §7 frontend security (id validation, parsed responses, safe strings), backend security, rules deny-direct                                                                           | 8, 12, 7, 15                                                               |
| §7 impeccable/taste audit                                                                                                                                                           | 16                                                                         |
| §9 unit TDD per layer, rules test, visual evidence                                                                                                                                  | every task, 15, 16 (Plan C owns the full Playwright flow and `verify:mvp`) |
| G6 roles                                                                                                                                                                            | 7, 12, 13, 14, ADR-010 amendment in 7                                      |
| G8 field schemas for the backfill                                                                                                                                                   | 1 (`studentAdminDetailsSchema`)                                            |

Placeholder scan: the only open text is the commit body of Task 16, filled from real audit output.
Type consistency: `MemberProfileRecord` (5 → 6, 7), `MemberProfileService.fullProfile/coachProfile/searchNames`
(6 → 7), `recordHref` (12 → 13, 14), `DetailsDraft` / `payloadFromDraft` (10 → 11),
`ibjjfCardSlot` (9 → 12), `mapMemberDirectoryError` / `defaultMemberDirectoryCallableServices` /
`memberDirectoryCallableOptions` (7) match across tasks.
