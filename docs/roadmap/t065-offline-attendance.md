# T065 - Asistencia offline y conflictos

Estado: revision (slice de dominio y cola local tenant-scoped, 2026-08-31).

## Alcance implementado

- Parser estricto de eventos offline de check_in y check_out.
- Reconciliacion idempotente de reintentos exactos.
- Conflicto explicito para eventId con payload diferente.
- Conflicto explicito para misma sesion, estudiante y tipo con eventos distintos.
- Validacion de IDs, fechas, orden capturedAt/occurredAt y tipos permitidos.
- Salida inmutable y determinista; no hay resolucion silenciosa.
- Cola local agnostica de plataforma con almacenamiento inyectado y clave por academia/dispositivo.
- Reintento exacto idempotente; payload divergente, cruce de tenant/dispositivo y conflicto de misma
  sesion/tipo fallan cerrado sin sobrescribir la cola.
- Adaptador web opt-in sobre `localStorage`, sin wiring de red, Firestore ni ejecucion en servidor.

## Limites y dependencias abiertas

- No se agregaron sincronizacion de red, Firestore writes, UI, Rules/Emulator ni E2E de sincronizacion.
- La persistencia local queda disponible mediante almacenamiento inyectado; la politica operativa de
  resolucion, el adaptador productivo de dispositivo y el flujo autenticado de sync siguen pendientes.
- El contrato no decide cual evento gana ni corrige asistencia sin una politica aprobada.

## Evidencia

- `offline-contracts.test.ts`: 6/6.
- `offline-queue.test.ts`: 5/5 y adaptador web `offline-attendance-storage.test.ts`: 2/2.
- Regresion de dominio Levels/progreso/recordatorios: 48/48.
- `@bpt-jersey/domain` y `@bpt-jersey/web` typecheck: pasan.
- ESLint focalizado, Prettier y `git diff --check`: pasan.

## Seguridad y rollback

- La cola valida de nuevo todo el estado leído antes de devolverlo y nunca repara ni sobrescribe
  almacenamiento corrupto. Los errores del almacenamiento no exponen detalles internos.
- La clave es tenant/device scoped, pero `localStorage` no se considera un almacén cifrado. Este
  adaptador no se conecta a datos reales ni a producción hasta aprobar retención, dispositivo y
  política de privacidad.
- Rollback: retirar el adaptador y eliminar únicamente la clave local de pruebas; no se borran datos
  remotos ni se ejecutan migraciones.
