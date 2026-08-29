# T062 - bandeja persistida de alertas de retención

Estado: slice implementado y en revisión; no activa CRM, mensajes externos ni producción.

Fecha: 2026-08-28 (America/Bogota)

## Alcance implementado

El contrato de dominio sigue evaluando proyecciones canónicas de estudiantes activos, membresía vigente y asistencia para producir tres señales internas y explicables: `attendance_gap`, `repeated_no_show` y `membership_expiring`.

Este slice agrega una bandeja in-app persistida y tenant-scoped:

- El backend de confianza valida lotes de hasta 200 alertas, usa un ID y una clave de deduplicación deterministas y persiste mediante transacciones idempotentes.
- Un reintento idéntico queda `unchanged`; el mismo ID con contenido distinto falla cerrado y no sobrescribe evidencia.
- La consulta se ordena por `createdAt` descendente y devuelve como máximo 200 alertas.
- `listRetentionAlerts` acepta solo payload `null`, deriva el tenant del actor autenticado y permite lectura únicamente a `owner` y `administrator`.
- La respuesta minimizada expone una referencia sintética de estudiante, señal, severidad, estado, evidencia mínima y fecha; omite `academyId`, `studentId`, `alertId`, contactos y claves de deduplicación.
- Firestore Rules niega toda lectura y escritura directa de `retentionAlerts` a clientes, incluidos owner y administrator.
- `/admin/retention` ofrece una bandeja read-only responsive con estados de carga, error y vacío, sin acciones de mutación.

## Datos y seguridad

`retentionAlerts` es una proyección derivada `Restricted`, no una nueva fuente de verdad. Cada documento conserva `alertId`, `academyId`, `studentId`, `kind`, `severity`, `status`, `reasonCode`, evidencia mínima, `deduplicationKey`, `createdAt` y `schemaVersion`. El origen canónico continúa en asistencia, estudiantes y membresías.

Las entradas rechazan campos desconocidos, identificadores inválidos, fechas de calendario imposibles, lotes excesivos, datos cross-tenant, duplicados y alteraciones de un registro ya persistido. No se almacenan nombres, email, teléfono, texto libre, IDs financieros, credenciales ni secretos.

## Evidencia

- Servicio/callable focalizado: 15/15.
- Cliente web: 8/8.
- Firestore Emulator del store: 1/1.
- Firestore Rules completa: 71/71, incluida la frontera T062 7/7.
- E2E sintético responsive: 2/2 desktop/móvil.
- E2E real Auth + Functions + Firestore Emulator: 2/2 desktop/móvil.
- Runtime de despliegue: 2/2 y artefacto regenerado con `listRetentionAlerts` exportada.
- Typecheck Functions/Web/QA, ESLint focalizado, build web, audit sin high/critical y `git diff --check`: aprobados.

El gate global `corepack pnpm verify:mvp` pasa con 1139/1139 unitarias, 71/71 Rules, carga sintética 240/240 sin fallos (p95 32 ms) y smoke E2E 5 aprobadas/1 omitida esperada.

## Fuera de alcance y pendientes

- No existe todavía un productor automático conectado a asistencia/membresías ni auditoría persistida de esa ejecución.
- Asignar, snoozear, cerrar o eliminar alertas sigue fuera de alcance; la UI y callable son read-only.
- No se implementaron email, SMS, CRM externo, proveedor, datos reales, credenciales, gasto, migración ni despliegue.
- App Check, rate limiting persistente por actor y la política definitiva de retención/eliminación de T011 siguen siendo gates de producción.

## Rollback

El cambio es aditivo y no requiere migración. El rollback consiste en retirar la ruta y callable, deshabilitar el productor de confianza futuro y dejar los documentos derivados inertes. Cualquier limpieza productiva queda sujeta a T011 y a confirmación explícita; este slice no ejecuta borrados.
