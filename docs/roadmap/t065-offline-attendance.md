# T065 - Asistencia offline y conflictos

Estado: revision (slice de dominio, 2026-08-27).

## Alcance implementado

- Parser estricto de eventos offline de check_in y check_out.
- Reconciliacion idempotente de reintentos exactos.
- Conflicto explicito para eventId con payload diferente.
- Conflicto explicito para misma sesion, estudiante y tipo con eventos distintos.
- Validacion de IDs, fechas, orden capturedAt/occurredAt y tipos permitidos.
- Salida inmutable y determinista; no hay resolucion silenciosa.

## Limites y dependencias abiertas

- No se agregaron sincronizacion de red, Firestore writes, UI ni persistencia de cola.
- Adaptador de dispositivo, politica operativa de resolucion, persistencia tenant-scoped, Rules/Emulator y E2E siguen pendientes.
- El contrato no decide cual evento gana ni corrige asistencia sin una politica aprobada.

## Evidencia

- offline-contracts.test.ts: 6/6.
- Regresion de dominio Levels/progreso/recordatorios: 48/48.
- @bpt-jersey/domain typecheck: pasa.
- ESLint focalizado, Prettier y git diff --check: pasan.
