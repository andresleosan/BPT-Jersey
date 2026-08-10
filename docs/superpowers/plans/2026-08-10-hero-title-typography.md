# Hero Title Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Make the homepage hero title's punctuation read intentionally by controlling its three-line composition and refining its responsive typography.

**Architecture:** Keep the published title as one canonical string and add a canonical three-line presentation array beside it. The server-rendered homepage maps those lines into decorative visual spans while the `h1` keeps the canonical string as its accessible name. CSS owns sizing, spacing, and responsive wrapping; no client JavaScript or new dependency is needed.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 6, Vitest, React Testing Library, Playwright, CSS.

## Global Constraints

- Keep all visible product content in English.
- Preserve the BPT Purple background, Barlow Condensed display face, uppercase treatment, and Source Sans 3 body copy.
- Keep the comma in the source content for correct English punctuation.
- Respect responsive layout, visible keyboard focus, and `prefers-reduced-motion`.
- Do not add client-side JavaScript or dependencies for this visual correction.
- Do not change authentication, backend, data, deployment, or production configuration.

---

### Task 1: Add Canonical Title Lines And Accessible Markup

**Files:**
- Modify: `apps/web/src/content/academy.ts:33-37`
- Modify: `apps/web/src/content/academy.test.ts:5-12`
- Modify: `apps/web/src/app/page.tsx:36-42`
- Modify: `apps/web/src/test-harness.test.tsx:7-16`

**Interfaces:**
- Consumes: `academyContent.identity.title`.
- Produces: `academyContent.identity.titleLines` as `readonly [string, string, string]`; the `h1#hero-title` keeps `academyContent.identity.title` as its accessible name.

- [ ] **Step 1: Write the failing content contract**

Update the identity expectation in `apps/web/src/content/academy.test.ts` to require the published punctuation and the intended visual grouping:

```ts
expect(academyContent.identity.title).toBe("Brazilian Jiu-Jitsu, MMA & Self-Defence");
expect(academyContent.identity.titleLines).toEqual([
  "Brazilian Jiu-",
  "Jitsu, MMA",
  "& Self-Defence",
]);
```

Update the homepage heading matcher in `apps/web/src/test-harness.test.tsx` to include the comma:

```ts
name: /Brazilian Jiu-Jitsu, MMA & Self-Defence/i,
```

- [ ] **Step 2: Run the focused tests and confirm the red state**

Run from the repository root:

```text
corepack pnpm exec vitest run --project web apps/web/src/content/academy.test.ts apps/web/src/test-harness.test.tsx
```

Expected: FAIL because the current local title omits the comma and `titleLines` is not present.

- [ ] **Step 3: Implement the minimal content and markup**

In `apps/web/src/content/academy.ts`, set the title to the canonical comma-bearing string and add:

```ts
titleLines: ["Brazilian Jiu-", "Jitsu, MMA", "& Self-Defence"] as const,
```

In `apps/web/src/app/page.tsx`, replace the plain `h1` child with an accessible name plus visual line spans:

```tsx
<h1 aria-label={academyContent.identity.title} id="hero-title">
  {academyContent.identity.titleLines.map((line) => (
    <span aria-hidden="true" className="hero-title-line" key={line}>
      {line}
    </span>
  ))}
</h1>
```

The `aria-hidden` spans prevent duplicated screen-reader text while the `aria-label` preserves the exact canonical title.

- [ ] **Step 4: Run the focused tests and confirm green**

Run the same Vitest command from Step 2.

Expected: all focused tests pass, including the accessible heading lookup.

### Task 2: Refine Hero Typography And Verify Responsive Output

**Files:**
- Modify: `apps/web/src/app/globals.css:273-282`
- Modify: `apps/web/src/app/globals.css:748-755`
- Verify: `qa/tests/public-home.spec.ts:16-75`

**Interfaces:**
- Consumes: `.hero-title-line` spans from Task 1.
- Produces: a three-line hero title with no punctuation visually aligned over the `D` in `Self-Defence`, no horizontal overflow, and the same accessible heading contract.

- [ ] **Step 1: Add the line-group layout and typography refinement**

Update the desktop hero title rules to use slightly more vertical breathing room and add the line-group display rule:

```css
.hero h1 {
  font-family: var(--font-display), Impact, sans-serif;
  font-size: clamp(4rem, 8vw, 7.7rem);
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 0.88;
  margin: 0;
  max-width: 12.5ch;
  text-transform: uppercase;
}

.hero-title-line {
  display: block;
}
```

Keep the mobile size rule, but set its line height and width constraints consistently:

```css
.hero h1 {
  font-size: clamp(3.4rem, 17vw, 5rem);
  line-height: 0.86;
  max-width: 12.5ch;
}
```

Do not add `white-space: nowrap`; the spans must be allowed to wrap naturally on narrow screens instead of causing overflow.

- [ ] **Step 2: Run formatting and static checks**

Run:

```text
corepack pnpm exec prettier --check apps/web/src/app/page.tsx apps/web/src/app/globals.css apps/web/src/content/academy.ts apps/web/src/content/academy.test.ts apps/web/src/test-harness.test.tsx
corepack pnpm exec eslint apps/web/src/app/page.tsx apps/web/src/content/academy.ts apps/web/src/content/academy.test.ts apps/web/src/test-harness.test.tsx --max-warnings 0
corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json
```

Expected: all commands exit 0.

- [ ] **Step 3: Build the static web output**

Run:

```text
corepack pnpm --filter @bpt-jersey/web build
```

Expected: the Next.js static build completes successfully and includes the homepage.

- [ ] **Step 4: Run desktop and mobile homepage E2E**

Run:

```text
corepack pnpm --dir qa exec node run-e2e.mjs tests/public-home.spec.ts --project=desktop-chromium --project=mobile-chromium
```

Expected: both viewport projects pass; the existing test confirms the heading, no console errors, and no horizontal overflow. Inspect the generated screenshots when `CAPTURE_VISUALS=true` to confirm the comma no longer appears aligned over the `D`.

- [ ] **Step 5: Run the complete relevant unit suite**

Run:

```text
corepack pnpm test:unit
```

Expected: all web and node unit tests pass with no regressions.

## Self-Review Checklist

- The canonical content, visual grouping, and accessible name are covered in Task 1.
- Desktop and mobile typography, overflow, console errors, build, lint, typecheck, formatting, and unit regressions are covered in Task 2.
- No placeholder steps or unspecified files remain.
- No backend, data, authentication, secret, migration, or deployment behavior is touched.
