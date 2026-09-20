# Unified Members Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every existing or approved new athlete one manageable BPT member record, preserving legacy history and connecting approved personal and guardian accounts to the correct training and subscription permissions.

**Architecture:** Extend the existing canonical Firestore directory and its guarded writers, source links and audit trail. Resolve access per athlete, independently of financial coverage, and use the same confirmed training rules in profile completion and booking. Consolidate the interface only after the underlying readers and permissions support the approved model.

**Tech Stack:** TypeScript, Zod, Firebase Authentication, Firestore, Firebase callable functions, Next.js App Router and the existing BPT UI components.

**Spec:** `docs/superpowers/specs/2026-09-20-unified-members-directory-design.md`, approved by the user on 20 September 2026, including section 7.1.

**Status:** Approved for native execution (option B). Implementation is in progress; production migration and deployment remain separate. Task progress and inspection evidence are recorded in the plan-scoped execution ledger.

## Global Constraints

- BPT Jersey is the operational system. Regyfit is a historical source.
- Complete the existing canonical Firestore directory rather than introduce another database.
- All production interface text and maintained product documentation use British English.
- Each child has at most one active guardian account. A guardian is required below 16 and optional at 16–17.
- At 16, an existing guardian retains access. The athlete may request their own verified account, with administrative approval.
- From the eighteenth birthday, the athlete is an independent adult. Guardian access to that athlete ends without requiring another administrative decision.
- Enrolment requests remains the existing destination for applications and recovery requests. Do not create a second request queue inside Members.
- No source wins by default. A member's reconciliation cannot be closed with unresolved discrepancies.
- Linking the previous payment creates neither a new invoice nor a second charge.
- A calculated group or selected plan alone does not enable booking, establish a paid period or authorise a new charge.
- Do not perform destructive archive cleanup as part of this work.
- Follow `AGENTS.md`: work on local `main`, fetch/integrate before edits, preserve other work, commit scoped changes and push to `origin/main`; no branches, worktrees, PRs or force pushes.
- The explicit BPT exception overrides the skill's TDD template: do not add or run automated tests, browser suites, broad lint/type/format checks or routine builds. Review the cases specified below by inspecting code and diffs. Run deployment compilation only within an authorised deployment scope.
- Read `PRODUCT.md`, `DESIGN.md` and `apps/web/AGENTS.md` before interface implementation, including the installed Next.js documentation required by that file. Reuse the admin shell, components and brand; preserve coaches' restrictions.
- Preserve App Check, active-actor and academy checks, restricted-read budgets, request receipts, MAC/control-plane checks and audit records. New workflows use the existing authenticated server boundary; they do not grant direct Firestore client access.
- GitHub publication is separate from production deployment and data migration. Obtain any missing authorisation only after the concrete release or migration preview is ready; do not treat approval of this plan as permission for production writes.

## Review Focus

1. **Two competing guardian approvals:** exactly one wins for the specified child; stale decisions fail, siblings and both adults' other profiles remain accessible. Tasks 5–7 and 11 own this case.
2. **Age boundaries and delayed claims:** use the academy date; a 16-year-old may have approved own access while retaining a guardian; at 18 guardian access ends even with an old token or delayed maintenance job. A 16+ class does not imply an adult subscription. Tasks 4, 6, 8 and 12 own this case.
3. **Duplicate or stale historical evidence:** repeated imports cannot add a second payment, paid period or attendance credit; a newer record invalidates an old decision; missing amounts remain unknown. Tasks 1–3 and 16 own this case.
4. **Same names, shared emails and unknown dates:** candidates remain internal; no public existence disclosure or name-only merge; one approved subject does not approve another subject in the request. Tasks 1–2, 7 and 10–11 own this case.
5. **No matching plan, several groups, or a quick profile switch:** completion can be submitted for review without a plan choice; proposals never grant coverage; late responses cannot display or mutate another child's data. Tasks 8–9 and 12–14 own this case.

Each owning task has an explicit inspection case. These replace automated test steps under the repository's current operator preference; they are not claims of runtime validation.

---

## File structure and dependencies

Paths are relative to the repository. Existing files below remain the integration points; new modules each own one responsibility. Do not copy the large existing directory/recovery services into another parallel system.

| Area | Files created | Existing files extended | Responsibility |
| --- | --- | --- | --- |
| Inventory | `packages/domain/src/members/member-inventory-contracts.ts`; `apps/functions/src/members/member-inventory-service.ts`; `apps/functions/src/members/member-inventory-callables.ts` | `member-migration-firestore.ts`, functions index and domain package exports | Paginated source coverage and integrity report. |
| Reconciliation | `packages/domain/src/members/member-reconciliation-contracts.ts`; `apps/functions/src/members/member-reconciliation-service.ts`; `apps/functions/src/members/member-reconciliation-callables.ts` | Canonical directory writer/read service, migration contracts/service | Reviewed source links, field decisions and identity aliases using existing controls. |
| Historical progress | `packages/domain/src/members/member-history-contracts.ts`; `apps/functions/src/members/member-history-service.ts` | Member profile, subscriptions and progress readers | Provenance, reviewed baselines, adjustments and no duplicate credit. |
| Athlete access | `packages/domain/src/members/member-access-contracts.ts`; `apps/functions/src/members/member-access-service.ts`; `apps/functions/src/members/member-access-callables.ts` | Schedule scope resolver, family service, profile and dependent readers | Per-athlete authorisation and account profile list. |
| Guardian lifecycle | No separate family database | Family contracts/service/callables, canonical review writer | One guardian per child; per-child replacement and adulthood. |
| Recovery | No parallel access-request collection | Existing recovery contracts/service/callables, login flow and review queue | Multiple independently reviewed subjects per verified account. |
| Training | `packages/domain/src/members/member-training-contracts.ts`; `apps/functions/src/members/member-training-service.ts`; `apps/functions/src/members/member-training-callables.ts` | Plan/calendar eligibility, enrolment/recovery details | Confirmed rules, suggestions and reviewable completion submissions. |
| Account UI | `apps/web/src/lib/member-access-client.ts`; `apps/web/src/lib/member-training-client.ts`; `apps/web/src/app/account/member-profile-context.tsx`; `apps/web/src/app/account/training-details/page.tsx`; `apps/web/src/app/account/training-details/training-details-form.tsx` | Calendar/account pages and repositories | Own/child selection with shared scoping and missing-data form. |
| Members UI | `apps/web/src/lib/member-reconciliation-client.ts`; `apps/web/src/app/admin/members/members-workspace.tsx`; `families-view.tsx`; `data-review.tsx` in that same directory | Members page, existing family/search features, shell | One directory with three views. |
| Member record UI | `family-access-tab.tsx`, `history-tab.tsx` under `apps/web/src/app/admin/members/profile/` | Existing record and tab components/contracts | Five consolidated tabs with existing operational editors. |
| Operations | `docs/unified-members-rollout.md` | `docs/legacy-member-recovery.md`, `PRODUCT.md` | Readiness, reviewed migration, cutover and correction procedure. |

The snippets below define contracts and the critical branches to implement within the existing service conventions; local transaction/UI variable names refer to that owning step. All new cross-task interfaces are named here. Register the following domain entries in `packages/domain/package.json` using its existing `types`/`import` source and `default` compiled-file convention:

| Entry | Source file under `packages/domain/src/members/` |
| --- | --- |
| `./members/inventory` | `member-inventory-contracts.ts` |
| `./members/reconciliation` | `member-reconciliation-contracts.ts` |
| `./members/history` | `member-history-contracts.ts` |
| `./members/access` | `member-access-contracts.ts` |
| `./members/training` | `member-training-contracts.ts` |

For example:

```json
"./members/access": {
  "types": "./src/members/member-access-contracts.ts",
  "import": "./src/members/member-access-contracts.ts",
  "default": "./lib/members/member-access-contracts.js"
}
```

