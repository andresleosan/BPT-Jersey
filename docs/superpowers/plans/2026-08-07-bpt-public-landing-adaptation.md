# BPT Public Landing Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. No commit is authorized unless the operator requests it explicitly.

**Goal:** Replace the abstract landing content with a self-contained public BPT Jersey landing that uses curated real academy information and never redirects its primary actions to `bptjersey.com`.

**Architecture:** Keep the Next.js page statically exported. Store all public academy facts in a typed module under `apps/web/src/content/academy.ts`; `page.tsx` consumes that module and renders semantic sections for the academy, schedule, programs, fees, platform preview, and contact. No runtime fetch, scraping, Firebase client, form submission, or external content dependency is introduced.

**Tech Stack:** Next.js 16.3.0, React 19.2.8, TypeScript 6.0.3, CSS Modules via `apps/web/src/app/globals.css`, Vitest 4.1.10 + React Testing Library, Playwright 1.61.1, static export to `apps/web/out`, pnpm 11.20.0.

## Global Constraints

- Visible interface content remains in English; internal documentation may remain in Spanish.
- The public page must not use `https://bptjersey.com/` as a primary CTA or redirect destination.
- Content is static and curated from `https://bptjersey.com/`, `/classes`, and `/contact-us`, consulted on 2026-08-07.
- The page must include the published BJJ, MMA, self-defence, kids, beginners, location, schedule, fee, instructor, and contact information defined by the approved spec.
- Published fees and conditions are informational only; they must not become payment, membership, capacity, booking, or authorization logic.
- The Carrefour/New Town eligibility contradiction is shown as a confirmation note, never silently resolved as a rule.
- The public filler account `filler@godaddy.com`, invented capacities, live availability claims, invented instructors per session, and `(f)` placeholders never reach the visible page.
- Firestore, Firebase Rules, backend code, Cloudflare configuration, and production integrations are out of scope.
- Preserve `output: "export"`, `next/font`, Barlow Condensed, Source Sans 3, and the existing BPT Design DNA.
- The page must be keyboard operable, responsive at desktop/mobile viewports, free of horizontal overflow, and respectful of `prefers-reduced-motion`.
- Do not add a dependency; use existing TypeScript, React Testing Library, Vitest, Playwright, and CSS.

---

### Task 1: Create the typed public academy content contract

**Files:**

- Create: `apps/web/src/content/academy.ts`
- Test: `apps/web/src/content/academy.test.ts`

**Interfaces:**

- Consumes: approved content requirements in `docs/superpowers/specs/2026-08-07-bpt-public-landing-adaptation-design.md`.
- Produces: `academyContent`, `ScheduleEntry`, `FeeItem`, `ProgramItem`, and `Instructor` exports for `page.tsx` and content tests.

- [ ] **Step 1: Write the failing content contract test**

Create `apps/web/src/content/academy.test.ts` with these assertions before creating the content module:

```typescript
import { describe, expect, it } from "vitest";

import { academyContent } from "./academy";

describe("public academy content", () => {
  it("contains the published identity, location, and sources", () => {
    expect(academyContent.identity.title).toBe("Brazilian Jiu-Jitsu, MMA & Self-Defence");
    expect(academyContent.location.address).toContain("13 Library Place");
    expect(academyContent.sources).toEqual([
      "https://bptjersey.com/",
      "https://bptjersey.com/classes",
      "https://bptjersey.com/contact-us",
    ]);
  });

  it("contains the eight published schedule rows and three published fee items", () => {
    expect(academyContent.schedule).toHaveLength(8);
    expect(academyContent.schedule).toContainEqual(
      expect.objectContaining({
        location: "Town Office",
        days: "Monday and Wednesday",
        time: "06:00-07:00",
        discipline: "No-Gi",
      }),
    );
    expect(academyContent.schedule).toContainEqual(
      expect.objectContaining({ location: "Strive", time: "18:30-19:30" }),
    );
    expect(academyContent.fees.map((fee) => fee.amount)).toEqual(["£85", "£10 / £65", "£95"]);
  });

  it("keeps public program and contact content free of account artifacts", () => {
    const visibleContent = JSON.stringify(academyContent);

    expect(visibleContent).toContain("Kids self-defence");
    expect(visibleContent).toContain("MMA");
    expect(visibleContent).toContain("Book a free class");
    expect(visibleContent).not.toContain("filler@godaddy.com");
    expect(visibleContent).not.toContain("(f)");
  });
});
```

