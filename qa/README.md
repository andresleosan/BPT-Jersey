# Quality assurance conventions

- Unit files use `*.test.ts` or `*.test.tsx` and run with Vitest.
- Browser journeys use `*.spec.ts` under `qa/tests/` and run with Playwright.
- Prefer behavior and accessible roles over implementation details.
- Every test owns its data and must run independently of execution order.
- Production credentials and live Firebase projects are prohibited in automated tests.
- Contract, Rules, load, and security-edge suites are added beside the feature they protect.
- Build `apps/web` before E2E so Playwright exercises the production static export.