Callable request schemas use existing ID validators, explicit bounds and strict objects. Server-owned actor/academy/reviewer fields never come from browser input. Register callable exports explicitly in `apps/functions/src/index.ts`. Keep new collections server-only in `firestore.rules`; no wildcard permission expansion. Use existing audit/receipt mechanisms rather than introducing a second generic audit system.

Sequence: **1 → 2 → 3**, **2 → 4 → 5 → 6 → 7**, **3 + 4 → 8 → 9**, then **7 → 10 → 11**, **6 + 9 → 12**, **2 + 3 + 11 → 13 → 14 → 15**, and **all → 16**. Backend tasks may be committed separately but must not enable a new access path before all dependent authorisation adapters are ready.

## Task 1: Produce a complete, paginated inventory without changing members

**Files:**
- Create the three inventory files in the file map.
- Modify `apps/functions/src/members/member-migration-firestore.ts`, `apps/functions/src/index.ts`, `packages/domain/package.json`.
- Read `member-recovery-sources.ts`, `member-directory-forward-dry-run.ts`, `member-directory-bootstrap-verification.ts` and the existing migration contracts before adapting them.

**Interfaces:**
- Consume `MemberMigrationStore.load(academyId): Promise<MemberMigrationSnapshot>` as the current compatibility adapter. It currently loads complete collections into memory; do not reuse that implementation as the new paginated reader or as proof of complete archive coverage.
- Produce `InventoryCollection`, `InventoryPage`, `InventoryRow` and `MemberInventoryService.page(academyId, collection, cursor?): Promise<InventoryPage>` as defined below; callable `getMemberInventoryPage` is office-only.

- [x] Define the inventory contracts and their strict Zod schemas. Validate opaque cursors server-side; max page size is 100. Store raw values only in existing protected sources, never in summary output.

```ts
export type InventoryCollection =
  | "members" | "regyfitMemberRecords" | "students" | "studentAdminProfiles"
  | "users" | "families" | "relationships" | "memberships"
  | "regyfitOfficeLinks" | "regyfitMemberLinks" | "memberRecoverySourceLinks"
  | "memberMigrationDecisions" | "bookings" | "attendance" | "invoices" | "payments";
export type InventoryRow = Readonly<{
  id: string;
  version: string;
  issueCodes: readonly string[];
}>;
export type InventoryPage = Readonly<{
  collection: InventoryCollection;
  rows: readonly InventoryRow[];
  nextCursor: string | null;
  complete: boolean;
}>;
export interface MemberInventoryService {
  page(academyId: string, collection: InventoryCollection,
       cursor?: string): Promise<InventoryPage>;
}
```

- [x] Implement document-ID pagination with a 101st-row sentinel; bind each cursor to actor, academy, collection and last document. Parse each stored schema; report invalid rows by safe ID and issue code instead of silently omitting them. Keep `complete: false` when the sentinel exists.

```ts
const fetched = await query.limit(101).get();
const pageDocuments = fetched.docs.slice(0, 100);
const complete = fetched.docs.length <= 100;
// The cursor state uses the existing protected cursor store, never client JSON.
```

- [x] Add office-only callable validation through `requireCanonicalMemberDirectoryActor` and the existing restricted-read budget. The request permits only the `InventoryCollection` allowlist; it never accepts an arbitrary Firestore path. Responses contain no contacts, identity numbers, passwords or payment credentials.
- [x] Extend the private inventory report to distinguish documents, linked athletes, unresolved identities, missing dates/guardians, conflicting links and dangling operational references. Record capture dates and the archive's 50-payment/50-attendance-row limits. A stored array of 50 does not prove only 50 lifetime transactions. Label source coverage `complete`, `partial` or `unknown` only on evidence; cursor exhaustion means the stored collection was traversed, not that Regyfit history is complete.
- [x] Inspect a synthetic 101-row boundary, an invalid middle row, a duplicate source link and a second capture containing overlapping history. Expected: next page reachable, invalid row reported, duplication unresolved, and no claim that document count equals people. Do not run the callable against production during this task without existing read authorisation.
- [x] Commit only this task's files with message `Add paginated member source inventory`. Follow the global publication workflow.

## Task 2: Add explicit, versioned reconciliation decisions

**Files:**
- Create reconciliation contracts/service/callables from the file map.
- Modify `packages/domain/src/members/member-directory-operation-contracts.ts`, `packages/domain/src/members/member-migration-contracts.ts`, `apps/functions/src/members/canonical-member-directory-service.ts`, `canonical-member-directory-read-service.ts`, `member-migration-service.ts`, `member-directory-state.ts`, domain exports, functions index and `firestore.rules`.

**Interfaces:**
- Consume the canonical writer's actor, transaction, control-plane and receipt contracts and the existing `registerLegacyMember` / `skipLegacyMember` operations.
- Produce `ReconciliationDecision`, `ReconciliationField`, `ReconciliationCase`; `MemberReconciliationService.getCase(academyId: string, studentId: string): Promise<ReconciliationCase>`, `.decide(actor: CanonicalMemberDirectoryActor, input: ReconciliationDecisionInput): Promise<ReconciliationCase>` and `.close(actor: CanonicalMemberDirectoryActor, input: CloseReconciliationInput): Promise<ReconciliationCase>`.
- Produce `resolveCanonicalStudentId(academyId: string, studentId: string): Promise<string>` in the reconciliation service, for approved aliases only.

- [x] Define decision values as bounded scalars/string lists, with protected source references rather than unrestricted document paths. Complex historical movements remain source-linked and go through their typed billing/progression writer rather than an arbitrary JSON patch. Define exact versions and independent states:

```ts
export type ReviewValue = null | boolean | number | string | readonly string[];
export type ReconciliationDecision = Readonly<{
  field: string;
  resolution: "retain-current" | "use-source" | "verified-correction" | "historical-period";
  value: ReviewValue;
  sourceIds: readonly string[];
  evidence: string;
  reason: string;
}>;
export type ReconciliationField = Readonly<{
  field: string;
  currentValue: ReviewValue;
  currentVersion: string;
  sourceValues: readonly Readonly<{
    sourceId: string;
    version: string;
    capturedAt: string | null;
    value: ReviewValue;
  }>[];
  decision: ReconciliationDecision | null;
}>;
export type ReconciliationCase = Readonly<{
  studentId: string;
  revision: string;
  fields: readonly ReconciliationField[];
  unresolvedFields: readonly string[];
  status: "open" | "closed";
}>;
export type ReconciliationDecisionInput = Readonly<{
  requestId: string;
  studentId: string;
  expectedRevision: string;
  decision: ReconciliationDecision;
}>;
export type CloseReconciliationInput = Readonly<{
  requestId: string;
  studentId: string;
  expectedRevision: string;
}>;
```

- [x] Build a server field allowlist with per-field parsers and writer dispatch: personal fields use the canonical editor; relationships use Task 5; plans and financial evidence use Task 3; progression uses existing staff-level operations. Reject unknown fields, overlong evidence/reasons and values inconsistent with the selected field. Never spread applicant JSON into a student or payment document.
- [x] Store decisions in `memberReconciliationCases/{studentId}` and `memberReconciliationDecisions/{requestId}` under the academy. Keep both original values and their source versions in the protected decision record. Use existing audit/receipt infrastructure and include actor, evidence, time, before/after and body digest. In the same transaction recheck actor, case revision and every source version. A same-ID/same-body retry returns its receipt; same ID/different body rejects.

```ts
if (currentCase.revision !== input.expectedRevision) {
  throw new HttpsError("failed-precondition", "This review has changed. Refresh it before saving.");
}
if (currentCase.unresolvedFields.length !== 0) {
  throw new HttpsError("failed-precondition", "Resolve every discrepancy before closing this review.");
}
```