- [ ] **Step 2: Run the focused test to confirm the expected red state**

Run:

```powershell
corepack pnpm exec vitest run --project web apps/web/src/content/academy.test.ts
```

Expected: FAIL because `apps/web/src/content/academy.ts` does not exist yet. If the failure is a test syntax/import error instead, correct the test before implementing the module.

- [ ] **Step 3: Implement the minimal typed content module**

Create `apps/web/src/content/academy.ts` with:

```typescript
export type ScheduleEntry = {
  location: "Town Office" | "Strive";
  days: string;
  time: string;
  discipline: "Gi" | "No-Gi" | "Jiu-Jitsu";
  level: string;
};

export type FeeItem = {
  label: string;
  amount: string;
  detail: string;
};

export type ProgramItem = {
  label: string;
  title: string;
  description: string;
};

export type Instructor = {
  name: string;
  credential: string;
};

export const academyContent = {
  lastVerified: "2026-08-07",
  sources: [
    "https://bptjersey.com/",
    "https://bptjersey.com/classes",
    "https://bptjersey.com/contact-us",
  ],
  identity: {
    title: "Brazilian Jiu-Jitsu, MMA & Self-Defence",
    intro:
      "Train with purpose in a welcoming Jersey academy built around skill, confidence, discipline, and community.",
  },
  location: {
    name: "Town Office",
    address: "Office 9, 13 Library Place",
    locality: "St Helier, Jersey",
    postcode: "JE2 3RR",
  },
  schedule: [
    {
      location: "Town Office",
      days: "Monday and Wednesday",
      time: "06:00-07:00",
      discipline: "No-Gi",
      level: "All levels",
    },
    {
      location: "Town Office",
      days: "Monday and Wednesday",
      time: "07:00-08:00",
      discipline: "Gi",
      level: "Beginners and all levels",
    },
    {
      location: "Town Office",
      days: "Monday and Wednesday",
      time: "17:30-18:30",
      discipline: "Gi",
      level: "Beginners",
    },
    {
      location: "Town Office",
      days: "Monday and Wednesday",
      time: "18:30-19:30",
      discipline: "No-Gi",
      level: "All levels",
    },
    {
      location: "Town Office",
      days: "Tuesday and Thursday",
      time: "12:00-13:00",
      discipline: "Gi",
      level: "Beginners and all levels",
    },
    {
      location: "Town Office",
      days: "Tuesday and Thursday",
      time: "17:30-18:30",
      discipline: "Gi",
      level: "All levels",
    },
    {
      location: "Town Office",
      days: "Tuesday and Thursday",
      time: "18:30-19:30",
      discipline: "No-Gi",
      level: "Beginners",
    },
    {
      location: "Strive",
      days: "Tuesday and Thursday",
      time: "18:30-19:30",
      discipline: "Jiu-Jitsu",
      level: "Published session",
    },
  ] satisfies readonly ScheduleEntry[],
  programs: [
    {
      label: "BJJ",
      title: "Brazilian Jiu-Jitsu",
      description: "Gi and No-Gi training for beginners and experienced students.",
    },
    {
      label: "Kids",
      title: "Kids self-defence",
      description:
        "Age-group programs based on Brazilian Jiu-Jitsu, with focus, coordination, teamwork, and confidence.",
    },
    {
      label: "Beginners",
      title: "Start with confidence",
      description:
        "A clear entry point for people with no previous martial-arts experience or returning to training.",
    },
    {
      label: "MMA",
      title: "MMA at BPT",
      description:
        "A combat-sports pathway for students looking for a different challenge; event availability is confirmed separately.",
    },
  ] satisfies readonly ProgramItem[],
  fees: [
    {
      label: "Town Office",
      amount: "£85",
      detail: "Monthly fee covering all classes and open mats.",
    },
    {
      label: "BPT West / Strive",
      amount: "£10 / £65",
      detail: "Per session or monthly; the published £8 class wording should be confirmed.",
    },
    { label: "Kids", amount: "£95", detail: "Once weekly for the current school term." },
  ] satisfies readonly FeeItem[],
  instructors: [
    { name: 'Professor Vladimiro "Miro" Afonso', credential: "4th degree black belt" },
    { name: 'Eduardo "Eddie" Afonso', credential: "2nd degree black belt" },
    {
      name: 'Andrew "Topo" Toporis',
      credential: "2nd degree black belt and Jersey grappling pioneer",
    },
    { name: "Charlie Tromans", credential: "Black belt" },
  ] satisfies readonly Instructor[],
  notes: {
    booking:
      "Timetables and fees are published information. Confirm eligibility and current term availability when booking.",
    contact:
      "Book a free class and the academy team will help you choose the right starting point.",
  },
} as const;
```

