# T062 - bandeja persistida y productor interno de alertas de retención

Estado: productor interno implementado y en revisión; no está conectado a ningún endpoint, trigger, scheduler ni despliegue.

Fecha: 2026-08-31 (America/Bogota)

## Alcance implementado

El contrato de dominio evalúa proyecciones canónicas de estudiantes activos, membresía vigente y asistencia para producir tres señales internas y explicables: `attendance_gap`, `repeated_no_show` y `membership_expiring`.

La bandeja in-app existente conserva estas garantías:

- `retentionAlerts` es una proyección `Restricted`, tenant-scoped y reconstruible; no sustituye asistencia, membresías ni perfiles.
- El callable de lectura acepta solo payload `null`, deriva el tenant del actor y autoriza únicamente a `owner` y `administrator`.
- Firestore Rules niega toda lectura y escritura directa de `retentionAlerts` a clientes.
- `/admin/retention` sigue siendo read-only; no asigna, cierra, elimina ni envía alertas.

## Productor interno auditado

`createRetentionAlertProducer` se construye por inyección de dependencias y no se exporta desde `apps/functions/src/index.ts`. Su única entrada temporal es un `runDate` `YYYY-MM-DD`, normalizado a `00:00:00.000Z`, por lo que la idempotencia está definida por día UTC.

La fuente Firestore lee solo proyecciones mínimas y acotadas de una academia:

- Membresías `trial|active` con `limit(201)`; más de 200 bloquea el run. `startsAt` debe ser anterior o igual al instante efectivo y `endsAt` debe ser nulo o posterior.
- Estudiantes referenciados mediante `getAll` y `fieldMask` de `studentId`, `academyId`, `active` y `status`; referencias ausentes, duplicadas o cross-tenant fallan cerrado.
- Asistencia desde el lookback con `limit(5001)`; el mismo máximo global de 5000 se exige también a fuentes inyectadas. La proyección valida `sessionId`, `studentId`, `schemaVersion: "1"` y la identidad canónica `{sessionId}__{studentId}`; una corrección opaca debe apuntar exactamente a esa identidad.
- Solo documentos canónicos con `correctionOf === null` alimentan alertas. Correcciones, `excused`, eventos futuros, registros de otros estudiantes y asistencia anterior al inicio de la membresía vigente no cuentan.
- El inicio de la membresía es el baseline cuando no existe asistencia; una membresía reciente no produce un falso `attendance_gap`.
- Las colecciones se consultan con índices simples; T062 no agrega índice compuesto.

Los umbrales se inyectan con cada run. Los valores `14/30/2/14` pertenecen a fixtures sintéticos y no son defaults productivos.

## Identidad, replay y atomicidad

La identidad v2 usa segmentos length-prefixed y no transforma delimitadores:

- `alertId`: `retention-v2__<academyLength>_<academyId>__<kindLength>_<kind>__<studentLength>_<studentId>__<runDate>`.
- `deduplicationKey`: `v2:<kindLength>:<kind>:<studentLength>:<studentId>:<runDate>`.
- `auditEventId`: `retention-production-v1__<academyLength>_<academyId>__<runDate>`.

Así, identificadores como `a:b` y `a__b` no colisionan. `createdAt` siempre es el instante UTC canónico del run.

El productor calcula SHA-256 sobre una serialización canónica y minimizada de academia, día, política y snapshots ordenados. El hash no incluye nombre, email, teléfono, notas, family ID, membership ID, actores ni payload libre.

Alertas y un evento append-only `retention.alerts.generated` se preflightan y crean en la misma transacción:

- Actor fijo: `system-retention-producer`.
- Metadatos exactos: `runDate`, `policyVersion`, `evaluatedStudents`, `alertCount`, los cuatro umbrales y `sourceHash`.
- Replay exacto: ninguna duplicación y resultado `replayed`.
- Replay divergente, alerta alterada/ausente tras auditoría, identidad inconsistente o fallo al crear auditoría: conflicto y cero escrituras parciales.
- Máximo: 200 alertas más una auditoría en una transacción.

