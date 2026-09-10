# T121 corte 2 — Aprobar una solicitud de inscripción

**Fecha:** 2026-09-06
**Estado:** implementado. Falta la verificación en Emulator y la UI de aprobación (corte 3c).
**Depende de:** `2026-09-06-t122-member-account-link-design.md`, cuyo `createAdminAdultForAccount`
es la mitad adulta de esta secuencia.
**Alcance confirmado por el operador el 2026-09-06:** adulto y tutor en la misma entrega; la
proyección de detalle con la misma disciplina que `member.detail.read`.

## 1. Por qué esto no es una transacción, y no puede serlo

El estudiante vive en Firestore y el rol vive en Auth. Para un tutor, además, el escritor de
familias exige que el rol **ya esté puesto** antes de correr. Así que la aprobación es una secuencia
corta de pasos individualmente transaccionales. Lo que la hace segura no es la atomicidad, sino tres
propiedades sostenidas a la vez:

1. **La solicitud es el cerrojo.** Un revisor la mueve a `approving` y en ese mismo commit le fija
   la clave de idempotencia de la escritura administrativa. Cualquier intento posterior, de quien
   sea, corre contra esa misma clave.
2. **Cada paso es idempotente bajo esa clave.** La escritura canónica responde a una repetición con
   el estudiante que ya creó, el perfil de tutor repite su recibo, la familia repite el suyo, y
   poner un claim al valor que ya tiene no hace nada.
3. **Una secuencia que se corta a medias deja la solicitud en `approval-failed`**, nunca en
   `approved` y nunca de vuelta en manos del solicitante. Office lo ve, y reintentar reanuda en vez
   de reempezar.

Esto reemplaza lo que la fila T122 anotaba como «resolver la doble aprobación con el cambio de
estado de la solicitud dentro del mismo commit»: ese cambio **no** puede ir en el mismo commit que
la escritura canónica, porque la transacción vive dentro del servicio. Sin el cerrojo, dos revisores
concurrentes generarían dos `requestId` de office distintos, dos recibos distintos y **dos
estudiantes para una persona**. Con el cerrojo, el segundo revisor hereda la clave del primero.

## 2. Estados nuevos

`approving` y `approval-failed`, ninguno de los dos «abierto».

El guardia de «una sola solicitud por persona» se reescribió como **lista de permitidos** en vez de
lista de rechazos: solo `withdrawn` (o no tener solicitud) permite volver a solicitar. Una lista de
rechazos habría dejado pasar los dos estados nuevos en silencio, que es exactamente el agujero que
un vocabulario que crece produce.

**Callejón sin salida que esto abrió, y su salida.** Una solicitud en `approval-failed` no la puede
retirar el solicitante (no está abierta) ni volver a solicitar (tiene una en curso). Si la
aprobación falla por algo que solo el solicitante puede arreglar —su cuenta de Google sin nombre,
por ejemplo— queda atrapado para siempre. Por eso office puede **devolverla con nota** desde ese
estado, y la bandeja lo ofrece: es la única salida.

## 3. Las dos secuencias

**Adulto que se inscribe a sí mismo** — ficha primero, rol después:

1. `beginApproval` toma el cerrojo y fija la clave.
2. `createAdminAdultForAccount` escribe en **una** transacción: estudiante con `userId` y familia
   propia, perfil administrativo, claves administrativas, la reserva `auth-user-id`, el documento
   `users/{uid}`, el avance del plano de control, auditoría y recibo.
3. El claim asciende a `adultStudent`, se relee y, si no cuajó, se restaura el anterior.
4. `completeApproval` cierra la solicitud con el `studentId` que produjo.

El orden no es preferencia: una cuenta con `adultStudent` y nada detrás es peor que una ficha cuyo
dueño todavía no puede entrar, y solo una de las dos se arregla reintentando.

**Tutor con menores** — el orden lo impone `createFamily`:

1. `beginApproval`.
2. `saveGuardianProfile` escribe el documento de cliente del tutor. El tutor **no** es estudiante:
   no se le escribe ficha canónica.