Keep source URLs and `lastVerified` in the module for provenance, but do not render URLs or raw source metadata as noisy page copy.

- [ ] **Step 4: Run the focused content test to confirm green**

Run:

```powershell
corepack pnpm exec vitest run --project web apps/web/src/content/academy.test.ts
```

Expected: 3 tests pass with no console errors. Do not proceed if the public account artifact or `(f)` marker appears in the serialized content.

---

### Task 2: Recompose the page around real academy content

**Files:**

- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/test-harness.test.tsx`

**Interfaces:**

- Consumes: `academyContent` and its `ScheduleEntry`, `ProgramItem`, `FeeItem`, and `Instructor` values from Task 1.
- Produces: one static, semantic page with internal anchors `#top`, `#classes`, `#programs`, `#fees`, `#contact` and no primary link to `bptjersey.com`.

- [ ] **Step 1: Update the render test before changing the page**

Replace the old fictional assertions in `apps/web/src/test-harness.test.tsx` with these behaviors:

```tsx
it("renders the real public academy identity and internal navigation", () => {
  render(<HomePage />);

  expect(
    screen.getByRole("heading", { level: 1, name: /Brazilian Jiu-Jitsu, MMA & Self-Defence/i }),
  ).toBeVisible();
  expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Classes in Jersey" })).toBeVisible();
  expect(screen.getByText("Office 9, 13 Library Place")).toBeVisible();
  expect(screen.getByText("£85")).toBeVisible();
  expect(screen.getByRole("link", { name: "Book a free class" })).toHaveAttribute(
    "href",
    "#contact",
  );
  expect(screen.queryByRole("link", { name: "Visit BPT Jersey" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the updated render test to confirm red**

Run:

```powershell
corepack pnpm exec vitest run --project web apps/web/src/test-harness.test.tsx
```

Expected: FAIL because the existing page still has the old hero copy, `Tonight at BPT`, and external CTA.

- [ ] **Step 3: Implement the page composition**

Update `page.tsx` to import `academyContent` and render these exact content boundaries. The navigation and landmark skeleton must be concrete:

```tsx
<a className="skip-link" href="#main-content">Skip to main content</a>
<header className="site-header">
  <a className="wordmark" href="#top" aria-label="BPT Jersey home">
    <span>BPT</span>
    <span>Jersey</span>
  </a>
  <nav aria-label="Primary navigation">
    <a href="#top">Home</a>
    <a href="#classes">Classes</a>
    <a href="#programs">Programs</a>
    <a href="#contact">Contact</a>
    <a className="nav-cta" href="#contact">Book a free class</a>
  </nav>