- [x] Extend the existing migration preview to show the proposed canonical athlete, identity evidence, all conflicts and affected references. Strong compatible matches may be explicitly batch-approved, at most 50 per existing migration decision boundary. Names, shared emails and name/date pairs only suggest candidates. A conflicting unique identifier blocks batch application.
- [x] For an approved duplicate canonical identity, retain the chosen stable athlete ID and record the other ID in `memberIdentityAliases`. Reject cycles and competing targets. Preserve original payment/attendance references; all relevant readers resolve the alias and deduplicate stable event IDs. Transfer account/guardian links only as separately reviewed link decisions. Preview the union of affected records before alias creation; unresolved ownership or relationship conflicts block it. Canonical lists exclude approved aliases; alias targets retain all confirmed source identities. New source changes reopen affected closed cases rather than silently marking the new discrepancy resolved. Recheck uniqueness in the transaction, including existing source-link collections.
- [x] Inspect stale source updates, unchanged retries, contradictory member numbers, same-name siblings and closure with one unresolved field. Expected: no silent source winner, no duplicate athlete, no stale overwrite and no premature closure. Inspect alias resolution for cycles and two concurrent target claims.
- [x] Commit with message `Add explicit member reconciliation decisions`.

Implementation note (20 September): review decisions and typed application are separate; a changed value remains pending until its existing editor applies it. Canonical lists/details resolve aliases now; all historical/account readers are coordinated in Tasks 3–7 before release. The aggregate legacy preview has a 500-record ceiling and directs larger datasets to paginated inventory; Task 16 prepares bounded application.

## Task 3: Preserve payments, paid periods and progression provenance

**Files:**
- Create `packages/domain/src/members/member-history-contracts.ts` and `apps/functions/src/members/member-history-service.ts`.
- Modify `apps/functions/src/members/member-profile-service.ts`, `member-profile-firestore.ts`, `member-recovery-service.ts`, `apps/functions/src/memberships/manual-subscription-service.ts`, `subscription-admin-service.ts`, `packages/domain/src/memberships/subscription-admin-contracts.ts`, `apps/functions/src/levels/progress-report-callables.ts`, domain exports and `firestore.rules`.

**Interfaces:**
- Consume `resolveCanonicalStudentId`, existing `ManualSubscriptionInput` and `saveManualSubscription`, existing Regyfit record schemas and existing staff progression operations.
- Produce `MemberHistoryEntry`, `AttendanceBaseline`, `MemberHistoryService.list(academyId: string, studentId: string, cursor?: string): Promise<{entries: readonly MemberHistoryEntry[]; nextCursor: string | null}>`.

- [x] Define provenance and unknown-value handling; an archive movement is evidence, not a new BPT financial transaction.

```ts
export type MemberHistoryEntry = Readonly<{
  entryId: string;
  studentId: string;
  kind: "payment" | "attendance" | "level" | "adjustment";
  sourceRecordId: string;
  sourceItemId: string;
  occurredAt: string | null;
  amountMinor: number | null;
  originalText: string | null;
  confirmation: "unconfirmed" | "confirmed" | "disputed";
  supersedesEntryId: string | null;
}>;
export type AttendanceBaseline = Readonly<{
  studentId: string;
  throughDate: string;
  confirmedCount: number;
  sourceIds: readonly string[];
  decisionId: string;
}>;
```

- [x] Link each archive row using source-record/capture/item provenance. Preserve an available upstream transaction ID; otherwise use a deterministic per-capture row reference and mark cross-capture matches for review. Equal amount/date/text is only a duplicate candidate, since two real payments can be identical. Store reviewed equivalences before combining capture histories. Paginate, expose coverage and never silently claim bounded arrays are the lifetime ledger.
- [x] Reuse the existing `previously-paid` settlement. The reviewer selects the matching plan, dates and original evidence; enrich its receipt with the reconciliation decision and source item references. Keep `endsAt` exclusive as in the existing linking flow. Detect existing compatible paid coverage before creating a membership; reuse its identity or route a discrepancy, not another subscription. Do not call charge, invoice-create or payment-create code on this path.

```ts
const settlement: ManualSubscriptionInput["settlement"] = {
  kind: "previously-paid",
  recordId: confirmedArchiveRecordId,
  paymentConfirmed: true,
};
```

- [x] Store reviewed `AttendanceBaseline` records in `memberAttendanceBaselines/{studentId}` with existing guards/audit. Count the confirmed baseline through its cut-off plus unique confirmed BPT events strictly after that cut-off. Display earlier overlapping BPT events as history without adding them again. If completeness or overlap is unresolved, show the known periods separately; never create dated events from an aggregate count. Preserve level, belt, stripes and graduation dates through the existing staff correction workflow.
- [x] Corrections append an adjustment or a new reviewed baseline with previous-version evidence; retain originals and payer identity. Guardian changes must never call subscription renewal, mandate transfer or payment cancellation. Require the existing financial workflow for future payer changes. Update confirmed profile/history projections without exposing staff-only evidence notes to clients.
- [x] Inspect a repeated paid-period link, already expired source plan, same-price duplicate candidates, unknown amount, partial attendance snapshot and overlapping baseline. Expected: no charge/invoice, no reactivation from a legacy active flag, unknown stays unknown, and no doubled progress. Inspect concurrent plan edits for version rejection.
- [x] Commit with message `Link member history without duplicating paid coverage`.

## Task 4: Define account access independently from class and plan age rules

**Files:**
- Create `packages/domain/src/members/member-access-contracts.ts` and `apps/functions/src/members/member-access-service.ts`.
- Modify `apps/functions/src/schedule/canonical-client-student-scope.ts`, `packages/domain/src/profiles/profile-contracts.ts`, domain exports.

**Interfaces:**
- Consume existing `StudentProfile`, `FamilyRelationship`, `dateKeyInJersey` and the approved canonical-ID resolver.
- Produce `MemberAccessFacts`, `MemberAccessDecision`, `decideMemberAccess(facts: MemberAccessFacts): MemberAccessDecision`, `MemberAccessService.authorise(academyId: string, actorUserId: string, studentId: string): Promise<MemberAccessDecision>` and `.listProfiles(academyId: string, actorUserId: string): Promise<readonly AccountMemberProfile[]>`.

- [x] Implement calendar-date age calculation, including strict real-date validation, leap dates and future-date rejection. Use `dateKeyInJersey(now)`. Export `memberAgeOn(dateOfBirth: string, academyDate: string): number | null` here; keep subscription age classification in its existing module.
- [x] Define the facts gathered by the server and a pure access decision. Role permits entry to the member area; it does not select a single personal-versus-guardian relationship.

```ts
export type MemberAccessFacts = Readonly<{
  actorActive: boolean;
  academyMatches: boolean;
  memberAccessible: boolean;
  confirmedAge: number | null;
  ownLinkApproved: boolean;
  guardianLinkCurrent: boolean;
}>;
export type MemberAccessDecision =
  | Readonly<{ allowed: true; via: "self" | "guardian" }>
  | Readonly<{ allowed: false }>;
export function decideMemberAccess(f: MemberAccessFacts): MemberAccessDecision {
  if (!f.actorActive || !f.academyMatches || !f.memberAccessible || f.confirmedAge === null) {
    return { allowed: false };
  }
  if (f.ownLinkApproved && f.confirmedAge >= 16) return { allowed: true, via: "self" };
  if (f.guardianLinkCurrent && f.confirmedAge < 18) return { allowed: true, via: "guardian" };
  return { allowed: false };
}
export type AccountMemberProfile = Readonly<{
  studentId: string;
  fullName: string;
  via: "self" | "guardian";
  trainingDetailsRequired: boolean;
}>;
```

- [x] Adapt stored-profile parsing before the access decision. The current `parseStudentProfileAt` rejects an old `minor` classification after the eighteenth birthday. Validate the signed original at its recorded write date, using the existing strict `parseStudentProfileAt(value, effectiveDate)` parser, then derive an effective current projection using the confirmed birth date. Do not overwrite the raw document before MAC verification or weaken unrelated field validation. Use this projection in every Task 6 reader; a guarded maintenance write may refresh the stored classification later. For adult projections omit minor-only `guardianStatus`; retain historical relationship/family references without deriving access from them.

