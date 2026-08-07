# Dependency risk register

## DR-001 — Firebase transitive moderate advisories

- Recorded: 2026-08-06
- Status: temporarily accepted; must be rechecked on every dependency update and before production.
- Affected paths:
  - `uuid@9.0.1` through current Google/Firebase SDK packages.
  - `@opentelemetry/core@1.30.1` through the development-only Firebase CLI.
- Exposure analysis:
  - The UUID advisory affects the v3, v5, and v6 APIs when a caller supplies an invalid output buffer. The installed Google call paths use UUID v4, which the advisory identifies as bounds-checked.
  - The OpenTelemetry package is in `firebase-tools`, not the deployed Functions dependency graph. Firebase CLI is not exposed as an HTTP service; Node's default HTTP header limit also constrains the reported baggage-allocation vector.
- Decision: do not force incompatible major-version overrides beneath official Firebase packages. Keep the latest direct Firebase packages, monitor upstream releases, and block production if usage introduces an affected UUID API, an exposed OpenTelemetry propagator, or severity increases.
- Verification: `pnpm audit --audit-level high` must remain clear of high/critical findings. The two moderate findings stay visible rather than being suppressed.
