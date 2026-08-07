# T007 Security Model Design

## Objective

Define the preliminary security model that must exist before domain contracts, data storage, authorization rules, consent handling, audit logging, restricted medical data, private files, or safeguarding communication are implemented.

The implementation deliverable will be `docs/security/data-classification-threat-model-access-matrix.md`.

## Scope

The document will cover:

1. Scope, assumptions, and legal limitations.
2. Data classification levels.
3. MVP data inventory by business domain.
4. Actors, assets, trust boundaries, threats, and abuse cases.
5. Preliminary role-based access matrix.
6. Mandatory controls and prohibited behavior.
7. Open risks and decisions requiring external confirmation.
8. Traceability to later implementation tasks.

It will remain technology-independent. Firestore collections, custom claims, Firebase Rules, R2 object paths, and concrete API contracts belong to later tasks.

## Classification Model

The model has four levels:

- `Public`: information deliberately published for unrestricted access.
- `Internal`: non-sensitive academy operations that must not be public.
- `Confidential`: identity, contact, membership, assessment, CRM, and administrative financial data.
- `Restricted`: child, health, safeguarding, consent, authorized collection, credential, payment, and audit data requiring the strongest controls.

Classification is based on the most sensitive field in a record or payload. A derived value inherits the source classification unless the document explicitly justifies declassification.

## Security Principles

- Deny access by default and grant the minimum necessary privilege.
- Scope access by role, family relationship, class assignment, and operational purpose.
- Do not create authenticated accounts for minors in the MVP.
- Require an authorized backend and immutable audit evidence for sensitive actions.
- Keep payments, promotions, safeguarding decisions, and access corrections under authorized human control.
- Prevent hidden private communication between coaches and minors; the guardian must retain visibility.
- Preserve financial, membership, consent, attendance, and assessment history rather than relying on destructive deletion.

## Threat Model

Threats will be organized using STRIDE, supplemented with domain abuse cases involving:

- Unauthorized family or cross-student access.
- Staff privilege escalation or stale access after deactivation.
- Unsafe child check-out or falsified attendance.
- Exposure of medical, safeguarding, waiver, or assessment information.
- Forged or replayed payment and integration events.
- Hidden coach-to-minor communication.
- Bulk export, scraping, enumeration, and account abuse.
- Audit-log alteration and denial of accountability.

Each threat will identify affected assets, plausible impact, baseline mitigations, residual risk, and the task responsible for technical enforcement.

## Access Matrix

The actors are:

- `owner`
- `administrator/reception`
- `head coach`
- `coach`
- `parent/guardian`
- `adult student`
- `system/integration`

Minors are represented as protected data subjects, not authenticated actors.

For each MVP domain, the matrix will distinguish read, create, update, approve, export, and delete/retain capabilities. Access will be marked as full, relationship/assignment-scoped, or prohibited. Sensitive field exceptions will override broad record-level access.

## Validation

T007 can move to approval only when:

- Every MVP data category has a classification.
- Every role has explicit access boundaries.
- Child, health, payment, consent, safeguarding, and audit data have reinforced controls.
- No critical threat remains without a mitigation or an explicit blocking follow-up.
- Legal and jurisdictional questions remain labeled as assumptions rather than compliance claims.
- Future technical controls map to existing tasks, especially `T013`, `T016`, `T018`, `T019`, `T023`, `T024`, and `T047`.
- The document contains no unresolved placeholders or contradictory access grants.

## Verification Approach

Verification is documentary rather than runtime-based for this task:

- Cross-check coverage against `BRIEF.md`, `STACK.md`, and `tasks.md`.
- Search for unclassified MVP domains and roles.
- Check the access matrix for privilege conflicts and missing negative rules.
- Apply the `security-baseline` checklist and record any residual findings.
- Run formatting and repository consistency checks before changing `T007` from `pendiente`.
