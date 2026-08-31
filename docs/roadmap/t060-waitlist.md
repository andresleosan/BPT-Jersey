# T060 - waitlist persistida

Estado: oferta FIFO y booking transaccional en revisión; no activa promoción automática, créditos, cobros ni producción.

Fecha: 2026-08-30 (America/Bogota)

## Alcance aprobado

- Persistencia tenant-scoped en `waitlistEntries` con identidad determinista por sesión y estudiante.
- Join idempotente únicamente cuando la sesión existe, está `scheduled` y su capacidad confirmada está llena.
- La membresía debe existir en el mismo tenant, pertenecer al estudiante, estar `active` o `trial`, haber iniciado y no haber vencido.
- Posición asignada dentro de una transacción; listados acotados y ordenados.
- Cancelación idempotente del propio estudiante o por staff autorizado.
- Acceso público solo mediante callables con student-scope/RBAC; Firestore directo permanece denegado.
- Pruebas unitarias, Firestore Emulator, Rules y E2E real de callable con datos sintéticos.

## Fuera de alcance del primer slice

El primer slice no incluyó oferta, aceptación ni UI de staff; esas capacidades entraron después en el
corte actual aprobado. Continúan fuera promoción automática, expiración programada, reordenamiento,
créditos, recurrencia, cobros, mensajes, proveedor, datos reales, credenciales, gasto, migración y
despliegue.

## Slice UI inicial aprobado

- Ruta autenticada `/account/waitlist` para adulto/tutor.
- Participantes derivados de memberships propias `active`/`trial` y sesiones futuras presentadas por nombre, fecha y sede; no se piden IDs internos.
- Listado por posición y estado, con cancelación explícita de entradas `waiting`.
- Estados accesibles `loading`, `error`, `empty` y feedback transaccional persistente tras refrescar.
- Este slice inicial no incluyó UI de staff ni oferta/aceptación; el corte actual siguiente lo amplía
  de forma manual. Promoción automática, reordenamiento, créditos, recurrencia, pagos y mensajes
  siguen fuera.

## Corte actual aprobado

- `owner` y `administrator` pueden ofrecer manualmente el primer lugar `waiting` por `position` y
  `requestedAt`; `headCoach` y `coach` conservan lectura. El cliente nunca elige el estudiante.
- Solo hay una oferta activa por sesión. Reserva un cupo, dura 30 minutos como máximo y nunca pasa de
  una hora antes del inicio. El replay no extiende el vencimiento.
- Adulto/tutor autorizado acepta o declina desde `/account/waitlist`. La aceptación revalida tenant,
  sesión, membresía, plan/cuota, capacidad y T038, crea/restaura el booking confirmado de forma
  atómica y audita.
- La expiración se materializa bajo demanda; no hay scheduler, reencolado ni renumeración.
- Fuera del corte: promoción automática, notificaciones, créditos operativos, recurrencia, pagos,
  datos reales, migración, despliegue y producción.

## Rollback

El esquema es aditivo. El rollback retira exports/callables y el store de waitlist. Los fixtures del Emulator son desechables; cualquier limpieza futura en producción requeriría T011 y confirmación explícita.

## Evidencia focal

- Unitarias focales 75/75 y globales 174 archivos/1216 pruebas; typecheck de 6 proyectos.
- Firestore Emulator: 17/17 booking/ofertas y 3/3 waitlist base/restore; Rules 10 archivos/78 pruebas.
- E2E real Auth + Functions + Firestore Emulator: 6/6 desktop/mobile, un worker y sin retries.
- `verify:mvp`: formato, lint, typecheck, build de 31 rutas, unitarias, Rules, carga 240/240 sin fallos
  (p95 28 ms) y smoke 5 aprobadas/1 omitida.
- El artefacto local de Functions carga los callables de waitlist y booking sin imports workspace.
- Autocrítica independiente: 0 high/critical abiertos; audit: 2 moderadas y 0 high/critical.
