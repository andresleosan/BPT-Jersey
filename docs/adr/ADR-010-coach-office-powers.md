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
- El nuevo `saveHealthReferenceLabel` (solo la etiqueta de 25 caracteres, sobre un perfil de salud
  ya activo) y el nuevo `listHealthReferences`, ambos con alcance de academia.
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
- `saveHealthProfile`: escribe el expediente completo, incluida la nota clinica
  (`conditionSummary`); sigue siendo de owner/administrator.
- El directorio de miembros, finanzas, staff, retencion, `deactivateHealthProfile` y
  `reviewHealthProfileChangeRequest`.

## Consecuencias

- Cada accion del coach queda auditada con su `actorId`, como ya ocurre para la oficina.
- Un coach no ve membresias vencidas, importes ni facturas: su Overview muestra clases, llegadas
  pendientes, la tabla del dia y los cumpleanos.
- Ocultar botones en el cliente no es el control: la autorizacion se repite en cada callable, y
  los tests de callables fijan que rol pasa y cual no.
- `listHealthReferences` y `saveHealthReferenceLabel` son de alcance de academia: cualquier staff
  ve y mantiene la etiqueta de cualquier alumno, a diferencia de `getHealthProfile`, que para
  headCoach y coach exige una asignacion vigente con ese alumno.
- Si en el futuro se abre la aprobacion a coaches, hara falta una sonda de cuenta activa para staff
  equivalente a la de `canonical-actor.ts` y una enmienda a ADR-009.

## Enmienda 2026-09-14

Decision del operador en chat (2026-09-14): `coach` y `headCoach` ven ademas **Classes** y **Levels**.
En Classes, `coach` solo lee (la pagina no muestra crear, editar, generar, cancelar ni eliminar);
`headCoach` conserva los poderes de `managerRoles`. No cambia ningun callable: `listClasses` ya era de
staff, `listSessions` de cualquier autenticado, y las mutaciones siguen en `managerRoles`. El
directorio de Members sigue cerrado a coaches; se evaluo abrirlo en lectura y se descarto por el coste
de ADR-009.

2026-09-16: la ruta de coach `/admin/classes` pasa a `/admin/classes-services` (Locations, Types y
Classes & Services 2.0 en solo lectura para `coach`).

## Enmienda 2026-09-16

Decision del operador en chat (2026-09-16, opcion 1 de tres): `listStaffProfiles` se abre en lectura a
`headCoach`. Devuelve solo la proyeccion segura (`staffKey`, rol, activo, estado), sin datos personales,
y es lo unico que la pagina Classes & Services 2.0 necesita para que un headCoach cree clases (el
formulario exige un entrenador). No se abre nada mas: `listMemberNames` y `listMemberships` siguen
siendo de owner/administrator, asi que la inscripcion de alumnos desde esa pagina queda en la
oficina (la interfaz lo indica con «Enrolment needs an office account»). Se evaluaron y descartaron la
apertura completa del directorio y un callable acotado de busqueda de alumnos con `membershipId`,
por el coste de ADR-009. El resto del directorio de staff (crear, editar, activar, disponibilidad,
asignaciones) no cambia.

## Enmienda 2026-09-17

Decision del operador en chat (grill G6 de `docs/superpowers/specs/2026-09-17-member-profile-e0-e2-design.md`):
`headCoach` y `coach` abren la ficha canonica de un alumno en `/admin/members/profile` y lo buscan
por nombre en `/admin/members/search`.

- `getMemberProfile` recorta en el servidor: owner/administrator reciben la ficha completa por la
  lectura restringida auditada (mismo presupuesto y accion `member.detail.read` que `getMemberDetail`);
  headCoach/coach reciben solo la cabecera (nombre, edad, tipo de participante, estado, aviso de
  cumpleanos), autorizados con la autorizacion de niveles (`resolveStudent`), sin identificadores,
  fecha de nacimiento, datos de DETAILS, membresia ni responsables. Guardian y adultStudent: denegado.
- `searchMemberNames` devuelve como maximo 20 `{ studentId, fullName }` por nombre para los cuatro roles
  de staff. No abre `listMembers`, `listMemberNames`, `lookupMemberIdentity` ni `getMemberDetail`, que
  siguen siendo de la oficina.
- La interfaz muestra al coach solo la pestana PROFILE (tarjeta IBJJF y Manage, E2). Ocultar pestanas
  no es el control: los tests de `member-profile-callables.test.ts` fijan el conjunto exacto de claves
  por rol.
