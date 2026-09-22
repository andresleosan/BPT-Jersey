# ADR-018: ninguna reserva automática de clases

Fecha: 2026-09-22. Estado: vigente.

## Decisión del operador

Ningún proceso reserva clases por un miembro sin que alguien lo pida. Una reserva sólo nace de
dos caminos:

1. El owner o un administrator registra al miembro en la sesión desde la oficina (`/admin`).
2. El miembro (o su tutor) reserva desde el área de miembros (`/account`), incluido el botón
   «Book all my classes», porque lo pulsa la persona.

Salvo la excepción explícita de grupos descrita abajo, quedan prohibidos: scripts de reserva masiva, triggers o tareas programadas que creen reservas
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
Si la llamada viene de un trigger, un `onSchedule` o un script, no se hace salvo la recurrencia de grupos expresamente autorizada abajo.


## Excepción autorizada: grupos registrados expresamente (2026-09-22)

El operador confirmó: «Permitir recurrencia del grupo tras la inscripción expresa del admin».
Un owner o administrator debe pulsar **Register group** en una sesión. Esta acción autoriza
esa sesión y las siguientes de la misma serie semanal, y guarda actor, fecha, alcance y
referencia a la autorización. Crear un grupo, dar de alta un miembro o activar un plan por sí
solos no autorizan ninguna reserva.

Los procesos de grupos solo continúan asignaciones con esa autorización. Cada fecha vuelve a
comprobar miembro, suscripción activa, acceso, cupo y límites. La baja de suscripción conserva
el grupo y muestra **Missing Payment**; una exclusión de una sesión no modifica el grupo ni
otras fechas y no se vuelve a inscribir automáticamente. Eliminar el grupo detiene nuevas
reservas, conservando las existentes. La asistencia PAYG exige el pago de esa clase.

Las reservas recurrentes se auditan como acciones del sistema y sus resultados enlazan la
autorización humana original. Por tanto, una IP nula por sí sola ya no indica una violación:
hay que comprobar que existe esa autorización y que coincide con el grupo y la serie.
