# T056 — Acta del piloto controlado (aprobada para piloto sintético)

Estado: aprobada para el piloto sintético. Esta aprobación no constituye una aprobación de producción, de entorno live/staging ni de la política legal T011.

## Identificación

| Campo | Valor |
| --- | --- |
| Fecha de ejecución técnica | 2026-08-25 |
| Entorno | Workspace local; servidor estático en `127.0.0.1:3100` y Firebase Emulator para Rules |
| Datos | Fixtures sintéticas; no se usaron datos de miembros, pagos ni proveedores reales |
| Responsable técnico | Cronos (ejecución automatizada) |
| Responsable operativo | Operador de esta sesión (identidad y rol no registrados en el workspace) |
| Decisión | Aceptar con reservas únicamente para piloto sintético; no autorizar live, staging, producción, pagos ni datos reales |

## Evidencia ejecutada

| Control | Comando o artefacto | Resultado |
| --- | --- | --- |
| Gate MVP | `corepack pnpm verify:mvp` | Correcto: formato, lint, typecheck, build, unitarias, Rules, E2E smoke y carga sintética |
| Unitarias | Incluidas en `verify:mvp` | 154 archivos / 1066 pruebas pasaron |
| Firebase Rules | Incluidas en `verify:mvp` | 8 archivos / 64 pruebas pasaron |
| Carga sintética | `corepack pnpm test:load:synthetic` | 240 solicitudes, concurrencia 24, 0 fallos; p50 31 ms, p95 41 ms, p99 47 ms, máximo 49 ms |
| E2E por rol | `NEXT_PUBLIC_ADMIN_E2E=true corepack pnpm --dir qa test:e2e` | 71 pasaron, 14 omitidos por live/staging u opt-in, 0 fallos |

## Alcance y controles

- Se ejercitaron únicamente flujos y fixtures sintéticos del MVP.
- No se ejecutaron despliegues, migraciones, restauraciones productivas ni llamadas a pagos o APIs
  externas.
- Las 14 pruebas omitidas son una limitación conocida: requieren live/staging o activación explícita.
- T011 (retención, residencia y borrado) sigue bloqueada hasta contar con la matriz aprobada por el
  operador y la asesoría aplicable a Jersey.
- No se registraron incidencias en la ejecución sintética. Los hallazgos pendientes son de alcance,
  no una declaración de conformidad productiva.

## Criterio de salida propuesto

T056 fue aprobada explícitamente por el operador únicamente para el piloto sintético, tras revisar la evidencia y las limitaciones registradas.
La aprobación no autoriza un ensayo en staging dedicado ni modifica los gates de T011.

| Campo de aceptación | Completar por operador |
| --- | --- |
| Nombre y rol del aprobador | Operador de esta sesión (identidad y rol no registrados en el workspace) |
| Fecha y zona horaria | 2026-08-27, America/Bogota |
| Entorno autorizado | Workspace local + Firebase Emulator; sin live/staging ni producción |
| Incidencias aceptadas y severidad | Ninguna en la ejecución sintética; 14 escenarios omitidos por requerir live/staging u opt-in |
| Hallazgos que deben corregirse antes del siguiente gate | T011, staging dedicado, costos/alertas y CI/CD protegido |
| Decisión (`aceptar`, `aceptar con reservas`, `rechazar`) | Aceptar con reservas únicamente para piloto sintético |
| Firma o referencia verificable | Aprobación explícita recibida en la sesión Codex del 2026-08-27 |

## Próximos pasos bloqueados

1. Aprobación registrada para el piloto sintético; no se autoriza producción, live/staging, pagos ni datos reales.
2. Resolver T011 y confirmar el entorno staging dedicado antes de reintentar las pruebas omitidas.
3. Reabrir T055/T056 si aparecen fallos o hallazgos durante staging; mantener T057 en revisión hasta
   superar sus gates.


## Registro de aprobación explícita — 2026-08-27

- Aprobador: operador de esta sesión (identidad y rol no registrados en el workspace).
- Fecha y zona horaria: 2026-08-27, America/Bogota.
- Entorno autorizado: workspace local + Firebase Emulator; no live/staging ni producción.
- Decisión: aceptar con reservas únicamente para piloto sintético.
- Firma o referencia verificable: aprobación explícita recibida en la sesión Codex del 2026-08-27.