```ts
const effectiveType = deriveParticipantType(confirmedDateOfBirth, academyDate);
const { guardianStatus, ...baseProfile } = validatedStoredProfile;
const effectiveProfile: StudentProfile = effectiveType === "adult"
  ? { ...baseProfile, participantType: "adult" }
  : { ...validatedStoredProfile, participantType: "minor" };
```

- [x] Read current actor/account state, exact student link and current per-child relationship from Firestore; never accept those facts from the browser. A suspended/expired subscription does not itself make the profile inaccessible. A disputed proposed birth date does not replace a confirmed date. Unknown confirmed age needs office review before granting access. Duplicate active relationships or competing personal links deny a new link and create a review issue.
- [x] Replace the resolver's current `teenAccountMinimumAge = 12` rule with the approved 16 policy. Make the existing `CanonicalClientStudentScopeResolver` delegate to this service, preserving its signature. Use approved links for both `guardian` and personal account roles, so an adult athlete who is a guardian can manage both. A stale `teenStudent` claim at 18 must not block an already approved personal link; a stale `guardian` claim cannot bypass the per-child decision.
- [x] List the union of approved own and child profiles with bounded pagination through the underlying queries; deduplicate canonical IDs. Do not limit an account to a single family result. Do not store child IDs in unvalidated custom claims. Keep pending account `shopper` privileges unchanged until a reviewed link is committed.
- [x] Inspect ages 15/16/17/18 at Jersey midnight, a leap birthday, missing date, guardian plus own profile, stale teen claims and a suspended plan. Expected: policy above, no new role powers, no loss of confirmed history merely due to unpaid/uncertain coverage.
- [x] Commit with message `Centralise member access by approved athlete relationship`.

## Task 5: Replace a guardian for one child and enforce adulthood

**Files:**
- Modify `packages/domain/src/families/family-contracts.ts`, `apps/functions/src/families/family-service.ts`, `family-callables.ts`, `apps/functions/src/members/canonical-member-directory-service.ts`, `member-directory-state.ts`, `packages/domain/src/members/member-access-contracts.ts`, `apps/functions/src/members/member-access-service.ts`, `firestore.rules`.

**Interfaces:**
- Consume `memberAgeOn`, `MemberAccessService` and existing family audit/transaction/control-plane utilities.
- Produce `ChildGuardianChange` and `FamilyStore.changeChildGuardian(input: ChildGuardianChange & {academyId: string; actorId: string; actorRole: "owner" | "administrator"; now: string}): Promise<StaffFamilyProjection>`.

- [ ] Add an explicit per-child command; a null proposed guardian removes an optional guardian only when age is 16 or above. An online guardian link below 18 needs a verified account and reviewed relationship evidence. Preserve existing office-managed guardian contact records for children whose guardian has no login; a required guardian contact does not itself create or prove account access.

```ts
export type ChildGuardianChange = Readonly<{
  requestId: string;
  studentId: string;
  expectedRelationshipId: string | null;
  expectedRelationshipVersion: string | null;
  proposedGuardianUserId: string | null;
  evidence: string;
  reason: string;
}>;
```

- [ ] Use `memberGuardianStates/{studentId}` as the transaction's per-child uniqueness/version anchor, not as a second source of relationship truth. Seed it only after inspecting all existing active relationships; conflicting existing guardians go to review. All writers, including create-family, add-student, old replacement and recovery approval, must honour it. Preserve existing writer guards and MAC coverage for the new state.
- [ ] In one transaction re-read the child, academy/actor, anchor and expected relationship. End only that relationship, create a new uniquely versioned relationship rather than overwriting its history, then update the anchor, audit and receipt. Preserve `familyId`, billing contacts, sibling relationships, memberships and historical payer. One transaction cannot leave two guardians or an ended link without its approved replacement.

```ts
if (activeRelationshipId !== input.expectedRelationshipId ||
    activeRelationshipVersion !== input.expectedRelationshipVersion) {
  throw new HttpsError("failed-precondition", "The guardian has changed. Refresh this review.");
}
if (age !== null && age >= 18 && input.proposedGuardianUserId !== null) {
  throw new HttpsError("failed-precondition", "This member manages their own account.");
}
```

- [ ] Prevent the old whole-family `replaceTutor` path from bypassing child-specific review. Keep its historical reader compatibility; replace office actions with explicit per-child commands. Family deactivation may only affect the relationships explicitly within its authorised scope and must not remove an account's independent own/other-family links.
- [ ] Effective guardian access ends on the eighteenth birthday in Task 4 even before persistence catches up. Preserve relationship history; store effective end date/reason through a guarded, idempotent maintenance operation when the record is next reviewed or the existing birthday workflow runs. A missing or invalid recorded write date is a review issue, not permission to skip strict parsing. Changing a confirmed birth date recomputes authorisation immediately; extending an ended relationship requires a reviewed new link, not automatic reactivation.
- [ ] Add the approaching-18 marker to authorised staff projections, showing whether own access is prepared. Do not create an Auth user, renew a plan or extend guardian access when no personal account exists.
- [ ] Inspect two simultaneous replacements of child A, sibling B retained, old tutor's own account, removal at 15 versus 16, and birthday with maintenance delayed. Expected: one winning child change; invariant and access boundary enforced in the transaction/server, not only the UI.
- [ ] Commit with message `Manage guardian access per child and end it at adulthood`.

## Task 6: Apply athlete scope to every dependent reader and mutation

**Files:**
- Create `apps/functions/src/members/member-access-callables.ts`; register its exports.
- Modify `apps/functions/src/families/family-service.ts` and `family-callables.ts`; `apps/functions/src/profiles/profile-service.ts` and `guardian-profile-service.ts`; `apps/functions/src/members/member-profile-service.ts`, `member-recovery-service.ts`; `apps/functions/src/schedule/schedule-callables.ts`, `advanced-booking-callables.ts`, `student-group-access-callables.ts`, `member-class-records-callables.ts`, `pre-class-callables.ts`; `apps/functions/src/memberships/membership-callables.ts`; `apps/functions/src/finance/finance-callables.ts`; `apps/functions/src/health/health-service.ts`; `apps/functions/src/documents/private-document-service.ts`; `apps/functions/src/consents/consent-service.ts`; `apps/functions/src/levels/progress-report-callables.ts` and `family-achievement-callables.ts`; `apps/functions/src/announcements/announcement-callables.ts`; `apps/functions/src/reminders/reminder-callables.ts`; `apps/functions/src/streak/streak-callables.ts`.

**Interfaces:**
- Consume `MemberAccessService.authorise` and `.listProfiles`.
- Produce callable `listMyMemberProfiles` returning `{profiles: readonly AccountMemberProfile[]}` and a shared server helper `requireMemberProfileAccess(academyId: string, actorUserId: string, studentId: string): Promise<{studentId: string; via: "self" | "guardian"}>` in `member-access-service.ts`.

- [ ] Implement the helper by resolving canonical identity, loading current facts and rejecting unauthorised subjects with a generic permission error. Keep each operation's existing role, purpose and data-classification restrictions in addition to this relationship check.

```ts
const access = await memberAccess.authorise(academyId, actorUserId, studentId);
if (!access.allowed) throw new HttpsError("permission-denied", "Member profile is unavailable.");
```

