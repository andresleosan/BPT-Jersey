# T050 Financial Dashboard Implementation Plan

## Objective

Connect `/admin/finance` to a least-data, owner/administrator-only projection over canonical
memberships, invoices, and manual payments. Keep all work inside the synthetic pilot boundary.

## Steps

1. Add the immutable financial-dashboard domain projection and strict response validator.
2. Add a capped Firestore read service that validates document identity, tenant scope, and
   invoice/payment/membership relationships before projection.
3. Add `getFinancialDashboard` with exact-null payload, active owner/admin authorization, stable
   errors, runtime export, and deploy-runtime coverage.
4. Add a validating Firebase web client and replace preview fixtures with loading, error, empty,
   refresh, balance, renewal, and recent-payment states.
5. Add focused contract/service/callable/client/UI tests and a desktop/mobile Playwright flow.
6. Run the complete Cronos self-critique gates and synchronize `tasks.md` with `Lista/Lista.js`.

## Non-goals

No automated billing or renewal mutation, provider/card integration, refund, email/SMS delivery,
new Firestore schema, real data, staging/production access, migration, or deployment.
