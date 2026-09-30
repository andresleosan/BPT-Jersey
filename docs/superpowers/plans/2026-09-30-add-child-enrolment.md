# Add a Child as an Enrolment + Account People — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An existing member adds a child (or starts training) through the full `/enrol` form and the office approves it in Enrolment Requests; every account shows exactly the people who train on it, each with the sessions their age and plan allow.

**Architecture:** One optional flag, `existingMember: true`, on the enrolment request carries the new case through the existing layers (domain contract → store/callable → approval service → office UI → `/enrol`). The web stops deciding "who is on this account" from the role claim and uses one shared loader built on `listMyMemberProfiles`. The old Plan requests system is deleted.

**Tech Stack:** TypeScript, zod, Firebase Functions v2 + Firestore (admin SDK), Next.js static web (React client components), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-09-30-add-child-enrolment-design.md` (decisions D1–D18). Read it before any task.

## Global Constraints

- BPT-Jersey rules (`AGENTS.md`): work on local `main`; never `git add -A` (other sessions share the repo), add only your files; no automated test suites unless requested; no workspace-wide lint/typecheck as routine — typecheck only the packages you touched and filter to your files.
- Per-task check = `corepack pnpm --filter <pkg> exec tsc --noEmit -p tsconfig.json 2>&1 | grep -v "\.test\." | grep error` must print nothing for your files (pre-existing errors live only in `*.test.ts`).
- Domain changes need `corepack pnpm --filter @bpt-jersey/domain build:runtime` before the functions typecheck sees them.
- Commit locally after each task (author `Luis <luismadef45@gmail.com>`, trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`). **Do not push until Task 9.**
- UI copy in English. Reuse existing classes (`button button-primary`, `admin-status-badge`, `enrol-*`, `client-plan-people-*`).
- The server never trusts the client for the existing-member case: it re-derives it from Firestore.

## Review Focus

1. **A guardian who does not train asks to "Train yourself"** — approval must keep the claim `guardian` (never demote to `adultStudent`) and create their own student. Owned by Task 3 (explicit rule + acceptance case 4).
2. **Two children in one request, or a retried approval** — each child written once; the family `addStudent` requestIds must differ per child and be stable across retries. Task 3.
3. **A member with an approved hold submits a plain (non-existing-member) enrolment** — still refused as today; only `existingMember` opens the door. Task 2.
4. **A member who already trains asks to be added as a student again** (`applicantIsStudent: true` with a `self` profile) — refused at submit. Task 2.
5. **Stale ID token after approval** (role still `adultStudent`) — calendar/Progress must still show holder + children. Task 5 (loader never reads the role) + acceptance case 3.

---

### Task 1: Domain — `existingMember` flag, row tag, drop the old schema

**Files:**
- Modify: `packages/domain/src/members/enrolment-request-contracts.ts` (submission schema ~L284, record schema ~L294, `EnrolmentRequestRow` ~L395, `EnrolmentRequestDetail` ~L405, `toEnrolmentRequestRow` ~L630, `toEnrolmentRequestDetail`)
- Modify: `packages/domain/src/members/member-engagement-contracts.ts:309-314` (delete `memberPlanRequestInputSchema`)

**Interfaces — Produces:**
- `EnrolmentRequestSubmission.existingMember?: true`, `EnrolmentRequestRecord.existingMember?: true`
- `EnrolmentRequestRow.existingMember?: true`, `EnrolmentRequestDetail.existingMember?: true`

- [ ] **Step 1: Add the flag to the submission and the record**

In `enrolmentRequestSubmissionSchema` (inside `.strictObject({ ... })`) add after `payment`:

```ts
    /**
     * Sent from My plan by an account that already holds members (spec D1/D5). The server
     * re-derives it from Firestore before storing it; the client's word only asks.
     */
    existingMember: z.literal(true).optional(),
```

In `enrolmentRequestRecordSchema` add the same line after `payment: enrolmentPaymentSchema.optional(),`.

- [ ] **Step 2: Carry it to the office row and detail**

In `export type EnrolmentRequestRow` add `existingMember?: true;` after `minorCount`.
In `export type EnrolmentRequestDetail` add `existingMember?: true;` after `applicantIsStudent`.
In `toEnrolmentRequestRow` and `toEnrolmentRequestDetail` add:

```ts
    ...(record.existingMember ? { existingMember: true as const } : {}),
```

- [ ] **Step 3: Delete the old plan-request schema**

Remove `memberPlanRequestInputSchema` (and only it) from `member-engagement-contracts.ts`. Its only non-test users are deleted in Task 8; `grep -rn memberPlanRequestInputSchema packages/domain/src apps/*/src` must list only `family-plan-service.ts` and `family-plan-client.ts`.