- [ ] At each listed member-facing entry point, require a target student ID or enumerate only `listProfiles` results; remove client-supplied family IDs as sufficient proof. Recheck within transactions for bookings, consent, health updates and other sensitive writes. Apply allowed relationship mode to the operation: approved own access at 16 does not automatically grant adult/legal guardian consent powers. Retain operation-specific legal restrictions.
- [ ] Filter family/achievement/health/history projections per allowed child, including nested names, counts and attachments. A former guardian cannot read an adult child via a family aggregate, download URL, notification, reminder or old history endpoint. Derive notification recipients from current permissions at delivery. Review existing direct reads and role checks with `rg` for `getGuardianFamily`, `actor.role`, `adultUserId`, `familyId` and `userId`; add any discovered athlete-data route to this same adapter inventory before completion.
- [ ] Keep billing authorisation distinct: historical payers retain access only to their own lawful transaction/account projection; a new guardian does not inherit family-wide invoices, payment methods or mandates. A child subscription projection may show confirmed coverage without exposing another person's payment credentials or other children's invoices. No generic member-scope helper grants finance-admin rights.
- [ ] Preserve single-family compatibility consumers temporarily through a filtered wrapper; new account readers use the union of profiles. Adapt self routes that assumed student ID equals user ID. Preserve staff assignment restrictions, owner/administrator approvals and coaches' non-financial projections.
- [ ] Inspect the complete adapter inventory with former tutor, newly appointed tutor, 16-year-old self, 18-year-old stale claim and own-plus-two-children cases. Follow both list and detail paths, mutation transaction and signed-document route. Expected: no fallback to an unfiltered family response and no authorization derived solely from a JWT role.
- [ ] Commit with message `Enforce current member scope across account services`.

## Task 7: Extend recovery to independently reviewed family subjects

**Files:**
- Modify `packages/domain/src/members/member-recovery-contracts.ts`, `apps/functions/src/members/member-recovery-service.ts`, `member-recovery-sources.ts`, `member-recovery-callables.ts`, `apps/functions/src/members/enrolment-approval-service.ts`, `enrolment-request-service.ts`.

**Interfaces:**
- Consume the verified Firebase account binding, canonical directory operations, `ChildGuardianChange`, `MemberAccessService` and reconciliation service.
- Extend existing begin/complete/detail/review callables; produce `RecoverySubject`, `RecoverySubjectDecision` and per-subject results. Keep legacy request parsing through an explicit version adapter.

- [ ] Add strict subject schemas, using server-generated opaque subject IDs. A guardian request accepts 1–10 children plus at most one self subject; additional children can use a later request on the same account. Enforce at most one self subject for athlete requests. Date of birth is required for child candidate search and optional for initial athlete recovery; previous email remains optional.

```ts
export type RecoverySubject = Readonly<{
  subjectId: string;
  kind: "self" | "child";
  fullName: string;
  dateOfBirth?: string;
  previousEmail?: string;
  status: "pending-review" | "more-information" | "approved" | "rejected";
}>;
export type RecoverySubjectDecision = Readonly<{
  requestId: string;
  subjectId: string;
  expectedRevision: string;
  decision: "approve" | "reject" | "more-information";
  candidateId?: string;
  identityEvidence: string;
  guardianEvidence?: string;
  guardianChange?: ChildGuardianChange;
}>;
```

- [ ] Extend stored requests to version 2 with account UID, verification state, subjects and a revision. Map old single-athlete tickets to one self subject without rewriting all tickets. Preserve request expiry, quotas, App Check and resumable account-bound ownership. Pending or completed status must reflect each subject; approval of one subject never closes or approves the remaining subjects.
- [ ] Separate candidate matching from public responses. The public begin/complete flow returns only its opaque ID, expiry, applicant-supplied fields and request status. An office reviewer may page/search candidates under the existing restricted access rules. Do not return a count or names indicating that a child exists to an unauthorised applicant.
- [ ] On each approval, re-read Firebase account verification/disabled state and current request ownership, then atomically commit that subject's canonical link, optional guardian replacement, receipt and review result. Use explicit evidence for identity and guardianship. Reject a self link below 16 and guardian links at 18 or above. A pending claim alone does not change a pre-existing account link. A source with no canonical athlete uses the guarded canonical registration path after identity review, not an unrelated enrolment.
- [ ] Auth claim synchronisation is a retryable consequence of the committed account link, not the permission source. Do not grant student access before the link transaction succeeds. If claim refresh fails after commit, return a recoverable account-refresh state and retry using the same receipt; no second athlete or approval. Existing accounts keep unrelated approved profiles and staff privileges; never downgrade a staff account by blindly replacing its claims.
- [ ] Keep plan approval outside recovery approval. New enrolment approval checks existing verified links before creating a student and places only approved enrolments into the directory. Preserve pending data on the same existing enrolment/recovery request.
- [ ] Inspect interrupted email verification, Google account already used, same-name candidates, an unverified account, approval of child A with child B pending, stale guardian replacement and claim-write failure. Expected: no secret stored, no implicit sibling grant, resumable linking and no financial activation.
- [ ] Commit with message `Recover own and child profiles through existing enrolment requests`.

## Task 8: Derive group and plan suggestions from current configured rules

**Files:**
- Create `packages/domain/src/members/member-training-contracts.ts`.
- Modify `packages/domain/src/schedule/member-calendar-contracts.ts`, `student-group-access-contracts.ts`, `packages/domain/src/members/enrolment-request-contracts.ts`, `packages/domain/src/memberships/plan-contracts.ts`, domain exports.

**Interfaces:**
- Consume existing `PlanRecord`, configured program/session age and level restrictions, `memberAgeOn` and `participantTypeOn`.
- Produce `TrainingFrequency`, `TrainingFacts`, `TrainingSuggestion`, `suggestMemberTraining(facts: TrainingFacts, eligibleGroupIds: readonly string[], eligiblePlans: readonly PlanRecord[]): TrainingSuggestion` and shared `isPlanEligibleForTraining(plan: PlanRecord, facts: TrainingFacts): boolean`.

- [ ] Define inputs as confirmed server projections or explicitly unverified proposals; preserve all active explicit program grants separately from a base group suggestion.

```ts
export type TrainingFrequency = 1 | 2 | 3 | "unlimited" | "pay-as-you-go";
export type TrainingFacts = Readonly<{
  dateOfBirth: string | null;
  trainingCenter: "Town" | "West" | null;
  frequency: TrainingFrequency | null;
  effectiveDate: string;
  confirmed: boolean;
  currentPlanId: string | null;
}>;
export type TrainingSuggestion = Readonly<{
  groupIds: readonly string[];
  groupStatus: "confirmed" | "proposed" | "review-required";
  eligiblePlanIds: readonly string[];
  suggestedPlanId: string | null;
}>;
```

- [ ] Extract the existing rule evaluation into reusable predicates rather than reproducing a second age-band table. Evaluate configured age ranges at the session date, location/site, discipline, staff-confirmed level restrictions and explicit grants. Missing rules or level evidence cannot be treated as a match. Multiple compatible session programs can remain eligible; only a unique base-group mapping becomes an automatic assignment.
- [ ] Filter plans from the current authorised catalogue: active, not retired, participant type, site and frequency. `participantTypeOn` remains adult from 18. Do not equate the schedule's 16+ preset with the subscription's adult type. Retired plans remain readable in history; they cannot be selected as new plans.
- [ ] Implement suggestion selection after filtering. Preserve an already confirmed compatible current plan, even when no new preference is required. A single compatible alternative may be suggested; several alternatives require the member's explicit preference. Price, currency, sites and billing period come from that same current plan record.

```ts
export function suggestMemberTraining(
  facts: TrainingFacts,
  eligibleGroupIds: readonly string[],
  eligiblePlans: readonly PlanRecord[],
): TrainingSuggestion {
  const planIds: readonly string[] = eligiblePlans.map((plan) => plan.planId);
  const retained = facts.currentPlanId !== null && planIds.includes(facts.currentPlanId);
  return {
    groupIds: eligibleGroupIds,
    groupStatus: eligibleGroupIds.length !== 1 ? "review-required" :
      facts.confirmed ? "confirmed" : "proposed",
    eligiblePlanIds: planIds,
    suggestedPlanId: retained ? facts.currentPlanId : planIds.length === 1 ? planIds[0]! : null,
  };
}
```

- [ ] Use the shared eligibility predicates in both proposed assignment and calendar/booking evaluation. Keep capacity, booking windows, explicit grants, weekly limits, paid coverage and pay-as-you-go conditions as independent booking requirements; the suggestion function grants none of them.
- [ ] Inspect age 9/West/two classes, 16 with a 16+ class but teen plan, birthday before session, overlapping programs, no centre, retired plan and existing paid compatible plan. Expected: consistent group/booking rules, no arbitrary first group and no silent upgrade.
- [ ] Commit with message `Share training and subscription eligibility rules`.

