# ADR-018: ninguna reserva automática de clases

Fecha: 2026-09-22. Estado: vigente.

## Decisión del operador

Ningún proceso reserva clases por un miembro sin que alguien lo pida. Una reserva sólo nace de
dos caminos:

1. El owner o un administrator registra al miembro en la sesión desde la oficina (`/admin`).
2. El miembro (o su tutor) reserva desde el área de miembros (`/account`), incluido el botón
   «Book all my classes», porque lo pulsa la persona.

Quedan prohibidos: scripts de reserva masiva, triggers o tareas programadas que creen reservas
(por grupo, por plan, por inscripción o por cualquier otra regla) y cualquier «reservar por
defecto» al alta de un miembro. La promoción desde la lista de espera no cuenta: el miembro pidió
ese sitio.

## Qué cambió

- Se retira `qa/scripts/member-unification-bulk-book.mjs` (reservas automáticas de kids y teens
  con plan vigente, 22-sep) y sus lanzadores. Las 110 reservas futuras que creó se cancelaron el
  mismo día con motivo «Automatic booking withdrawn»; las reservas de sesiones ya empezadas se
  conservan como historial.
- Toda reserva creada desde un script quedaba en la auditoría con `actorIp: null`; una reserva
  hecha por una persona siempre trae IP. Ese es el rastro para detectar una violación.

## Cómo aplicarla

Antes de escribir código que llame a `requestBooking` / `confirmBookingInTransaction`, comprobar
que el actor es una persona en una petición (owner/administrator en oficina, o el propio miembro).
Si la llamada viene de un trigger, un `onSchedule` o un script, no se hace.
