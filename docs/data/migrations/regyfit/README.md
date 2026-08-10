# Regyfit migration artifacts

This directory stores versioned contracts and sanitized metadata examples for the
Regyfit discovery and migration work. It is not an export, a backup, a staging
dump, or a place for source rows.

## Safety rules

- Use synthetic identifiers and metadata only in this directory.
- Keep real exports, attachments, screenshots, browser traces, and rejected rows
  in a private encrypted location outside `Dev/`, Git, and GitHub.
- Do not place credentials, authentication material, raw payment data, medical
  narratives, safeguarding notes, or personal records in repository artifacts.
- Treat the JSON and YAML files as examples pending review; they do not approve
  a live migration or a production write.

## Artifacts

- [`../README.md`](../README.md) is the Firestore/RTDB migration runbook and
  defines the mandatory migration register fields and environment gates.
- [`source-inventory.md`](source-inventory.md) is the metadata-only inventory
  contract for modules, routes, roles, actions, and fields.
- [`field-mapping.md`](field-mapping.md) records the proposed source-to-BPT
  mapping strategies and their approval state.
- [`discovery-manifest.example.json`](discovery-manifest.example.json) is a
  synthetic `RegyfitDiscoveryManifest` example with no row values.
- [`discovery-manifest.observed.sanitized.json`](discovery-manifest.observed.sanitized.json)
  contains the metadata-only result from the controlled browser session.
- [`migration-run.example.yaml`](migration-run.example.yaml) is a pending,
  emulator-only migration register example. It is not executable approval.

## Discovery status

The initial controlled read-only discovery phase observed the Regyfit admin shell
and several embedded module routes without retaining source values. A later
operator-confirmed run captured 10 real `alunos-acessos` records into the private
encrypted staging root outside `Dev/`. No official export or documented API was
verified.

The sanitized handoff is in [`cronos-handoff.md`](cronos-handoff.md). The operator
approved the restricted snapshot mapping for staging only. The staging run imported
10 documents into `bptjersey-f5a25` under `demo-academy`; the raw records remain
outside this checkout and are read only from `REGYFIT_PRIVATE_STAGING_ROOT`.