## Task 9: Store training completion as reviewable proposals

**Files:**
- Create `apps/functions/src/members/member-training-service.ts` and `member-training-callables.ts`.
- Modify training contracts, reconciliation service, recovery and enrolment services, `apps/functions/src/schedule/student-group-access-callables.ts`, functions index and `firestore.rules`.

**Interfaces:**
- Consume `TrainingFacts`, `TrainingSuggestion`, `MemberAccessService`, current plan/program readers and existing request ownership checks.
- Produce `TrainingTarget`, `TrainingSubmission`, `TrainingPlanOption`, `TrainingCompletionView`; callable `getMemberTrainingDetails` consumes `TrainingTarget` and returns `TrainingCompletionView`, and `submitMemberTrainingDetails` consumes `TrainingSubmission` and returns the refreshed `TrainingCompletionView`.

- [ ] Define the target explicitly; an unapproved requester may submit only against their own existing request and subject, not an arbitrary student ID.

```ts
export type TrainingTarget =
  | Readonly<{ kind: "member"; studentId: string }>
  | Readonly<{ kind: "recovery"; requestId: string; subjectId: string }>
  | Readonly<{ kind: "enrolment"; requestId: string }>;
export type TrainingSubmission = Readonly<{
  requestId: string;
  target: TrainingTarget;
  expectedRevision: string;
  dateOfBirth?: string;
  trainingCenter?: "Town" | "West";
  frequency?: TrainingFrequency;
  preferredPlanId?: string;
}>;
export type TrainingPlanOption = Readonly<Pick<PlanRecord,
  "planId" | "displayName" | "priceMinor" | "currency" | "billingPeriod" |
  "classSites" | "weeklyClassLimit" | "openMatSites" | "openMatFeeMinor"
>>;
export type TrainingCompletionView = Readonly<{
  target: TrainingTarget;
  revision: string;
  requiredFields: readonly ("dateOfBirth" | "trainingCenter" | "frequency" | "plan")[];
  facts: TrainingFacts;
  suggestion: TrainingSuggestion;
  plans: readonly TrainingPlanOption[];
  reviewStatus: "not-required" | "awaiting-details" | "pending-review";
}>;
```

- [ ] Build the completion view from confirmed member fields, source evidence and current catalogue. Use missing/unconfirmed requirements only. Project the current catalogue to `TrainingPlanOption`; do not return internal plan audit fields to applicants. Do not expose the archive before access approval: pending requests receive applicant-provided fields and safe generic plan options; source-prefill is available only for approved profiles. Mark imported unconfirmed facts explicitly.
- [ ] Validate DOB as a real past date, centre allowlist, frequency and preferred plan against the current filtered catalogue at submission. A changed catalogue returns a refreshed choice view; no matching plan accepts a submission without `preferredPlanId`. Preserve its missing-plan issue instead of creating a required empty selector.
- [ ] Save idempotently to `memberTrainingReviews/{studentId}` for approved member targets, or attach it to the owned existing recovery/enrolment request. Record submitter, target, version and source facts. Route confirmed-value differences to Task 2, retaining both versions. Do not create another access-request queue or directly overwrite a confirmed DOB, centre, level or paid plan.
- [ ] Apply confirmed unambiguous group assignments through the guarded group-access writer. Staff approval of submitted DOB/centre/frequency reruns current rules before applying the assignment; a plan preference still requires Task 3's coverage decision. Keep access approval and financial status independent.

```ts
const requiresOfficeReview = !facts.confirmed ||
  suggestion.groupStatus === "review-required" ||
  suggestion.suggestedPlanId === null;
// Persist the proposal and its review destination; this branch never grants coverage.
```

- [ ] Inspect no plans, two plans, incorrect DOB correction, duplicate submit, non-owned pending request, guardian replacement during submission and a changed plan price. Expected: reviewable submission, no premature permissions or charge, current scope/version rechecked.
- [ ] Commit with message `Review missing member training details on the existing record`.

## Task 10: Add the two recovery entries and verified account preparation

**Files:**
- Modify `apps/web/src/app/login/login-form.tsx`, `apps/web/src/app/login/recover/recovery-form.tsx`, `apps/web/src/lib/member-recovery-client.ts`, `member-recovery-auth.ts`, `client-account.ts`.

**Interfaces:**
- Consume Task 7 recovery schemas and existing Firebase Google/email/password verification helpers. UI state includes the request's opaque ID and applicant-entered subjects only.
- Produce the extended `RecoveryForm` at its existing route, using `kind=guardian` or `kind=athlete` in the URL; no directory search endpoint is added.

- [ ] Add the two English links and accessible form mode. Never put child names or birth dates in URLs.

```tsx
<Link href="/login/recover?kind=guardian">I'm a guardian. Recover my child's access.</Link>
<Link href="/login/recover?kind=athlete">I'm an athlete. Recover my access.</Link>
```

- [ ] Render repeatable child full-name/date rows, guardian contact details, and optional own-athlete subject. Athlete mode requires full name only for matching; previous email is optional and visibly distinct from the sign-in email. Use labelled date controls and inline errors; prevent duplicate child rows within the request.
- [ ] Reuse real Google authentication or existing email/password account creation and email verification. Resolve an existing-account/provider conflict by asking the user to sign in using its existing provider; do not silently create another account or infer ownership from a typed Google address. Keep passwords inside Firebase SDK calls only.
- [ ] Resume account-bound pending requests after returning from verification. Display each subject's public status with generic matching copy: `BPT will review your request.` Show `More information required` with the office's safe request, not internal candidate evidence. Partial approval exposes only already approved profiles.
- [ ] Inspect the render paths for optional previous email, several children, existing Google account, verification interrupted and denied/rejected subject. Confirm no candidate names, source record IDs, evidence notes, passwords or raw callable errors reach applicant-facing output.
- [ ] Commit with message `Add guardian and athlete recovery to member sign-in`.

## Task 11: Review all recovery subjects in existing Enrolment requests

**Files:**
- Modify `apps/web/src/app/admin/members/requests/page.tsx`, `apps/web/src/app/admin/members/recovery/recovery-queue.tsx`, `apps/web/src/lib/member-recovery-client.ts` and existing request detail controls.

**Interfaces:**
- Consume versioned recovery detail, `RecoverySubjectDecision`, `ChildGuardianChange`, existing office session gates and record links.
- Produce an extended `MemberRecoveryQueue` in its existing embedded location; no new route or navigation section for access requests.

- [ ] Keep `New enrolments` and `Member access recovery`. Show request kind, verified account, per-subject status and identity/guardian evidence fields. Keep candidacy and administrative evidence restricted to owner/administrator readers.
- [ ] Use one explicit selection and approval action for each subject. Display plan status separately with the explanatory copy below; financial uncertainty must not disable otherwise valid access approval.

```tsx
<p>Approve access to this profile. Subscription coverage is reviewed separately.</p>
```

- [ ] For replacement, confirm child, old guardian and new verified account, and carry the exact expected relationship ID/version from the detail response. Warn specifically that this changes access to this child; show no implication of mandate or subscription transfer. A stale response refreshes the review and requires a new decision.
- [ ] Provide approve, reject and request-more-information operations; reject does not delete the athlete. Link every approved subject to the canonical Members record, keeping unapproved siblings visible as pending. Attach training completion to the same request while it is pending.
- [ ] Inspect mixed approved/pending family request, already replaced guardian and expired plan. Expected: subject-specific action, fresh versions, no additional access queue, no automatic plan activation, and no coach approval control.
- [ ] Commit with message `Review recovered family profiles in Enrolment requests`.

## Task 12: Use a shared profile selector and training completion in the member area

