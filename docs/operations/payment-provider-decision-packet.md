# T010 Payment Provider Decision Packet

Status: blocked; synthetic draft only, awaiting real Jersey availability, commercial terms, cost controls, and explicit operator approval.

Prepared: 2026-08-25

## Scope

T010 covers a post-pilot payment provider for hosted checkout and signed, idempotent webhooks.
The current pilot remains manual: cash, bank_transfer, or other records only. No provider account,
credential, checkout, webhook, refund, tax automation, or production payment is authorized by this packet.

## Non-negotiable boundaries

- Keep payment details out of the BPT Jersey client and backend; use hosted checkout and a provider-independent adapter.
- Require signed webhook verification, idempotency, replay protection, audit events, and fail-closed error handling.
- Do not treat provider marketing claims as proof of Jersey availability, data residency, legal compliance, or child-data suitability.
- T011 must remain unresolved for production data retention, residency, transfers, deletion, backups, and legal wording.
- Any real selection requires an official quote, current terms, data-processing terms, operator approval, and a documented rollback.

## Synthetic candidate matrix (fictitious; replace before acceptance)

All names, fees, volumes, and capabilities in this table are invented placeholders. They are not provider
recommendations and must not be used to open an account or process money.

| Candidate (f)           | Hosted checkout | Webhook signing      | Synthetic fee assumption | Synthetic monthly range | Billing alert  |
| ----------------------- | --------------- | -------------------- | ------------------------ | ----------------------- | -------------- |
| Provider Northstar (f)  | yes             | yes                  | 1.5% + GBP 0.20          | GBP 0-50                | not configured |
| Provider HarbourPay (f) | yes             | yes                  | 1.8% + GBP 0.15          | GBP 0-60                | not configured |
| Provider IslandGate (f) | yes             | pending verification | 2.0% + GBP 0.25          | GBP 0-70                | not configured |

Example only: at 200 synthetic transactions/month and GBP 80 average ticket, the illustrative
processing volume is GBP 16,000. Replace this arithmetic with the provider's current Jersey quote,
fixed fees, chargeback/refund costs, currency treatment, and tax/accounting impact before any decision.

## Cost-intelligence finding

- Severity: medium cost finding. No provider account or billing alert exists today, so no spend is occurring.
- Before activation, configure a provider spending alert or equivalent account control and a Google Cloud/Cloudflare budget notification where applicable.
- A billing alert is not a hard cap. The operator must define a monthly ceiling and an escalation owner.

## Required real-world reply

Provider: <legal provider name and Jersey availability evidence>
Official pricing/quote date: <date and source>
Hosted checkout and webhook signing: <evidence>
Data processing/region/transfer terms: <evidence; coordinate with T011>
Monthly ceiling and alert owner: <amount and role>
Rollback: <disable checkout, revoke webhook, preserve manual ledger>
Approver/role: <name or operator role>

## Promotion gate

Keep T010 blocked until every field above is completed from current provider documentation or an official
quote. Then update the ADR, STACK.md cost section, adapter contract, tests, and tasks.md evidence.
Do not mark T010 approved from this synthetic packet alone.

## T034 synthetic adapter evidence (2026-08-26)

The provider-independent adapter is implemented locally in `packages/domain/src/payments/` and
`apps/functions/src/payments/`. It accepts only a strict GBP checkout contract, excludes card data,
requires HTTPS checkout URLs, normalizes malformed provider output to a failed result, and deduplicates
requests by tenant and idempotency key. The default `unconfigured` provider records no external call
and has an estimated committed cost of USD 0/month.

This does not select or verify a real provider, create credentials, open checkout, process money, or
satisfy T010. T035 hosted checkout and T036 signed webhooks remain pending until T010 is resolved.