</header>
<main id="main-content">
  <section id="top" aria-labelledby="hero-title">
    <p className="eyebrow">Brazilian Power Team · Jersey</p>
    <h1 id="hero-title">Brazilian Jiu-Jitsu, MMA &amp; Self-Defence</h1>
    <a className="button button-primary" href="#classes">View classes</a>
    <a className="button button-secondary" href="#contact">Book a free class</a>
  </section>
  <section id="classes" aria-labelledby="classes-title">
    <h2 id="classes-title">Classes in Jersey</h2>
  </section>
  <section id="programs" aria-labelledby="programs-title">
    <h2 id="programs-title">Find your way onto the mat</h2>
  </section>
  <section id="fees" aria-labelledby="fees-title">
    <h2 id="fees-title">Simple ways to train</h2>
  </section>
  <section id="platform" aria-labelledby="platform-title">
    <h2 id="platform-title">One academy. One clear system.</h2>
  </section>
  <section id="contact" aria-labelledby="contact-title">
    <h2 id="contact-title">Start with a free class</h2>
  </section>
</main>
```

Use `academyContent.schedule.map`, `programs.map`, `fees.map`, and `instructors.map` with stable content keys. Render the schedule as a visible table-like list with location, days, time, discipline, and level. Render fee amounts and the confirmation note without adding payment links. Keep SVG arrows decorative with `aria-hidden="true"`. Replace the old `Visit BPT Jersey` external anchor entirely with internal `#contact` actions.

- [ ] **Step 4: Run the focused render test to confirm green**

Run:

```powershell
corepack pnpm exec vitest run --project web apps/web/src/test-harness.test.tsx apps/web/src/content/academy.test.ts
```

Expected: 4 tests pass (3 content tests + 1 harness test) and the visible content is English. If a test finds the old heading or external CTA, fix the page composition rather than weakening the assertion.

---

### Task 3: Implement the timetable-led visual system and responsive accessibility

**Files:**

- Modify: `apps/web/src/app/globals.css`
- Reference: `STACK.md` Design DNA and the approved landing spec

**Interfaces:**

- Consumes: semantic class names from `page.tsx`, BPT color/font tokens, and the schedule/program/fee layout.
- Produces: desktop and mobile styles with no horizontal overflow, visible keyboard focus, readable contrast, and reduced-motion behavior.

- [ ] **Step 1: Add skip-link, anchor, and focus rules**

Add concrete rules for `.skip-link`, `:target`, `:focus-visible`, and `scroll-margin-top` so keyboard users can bypass navigation and never lose focus visibility. The skip link must be visually hidden until focused and must become a visible high-contrast control.

- [ ] **Step 2: Replace the fictional board styles with the real timetable board**

Keep the existing BPT tokens and fonts, then style the schedule with concrete rules for the following selectors. Use straight borders, a white schedule surface, purple discipline markers, Mat Ink headings, and Canvas page spacing:

```css
.schedule-board {
  border: 1px solid var(--line);
  background: var(--gi-white);
}
.schedule-location {
  border-top: 3px solid var(--bpt-purple);
  padding: 1.5rem;
}
.schedule-row {
  border-top: 1px solid var(--line);
  display: grid;
  grid-template-columns: 8rem 1fr 8rem 1fr;
  gap: 1rem;
  padding: 1rem 0;
}
.schedule-day {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
}
.schedule-time {
  font-family: var(--font-display), Impact, sans-serif;
  font-size: 1.5rem;
}
.schedule-discipline {
  color: var(--bpt-purple);
  font-weight: 700;
}
.schedule-level {
  color: var(--muted);
}
.program-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.fee-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.instructor-list {
  border-top: 1px solid var(--line);
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
```

Do not add gradients, rounded-card systems, or fake live-status indicators. Preserve at least 4.5:1 text contrast and 3:1 UI/border contrast where used to communicate structure.

- [ ] **Step 3: Add responsive rules for the approved layout**

At widths below `56rem`, collapse navigation to the existing compact pattern, stack hero/content columns, and make program/fee grids single-column. At widths below `38rem`, make schedule rows stack as `time`, `class`, `location/level` without clipping, make primary CTA targets full-width, and keep the address readable. Do not hide essential schedule data on mobile.

- [ ] **Step 4: Add motion and reduced-motion behavior**

Use short opacity/translate transitions for hero sections, buttons, and schedule rows. Extend the existing `prefers-reduced-motion: reduce` block so animation and transition durations are effectively disabled and smooth scrolling is removed for users who request reduced motion.

- [ ] **Step 5: Run format and type checks for the visual block**

