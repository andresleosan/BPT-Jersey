# T022 - Familias multi-child y relaciones autorizadas

## Objetivo

Implementar la agrupación canónica de menores bajo una familia, con un único tutor adulto por menor,
contactos familiares consistentes y autorización basada en relaciones explícitas. La creación y
modificación serán operaciones staff/admin; un guardian solo podrá consultar su propia familia mediante
callable protegido.

## Fuentes y decisiones aprobadas

- `tasks.md` define `T022` como familias multi-child, contactos y relaciones autorizadas.
- `BRIEF.md` exige que los menores no tengan cuenta propia, que el tutor gestione su información y que
  cada rol vea únicamente la información necesaria.
- `docs/data/firestore-data-model.md` define `families` y `relationships` como colecciones separadas,
  sin arrays embebidos de menores o adultos.
- `T021` ya crea perfiles adultos/participantes en `users` y `students`; `familyId` queda reservado para
  este módulo.
- El operador confirmó:
  - solo `owner` y `administrator` escriben familias y relaciones;
  - `guardian` únicamente consulta su familia y menores relacionados;
  - cada familia puede tener varios menores;
  - cada menor pertenece a una sola familia y tiene exactamente un tutor;
  - `primaryContactUserId` y `billingContactUserId` son el mismo tutor;
  - un adulto no pertenece a más de una familia;
  - el tutor debe ser un adulto existente en `users` y Firebase Auth;
  - `T022` no crea cuentas Auth ni modifica claims.

## Modelo de datos

### `academies/{academyId}/families/{familyId}`

Campos canónicos:

- `familyId`: ID generado por backend.
- `academyId`: tenant derivado del actor staff/admin.
- `primaryContactUserId`: adulto existente en `users`.
- `billingContactUserId`: igual a `primaryContactUserId` en T022.
- `active`: booleano server-owned.
- `status`: `active` o `inactive`.
- `schemaVersion`: `1`.
- `createdAt`, `createdBy`, `updatedAt`, `updatedBy`: server-owned.

No se embebe una lista de menores ni de tutores. La pertenencia se resuelve mediante `familyId` en
`students` y la relación explícita.

### `academies/{academyId}/students/{studentId}`

T022 agrega `familyId` como campo opcional al contrato de participante de T021. Para los menores
creados por T022:

- `familyId` es obligatorio y referencia la familia del mismo tenant.
- `userId` no existe; el menor no tiene cuenta Auth.
- `participantType` siempre se deriva como `minor` desde la fecha de nacimiento del servidor.
- Los demás campos de perfil siguen el contrato de T021.

Un estudiante que ya tenga `familyId` activo no puede ser vinculado a otra familia.

### `academies/{academyId}/relationships/{relationshipId}`

Campos canónicos:

- `relationshipId`: identidad idempotente de la pareja `familyId + studentId`.
- `academyId`: tenant server-owned.
- `familyId`: familia del mismo tenant.
- `studentId`: menor de la familia.
- `adultUserId`: único tutor, igual a los contactos de la familia.
- `relationshipType`: `guardian`.
- `permissions`: proyección fija de `readProfile`; no concede por sí sola acceso a salud, waiver,
  pagos, asistencia o progreso futuro.
- `validFrom`, `validTo`: vigencia; `validTo` es opcional.
- `active`: booleano server-owned.
- `status`: `active` o `inactive`.
- `schemaVersion`, timestamps y actores del envelope común.

No hay arrays de adultos autorizados ni relaciones implícitas en `families` o `students`.

## Autorización

### Escritura staff/admin

`owner` y `administrator` pueden:

- crear una familia con un tutor existente y uno o más menores;
- agregar menores nuevos a una familia;
- cambiar el tutor por otro adulto existente del mismo tenant;
- desactivar una relación o familia sin borrar historial.

Cada comando verifica en una transacción:

1. actor autenticado, rol administrativo y tenant válido;
2. tutor existente, activo, de tipo cliente y perteneciente a la misma academia;
3. menores válidos, sin cuenta Auth y con fecha/participante coherentes;
4. ausencia de otra familia o relación activa para cada menor;
5. correspondencia entre ruta, `academyId` y todas las referencias;
6. allowlist exacta de campos, sin salud, waiver, documentos, pagos ni claims.

T022 no provisiona Auth, no cambia custom claims y no autoriza acceso por conocer un ID.

### Lectura guardian

`guardian` solo puede consultar mediante `getFamily` sin enviar `familyId`. El backend resuelve la
familia desde la relación activa cuyo `adultUserId` coincide con el actor. Si no existe exactamente una
familia válida, la operación falla cerrada.