3. El claim asciende a `guardian`, con la misma verificación y compensación.
4. `createFamily` escribe familia, estudiantes menores, relaciones y perfiles administrativos.
5. `completeApproval` con los `studentId` de los menores.

`createFamily` rechaza a un tutor que no sea ya `guardian` con documento de cliente activo
(`family-service.ts:626` y `:514-529`), así que 2 y 3 van antes de 4 por obligación.

### Fidelidad de datos que faltaba

`FamilyStudentDraft` no llevaba `gender` ni `frequencyNote`, y el escritor de familias fijaba
`gender: "unknown"`. Aprobar por ahí habría **tirado en silencio** lo que el solicitante contestó
sobre cada menor. Ambos campos son ahora opcionales en el borrador y el escritor los respeta;
`unknown` vuelve a significar «no contestó» en vez de «no lo cargamos».

## 4. La proyección de detalle

Office aprobaba mirando una cola con nombre y centro: ni la fecha de nacimiento que decide si el
solicitante es siquiera elegible, ni el contacto de emergencia del que la academia se hace
responsable. `enrolmentRequestDetail` cierra eso, con la disciplina de `member.detail.read`:
propósito declarado, evento de auditoría por lectura y el **mismo** contador de 20 lecturas cada 5
minutos por actor. Lo único que no comparte es la precondición de lector canónico: una solicitud no
es un registro del directorio, y congelar el directorio no debe esconderle a office lo que alguien
pidió.

**Defecto que esto destapó:** `audit-writer.ts` fijaba `result: "completed"` para toda acción fuera
de dos nombres codificados a mano, así que la lectura nueva habría registrado «completada» pasara lo
que pasara. Corregido: el ledger habría estado afirmando algo falso.

## 5. La pila de actor

Las dos puertas de office usan `requireCanonicalMemberDirectoryActor`, extraída de
`member-directory-callables.ts` a `canonical-actor.ts` y compartida ahora por las dos: App Check
verificado **en el handler** (no solo en las opciones del callable), claims administrativos, y sonda
de vitalidad contra Auth y el documento de staff de la academia. Los callables de solicitud seguían
usando `requireUserActor` con un conjunto de roles; eso alcanza para leer una cola, no para escribir
en el directorio canónico. Un administrador revocado conserva un token válido hasta que expira; sin
la sonda ese token sigue inscribiendo gente.

## 6. Lo que este corte deliberadamente no hace

- **No hay UI de aprobación.** La bandeja lista y devuelve; aprobar y ver el detalle son callables
  sin pantalla todavía. Es el corte 3c.
- **No repara fichas ya duplicadas.** T122 ya decidió que no hay ninguna: T107 purgó el dataset y el
  directorio canónico se inicializó vacío.
- **No habilita uso operativo.** El texto legal del waiver y de los disclaimers sigue bloqueado por
  T011.

## 7. Riesgos aceptados, escritos

- **Concurrencia real no verificada.** El cerrojo depende de que dos `beginApproval` simultáneas se
  serialicen sobre el documento de la solicitud. Firestore lo garantiza; el doble de pruebas no lo
  simula. Va en la lista de Emulator.
- **Techo de 400.** Cerca del límite de reversión, la escritura de familia falla después de que el
  documento de cliente y el claim ya se escribieron. La solicitud queda en `approval-failed` y el
  reintento reanuda cuando haya capacidad.
- **El evento `guardian.profile.created` registra al solicitante como actor**, no a office, porque
  el contrato de auditoría fija ese objetivo y ese propósito. La traza igual queda completa: el
  evento `enrolment.request.approved` sí registra a office con la solicitud como objetivo.
- **`promoteClaim` preserva los claims previos** (`{...before, academyId, role}`), igual que
  `registerShopperAccount`. Si una cuenta cargara un claim ajeno al vocabulario, `extractUserClaims`
  la dejaría fuera de todos los callables. Es comportamiento preexistente y compartido, no una
  regresión de este corte, pero queda anotado.
