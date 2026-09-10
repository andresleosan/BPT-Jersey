# Regyfit source inventory

The first section records metadata observed during the controlled read-only
discovery session. It does not identify source entities or authorize reading or
storing source rows. `not observed` means that no field/entity evidence was
exposed in that initial session. The follow-up capture is documented separately
below and remains governed by the private staging handoff.

| Module              | Source route                                                    | Roles  | Actions | Fields | Evidence reference                         | Observation status |
| ------------------- | --------------------------------------------------------------- | ------ | ------- | ------ | ------------------------------------------ | ------------------ |
| admin2              | `/admin2/index.php`                                             | status | none    | none   | discovery-manifest.observed.sanitized.json | observed metadata  |
| mail_editor         | `/admin2/modulos/centro_comunica/mail_editor/index.php`         | none   | none    | none   | discovery-manifest.observed.sanitized.json | observed metadata  |
| quest_manager-php   | `/admin2/modulos/centro_comunica/mail_editor/quest_manager.php` | none   | none    | none   | discovery-manifest.observed.sanitized.json | observed metadata  |
| image_manager-php   | `/admin2/modulos/centro_comunica/mail_editor/image_manager.php` | none   | none    | none   | discovery-manifest.observed.sanitized.json | observed metadata  |
| video_tutoriais-php | `/admin2/modulos/updates/video_tutoriais.php`                   | none   | search  | none   | discovery-manifest.observed.sanitized.json | observed metadata  |

## Frame-only route observations

These routes appeared as embedded frames but did not expose usable metadata
signals in the read-only capture. They are not source entities or migration
fields:

| Route                                                     | Status                                |
| --------------------------------------------------------- | ------------------------------------- |
| `/admin2/modulos/centro_comunica/mail_editor/imagens.php` | route observed; metadata not observed |
| `/admin2/includes/icons_new2.php`                         | route observed; metadata not observed |
| `/admin2/scripts/duplica_semana_auto.php`                 | route observed; metadata not observed |

## Capability evidence

| Capability         | Status       | Evidence reference                         |
| ------------------ | ------------ | ------------------------------------------ |
| Official export    | not verified | discovery-manifest.observed.sanitized.json |
| Documented API     | not verified | discovery-manifest.observed.sanitized.json |
| Panel-only capture | observed     | discovery-manifest.observed.sanitized.json |

## Follow-up real capture

The initial discovery was metadata-only, but a later operator-confirmed Playwright run captured the
read-only `alunos-acessos` module. The raw records are outside this checkout under the runbook gate;
no values are stored in this inventory.

| Route                                       | Observed fields                                                                       | Run status                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `/admin2/modulos/alunos/acessos_alunos.php` | `Member`, `Member Nº`, `Logins`, `Last Login`, `IP`; 10 data rows with stable DOM IDs | 10 real records captured in `regyfit-20260808-acessos-01` |

The target collection and role projections were approved for the restricted staging
snapshot only. The import completed in `bptjersey-f5a25` for `demo-academy`; see
[`cronos-handoff.md`](cronos-handoff.md) for the sanitized receipt and rollback scope.
