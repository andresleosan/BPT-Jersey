# ADR-004: Firestore Aggregate Boundaries and Ephemeral RTDB Presence

- Status: Accepted for T013 implementation; operational values remain pending in T008-T011.
- Date: 2026-08-07.
- Scope: BPT Jersey Academy Platform MVP data boundaries.

## Context

The platform is a Level 3 multi-module system handling minors, families, staff, attendance, check-out, memberships, payments, progress, consent, safeguarding, audit, and private documents. It needs one canonical history, tenant isolation, queryable operational records, and a small real-time surface without creating a second source of truth.

## Decision

Use Cloud Firestore Standard as the canonical store. Place academy data under `academies/{academyId}` and keep `academyId` in every operational document as a defensive tenant check. Keep domain entities in separate direct subcollections: identity, scheduling, attendance, commercial, development, CRM/communication, and restricted governance. Use deterministic IDs for booking and attendance records keyed by `sessionId__studentId`.

Use Realtime Database only for expiring presence at `academies/{academyId}/presence/{sessionId}/{studentId}`. Presence may contain `state`, `lastSeenAt`, and `sessionVersion`; it cannot contain canonical attendance, payments, memberships, progress, consent, audit, health, or safeguarding data and cannot restore Firestore.

Keep the application as a modular monolith. Backend transactions and idempotency enforce capacity, booking uniqueness, attendance uniqueness, checkout state, and append-only event behavior. Final role Rules belong to T016; final operational values belong to T008; payment provider details belong to T010; retention/residency/deletion belong to T011.

## Alternatives rejected

1. RTDB as the primary database: rejected because payment, attendance, consent, and audit history need Firestore transactions, query contracts, and durable canonical records.
2. Embedding all students, relationships, or bookings in family/session documents: rejected because arrays would grow without a safe ownership boundary and would make independent queries and corrections harder.
3. Separate database per module or microservices: rejected because the current product has one academy, one team, and no independent scaling or deployment requirement.
4. Eagerly indexing every field: rejected because compound indexes are added only for documented queries.

## Consequences

The model is consistent across modules and supports later Rules, audit, and migration work. Queries require a documented owner and index. Restricted collections need separate access checks and exports. RTDB data loss is acceptable because it is ephemeral; Firestore data loss is not and requires verified backup/restore procedures.

## Revisit conditions

Revisit this ADR only if the product adds independent tenant-scale requirements, offline canonical attendance, a measured real-time need beyond presence, or a verified operational reason to split services. Do not revisit it to encode unapproved T008/T010/T011 values.