La proyección guardian contiene únicamente:

- identificador y estado operativo de la familia;
- datos mínimos del contacto/tutor propio;
- menores relacionados: `studentId`, `fullName`, `dateOfBirth`, `trainingCenter`, preferencias y estado.

No devuelve claims completas, actores internos, documentos, salud, waiver, pagos, auditoría ni datos de
otra familia. `headCoach`, `coach` y `adultStudent` no reciben acceso familiar general.

### Firestore Rules

Las colecciones `families`, `students` y `relationships` permanecen deny-by-default para acceso directo
del navegador. El backend es la única superficie de lectura/escritura de T022.

## API y flujo

### `createFamily`

Solo staff/admin. Payload estricto:

```ts
{
  tutorUserId: string;
  students: readonly [{
    fullName: string;
    dateOfBirth: string;
    phoneNumber?: string;
    email?: string;
    trainingCenter: "Town" | "West";
    trainingTimePreferences: readonly ("morning" | "afternoon" | "evening")[];
  }];
}
```

El backend genera `familyId` y `studentId`, deriva el `relationshipId` determinista, y genera timestamps
y actores. Devuelve una
proyección staff mínima de la familia, los menores y sus relaciones.

### `getFamily`

- Staff/admin: payload exacto `{ familyId: string }`.
- Guardian: payload `null`; cualquier `familyId` enviado se rechaza.
- Devuelve la proyección correspondiente al rol, nunca el documento completo.

### `updateFamily`

Solo staff/admin. Payload estricto con `familyId` y una operación única:

- `replaceTutor` con un `tutorUserId` existente;
- `addStudent` con el borrador de un menor;
- `deactivateRelationship` con `studentId`;
- `deactivateFamily` sin borrar documentos.

`replaceTutor` actualiza los contactos de la familia y todas sus relaciones activas en una única
transacción. Rechaza un tutor que ya pertenezca a otra familia. Cada operación es idempotente o rechaza
un estado conflictivo; no se aceptan mutaciones ambiguas en un mismo payload.

## UI

- `/admin/families`: alta y mantenimiento staff/admin, selección de tutor existente, formulario de uno
  o varios menores y estado de relaciones.
- `/account/family`: lectura guardian de su propia familia y todos sus menores vinculados.
- Interfaz y mensajes visibles en inglés.
- Labels asociados, errores por campo, foco visible, estado de carga, bloqueo de doble envío y mobile sin
  overflow.
- No se muestran campos de salud, emergencia, waiver, membresías, pagos, asistencia o progreso.

## Errores y privacidad

- Anónimo: `unauthenticated`.
- Rol no permitido o relación inexistente: `permission-denied`.
- Payload, enums, fechas o campos inesperados: `invalid-argument`.
- Conflicto de pertenencia, tutor inexistente o documento inconsistente: `failed-precondition`.
- Fallo inesperado: mensaje público genérico `internal`; los logs no contienen PII, claims completas ni
  payloads crudos.

## Pruebas y evidencia requerida

- Domain: parser de `familyId`, familia, menor y relación; campos extra, símbolos, prototipos, fechas,
  duplicados y mezcla de dominios rechazados.
- Store: transacciones create/update, múltiples menores, tutor único, tenant mismatch, duplicados,
  idempotencia y preservación del envelope.
- Callables: matriz de roles, payload cerrado, proyección por rol, guardian cross-family y errores
  genéricos.
- Firestore Emulator: creación staff de familia con dos menores, lectura guardian, reasignación de tutor,
  desactivación y rechazo de acceso cruzado.
- Rules: deny-by-default para las tres colecciones.
- Web: formulario staff, vista guardian, validación, estados de error, teclado y mobile.
- E2E: un staff crea una familia multi-child y el guardian ve exactamente ambos menores, sin datos
  internos ni overflow.

## Datos existentes y rollback

- No se ejecuta migración ni se reescriben familias existentes en T022.
- Los documentos nuevos son aditivos y se prueban únicamente con datos sintéticos en emulador o staging
  separado.
- Rollback de código: revertir callables, store, contratos y UI; apagar el emulador elimina los datos de
  prueba.
- Antes de cualquier uso staging/productivo futuro se requiere backup verificado, plan de reversión y
  aprobación operativa explícita.

## Fuera de alcance

- Autocreación de familias por guardian.
- Creación de cuentas Firebase Auth o modificación de claims.
- Más de un tutor por menor.
- Contactos de emergencia, salud, safeguarding y soporte médico (`T023`).
- Consentimiento y waiver (`T018`), documentos/PDF (`T024`), membresías/pagos, asistencia y progreso.
- Transporte o autorización de salida de menores.