Run:

```powershell
corepack pnpm exec prettier --check apps/web/src/app/page.tsx apps/web/src/app/globals.css apps/web/src/content/academy.ts apps/web/src/content/academy.test.ts apps/web/src/test-harness.test.tsx
corepack pnpm --filter @bpt-jersey/web typecheck
```

Expected: all listed files pass formatting and the web workspace typecheck completes successfully.

---

### Task 4: Update browser coverage and verify the static export

**Files:**

- Modify: `qa/tests/public-home.spec.ts`
- Test target: `apps/web/src/app/page.tsx`, `apps/web/src/content/academy.ts`, `apps/web/src/app/globals.css`

**Interfaces:**

- Consumes: internal anchors and accessible names from Tasks 1-3.
- Produces: desktop/mobile smoke coverage for real public content, internal navigation, no redirect, no console errors, no overflow, and static build output.

- [ ] **Step 1: Replace old Playwright expectations**

Update `qa/tests/public-home.spec.ts` to assert:

```typescript
await expect(page).toHaveTitle(/BPT Jersey/);
await expect(
  page.getByRole("heading", {
    name: /Brazilian Jiu-Jitsu, MMA & Self-Defence/i,
    level: 1,
  }),
).toBeVisible();
await expect(page.getByRole("heading", { name: "Classes in Jersey" })).toBeVisible();
await expect(page.getByText("Office 9, 13 Library Place")).toBeVisible();
await expect(page.getByText("£85")).toBeVisible();
await expect(page.getByText("£65")).toBeVisible();
await expect(page.getByText("£95")).toBeVisible();

await page.getByRole("link", { name: "View classes" }).click();
await expect(page).toHaveURL(/#classes$/);
await page.getByRole("link", { name: "Book a free class" }).first().click();
await expect(page).toHaveURL(/#contact$/);
await expect(page.locator('a[href="https://bptjersey.com/"]')).toHaveCount(0);
```

Keep the existing browser error listener, response check, horizontal overflow check, and screenshot capture behavior. Add a keyboard assertion that `page.keyboard.press("Tab")` can reach the skip link and that its accessible name is `Skip to main content`.

- [ ] **Step 2: Run the static build**

Run:

```powershell
corepack pnpm --filter @bpt-jersey/web build
```

Expected: Next.js completes with the `/` route marked static and writes `apps/web/out`.

- [ ] **Step 3: Run unit and browser smoke tests**

Run:

```powershell
corepack pnpm test
corepack pnpm --dir qa test:e2e:smoke
```

Expected: existing unit projects pass, desktop/mobile public-home smoke passes, no browser console errors appear, and no horizontal overflow is detected.

- [ ] **Step 4: Run the final frontend quality checks**

Run:

```powershell
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm format:check
git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check
```

The root formatter must be reported accurately if it still flags the unrelated external `opencode.json`; no external configuration is edited as part of this frontend task. The T013-specific residual does not excuse a new frontend formatting failure.

- [ ] **Step 5: Perform the content/security scan**

Search the modified frontend and test files for:

```text
filler@godaddy.com|\(f\)|href=["']https://bptjersey\.com/|password|secret|api[_-]?key|privateKey
```

Expected: no filler account, placeholders, old-site CTA, credentials, or secrets. Source URLs in `academy.ts` may include the public paths without being rendered as redirect actions; the exact old-site homepage anchor must still be absent.

## Plan Self-Review

- Spec coverage: Task 1 covers typed content and source provenance; Task 2 covers page information architecture and no-redirect behavior; Task 3 covers visual identity, responsiveness, focus, contrast, and reduced motion; Task 4 covers static export, unit tests, browser smoke, and content/security scans.
- Data consistency: the eight schedule rows and three fee items match the approved specification; public contradictions remain a confirmation note rather than product logic.
- Scope: no runtime fetch, Firebase, payment, login, form submission, Cloudflare, or backend changes are included.
- Completeness scan: all implementation steps specify files, concrete data, commands, expected outcomes, and boundaries.
- Execution safety: no commit is authorized by this plan; integration remains an explicit operator decision.