- [ ] **Step 4: Build and check**

```bash
corepack pnpm --filter @bpt-jersey/domain build:runtime
corepack pnpm --filter @bpt-jersey/domain exec tsc --noEmit -p tsconfig.json 2>&1 | grep -v "\.test\." | grep error
```
Expected: build OK, no output from the grep.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/members/enrolment-request-contracts.ts packages/domain/src/members/member-engagement-contracts.ts
git commit -m "feat(domain): existing-member flag on enrolment requests"
```

---

### Task 2: Store — accept an existing member's request, server-verified

**Files:**
- Modify: `apps/functions/src/members/enrolment-request-service.ts` (`submit`, ~L480-555)

**Interfaces:**
- Consumes: `submission.existingMember` (Task 1); `memberAccessInStoreTransaction(firestore, transaction).listProfiles(academyId, userId)` from `./member-access-service.js`; `parseUserProfile` from `@bpt-jersey/domain/profiles`.
- Produces: stored record with `existingMember: true` and applicant `fullName`/`email`/`phoneNumber` taken from `users/{uid}`.

- [ ] **Step 1: Replace the hold check with the existing-member branch**

Inside `submit`'s transaction, after `const hold = storedHold(...)`, replace the current `if (!canSubmitEnrolmentRequest(hold?.status)) { ... }` block with:

```ts
        let submission = input.submission;
        if (submission.existingMember) {
          // Spec §3: an existing member may apply again once their earlier request is settled,
          // never while one is still open or being approved.
          if (hold !== undefined && !["approved", "withdrawn"].includes(hold.status))
            throw new EnrolmentRequestStoreError(
              "precondition",
              "You already have a request waiting for the academy to review",
            );
          const user = parseUserProfile(
            asDocument(await transaction.get(firestore.doc(`academies/${academyId}/users/${actorId}`))).data(),
          );
          if (!user.ok || user.value.active !== true || user.value.status !== "active")
            throw new EnrolmentRequestStoreError("precondition", "Your account details are incomplete. Contact the office.");
          const profiles = await memberAccessInStoreTransaction(firestore, transaction, now).listProfiles(academyId, actorId);
          if (profiles.length === 0)
            throw new EnrolmentRequestStoreError("precondition", "Use the registration form to join the academy.");
          if (submission.applicantIsStudent && profiles.some((profile) => profile.via === "self"))
            throw new EnrolmentRequestStoreError("precondition", "You already train on this account.");
          // The holder's contact comes from the account, not from the form (spec D10).
          submission = {
            ...submission,
            applicant: {
              ...submission.applicant,
              fullName: user.value.displayName,
              ...(user.value.email ? { email: user.value.email } : {}),
              phoneNumber: user.value.phoneNumber ?? submission.applicant.phoneNumber,
            },
          };
        } else if (!canSubmitEnrolmentRequest(hold?.status)) {
          if (hold !== undefined && isOpenEnrolmentRequest(hold.status))
            throw new EnrolmentRequestStoreError(
              "precondition",
              "You already have a request waiting for the academy to review",
            );
          throw new EnrolmentRequestStoreError(
            "precondition",
            "The academy is already handling your enrolment. Ask reception if something needs changing",
          );
        }