**Files:**
- Create account files and two clients listed in the file map.
- Modify `apps/web/src/app/account/page.tsx`, `calendar/member-calendar.tsx`, `family/page.tsx`, `profile/page.tsx`, `progress/page.tsx`, `progress/own-progress.tsx`, `progress/family-progress.tsx`, `progress/recovered-history.tsx`, `membership/page.tsx`, `billing/page.tsx`, `classes/page.tsx`, `waitlist/page.tsx`; `apps/web/src/lib/calendar/calendar-repository.ts`, `firebase-calendar-repository.ts`, `fixture-calendar-repository.ts`, `client-auth.tsx`; account-scoped clients affected by Task 6.

**Interfaces:**
- Consume `AccountMemberProfile`, `TrainingCompletionView`, `TrainingSubmission`, `listMyMemberProfiles` and existing calendar repository contract.
- New client exports: `listMyMemberProfiles(): Promise<{profiles: readonly AccountMemberProfile[]}>`, `getMemberTrainingDetails(target: TrainingTarget): Promise<TrainingCompletionView>`, `submitMemberTrainingDetails(input: TrainingSubmission): Promise<TrainingCompletionView>`. They parse responses with the shared schemas and map generic errors to safe English messages.
- Produce `MemberProfileProvider` and `useMemberProfile(): {profiles: readonly AccountMemberProfile[]; selectedStudentId: string | null; selectProfile(id: string): void; refreshProfiles(): Promise<void>}`; all protected account features consume this context or the same explicit validated student ID.

- [ ] Load the account's approved profile union. Label own profile `My profile` and children by name. Keep each child’s membership, progress and calendar state scoped by student ID. Preserve the existing page auth providers instead of creating a competing auth store; share the profile context across the current route wrappers.
- [ ] Remove client branches that choose own versus child data solely from the role. Use the selected profile's `via` value only to render appropriate actions; the server remains authoritative. Revalidate the selector on login refresh, permission-denied responses and returning to the app.
- [ ] Prevent a late response for child A from replacing child B's state. Tie request keys and mutation inputs to the selected ID at invocation; clear sensitive loaded data when that ID changes or disappears.

```ts
// Inside the training loader, after rejecting a null selection:
const requestedStudentId = selectedStudentId;
const response = await getMemberTrainingDetails({ kind: "member", studentId: requestedStudentId });
if (selectedStudentIdRef.current !== requestedStudentId) return;
setTrainingView(response);
```

- [ ] Render `Complete your training details` only when the view requires it. Prefill known approved-profile details, label unconfirmed values, ask only required fields, display calculated group status and current compatible plan options. Reuse the existing plan-choice presentation where possible. Do not force contact/time fields unless needed for the operation.
- [ ] Allow submission with no plan match and show `Your details are awaiting BPT review.` Multiple choices require an explicit preference; a suggested plan is labelled as a suggestion. Do not provide a production button that simulates office approval or paid coverage, even though the standalone prototype demonstrates the resulting state.
- [ ] Show confirmed history while the plan is awaiting review; keep calendar locks and normal pay-as-you-go behaviour. At 18 remove the child from the former guardian's selector. Own approved access continues; otherwise the athlete can use the existing recovery route. Other profiles remain selected/available.
- [ ] Inspect rapid profile switching, link removed during page use, one complete sibling and one incomplete sibling, a new adult without own login and a no-match submission. Expected: no data crossing profile boundaries and no extra completion barrier for an already eligible member. UI review uses synthetic data only; no browser suite is authorised.
- [ ] Commit with message `Manage own and child training profiles in one member account`.

## Task 13: Build one Members workspace with three views

**Files:**
- Create `apps/web/src/lib/member-reconciliation-client.ts`, `apps/web/src/app/admin/members/members-workspace.tsx`, `apps/web/src/app/admin/members/families-view.tsx`, `apps/web/src/app/admin/members/data-review.tsx`.
- Modify `apps/web/src/app/admin/members/page.tsx`, `member-review.tsx`, `apps/web/src/lib/members-client.ts`, `apps/functions/src/members/canonical-member-directory-read-service.ts`, `member-directory-callables.ts`, `packages/domain/src/members/member-directory-contracts.ts`.

**Interfaces:**
- Expose the Task 2 office service through callables `getMemberReconciliation` (`{studentId}` → `ReconciliationCase`), `decideMemberReconciliation` (`ReconciliationDecisionInput` → `ReconciliationCase`) and `closeMemberReconciliation` (`CloseReconciliationInput` → `ReconciliationCase`). The new client uses those exact names and schemas.
- Consume canonical directory pagination/detail, reconciliation cases, Task 5 family projections and approved enrolment links.
- Extend the existing `AdminDirectoryPage` row projection; produce `MembersWorkspace` with query-param view `all | families | review` and cursor-based loading. Do not introduce another collection of members.

- [ ] Extend rows with age/unknown state, level, current group/site, plan and membership state, account/guardian summary and review indicators. Fetch a bounded page plus bounded projections; avoid downloading all legacy documents or all payments to render a directory. Source labels and unresolved counts are summaries, not raw restricted fields.
- [ ] Add server-side canonical name/member-number/guardian lookup with validated page cursors and existing identifier-read budgets. Historical search resolves existing links/aliases to the canonical record; unresolved historical sources open their Data review case. Do not create another editable copy from a search result.
- [ ] Render the three tabs with URL-preserved view/filter state and a common record destination. Group Families by current account relationships, including multiple families visible to the same guardian where applicable. Keep current office permissions; finance and restricted details stay outside coach rows.

```ts
const memberViews = [
  { value: "all", label: "All members" },
  { value: "families", label: "Families" },
  { value: "review", label: "Data review" },
] as const;
```

- [ ] Show already existing canonical athletes even when missing DOB/guardian or awaiting reconciliation. Include approved new enrolments immediately from the same canonical writer. Pending new applications stay in Enrolment requests. During migration distinguish uncovered legacy sources in Data review; do not claim all legacy people are already linked before the inventory reconciles.
- [ ] In Data review show BPT/source values, dates, evidence and explicit decisions without preselected winners. Keep closure disabled when unresolved issues remain, matching server enforcement. Distinguish identity, training, access-request link and coverage statuses; requesting account access opens the existing Enrolment requests entry.
- [ ] Inspect pagination/filter changes, same-name people, an unknown birth date, unapproved new application, former guardian grouping and one conflict remaining. Expected: unique canonical navigation, accurate pending states, editable appropriate fields and no unbounded fetch.
- [ ] Commit with message `Unify Members directory families and data review`.

## Task 14: Consolidate the editable member record without losing existing tools

**Files:**
- Create `apps/web/src/app/admin/members/profile/family-access-tab.tsx` and `apps/web/src/app/admin/members/profile/history-tab.tsx`.
- Modify `packages/domain/src/members/member-profile-contracts.ts`, `apps/functions/src/members/member-profile-service.ts`, `member-profile-firestore.ts`, `member-profile-callables.ts`, `apps/web/src/lib/member-profile-client.ts`, `apps/web/src/app/admin/members/profile/member-record.tsx`, `profile-tab.tsx`, `details-tab.tsx`, `plan-tab.tsx`, `payments-tab.tsx`, `classes-tab.tsx`, `group-access-editor.tsx`, `manage-view.tsx`.

**Interfaces:**
- Consume existing `MemberProfile`/`FullMemberProfile`/coach projection, history/reconciliation projections and existing mutation clients.
- Produce member-record tab IDs `overview`, `plan-payments`, `level-progress`, `family-access`, `history`; `recordHref` keeps canonical student IDs and maps old tab parameters in Task 15.

- [ ] Consolidate the visible tab map, reusing the existing components and editors instead of replacing functional controls with demo HTML.

```ts
const unifiedRecordTabs = [
  ["overview", "Overview"],
  ["plan-payments", "Plan and payments"],
  ["level-progress", "Level and progress"],
  ["family-access", "Family and access"],
  ["history", "History"],
] as const;
```

