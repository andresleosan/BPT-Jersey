# T056 — Acta del piloto controlado (borrador)

Estado: borrador preparado para firma del operador. Este documento no constituye una aprobación
de producción, de entorno live/staging ni de la política legal T011.

## Identificación

| Campo | Valor |
| --- | --- |
| Fecha de ejecución técnica | 2026-08-25 |
| Entorno | Workspace local; servidor estático en `127.0.0.1:3100` y Firebase Emulator para Rules |
| Datos | Fixtures sintéticas; no se usaron datos de miembros, pagos ni proveedores reales |
| Responsable técnico | Cronos (ejecución automatizada) |
| Responsable operativo | Pendiente de completar por el operador |
| Decisión | Pendiente de firma y aceptación explícita del operador |

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

T056 puede pasar a `aprobada` únicamente cuando el operador complete los campos siguientes, revise la
evidencia y confirme por escrito la decisión. La aprobación debe indicar expresamente si solo cubre el
piloto sintético o si autoriza un ensayo en staging dedicado.

| Campo de aceptación | Completar por operador |
| --- | --- |
| Nombre y rol del aprobador | ______________________________ |
| Fecha y zona horaria | ______________________________ |
| Entorno autorizado | ______________________________ |
| Incidencias aceptadas y severidad | ______________________________ |
| Hallazgos que deben corregirse antes del siguiente gate | ______________________________ |
| Decisión (`aceptar`, `aceptar con reservas`, `rechazar`) | ______________________________ |
| Firma o referencia verificable | ______________________________ |

## Próximos pasos bloqueados

1. Completar y firmar esta acta sin inventar identidad, fecha de aprobación ni resultados live/staging.
2. Resolver T011 y confirmar el entorno staging dedicado antes de reintentar las pruebas omitidas.
3. Reabrir T055/T056 si aparecen fallos o hallazgos durante staging; mantener T057 en borrador hasta
   superar sus gates.


## Ejemplo de llenado sintético (f) — no es una firma

Estos valores solo muestran cómo podría completarse el formulario durante un
ensayo controlado. No identifican a un operador real ni cambian el estado de
T056: `revision`.

- Responsable operativo (f): Alex Morgan, Academy Operations Lead.
- Fecha y zona horaria (f): 2026-08-25, Europe/Jersey.
- Entorno autorizado (f): Emulator local + staging aislado `synthetic-only`.
- Decisión (f): aceptar con reservas para piloto sintético; no autorizar live,
  producción, pagos ni datos reales.
- Firma o referencia verificable: pendiente; debe completarla el operador real.