```

Then in the `parseEnrolmentRequestRecord({...})` call below, replace every `input.submission.` with `submission.` and add `...(submission.existingMember ? { existingMember: true } : {}),` after the `payment` spread.

Add imports at the top:

```ts
import { parseUserProfile } from "@bpt-jersey/domain/profiles";
import { memberAccessInStoreTransaction } from "./member-access-service.js";
```

Note: `now` inside `submit` is the validated timestamp string already in scope (`const now = timestamp(input.now)`); `UserProfile.phoneNumber` is optional — keep the submitted one when the account has none.

- [ ] **Step 2: Typecheck functions**

```bash
corepack pnpm --filter @bpt-jersey/functions exec tsc --noEmit -p tsconfig.json --module ESNext --moduleResolution Bundler --rootDir . 2>&1 | grep -v "\.test\." | grep error
```
Expected: no output. (Package name: check `apps/functions/package.json` `name` if the filter does not match.)

- [ ] **Step 3: Commit**

```bash
git add apps/functions/src/members/enrolment-request-service.ts
git commit -m "feat(enrolment): existing members can apply to add a child or train"
```

---

### Task 3: Approval — existing member's request joins their account and family

**Files:**
- Modify: `apps/functions/src/members/enrolment-approval-service.ts` (`approve`, `targetRoleFor`, new `approveExistingMember`)

**Interfaces:**
- Consumes: `record.existingMember` (Task 1); `dependencies.families.getGuardianFamily(academyId, userId)`, `.updateFamily({... operation: { kind: "addStudent", requestId, student }})`, `.createFamily(...)` (`../families/family-service.ts`); `dependencies.directory.createAdminAdultForAccount({ ..., existingClientAccount: true })`.
- Produces: `studentIds` in `enrolmentStudents(record)` order (holder first when `applicantIsStudent`, then minors in order) — `registration.complete` and `completeApproval` depend on it.

- [ ] **Step 1: Add the existing-member writer**

Below `approveGuardian`, add:

```ts
  const normalizedName = (name: string) =>
    name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-GB");

  /**
   * Spec §5: an account that already holds members. Nothing account-level is created again: the
   * holder's own student joins the same account, children join the holder's family (created only
   * when there is none), and a retry finds what it already wrote instead of writing it twice.
   */
  async function approveExistingMember(
    input: ApproveEnrolmentRequestInput,
    record: EnrolmentRequestRecord,
    approvalRequestId: string,
    account: Readonly<{ userId: string; displayName: string; email: string }>,
  ): Promise<readonly string[]> {
    const academyId = input.actor.academyId;
    const ids: string[] = [];
    if (record.applicantIsStudent) {
      const written = await dependencies.directory.createAdminAdultForAccount({
        actor: input.actor,
        enrolmentRequestId: record.enrolmentRequestId,
        value: { requestId: approvalRequestId, ...record.applicant },
        account,
        existingClientAccount: true,
        now: input.now,
      });
      ids.push(written.studentId);
    }
    if (record.minors.length === 0) return Object.freeze(ids);
    await promoteClaim(account.userId, academyId, "guardian");
    const common = {
      academyId,
      actorId: input.actor.actorId,
      actorRole: input.actor.role === "owner" ? ("owner" as const) : ("administrator" as const),
      now: input.now,
    };
    const matches = (
      students: readonly Readonly<{ studentId: string; fullName: string; dateOfBirth?: string }>[],
      minor: EnrolmentRequestRecord["minors"][number],
    ) =>
      students.filter(
        (student) =>
          normalizedName(student.fullName) === normalizedName(minor.fullName) &&
          student.dateOfBirth === minor.dateOfBirth,
      );
    let family = await dependencies.families.getGuardianFamily(academyId, account.userId);
    if (!family) {
      const created = await dependencies.families.createFamily({
        ...common,
        enrolmentRequestId: record.enrolmentRequestId,
        requestId: approvalRequestId,
        tutorUserId: account.userId,
        students: record.minors.map(toFamilyStudentDraft),
      });
      for (const minor of record.minors) {
        const found = matches(created.students, minor);
        if (found.length !== 1)
          throw new EnrolmentApprovalError("conflict", "child_record_ambiguous", "The child's record needs office review");
        ids.push(found[0]!.studentId);
      }
      return Object.freeze(ids);
    }
    for (const [index, minor] of record.minors.entries()) {
      const existing = matches(family!.students, minor);
      if (existing.length === 1) {
        ids.push(existing[0]!.studentId);
        continue;
      }
      const written = await dependencies.families.updateFamily({
        ...common,
        familyId: family!.family.familyId,
        // One stable key per child: a retry replays it, a second child never collides with it.
        operation: { kind: "addStudent", requestId: `${approvalRequestId}-${index}`, student: toFamilyStudentDraft(minor) },
      });
      const found = matches(written.students, minor);
      if (found.length !== 1)
        throw new EnrolmentApprovalError("conflict", "child_record_ambiguous", "The child's record needs office review");
      ids.push(found[0]!.studentId);
      family = await dependencies.families.getGuardianFamily(academyId, account.userId);
    }
    return Object.freeze(ids);
  }
```

Check before writing: `getGuardianFamily` must be on the `families` dependency type (`EnrolmentApprovalDependencies.families`); if the type is a `Pick<FamilyStore, ...>`, add `"getGuardianFamily" | "updateFamily"` to it, and make sure the real wiring in `enrolment-request-callables.ts` (`officeCallableServices`, `createFamilyStore(...)`) passes the full store. `EnrolmentApprovalError` codes: use one that exists in `EnrolmentApprovalErrorCode` (read its union; use `"precondition"` if `"conflict"` is not a member). `StaffFamilyProjection.students` has `dateOfBirth` — confirm the field name.

- [ ] **Step 2: Never demote a guardian; route existing members**

Replace `targetRoleFor` with:

```ts
// A guardian who also trains ends as `guardian`: the role that lets them hold a family. Their own
// student record keeps the `self` link, because the adult writer stores their userId on it. An
// existing guardian who only starts training stays `guardian` (spec Review Focus 1).
function targetRoleFor(record: EnrolmentRequestRecord, currentRole?: unknown): "adultStudent" | "guardian" {
  return record.minors.length > 0 || (record.existingMember && currentRole === "guardian")
    ? "guardian"
    : "adultStudent";
}
```

In `approve`: compute the current claim once after `readApplicantAccount` (`const currentRole = currentClaims(await dependencies.auth.getUser(account.userId)).role;`), move `const role = targetRoleFor(record, currentRole)` below it (the `alreadyApproved` early return keeps `targetRoleFor(record)`), and replace the `studentIds = ...` expression with:

```ts
        studentIds = record.existingMember
          ? await approveExistingMember(input, record, approvalRequestId, account)
          : role === "adultStudent"
            ? await approveAdult(input, record, approvalRequestId, account)
            : Object.freeze([
                ...(record.applicantIsStudent
                  ? await approveAdult(input, record, approvalRequestId, account)
                  : []),
                ...(await approveGuardian(input, record, approvalRequestId, account)),
              ]);
