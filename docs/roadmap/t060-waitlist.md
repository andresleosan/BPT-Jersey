# T060 - waitlist persistida

Estado: slice backend implementado y en revisión; no activa promociones, créditos, cobros ni producción.

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

No hay promoción/oferta automática, aceptación de cupo, expiración programada, reordenamiento, créditos, recurrencia, cobros, mensajes, proveedor, UI final, datos reales, credenciales, gasto, migración ni despliegue.

## Rollback

El esquema es aditivo. El rollback retira exports/callables y el store de waitlist. Los fixtures del Emulator son desechables; cualquier limpieza futura en producción requeriría T011 y confirmación explícita.
## Evidencia focal

- Unitarias de dominio/store/callables: 25/25.
- Firestore Emulator del store: 2/2; Rules direct-deny: 7/7.
- E2E real Auth + Functions + Firestore Emulator: 5/5 repeticiones sin retries.
- Artefacto local de Functions carga `joinWaitlist`, `cancelWaitlistEntry`, `listStudentWaitlist` y `listSessionWaitlist`.