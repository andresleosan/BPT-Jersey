# Online payments: prepared integration

Implementation date: 2026-11-07. Default provider: `unconfigured`. No credentials, charges,
provider API calls or invoice email sending are enabled by this change.

## Delivered surfaces

- Account → Invoices & payments → Pay invoice: bank details and a method selector, billing name,
  email, address, town, postcode and country. Debit/credit slots show number, expiry and security
  code as disabled provider-owned fields. An online choice may save billing details without paying.
- Registration, membership applications, PAYG booking, courses and shop expose the same choices;
  until connected they keep their existing bank-transfer and reception/collection workflows.
- Admin/owner → Finance → Payments: confirmed methods and provider references; separately,
  Online payment activity shows the latest 50 attempts. Settings reports provider availability.
- Existing income totals, balances, reports and member payment history accept the online methods.
  Office editing/voiding stays restricted to manual money; online payments require provider refunds.

## Backend contract and records

`getOnlinePaymentOptions`, `preparePaymentCheckout` and `listPaymentCheckouts` are App Check
callables using fresh tokens and current Auth/session/role checks. Only an adult member's or
guardian's recorded payer ownership grants access; child-profile access does not. Office readers
must be owner/administrator. Academy identity and invoice amount come from the server, never
from a browser-supplied academy/family/amount. Payloads reject unexpected properties.

Records under `academies/{academyId}`:

| Collection              | Purpose                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `onlineCheckouts`       | Billing contact/address, chosen method, confirmed method, GBP amount, provider/session references, timestamps and status |
| `paymentInvoiceLocks`   | One active hosted checkout per invoice; uncertain outcomes retain the lock                                               |
| `paymentRateLimits`     | At most 20 newly prepared attempts per actor per UTC day                                                                 |
| `paymentProviderEvents` | Fingerprint and minimal outcome for verified webhook deduplication                                                       |
| `payments`              | Confirmed money, using the existing invoice ledger and provider-confirmed method                                         |
| `invoiceEmailOutbox`    | One branded invoice/receipt per recorded payment; delivery disabled                                                      |

These collections inherit the existing deny-all Firestore client fallback; only server functions
read/write them. No rule relaxation is required. Never persist PAN, expiry, CVV, wallet payloads,
provider credentials or raw webhook bodies in these records or logs.

Unconfigured attempts do not lock the invoice, call a provider or affect money. Configured session
creation uses a deterministic checkout ID as provider idempotency key. Retrying a `preparing`
attempt resumes that same creation. Lost/uncertain outcomes require reconciliation and keep the
invoice locked. A definitive failed/cancelled result permits a new attempt with a new request ID.

`onlinePaymentWebhook` accepts POST only and returns 503 while unconfigured. An adapter must
verify the signature, signed timestamp, merchant account and checkout correlation before returning
the strict event contract. No browser endpoint or return URL can mark an invoice paid. The actual
method in the verified event is authoritative, rather than the method initially selected.

A verified success registers money through the existing finance service, including its balance
checks, audit trail and overdue-membership reactivation. Provider transaction references deduplicate
across webhook event IDs. Checkout/event/outbox finalisation is resumable: if the worker stops
after writing money, another delivery reuses the same payment and completes the receipt. A signed
event can bind a missing session ID after an interrupted creation response. A stale failure cannot
undo success. An invoice changed/paid manually during checkout requires office reconciliation;
do not retry charges to repair it. No automatic bookings are introduced.

## Provider-specific work still required

Replace `getOnlinePaymentProvider()` in `apps/functions/src/payments/online-provider.ts` with the
contracted provider's adapter. An API key alone is insufficient. The adapter must implement:

1. Explicit supported methods and HTTPS checkout-origin allowlist. Confirm wallet availability for
   this merchant, including any Apple Pay domain/merchant validation and Google Pay configuration.
2. Idempotent hosted session creation keyed by `checkoutId`, merchant checkout correlation, GBP
   amount, 3DS and the fixed billing return URL. Repeated creation must reuse the session.
3. Verified signed webhooks mapping provider IDs, actual method, outcome, transaction timestamp,
   amount and currency to `VerifiedPaymentEvent`. Use the provider's current official SDK/docs.
   Do not put secrets into the web build or accept client-provided success claims.
4. Provider-specific refund, chargeback and reconciliation operations. Review retained invoice
   locks against the provider before releasing them; never expire an uncertain session blindly.
5. For payments _before an invoice exists_ (registration/membership approval, PAYG booking,
   course reservation, shop), add the provider's source-specific authorisation/capture lifecycle
   to the existing approval/identity/stock/capacity transactions. Those flows currently remain
   transfer-only for completion; this implementation does not charge a made-up invoice or grant
   places merely because a payment method was selected. Their coming-soon state remains until
   that lifecycle is connected. Invoice-backed charges share the delivered settlement path.

After integration, explicitly validate provider sandbox success, decline, challenge, interruption,
duplicate/reordered events, changed invoices and reconciliation before activating real payments.
No such tests were requested or run in this implementation session.

## Invoice email configuration later

`renderPaidInvoiceEmail` produces escaped HTML plus plain text with BPT colours, invoice description,
total, payment received, remaining balance, method, reference and billing address when supplied.
Online settlement queues a receipt after confirmation. `prepareManualPaymentInvoiceEmail` queues
manual receipts when new payment documents are created. Neither sends email; the existing reminder
sender is unchanged. No historical backfill runs.

Outbox status is `awaiting_configuration` or `missing_recipient`; `sentAt` remains null. A future
sender must configure sender identity/delivery, deduplicate by payment ID, re-read the current
invoice/payment (including edits/voids) before sending, validate recipient ownership, and only set
sent status after delivery confirmation. Publishing this trigger does not enable invoice sending.

## Publication scope

Web: the normal `main` push triggers Cloudflare Pages. Missing new callables produce an honest
unavailable state; existing transfers continue to work with the current backend.

Firebase publication is separate. Deploy the new checkout callables, webhook, manual outbox
trigger and `onlineCheckouts` invoice/createdAt index with operator authorisation. Existing
financial readers also need the expanded methods before connecting any provider:
`getFinancialDashboard`, `listFinancialAccount`, `getInvoice`, `getFamilyFinancialAccount`,
`listRecentPayments`, `getOperationalReport`, `listMemberSubscriptionBilling`, and the finance
mutation exports that share the ledger parsers. Use the repository's deployment dependency
inventory to determine the complete affected set; do not deploy unrelated functions blindly.

Rollback disables the provider factory/capabilities and new checkout creation, preserves money,
events/outbox/history and uncertain locks for reconciliation, and keeps manual transfers available.
No destructive migration or database rewrite is needed.
