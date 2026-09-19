# T122 — Vincular un miembro creado por office con su propia cuenta

**Fecha:** 2026-09-06
**Estado:** diseño, sin implementar. Requiere confirmación del operador antes de escribir código, porque toca el writer canónico.
**Origen:** auditoría en paralelo del camino de aprobación de T121 (seis lectores + crítico), 2026-09-06.

## 1. El defecto, verificado

Hoy la plataforma no tiene forma soportada de que un estudiante creado por office quede ligado a la
cuenta con la que esa misma persona inicia sesión. No es una carencia de T121: existe ya.

- `buildStudent` del writer canónico escribe el estudiante **sin `userId` y sin `familyId`**, y
  `buildKeys` solo reserva claves de identidad para `membership-number`, `id-card-number` y
  `vat-number` — nunca `auth-user-id`:
  `apps/functions/src/members/canonical-member-directory-service.ts:273-301` y `:335-366`.
- `saveClientProfile` no vincula un estudiante existente: **crea uno**. Busca al titular con
  `students where userId == uid` y, al no encontrar nada, acuña un `studentId` nuevo, una familia
  propia determinista, el documento `users/{uid}`, la clave `auth-user-id` y su propia auditoría:
  `apps/functions/src/profiles/profile-service.ts:617-620`, `:596`, `:781-786`, `:815-829`,
  `:871-882`.

Como la consulta se hace por `userId` y el alta administrativa nunca lo escribe, **ninguna de las
dos rutas puede adoptar el registro de la otra**.

### Consecuencia observable

1. Office da de alta a una persona (ficha con waiver, contacto de emergencia, dirección, número de
   socio) — sin `userId`.
2. Esa persona inicia sesión y entra a `/account/profile`
   (`apps/web/src/app/account/page.tsx:36`, `apps/web/src/app/account/profile/page.tsx:140`).
3. `saveClientProfile` no la encuentra y **crea una segunda ficha**: una con los datos y sin acceso,
   otra con el acceso y sin los datos.
4. Nada lo detecta. La única garantía de unicidad en ese camino es la clave `auth-user-id`, que el
   alta administrativa nunca acuñó.

## 2. Por qué esto bloquea T121

El corte 2 de T121 (aprobar una solicitud) haría exactamente los pasos 1 y 2 de esa secuencia, uno
detrás del otro y por diseño: crear la ficha desde la solicitud y ascender el claim para que la
persona entre. La aprobación no _tendría_ el defecto: lo **dispararía en cada aprobación**.

Por eso T122 va antes. Con el vínculo cerrado, la aprobación de T121 es corta; sin él, es dañina.

## 3. Lo que ninguno de los dos writers da por sí solo

| Necesario en el registro                                                     | `createAdminAdult` | `saveClientProfile` |
| ---------------------------------------------------------------------------- | ------------------ | ------------------- |
| Estudiante canónico                                                          | sí                 | sí                  |
| `userId` y familia propia                                                    | **no**             | sí                  |
| Clave de identidad `auth-user-id`                                            | **no**             | sí                  |
| Documento `users/{uid}` de cliente                                           | **no**             | sí                  |
| Perfil administrativo (género, nº socio, documento, IVA, nota de frecuencia) | sí                 | **no**              |
| Contacto de emergencia y dirección postal                                    | sí                 | **no**              |
| Claves administrativas de identidad                                          | sí                 | **no**              |

La unión de las dos columnas es lo que hace falta. No existe hoy.

## 4. Propuesta

Un solo plan de escritura, en **una transacción de Firestore**, que produzca la unión: estudiante
con `userId` y familia propia, perfil administrativo, claves administrativas **y** la clave
`auth-user-id`, documento `users/{uid}`, avance del plano de control, auditoría y recibo de
idempotencia.

No es un writer nuevo desde cero: es el plan de `createAdminAdult` más las tres piezas que
`saveClientProfile` ya sabe construir. Ambos módulos ya replican el avance del plano de control por
su cuenta, así que esta sería la cuarta copia — y esa duplicación es en sí un argumento para
extraerla a un helper compartido dentro de esta misma tarea.

### Invariantes que no se pueden romper

Verificadas contra el código, no supuestas:

1. **Una sola revisión del plano de control por transacción.** `advanceMemberDirectoryControlPlane`
   exige `nextState.stateRevision === current.stateRevision + 1`
   (`apps/functions/src/members/member-directory-state.ts:255`), así que dos llamadas de servicio no
   pueden compartir transacción. Un adulto **más** N menores consume al menos dos revisiones.
2. **Techo duro de 400.** `rollbackCapacityLimit` es `z.literal(400)` y
   `highestRollbackEligibleStudentCount` está topado a 400 por esquema
   (`packages/domain/src/members/member-directory-contracts.ts:213`,
   `member-directory-state.ts:79`). Cerca del techo, la segunda escritura falla después de que la
   primera ya comprometió.
3. **El actor es office, siempre.** `requireAuthorizedActor` solo acepta owner/administrator activo
   con App Check verificado (`canonical-member-directory-service.ts:148-157`), y vuelve a
   comprobarlo **dentro** de la transacción (`:210-231`).
4. **El claim es exactamente `{academyId, role}`.** Cualquier clave extra envenena
   `extractUserClaims` y deja la cuenta fuera de todos los callables
   (`apps/functions/src/auth/user-authorization.ts:31-46`).
5. **La reserva `auth-user-id` es la única garantía de unicidad por cuenta.** Si apunta a otro
   estudiante, hay que fallar cerrado, como ya hace `profile-service.ts:755-766`.

## 5. Decisiones abiertas para el operador

Ninguna la puede tomar el asistente:

1. **`users/{uid}` exige teléfono y correo.** `parseUserProfile` requiere `displayName`,
   `phoneNumber` y `email` no vacíos (`packages/domain/src/profiles/profile-contracts.ts:222-233`),
   pero el contrato de solicitud los deja opcionales y no captura `displayName`. O el teléfono pasa
   a obligatorio en el formulario, o se toma del registro de Auth lo que haya. Sin resolverlo, el
   camino de tutor con menores no puede completarse.
2. **De quién es el `requestId` de la escritura administrativa.** El contrato dice hoy que pertenece
   a la acción del revisor, no a la del solicitante
   (`packages/domain/src/members/enrolment-request-contracts.ts:14-19`). Si la aprobación reutiliza
   el `requestId` del solicitante gana idempotencia entre dos revisores, pero un valor elegido por
   el navegador del solicitante entra en el MAC del recibo. Hay que elegir una y escribirla.
3. **Qué pasa con las fichas ya duplicadas.** Si en producción ya existen pares, hace falta una
   reconciliación aparte; esta tarea evita crear nuevos, no repara los viejos.

## 6. Criterio de cierre

- Plan de escritura unión implementado y probado en Emulator, con adulto y con tutor+menores.
- Reserva `auth-user-id` acuñada por el alta administrativa y respetada por `saveClientProfile`, de
  modo que la segunda ruta **encuentre** la ficha en vez de crear otra.
- Prueba que reproduce el defecto actual en RED y pasa en GREEN.
- Rollback documentado antes de aplicar nada, y ninguna escritura en datos reales.
- T121 corte 2 puede entonces construirse encima.
