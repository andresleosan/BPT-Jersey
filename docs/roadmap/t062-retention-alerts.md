# T062 - contrato provisional de alertas de retencion

Estado: slice de dominio en revision; no activa CRM, mensajes externos ni produccion.

Fecha: 2026-08-27 (America/Bogota)

## Alcance

El contrato recibe proyecciones canonicas de estudiantes activos, membresia vigente y asistencia. Produce alertas internas para staff, sin leer contactos, sin enviar mensajes y sin crear una segunda fuente de verdad.

Triggers soportados:

- `attendance_gap`: no hubo asistencia `attended` o `late` dentro de la ventana de inactividad.
- `repeated_no_show`: el estudiante alcanza el umbral configurado de `no_show` dentro del lookback.
- `membership_expiring`: la membresia vigente termina dentro del horizonte configurado.

La politica se entrega explicitamente en cada evaluacion: `inactivityDays`, `lookbackDays`, `noShowThreshold` y `membershipExpiryDays`. Se rechazan rangos invalidos, datos cross-tenant, estudiantes duplicados, fechas futuras malformadas y snapshots inconsistentes.

## Invariantes

- Solo se generan alertas para estudiantes activos con membresia activa.
- Eventos futuros se ignoran; no pueden fabricar riesgo retrospectivo.
- Cada alerta incluye `reasonCode`, evidencia minima y `deduplicationKey` determinista.
- Repetir exactamente la misma entrada produce la misma salida y no muta los snapshots.
- La salida no incluye email, telefono, nombre, membership ID, invoice ID, mensaje libre ni datos de contacto.
- El resultado es una proyeccion read-only; la persistencia, asignacion a staff y cierre manual quedan fuera.

## Pendientes

- Persistir la bandeja tenant-scoped mediante una operacion idempotente y auditada.
- Definir quien puede ver, asignar, snoozear y cerrar alertas.
- Conectar fuentes canonicas de asistencia y membresia en Functions sin duplicar estado.
- Cubrir Firestore Emulator, Rules y E2E responsive con fixtures sinteticos.
- Diferir email/SMS y cualquier proveedor hasta resolver T046, consentimiento, costes y T011.
