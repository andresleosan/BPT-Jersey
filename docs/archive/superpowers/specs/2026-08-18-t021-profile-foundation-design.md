# T021 - Fundamentos de perfiles de participantes

## Objetivo

Implementar la base persistente del registro solicitado por `BPTJ FUNCTIONS APP.docx` sin mezclar
identidad adulta, participantes menores, tutoría, salud ni waiver. El MVP debe permitir que un adulto
autenticado complete su perfil y que el backend tenga un contrato canónico para participantes que luego
usarán `T022`, `T023`, `T018` y `T024`.

## Fuentes y precedencia

- `F:\Proyectos\BPT Jersey\Varios\BPTJ FUNCTIONS APP.docx` fija nombre, fecha de nacimiento, teléfono, email, sede habitual y preferencias horarias.
- `F:\Proyectos\BPT Jersey\Varios\BPT-memberships.docx` fija planes y accesos comerciales; la selección de plan pertenece a `T032`, no a este contrato.
- `BRIEF.md`, `STACK.md` y `docs/data/firestore-data-model.md` fijan Firestore como fuente canónica, menores sin cuenta Auth y separación entre `users`, `students`, `families` y `relationships`.
- El waiver compartido por el operador no se copia ni se acepta en T021; su lifecycle pertenece a `T018` y su PDF privado a `T024`.

## Modelo de datos

### `academies/{academyId}/users/{userId}`

Representa la identidad adulta autenticada y no el perfil completo del menor.

- `userId`: coincide con Firebase Auth.
- `academyId`: lo deriva el backend y debe coincidir con la ruta.
- `accountType`: `client` para este flujo; staff/admin conservan sus contratos propios.
- `displayName`: nombre visible de la cuenta.
- `email`: email normalizado desde Auth o validado por backend, nunca una autoridad enviada por cliente.
- `phoneNumber`: teléfono de contacto del adulto.
- `active`, `status`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`: campos server-owned.

### `academies/{academyId}/students/{studentId}`

Representa a la persona que participa en BJJ, sea adulta o menor. Un menor nunca obtiene una cuenta
Auth propia.

- `studentId`: ID generado por backend.
- `academyId`: lo deriva el backend y debe coincidir con la ruta.
- `userId`: opcional para el participante adulto autenticado; no existe para un menor.
- `fullName`: nombre legal/operativo del participante.
- `dateOfBirth`: fecha ISO date-only validada.
- `phoneNumber`, `email`: opcionales para el participante adulto; no se inventan para un menor.
- `trainingCenter`: sede habitual, limitada a `Town` o `West`.
- `trainingTimePreferences`: lista única de `morning`, `afternoon`, `evening`.
- `participantType`: `adult` o `minor`, derivado de la fecha de nacimiento por backend con el instante del servidor.
- `familyId`: queda reservado para `T022`; T021 no crea relaciones de tutoría.
- `active`, `status`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`: campos server-owned.

T021 no añade `medicalConditions`, `allergies`, `medication`, `emergencyContact`, `guardian`,
`consent`, `waiver`, `membershipId`, `belt`, `stripe` ni `signedPdf`. Esos campos pertenecen a
otras tareas y no se duplican.

## Flujo

1. Un adulto inicia sesión con el gateway cliente existente.
2. `/account/profile` consulta su perfil mediante callable; el cliente nunca lee Firestore directo.
3. Si no existe, el formulario solicita nombre, fecha de nacimiento, teléfono, email, sede habitual y preferencias horarias.
4. El backend obtiene `uid`, `academyId`, email/Auth y timestamp; valida el payload estricto y crea el documento adulto/participante de forma transaccional.
5. Si existe, el backend actualiza únicamente campos permitidos y conserva creación, actor e historial.
6. La respuesta contiene una proyección mínima del perfil; no devuelve claims completas, documentos restringidos ni datos de otros participantes.
7. La futura alta de un menor reutiliza el contrato de `students`, pero exige `T022` para familia/tutor antes de habilitar ese flujo.

## Autorización y seguridad

- Solo un adulto autenticado puede leer y actualizar su propio perfil mediante callable.
- Owner/administrator podrán operar perfiles por comandos administrativos posteriores, con alcance de academia y auditoría.
- Coach/staff no reciben lectura general por defecto.
- `academyId`, `userId`, `createdBy`, `updatedBy`, estados, `participantType` y timestamps no son aceptados como autoridad del cliente.
- Firestore Rules y RTDB permanecen deny-by-default para clientes.
- Errores públicos son genéricos (`unauthenticated`, `permission-denied`, `invalid-argument`); los logs de prueba no contienen emails, nombres reales, tokens ni claims completas.

## UI

- Ruta: `/account/profile`.
- Mensajes y controles visibles en inglés, siguiendo el idioma del producto.
- Formulario responsive y accesible: labels asociados, errores por campo, foco visible, teclado y mobile sin overflow.
- Sede: select cerrado con `Town` y `West`.
- Preferencias: checkboxes de mañana, tarde y noche; al menos una requerida.
- El formulario no muestra todavía campos de salud, tutoría, waiver, membresía ni belt/stripe.
- Éxito: confirmación genérica y datos guardados; fallo: mensaje accionable sin detalles de infraestructura.

## Contratos y pruebas

- Parser de dominio estricto para `UserProfile` y `StudentProfile`, con campos inesperados, prototipos no planos, fechas imposibles, sede inválida y preferencias duplicadas rechazados.
- Callable tests para anónimo, actor cliente, tenant cruzado, payload con `academyId`, actualización propia y repetición idempotente.
- Firestore Emulator para creación, actualización, tenant path y ausencia de lectura directa cliente.
- UI tests para carga, validación, guard de sesión, éxito, error genérico, teclado y mobile.
- El gate de T021 exige unitarias focused, Rules/integración relevante, lint, typecheck, build, formato y `git diff --check`.

## Datos existentes y rollback

- No se ejecuta migración ni se reescriben documentos existentes en T021.
- La colección `members` actual y sus imports permanecen intactos.
- Los nuevos documentos son aditivos y solo se crean en emulador o staging separado con datos sintéticos.
- Rollback de código: revertir el callable, contrato y UI; los documentos sintéticos de emulador se eliminan al apagar el entorno.
- Antes de cualquier uso staging/productivo futuro se necesitarán backup verificado, plan de reversión y aprobación operativa; T021 no autoriza ese paso.

## Fuera de alcance

- Familias, tutores, contactos de emergencia y menores gestionados por tutor: `T022`.
- Condiciones médicas, alergias, lesiones y medicación: `T023`.
- Waiver versionado, aceptación/revocación y UI de aceptación: `T018`.
- PDF firmado, R2 privado y URLs firmadas: `T024`.
- Membresías, precios, PAYG y accesos: `T032`, `T033`, `T037`, `T038`.
- Levels, belts, stripes y progreso: `T083`, `T039-T042`.