## Evidencia verificada

- TDD RED: las pruebas reprodujeron los defectos de identidad/tiempo, atomicidad y módulo ausente; la autocrítica añadió RED para asistencia previa a membresía, límite global, proyección canónica, `trial|active`, acción auditada y contrato público.
- Regresión focal GREEN: 49/49 en dominio, auditoría, store, productor, fuente y callable; el contrato público adicional pasa 12/12 (61/61 combinadas).
- Firestore Emulator: 5/5; incluye concurrencia exacta, replay divergente, fallo de auditoría sin alertas parciales, aislamiento del store y lote máximo de 200 alertas + 1 auditoría.
- Firestore Rules específica: 7/7 para denegar lectura, listado, creación, actualización y borrado directo a todos los roles cliente.
- Typecheck de Domain, Functions y QA: aprobado.
- Gate global `corepack pnpm verify:mvp`: formato, lint, typecheck y build aprobados; 175 archivos/1237 unitarias, Rules 78/78, carga sintética 240/240 sin fallos (p95 31 ms) y smoke E2E 5/5 con 1 omisión esperada.
- Seguridad: 0 firmas de secretos; audit con 0 high/critical y las 2 moderadas transitivas preexistentes registradas en DR-001.

## Runner manual local

El runner `apps/functions/src/retention/retention-alert-producer-runner.ts` permite una corrida manual y reversible del productor, solo contra el Firestore Emulator demo. Exige los seis parametros de entrada (`academyId`, `runDate` y los cuatro umbrales), valida sus limites y rechaza cualquier entorno distinto de `GCLOUD_PROJECT=demo-bpt-jersey` con `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`.

Para ejecutarlo se debe preparar el runtime aislado local y mantener `DEBUG` desactivado para que Firebase CLI no imprima el entorno heredado:

```powershell
Remove-Item Env:DEBUG -ErrorAction SilentlyContinue
corepack pnpm --filter @bpt-jersey/domain build:runtime
corepack pnpm exec node apps/functions/scripts/build-deploy-artifact.mjs
$env:GCLOUD_PROJECT = "demo-bpt-jersey"
corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore "node .firebase-functions/lib/src/retention/retention-alert-producer-runner.js --academy-id synthetic-empty --run-date 2026-09-01 --inactivity-days 14 --lookback-days 30 --no-show-threshold 2 --membership-expiry-days 14"
```

La corrida de verificacion del 2026-08-31 termino con codigo 0, fecha UTC canonica, 0 estudiantes, 0 alertas, hash determinista y una auditoria atomica en el Emulator. El runner no se exporta desde `index.ts`, no crea endpoint, trigger, scheduler, proveedor, secreto, migracion ni despliegue.
## Seguridad y límites conocidos

- No existe mutación pública, export runtime, scheduler, red externa, CRM, email, SMS, datos reales, credenciales, gasto, migración ni despliegue.
- La lectura de fuentes ocurre antes de la transacción de commit; un cambio concurrente cambia el hash y será detectable en otro run, pero no ofrece snapshot isolation entre colecciones.
- Una condición persistente crea otra alerta abierta en un nuevo `runDate`; cierre, archivo, episodios y cleanup dependen de una tarea posterior y de T011.
- La frontera diaria está fijada en UTC; una futura operación automática deberá decidir explícitamente la zona `Europe/Jersey`.
- La bandeja devuelve `studentReference`, que actualmente contiene el ID interno opaco del estudiante. No expone contacto ni PII directa, pero este identificador debe pseudonimizarse antes de habilitar datos reales o producción; documentarlo no sustituye ese gate.
- App Check, rate limiting del callable, política productiva y habilitación operativa siguen bloqueados por T011/T057.

## Rollback

El cambio es aditivo y no requiere migración. Como el productor no tiene wiring runtime, el rollback de código consiste en retirar el módulo, la operación transaccional y la variante de auditoría. Los documentos creados solo en Emulator se limpian al finalizar las pruebas. Cualquier limpieza futura de datos reales requiere T011, plan de reversión y confirmación explícita del operador.
