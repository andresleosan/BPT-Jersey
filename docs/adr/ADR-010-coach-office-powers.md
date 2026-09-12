# ADR-010: los coaches comparten con la oficina el panel operativo

Fecha: 2026-09-12
Estado: aceptada (decision del operador en chat, 2026-09-12)

## Contexto

El panel `/admin` restringia a `coach` a Attendance y a `headCoach` a Attendance + Classes. Los
coaches piden ver el Overview del dia (con cumpleanos), operar la asistencia por clase, ver la cola
de inscripcion y mantener la etiqueta de referencia medica de 25 caracteres. Los callables detras
de cada pantalla estaban limitados a `owner | administrator`.

## Decision

Se abre a `headCoach` y `coach`:

- `listEnrolmentRequests` y `returnEnrolmentRequest` (ver la cola y devolver con nota).
- `saveHealthProfile` (guardar la etiqueta de referencia) y el nuevo `listHealthReferences`.
- Rutas `/admin`, `/admin/attendance`, `/admin/members/requests`, `/admin/members/medical`
  (`apps/web/src/app/admin/admin-routes.ts`).

No se abre:

- `getEnrolmentRequestDetail` ni `approveEnrolmentRequest`: siguen detras de
  `requireCanonicalMemberDirectoryActor` y de los cerrojos de ADR-009 (lector, aprobador, familias,
  escritor canonico). Se evaluo abrirlos y se descarto el 2026-09-12 por su coste y por lo que
  protegen.
- `getOperationalReport`: el reporte operativo incluye importes (`revenue.issuedMinor`,
  `receivedMinor`, `outstandingMinor`); sigue siendo de owner/administrator (T038). El Overview del
  coach no lo llama y oculta la metrica «Overdue memberships», las lineas de vencidas y no-shows de
  «Needs attention» y el enlace «Review finance».
- El directorio de miembros, finanzas, staff, retencion, `deactivateHealthProfile` y
  `reviewHealthProfileChangeRequest`.

## Consecuencias

- Cada accion del coach queda auditada con su `actorId`, como ya ocurre para la oficina.
- Un coach no ve membresias vencidas, importes ni facturas: su Overview muestra clases, llegadas
  pendientes, la tabla del dia y los cumpleanos.
- Ocultar botones en el cliente no es el control: la autorizacion se repite en cada callable, y
  los tests de callables fijan que rol pasa y cual no.
- Si en el futuro se abre la aprobacion a coaches, hara falta una sonda de cuenta activa para staff
  equivalente a la de `canonical-actor.ts` y una enmienda a ADR-009.