- [ ] Place personal-details editing and current summaries in Overview; combine subscription editor and billing history under Plan and payments; put assessments, IBJJF card, belt/stripes, class history and group editor under Level and progress. Preserve existing save/cancel, unsaved-change confirmation and optimistic versions.
- [ ] Place own account, active guardian, pending request links, one-child replacement and adulthood markers under Family and access. History contains source provenance, reviewed decisions and adjustments, with appropriate restricted-field reveals. Preserve existing documents, notes and communication capabilities as labelled panels/actions under Overview or History; do not delete them merely because their old tab has moved.
- [ ] Keep current fields administrable through their existing safe writers. Imported source panels remain evidence; a correction opens the reviewed update/adjustment workflow. Eliminate whole-profile read-only dead ends only once there is a real canonical target. An unresolved legacy identity opens Data review before edits can attach to the wrong athlete.
- [ ] Enrich office profiles with history and account projections. Do not add financial/restricted fields to the coach schema and hide them only with CSS; retain the separate server projection. A staff level correction and a financial adjustment remain separately authorised actions.
- [ ] Inspect old subscription editor, assessment changes, unknown values, paid-period evidence, stale form save, coach opening a shared profile link and guardian transition. Expected: existing features retained, no evidence rewrite, no role leakage and one member identity throughout.
- [ ] Commit with message `Make unified member records fully manageable`.

## Task 15: Retire redundant navigation while preserving old links

**Files:**
- Modify `apps/web/src/app/admin/admin-shell.tsx`, `apps/web/src/app/admin/families/page.tsx`, `apps/web/src/app/admin/members/search/page.tsx`, `apps/web/src/app/admin/members/migration/page.tsx`, `apps/web/src/app/admin/members/recovery/page.tsx`, `apps/web/src/app/admin/members/profile/member-record.tsx`.
- Modify `PRODUCT.md` and `docs/legacy-member-recovery.md` for the final navigation and age/reconciliation policy.

**Interfaces:**
- Consume unified Members view URLs and canonical record resolution. Produce compatibility redirects/mappings; keep Enrolment requests at `/admin/members/requests`.

- [ ] Remove separate Families and Member search entries only once Tasks 13–14 cover their existing actions and permissions. Fix the existing `Enrolmnet Requests` label to `Enrolment requests`; do not move or duplicate the section.
- [ ] Map routes to the equivalent workspace view, preserving useful validated query context. Source IDs must go through an authenticated resolver; never relabel an archive ID as a student ID. Use the existing app's navigation/export pattern rather than assuming server redirects are available.

```ts
const compatibilityViews = {
  "/admin/families": "/admin/members?view=families",
  "/admin/members/search": "/admin/members?view=all",
  "/admin/members/migration": "/admin/members?view=review",
  "/admin/members/recovery": "/admin/members/requests#member-recovery",
} as const;
const legacyTabMap = {
  profile: "overview", details: "overview", plan: "plan-payments",
  payments: "plan-payments", classes: "level-progress",
  documents: "overview", communication: "history", notes: "history",
} as const;
```

- [ ] Preserve feature-specific anchors for documents, notes and communication after tab mapping. Keep authorisation at the destination and source resolution; redirects cannot bypass a record's permissions or expose names in unauthorised error copy.
- [ ] Update documentation: personal access from 16 is distinct from adulthood and subscription age; guardian ends at 18; no automatic source precedence; access requests remain in Enrolment requests; new enrolments appear after approval. Supersede conflicting old recovery wording explicitly.
- [ ] Inspect every legacy URL and old tab parameter, an unlinked archive result and a coach's old link. Expected: same permitted task reachable, no stranded features and no alternate member database interface.
- [ ] Commit with message `Route legacy member tools into the unified workspace`.

## Task 16: Prepare and execute only the authorised rollout stages

**Files:**
- Create `docs/unified-members-rollout.md`.
- Modify this plan's completion evidence as tasks finish and update `docs/legacy-member-recovery.md` with the final runbook link.
- Reuse existing `member-directory-forward-dry-run.ts`, `member-directory-forward-runner.ts`, `member-directory-forward-closure-runner.ts`, `member-directory-chunk-runner.ts` and their guarded Firestore adapters; no ad-hoc direct-write migration script.

**Interfaces:**
- Consume inventory pages, versioned review decisions, guarded migration previews/receipts and the existing deployment/change-control procedure.
- Produce a scoped release manifest and a private migration preview/receipt report. Public repository documentation contains only counts, safe operation identifiers and redacted findings, never real member records or credentials.

- [ ] Document a release manifest with exact changed callable exports, domain package changes, web routes, Firestore indexes/rules additions and dependencies. The backend must enforce new scope before client controls are enabled. Do not leave old recovery/whole-family mutation endpoints as an alternate bypass during staged rollout.
- [ ] Run read-only inventory only within authorised data access, exhaust every cursor, compare source links and operational references, and record capture limits. Report separately: source documents, confirmed unique athletes, pending candidates, invalid/dangling records and incomplete history. Never reuse the earlier documented 243/249 counts as a current census.
- [ ] Generate the concrete change preview using existing protected migration tooling. For each operation include canonical ID, sources, strong-match evidence, explicit discrepancy decisions, expected source versions, relationship changes and affected bookings/payments/attendance. Ambiguous identities and every unresolved discrepancy stay pending. Include the maximum batch size, target academy, total operations and reversal limits.
- [ ] Before a production write or deployment, check the conversation for existing authorisation for that exact scope. If missing, present the finished preview/manifest and request only that remaining approval. Approval of the specification/plan does not silently run this stage. Keep non-dependent preparation complete while that decision is pending.
- [ ] Apply reviewed batches using stable operation IDs and existing guarded runners. Stop/refresh stale operations; preserve successful receipts and retry failed operations without replaying successful effects. Reconcile post-write canonical links, account scope, source count accounting and operational references against the preview. Report successful, skipped, failed and still-unresolved operations separately; retain data-review cases.
- [ ] Correct an applied decision only through a compensating, audited operation that checks the current version. Do not restore an old export over later bookings, payments or member edits. Preserve archive originals, identity aliases and historical relationships. A failure in one batch must not be represented as full migration completion.
- [ ] Inspect the rollout document for the five Review Focus cases and spec coverage. Record code-inspection evidence, requested manual review evidence if supplied, and the explicit limit that automated tests were not run. Deployment success or Git publication alone is not proof of production data correctness.
- [ ] Publish scoped commits following `AGENTS.md`. Verify local and remote main contain the delivered commit; fetch/integrate any concurrent changes without force push. Report GitHub delivery, deployment state and migration state separately.

## Coverage and readiness record

| Approved specification | Owning tasks |
| --- | --- |
| One canonical identity, retained sources, duplicate review | 1–3, 13, 16 |
| Own account plus several children, one guardian per child | 4–7, 10–12 |
| Guardian required under 16, optional 16–17, independence at 18 | 4–6, 8, 11–12 |
| Account verification and individual office approval | 6–7, 10–11 |
| Access independent of plan review | 3–4, 7, 9, 11–12 |
| Explicit decision for every conflict; no source default | 2–3, 9, 13–14 |
| Historical payments, paid periods, payer and progression retained | 3, 5–6, 14, 16 |
| Missing training details, current catalogue, automatic unambiguous group | 8–9, 12 |
| One Members section and five editable record tabs | 13–15 |
| Existing Enrolment requests; approved new members appear in directory | 7, 11, 13, 15 |
| Bounded retries, current permissions, no destructive cleanup | 1–7, 9, 16 |
| British English and standalone review before implementation | Global constraints; approved prototype and this plan |

Planning evidence: local code and schema inspection, including the existing age-12 client-scope rule, family-wide replacement, bounded archive arrays, guarded canonical writers, separate profile projections and existing paid-period settlement. No production census, live claim changes, migration, deployment or automated tests were performed while writing this plan.

Review artefacts: `/root/compartido/bpt-members-propuesta-v1.html`, `/root/compartido/bpt-members-design.md` and `/root/compartido/bpt-members-plan.md`. The prototype uses fictitious data and its approval/payment actions are simulations.