```

and set `stage = record.existingMember ? "existing_member" : role === "adultStudent" ? "member" : "family";`. The later `if (role === "adultStudent") await promoteClaim(...)` stays: for an existing guardian `role` is now `guardian`, so nothing is demoted.

- [ ] **Step 3: Typecheck functions** (same command as Task 2 Step 2). Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add apps/functions/src/members/enrolment-approval-service.ts apps/functions/src/members/enrolment-request-callables.ts
git commit -m "feat(enrolment): approving an existing member adds to their account and family"
```

---

### Task 4: Office — "Existing member" tag

**Files:**
- Modify: `apps/web/src/lib/enrolment-client.ts` (`row()` ~L111-150; detail parser if it whitelists fields)
- Modify: `apps/web/src/app/admin/members/requests/page.tsx` (card head ~L706 and `DetailPanel`)

- [ ] **Step 1: Keep the flag when parsing**

In `row()` destructure `existingMember`, reject it unless `undefined` or `true`, and return `...(existingMember === true ? { existingMember: true as const } : {})`. Do the same wherever the detail projection is parsed (search `applicantIsStudent` in `enrolment-client.ts`).

- [ ] **Step 2: Show the tag**

In the card head, after `<AdminStatusBadge status={statusLabels[request.status]} />`:

```tsx
                    {request.existingMember ? <AdminStatusBadge status="Existing member" /> : null}
```

In `DetailPanel`, at the top of its output, when `detail.existingMember`:

```tsx
      {detail.existingMember ? (
        <p className="admin-request-meta">
          Existing member: approving adds these people to their current account and family.
        </p>
      ) : null}
```

- [ ] **Step 3: Typecheck web**

```bash
corepack pnpm --filter @bpt-jersey/web exec tsc --noEmit -p tsconfig.json 2>&1 | grep -v "\.test\." | grep error
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/enrolment-client.ts apps/web/src/app/admin/members/requests/page.tsx
git commit -m "feat(admin): tag existing-member enrolment requests"
```

---

### Task 5: One "people on this account" loader, used everywhere (the bug fix)

**Files:**
- Create: `apps/web/src/lib/account-people.ts`
- Modify: `apps/web/src/lib/calendar/firebase-calendar-repository.ts:75-79`
- Modify: `apps/web/src/app/account/progress/page.tsx`, `apps/web/src/app/account/progress/member-progress.tsx:313-348`
- Modify: `apps/web/src/app/account/calendar/member-calendar.tsx:436`
- Modify: `apps/web/src/app/account/membership/page.tsx:80-110` (subjects), and the `listMyProfiles` import in `membership/page.tsx`, `settings/page.tsx`, `competitors/page.tsx`, `private-lessons/page.tsx`

**Interfaces — Produces:**

```ts
export type AccountPerson = Readonly<{
  studentId: string;
  fullName: string;
  via: "self" | "guardian";
  dateOfBirth?: string;
  trainingCenter: "Town" | "West";
}>;
export function listMyProfiles(): Promise<readonly AccountMemberProfile[]>;
export function loadAccountPeople(): Promise<readonly AccountPerson[]>;
```

- [ ] **Step 1: Create the loader**

`apps/web/src/lib/account-people.ts`:

