# Hero Title Typography Design

## Goal

Improve the public homepage hero title so the comma in `Brazilian Jiu-Jitsu, MMA & Self-Defence` reads as intentional punctuation instead of an accent-like mark near the next line.

## Design

- Keep the current BPT Purple background, Barlow Condensed display face, uppercase treatment, and Source Sans 3 body copy.
- Keep the comma in the source content for correct English punctuation.
- Render the hero title with controlled line groups rather than relying on an incidental browser wrap.
- Preserve the existing three-line desktop composition while tuning `line-height`, `letter-spacing`, and width so punctuation remains attached to the preceding word.
- Keep mobile responsive by allowing the line groups to scale without horizontal overflow; the title remains readable before the hero copy and actions.
- Respect the existing `prefers-reduced-motion` behavior and do not add client-side JavaScript.

## Files

- `apps/web/src/content/academy.ts`: canonical title content, including the comma.
- `apps/web/src/app/page.tsx`: semantic title markup and controlled line grouping.
- `apps/web/src/app/globals.css`: desktop/mobile typography and spacing refinement.
- Existing homepage tests remain the regression contract; add only a focused assertion if the markup needs a stable accessible-name check.

## Verification

- Run focused homepage/unit tests.
- Run web lint, typecheck, and formatting checks.
- Build the static web output.
- Run the existing Playwright desktop and mobile smoke coverage, checking title wrapping, no horizontal overflow, and no console errors.

## Rollback

Restore the previous `page.tsx` and `globals.css` hero markup/styles. No data, authentication, backend, or deployment configuration changes are involved.
