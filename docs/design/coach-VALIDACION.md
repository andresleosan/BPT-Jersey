# Coach workspace validation

- Reuses `AdminShell`, its mobile navigation, role-filtered routes, admin panel and button styles. Existing backend authorization and Firebase login/linking code are unchanged.
- 55 focused tests pass across coach pages, access, shared admin navigation, role routes and the staff login client.
- TypeScript, scoped ESLint, formatting and the Next production build pass. The local build uses synthetic CI Firebase configuration and is not a deployment artifact.
- Chromium synthetic fixtures: dashboard and account controls at 320, 390, 768 and 1440 pixels have no horizontal overflow. Mobile drawer, focus return after Escape, site selection, Google linking and password controls pass. No browser errors observed.
- Normal coach rendering does not request the head-coach level panel module. No dependencies added. No production latency/Core Web Vitals improvement is claimed.
- The general suite includes pre-existing failures reproduced independently on `main` at `852e1dc`: `packages/domain/src/contracts.test.ts` (audit contract expectations), `qa/unit/member-directory-config.test.ts` (index expectations), `apps/web/src/app/admin/members/page.test.tsx` (directory column expectations), and `apps/web/src/app/admin/overview-page.test.tsx` (unavailable dashboard expectation). Those files are outside this change.
- The first broad run also caught three outdated shared navigation expectations; these were updated for the new coach links and all 16 existing admin shell tests pass in the focused run.
- Real Google linking and numeric-ID authentication were not exercised against production by these visual tests. Synthetic preview stubs are outside the repository and cannot ship.