```ts
import { z } from "zod";
import { accountMemberProfileSchema, type AccountMemberProfile } from "@bpt-jersey/domain/members/access";

import { httpsCallable } from "./callable";
import { getFamily } from "./family-client";
import { getFirebaseAuth, getFirebaseFunctions } from "./firebase-client";
import { getClientProfile } from "./profile-client";

/**
 * Who trains on this account (spec D14): the holder when they have a `self` profile, then each
 * child they are guardian of. Never derived from the role claim — a parent who trains and has
 * children who train is both, and a claim changed by an approval reaches the browser late.
 */
export type AccountPerson = Readonly<{
  studentId: string;
  fullName: string;
  via: "self" | "guardian";
  dateOfBirth?: string;
  trainingCenter: "Town" | "West";
}>;

const profilesSchema = z.object({ profiles: z.array(accountMemberProfileSchema) });

export async function listMyProfiles(): Promise<readonly AccountMemberProfile[]> {
  const response = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), "listMyMemberProfiles")({});
  return profilesSchema.parse(response.data).profiles;
}

export async function loadAccountPeople(): Promise<readonly AccountPerson[]> {
  const profiles = await listMyProfiles();
  const hasSelf = profiles.some((profile) => profile.via === "self");
  const hasChildren = profiles.some((profile) => profile.via === "guardian");
  const [own, family] = await Promise.all([
    hasSelf ? getClientProfile() : undefined,
    hasChildren ? getFamily() : undefined,
  ]);
  // An approval may have made this account a guardian after its token was issued; refresh it once
  // so pages that still read the role catch up. ponytail: fire-and-forget, the people list above
  // never depends on it.
  if (hasChildren) void getFirebaseAuth().currentUser?.getIdToken(true).catch(() => undefined);
  return profiles.flatMap((profile): AccountPerson[] => {
    if (profile.via === "self") {
      const student = own?.student.studentId === profile.studentId ? own.student : undefined;
      return student
        ? [{ studentId: student.studentId, fullName: student.fullName, via: "self",
             ...(student.dateOfBirth ? { dateOfBirth: student.dateOfBirth } : {}),
             trainingCenter: student.trainingCenter }]
        : [];
    }
    const child = family?.students.find(
      (student) => student.studentId === profile.studentId && student.active && student.status === "active",
    );
    return child
      ? [{ studentId: child.studentId, fullName: child.fullName, via: "guardian",
           ...(child.dateOfBirth ? { dateOfBirth: child.dateOfBirth } : {}),
           trainingCenter: child.trainingCenter }]
      : [];
  });
}
```

