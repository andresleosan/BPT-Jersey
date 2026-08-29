# T060 - waitlist persistida

Estado: slice backend y autoservicio mínimo en revisión; no activa promociones, créditos, cobros ni producción.

Fecha: 2026-08-28 (America/Bogota)

## Alcance aprobado

- Persistencia tenant-scoped en `waitlistEntries` con identidad determinista por sesión y estudiante.
- Join idempotente únicamente cuando la sesión existe, está `scheduled` y su capacidad confirmada está llena.
- La membresía debe existir en el mismo tenant, pertenecer al estudiante, estar `active` o `trial`, haber iniciado y no haber vencido.
- Posición asignada dentro de una transacción; listados acotados y ordenados.
- Cancelación idempotente del propio estudiante o por staff autorizado.
- Acceso público solo mediante callables con student-scope/RBAC; Firestore directo permanece denegado.
- Pruebas unitarias, Firestore Emulator, Rules y E2E real de callable con datos sintéticos.

## Fuera de alcance

No hay promoción/oferta automática, aceptación de cupo, expiración programada, reordenamiento, créditos, recurrencia, cobros, mensajes, proveedor, UI de staff/final operativa, datos reales, credenciales, gasto, migración ni despliegue.

## Slice UI aprobado

- Ruta autenticada `/account/waitlist` para adulto/tutor.
- Participantes derivados de memberships propias `active`/`trial` y sesiones futuras presentadas por nombre, fecha y sede; no se piden IDs internos.
- Listado por posición y estado, con cancelación explícita de entradas `waiting`.
- Estados accesibles `loading`, `error`, `empty` y feedback transaccional persistente tras refrescar.
- Sin UI de staff, oferta/aceptación, promoción, reordenamiento, créditos, recurrencia, booking automático, pagos ni mensajes.

## Rollback

El esquema es aditivo. El rollback retira exports/callables y el store de waitlist. Los fixtures del Emulator son desechables; cualquier limpieza futura en producción requeriría T011 y confirmación explícita.

## Evidencia focal

- Unitarias de dominio/store/callables: 25/25.
- Firestore Emulator del store: 2/2; Rules direct-deny: 7/7.
- E2E real Auth + Functions + Firestore Emulator: 5/5 repeticiones sin retries y 1/1 final tras autocrítica.
- Web focal: 23/23; `verify:mvp`: 172 archivos/1166 unitarias, 10 archivos/78 pruebas Rules, carga 240/240 y smoke 5 aprobadas/1 omitida.
- Artefacto local de Functions carga `joinWaitlist`, `cancelWaitlistEntry`, `listStudentWaitlist` y `listSessionWaitlist`.
- Audit: 0 high/critical; 2 moderadas transitivas limitadas a `firebase-tools` de desarrollo.
