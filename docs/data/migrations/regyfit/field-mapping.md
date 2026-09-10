# Regyfit field mapping

These are proposed mapping examples, not approved production mappings. The initial
controlled discovery observed module routes without source entities or fields; the
follow-up capture below adds one real source snapshot. Every target contract,
transformation, and permission still requires review. `pending` is not permission
to write.

| Source entity/field        | Target path                     | Strategy      | Sensitivity  | Transformation                                                     | Validation rule                                          | Approval status |
| -------------------------- | ------------------------------- | ------------- | ------------ | ------------------------------------------------------------------ | -------------------------------------------------------- | --------------- |
| students/recordStatus      | `students.status`               | direct        | internal     | Preserve the enumerated state                                      | Explicit source and target enum review                   | pending         |
| students/displayName       | `students.displayName`          | normalize     | confidential | Normalize whitespace and display casing                            | Metadata contract; no source row values in fixtures      | pending         |
| families/externalFamilyRef | `families.primaryContactUserId` | lookup        | confidential | Resolve a synthetic reference through the approved identity lookup | Reject unresolved or cross-academy references            | pending         |
| users/loginSecret          | `users.status`                  | exclude       | restricted   | Never copy the source field                                        | Exclusion is mandatory for authentication-related fields | pending         |
| payments/providerReference | `payments.providerReference`    | manual-review | restricted   | Hold for human reconciliation                                      | Require provider contract and audit evidence             | pending         |

## Follow-up real capture proposal

The operator-confirmed run `regyfit-20260808-acessos-01` captured 10 records from
`alunos-acessos`. The following mapping is approved for the restricted staging
snapshot only; it does not approve production or identity reconciliation:

| Source entity/field      | Target path                                             | Strategy      | Sensitivity | Transformation                                         | Validation rule                                                | Approval status |
| ------------------------ | ------------------------------------------------------- | ------------- | ----------- | ------------------------------------------------------ | -------------------------------------------------------------- | --------------- |
| `regyfit/alunos-acessos` | `academies/{academyId}/regyfitAccessRecords/{sourceId}` | manual-review | restricted  | Unwrap capture envelope, convert login count, normalize Jersey local login time to UTC, preserve missing member number as `null` | Source-ID idempotency, IP projection checks and import receipt | approved-staging-only |

## Mapping rules

- Only `direct`, `normalize`, `lookup`, `exclude`, and `manual-review` are
  permitted strategies.
- Excluded authentication-related fields have no destination write even when a
  placeholder target path is present in this contract example.
- Payment, document, safeguarding, consent, and audit fields require the BPT
  restricted-data review before any staging load.
- A missing target, unresolved relationship, or conflicting historical state is
  a rejection or manual-review item, never a silent guess.
- The proposed `regyfitAccessRecords` collection is not canonical identity data. Do
  not merge it into `students` or `users` until a reviewed identity reconciliation
  proves the relationship.