(The old `listMyProfiles` threw `FamilyPlanUnavailableError` on `not-found`; `listMyMemberProfiles` is a core callable, so the plain version is enough. Check `StudentProfile.trainingCenter`'s type name and use it instead of the literal union if it exists.)

- [ ] **Step 2: Re-point `listMyProfiles` imports**

In `membership/page.tsx`, `settings/page.tsx`, `competitors/page.tsx`, `private-lessons/page.tsx` change `from "../../../lib/family-plan-client"` to `from "../../../lib/account-people"` (adjust the relative depth per file).

- [ ] **Step 3: My plan uses the loader**

In `membership/page.tsx` replace the `subjectsPromise` body (L84-L110) with:

```ts
      const subjectsPromise = loadAccountPeople().then((people) => ({
        hasSelf: people.some((person) => person.via === "self"),
        hasChildren: people.some((person) => person.via === "guardian"),
        subjects: people.map((person): Subject => ({
          studentId: person.studentId,
          displayName: person.via === "self" ? "You" : person.fullName,
          trainingCenter: person.trainingCenter,
          participantType: person.dateOfBirth ? participantBand(person.dateOfBirth) : "adult",
        })),
      }));
```

Add `hasChildren: boolean` to `Workspace` (Task 7 uses it). Drop now-unused imports (`getFamily`, `getClientProfile`) if nothing else in the file uses them.

- [ ] **Step 4: Calendar uses the loader**

In `firebase-calendar-repository.ts` replace L75-L79:

```ts
    const subjectsPromise = !ordinaryRole ? Promise.resolve([]) : loadAccountPeople();
```

and import `loadAccountPeople` from `"../account-people"`; remove the `getFamily` / `getClientProfile` imports if now unused. The loop below reads `subject.studentId`, `subject.fullName`, `subject.dateOfBirth`, `subject.trainingCenter` — all on `AccountPerson`.

- [ ] **Step 5: Sibling check-in no longer needs the role**

`member-calendar.tsx:436`: `if (member?.role !== "guardian" || others.length === 0) {` → `if (others.length === 0) {`.

- [ ] **Step 6: Progress uses the loader**

`progress/page.tsx`: render `<MemberProgress>` without the `guardian` prop; keep `RecoveredMemberHistory` for `session?.role === "adultStudent"` as today.
`member-progress.tsx`: drop the `guardian` prop; start `people` as `null` and load:

```ts
  useEffect(() => {
    let active = true;
    loadAccountPeople().then(
      (list) =>
        active &&
        setPeople(
          list.map((person) => ({
            studentId: person.studentId,
            firstName: person.via === "self" ? "You" : (person.fullName.split(/\s+/u)[0] ?? person.fullName),
          })),
        ),
      () => active && setPeople([]),
    );
    return () => {
      active = false;
    };
  }, []);
```

The holder's own summary is now requested with an explicit `studentId`. Read how `person.studentId === undefined` is used below (L350+) and keep that branch only if the level callable refuses a guardian asking for their own id; the member-access rule authorises a `self` id for any member role, so passing the id should work — confirm in the acceptance run (Task 9, case 2).

- [ ] **Step 7: Typecheck web** (Task 4 Step 3 command). Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/account-people.ts apps/web/src/lib/calendar/firebase-calendar-repository.ts apps/web/src/app/account/calendar/member-calendar.tsx apps/web/src/app/account/progress/page.tsx apps/web/src/app/account/progress/member-progress.tsx apps/web/src/app/account/membership/page.tsx apps/web/src/app/account/settings/page.tsx apps/web/src/app/account/competitors/page.tsx apps/web/src/app/account/private-lessons/page.tsx
git commit -m "fix(account): show everyone who trains on the account, not what the role says"
```

---

### Task 6: `/enrol` — three choices and existing-member mode

**Files:**
- Modify: `apps/web/src/app/enrol/page.tsx` (form type ~L84, `toDetails` ~L157, `EnrolContent` ~L532-870, step 1 "Who is joining" ~L876-898, "I also want to train" ~L965-975)

**Interfaces:**
- Consumes: `loadAccountPeople()` (Task 5), `getClientProfile()` / `getFamily()` for the holder's contact, `existingMember` on the submission (Task 1).
- URL: `/enrol?for=child|self|both` (produced by Task 7).

- [ ] **Step 1: One radio group with three choices**

Replace the two radios and the "I also want to train" checkbox with:

```tsx
              <fieldset className="enrol-who">
                <legend>Who is joining</legend>
                {whoOptions.map((option) => (
                  <label htmlFor={`enrol-who-${option.value}`} key={option.value}>
                    <input
                      checked={who(form) === option.value}
                      id={`enrol-who-${option.value}`}
                      name="enrol-who"
                      onChange={() => setForm(withWho(form, option.value))}
                      type="radio"
                    />
                    {option.label}
                  </label>
                ))}
              </fieldset>
```

with, at module level:

```ts
type Who = "self" | "child" | "both";
const allWhoOptions = [
  { value: "self", label: "Just me" },
  { value: "child", label: "My child or children" },
  { value: "both", label: "Me and my child or children" },
] as const;
const who = (form: ApplicantForm): Who =>
  !form.guardian ? "self" : form.applicantIsStudent ? "both" : "child";
const withWho = (form: ApplicantForm, next: Who): ApplicantForm => ({
  ...form,
  guardian: next !== "self",
  applicantIsStudent: next !== "child",
});
```

and inside `EnrolContent`: `const whoOptions = existing ? allWhoOptions.filter((option) => existing.allowed.includes(option.value)) : allWhoOptions;` (see Step 2). Delete the `enrol-guardian-trains` checkbox block; the fields under `{form.applicantIsStudent ? (...) : null}` stay.

- [ ] **Step 2: Detect existing-member mode and prefill**

In `EnrolContent`, after `alreadyStudent`:

```ts
  const requestedFor = useMemo(() => {
    const value = new URLSearchParams(globalThis.location?.search ?? "").get("for");
    return value === "child" || value === "self" || value === "both" ? value : undefined;
  }, []);
  const [existing, setExisting] = useState<Readonly<{ allowed: readonly Who[] }>>();
  useEffect(() => {
    if (!alreadyStudent || !requestedFor) return;
    let active = true;
    void loadAccountPeople().then(async (people) => {
      const trains = people.some((person) => person.via === "self");
      const allowed: Who[] = trains ? ["child"] : ["self", "child", "both"];
      // The holder's contact: their own student record when they train, else the family tutor.
      const [own, family] = await Promise.all([
        trains ? getClientProfile() : undefined,
        trains ? undefined : getFamily(),
      ]);
      const contact = own
        ? { fullName: own.user.displayName, email: own.user.email ?? "", phoneNumber: own.user.phoneNumber ?? "" }
        : family && "tutor" in family
          ? { fullName: family.tutor.displayName, email: family.tutor.email ?? "", phoneNumber: family.tutor.phoneNumber ?? "" }
          : undefined;
      if (!active || !contact) return;
      const start = allowed.includes(requestedFor) ? requestedFor : allowed[0]!;
      setForm((current) => ({
        ...withWho(current, start),
        ...contact,
        ...(own?.student.dateOfBirth ? { dateOfBirth: own.student.dateOfBirth } : {}),
        emergencyName: contact.fullName,
        emergencyRelationship: "Parent",
        emergencyPhone: contact.phoneNumber,
        minors: start === "self" ? current.minors : current.minors.length ? current.minors : [emptyMinor],
      }));
      setExisting({ allowed });
    });
    return () => {
      active = false;
    };
  }, [alreadyStudent, requestedFor]);
```

(Confirm `UserProfile.email`/`phoneNumber` optionality and that `ClientProfileProjection.user` is the right source; adjust the `?? ""`.)

Stop the session-seeding effect from overwriting the prefilled name once `existing` is set (guard `if (existing) return;` at its top and add `existing` to its deps).

- [ ] **Step 3: Let an existing member reach the form**

Change the "You are already enrolled" gate to skip existing-member mode and only consider open requests there:

```ts
  const openRequest = useMemo(
    () =>
      requests?.find((request) =>
        existing ? !["withdrawn", "approved"].includes(request.status) : request.status !== "withdrawn",
      ),
    [requests, existing],
  );
```

```tsx
  if (alreadyStudent && requestedFor && !existing && !loadFailed) {
    return (
      <main className="enrol-page" id="main-content">
        <p role="status">Loading your details…</p>
      </main>
    );
  }
  if (alreadyStudent && !existing && (!openRequest || openRequest.status === "approved")) {
```

(the second line replaces the existing `if (alreadyStudent && (!openRequest || ...` condition).

In the page header, when `existing`: title `"Add to your account"` and intro `"Your details are filled in from your account. Add who is joining, accept the waiver and choose a plan. The academy reviews it before confirming."`

- [ ] **Step 4: Lock the holder's contact, send the flag**

When `existing`, render the name, email and phone inputs with `readOnly` and a hint under the fieldset: `<p className="enrol-hint">To change these, go to Settings in your account.</p>` (reuse an existing small-text class from `enrol.css` if `enrol-hint` does not exist).

In `submit`, pass the flag to the parse call: `...toDetails(form, requestId), ...(existing ? { existingMember: true } : {}),`.

After a successful submit in existing mode, show the StatusCard as today (the new request is `submitted`, so `openRequest` finds it).

- [ ] **Step 5: Typecheck web** (Task 4 Step 3 command). Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/enrol/page.tsx
git commit -m "feat(enrol): three joining choices and an existing-member mode"
```

---

### Task 7: My plan — buttons open the enrolment form

**Files:**
- Modify: `apps/web/src/app/account/membership/page.tsx` (~L30 import, ~L296-299 empty-state copy, ~L471-475 `PlanPersonRequests`)

- [ ] **Step 1: Replace the dialog with links**

Remove `import { PlanPersonRequests } from "./plan-person-request";` and replace the `<PlanPersonRequests ... />` block with:

```tsx
      {state === "ready" && workspace ? (
        <section className="client-plan-people" aria-labelledby="plan-people-title">
          <h2 id="plan-people-title">Add someone</h2>
          <div className="client-plan-people-actions">
            <Link className="client-plan-people-card" href="/enrol?for=child">
              <strong>Add a child</strong>
              <span>Register a child under 18 on your account, with their plan and waiver.</span>
            </Link>
            {workspace.hasSelf ? null : (
              <>
                <Link className="client-plan-people-card" href="/enrol?for=self">
                  <strong>Train yourself</strong>
                  <span>Join as a member on this account, with your own plan.</span>
                </Link>
                <Link className="client-plan-people-card" href="/enrol?for=both">
                  <strong>Me and a child</strong>
                  <span>Join yourself and register a child in one request.</span>
                </Link>
              </>
            )}
          </div>
        </section>
      ) : null}
```

Empty-state copy (L298): `"Add a child or train yourself below."`

Check `membership.css`: `.client-plan-people-card` was styled for `<button>`; add `text-decoration: none; color: inherit; display: grid;` (only what the link needs to look the same). Remove CSS rules only used by the deleted dialog (`client-plan-people-dialog`, `-form`, `-times`, `-buttons`).

- [ ] **Step 2: Typecheck web**. Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/account/membership/page.tsx apps/web/src/app/account/membership/membership.css
git commit -m "feat(account): My plan opens the enrolment form to add people"
```

---

### Task 8: Remove the old Plan requests system

**Files:**
- Delete: `apps/web/src/app/account/membership/plan-person-request.tsx`, `apps/web/src/app/admin/members/requests/plan-requests-panel.tsx`, `apps/web/src/lib/family-plan-client.ts`, `apps/functions/src/family-plan/family-plan-callables.ts`, `apps/functions/src/family-plan/family-plan-service.ts`
- Modify: `apps/web/src/app/admin/members/requests/page.tsx` (import `PlanRequestsPanel` L32 and `{office ? <PlanRequestsPanel /> : null}`), `apps/web/src/app/admin/members/requests/requests.css` (`plan-requests-*` rules), `apps/functions/src/index.ts` (the `family-plan-callables.js` export line)

- [ ] **Step 1: Delete and unhook**

```bash
git rm apps/web/src/app/account/membership/plan-person-request.tsx apps/web/src/app/admin/members/requests/plan-requests-panel.tsx apps/web/src/lib/family-plan-client.ts apps/functions/src/family-plan/family-plan-callables.ts apps/functions/src/family-plan/family-plan-service.ts
grep -n "family-plan" apps/functions/src/index.ts
```

Remove that export line, the panel import/usage in the requests page, and the `plan-requests-*` CSS.

- [ ] **Step 2: Nothing left pointing at it**

```bash
grep -rn "family-plan\|PlanRequestsPanel\|PlanPersonRequests\|MemberPlanRequest\|requestMemberPlanPerson" apps/web/src apps/functions/src packages/domain/src | grep -v "\.test\."
```
Expected: no output. (Test files that import deleted modules are left as they are — repo rule; mention them in the final report.)

- [ ] **Step 3: Typecheck functions and web**. Expected: no output from either.

- [ ] **Step 4: Commit**

```bash
git add apps/functions/src/index.ts apps/web/src/app/admin/members/requests/page.tsx apps/web/src/app/admin/members/requests/requests.css
git commit -m "chore: remove the old Plan requests flow"
```

---

### Task 9: Review, acceptance in the local emulator, delivery

**Files:**
- Temporary (not committed): `qa/tests/add-child-accounts.spec.ts`

- [ ] **Step 1: Code review** — run `/code-review` at level high on the commits of Tasks 1–8 (touches permissions and member data). Fix confirmed findings in the owning files; commit each fix.

- [ ] **Step 2: Start the local stack**

```bash
node qa/scripts/run-recovery-stack.mjs build
node qa/scripts/run-recovery-stack.mjs start
```
Expected: Auth/Firestore/Functions emulators and Next dev on `127.0.0.1:3100`, seeded (demo project `demo-bpt-jersey`, synthetic data only).

- [ ] **Step 3: Acceptance script** — write `qa/tests/add-child-accounts.spec.ts` using `qa/tests/recovery-fixture.ts` (`test`, `createMemberAccount`, `signIn`, `uniqueEmail`, `ownerEmail`) and the enrol/approve steps from `qa/tests/enrol-flows.spec.ts` (R1/R2). Cases (spec §Verification):
  1. Guardian who does not train enrols 2 children via `/enrol` ("My child or children") → owner approves → `/account` participant chips = the 2 children, no "You"; each child's week shows sessions.
  2. Adult enrols "Me and my child or children" → approved → chips = "You" + child; both weeks show sessions; `/account/progress` chips = "You" + child.
  3. Adult enrols "Just me" → approved → `/account/membership` → "Add a child" → form shows name/email/phone read-only and the child's emergency contact prefilled → submit (Free Trial) → owner sees the card with "Existing member" → Approve → back on `/account` **without signing out**: chips = "You" + child; the child's calendar has no terms block; the child's week shows trial sessions.
  4. Guardian from case 1 → "Train yourself" → approved → chips = "You" + 2 children; the account claim is still `guardian`.

```bash
node qa/scripts/run-recovery-stack.mjs test tests/add-child-accounts.spec.ts
```
Expected: 4 passed. On a failure: `superpowers:systematic-debugging`, fix in the owning task's files, commit, re-run.

- [ ] **Step 4: Remove the temporary spec and stop the stack**

```bash
rm qa/tests/add-child-accounts.spec.ts
node qa/scripts/run-recovery-stack.mjs stop
```

- [ ] **Step 5: Push**

```bash
git pull --rebase --autostash origin main
git push origin main
git fetch && git rev-parse HEAD origin/main
```
Expected: both SHAs equal. Cloudflare publishes the web in ~90 s.

- [ ] **Step 6: Deploy (only with Luis's explicit OK in chat)**

Before: Luis confirms the "Plan requests" card in `/admin/members/requests` is empty (spec D17).

```bash
corepack pnpm --filter @bpt-jersey/domain build:runtime
npx firebase-tools deploy --only functions:submitEnrolmentRequest,functions:approveEnrolmentRequest,functions:listEnrolmentRequests,functions:getEnrolmentRequestDetail --project bptjersey-f5a25
npx firebase-tools functions:delete requestMemberPlanPerson listMemberPlanRequests decideMemberPlanRequest --region europe-west9 --project bptjersey-f5a25 --force
```
If the harness blocks the deploy, give Luis these commands with his step-by-step format (terminal, directory, expected output).

- [ ] **Step 7: Memory** — write `project-bpt-jersey-add-child-enrolment.md` (commits, LIVE state, D1–D18, pending) and add its line to `MEMORY.md`.
