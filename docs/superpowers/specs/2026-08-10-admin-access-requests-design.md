# Solicitudes de acceso administrativo

## Estado

Diseño aprobado por el operador el 2026-08-10.

## Objetivo

Permitir que una cuenta autenticada con Google solicite acceso administrativo desde el mismo flujo `Administrator`, sin conceder permisos automáticamente. Cualquier administrador aprobado podrá revisar, aceptar o rechazar solicitudes. Las cuentas cliente seguirán entrando a `/account` sin aprobación administrativa.

## Alcance

Incluye:

- Creación automática de una solicitud cuando una cuenta sin claims administrativos inicia sesión en contexto `Administrator`.
- Estado visible para solicitudes pendientes y rechazadas.
- Panel administrativo de solicitudes con acciones `Approve` y `Reject`.
- Asignación y revocación segura del claim administrativo desde Functions.
- Auditoría append-only de solicitudes y decisiones.
- Reintento después de un rechazo.
- Pruebas unitarias, de Rules, de Functions y E2E sintéticas.

No incluye:

- Autoasignación de roles desde el navegador.
- Aprobación de clientes para `/account`.
- Invitaciones por correo, comentarios de rechazo o workflow multi-academia nuevo.
- Un rol de negocio especial `owner`.

## Decisiones de producto

- El selector `Administrator` conserva su función actual como contexto de acceso.
- Después del login Google, una cuenta sin autorización crea o reabre su solicitud y no entra al panel.
- Una solicitud pendiente muestra `Your administrator access request is pending approval` y una acción de cierre de sesión.
- Una solicitud rechazada puede volver a intentarse desde el mismo flujo de login.
- Cualquier cuenta con rol `administrator` aprobado y MFA TOTP válido puede listar y decidir solicitudes.
- Todos los administradores reciben la proyección segura de Regyfit; la IP no se muestra a ningún rol de la aplicación.
- Una aprobación concede únicamente `role=administrator` y el `academyId` de la solicitud.
- El primer administrador existente se conserva como bootstrap operativo; cualquier claim técnico `owner` existente se normaliza a `administrator` durante el rollout y deja de tener privilegios distintos.
- La cuenta que acaba de ser aprobada debe cerrar sesión y volver a iniciar sesión para recibir los nuevos claims; no se intentará ocultar este cambio detrás de un refresh ambiguo.

## Modelo de datos

### Solicitud vigente

Ruta: `academies/{academyId}/adminAccessRequests/{requesterUid}`.

El UID autenticado es el ID determinista. Esto evita duplicados, permite reabrir una solicitud rechazada y no expone el correo en la ruta.

Campos server-owned o derivados de Firebase Auth:

- `requesterUid`: UID de Firebase Auth.
- `academyId`: tenant de la solicitud.
- `email`: correo actual de Auth para la vista administrativa.
- `displayName`: nombre actual de Auth, nullable.
- `authProvider`: `google`.
- `status`: `pending`, `approved` o `rejected`.
- `attemptCount`: número entero positivo incrementado en cada nueva solicitud.
- `requestedAt`: timestamp de la solicitud vigente.
- `createdAt`, `createdBy`.
- `updatedAt`, `updatedBy`.
- `reviewedAt`, `reviewedBy`, presentes solo después de una decisión.
- `retryAfterAt`, timestamp server-owned presente después de un rechazo para aplicar un cooldown técnico de 60 segundos antes de reintentar.
- `schemaVersion`: `1`.

No se acepta que el cliente elija `academyId`, correo, nombre, estado, reviewer, claims o timestamps.

### Auditoría

Cada transición escribe un evento append-only en `academies/{academyId}/auditEvents`:

- `admin.access.requested`.
- `admin.access.approved`.
- `admin.access.rejected`.

El evento contiene actor, target UID, estado anterior/nuevo, propósito, correlación y timestamps server-owned. No copia tokens, secretos ni payloads de Auth.

### Reglas de acceso

Las Rules no permiten lectura ni escritura directa de `adminAccessRequests`. Solo Functions puede leer o mutar solicitudes después de validar Auth, MFA, `academyId` y rol `administrator`.

## Backend

### `requestAdminAccess`

Callable autenticado sin requerir claims administrativos.

El payload debe ser exactamente un objeto vacío. Cualquier campo adicional se rechaza con `invalid-argument`; la identidad, el tenant y el estado nunca llegan desde el navegador.

1. Obtiene el usuario por `request.auth.uid` desde Admin SDK.
2. Rechaza usuarios sin correo o sin proveedor `google.com`.
3. Determina el `academyId` del entorno/configuración de la academia, no del payload.
4. Crea una solicitud `pending` si no existe.
5. Si existe `rejected` y ya pasó `retryAfterAt`, la reabre como `pending`, incrementa `attemptCount` y limpia los datos de revisión.
6. Si existe `rejected` y todavía no pasó `retryAfterAt`, responde `resource-exhausted` sin escribir ni auditar.
7. Si ya está `pending`, responde de forma idempotente sin crear otro documento.
8. Si ya está `approved`, no concede claims desde esta Function. Devuelve el estado junto con una indicación de reautenticación para que el cliente cierre sesión y vuelva a iniciar sesión si el token todavía no contiene el claim aprobado.

La respuesta es una proyección mínima: `status` y un mensaje estable. No devuelve claims ni datos de otros usuarios.

### `listAdminAccessRequests`

Callable autenticado que:

- exige `requireAdminActor` con MFA TOTP;
- acepta solo filtros allowlisted (`pending`, `approved`, `rejected`, `all`);
- exige el mismo `academyId` en actor y documentos;
- devuelve una proyección segura sin campos internos de Auth ni tokens;
- ordena por `requestedAt` descendente;
- aplica un límite máximo fijo y no acepta consultas arbitrarias.

### `reviewAdminAccessRequest`

Callable autenticado con payload estricto `{ requestId, decision }`, donde `decision` es `approve` o `reject`.

Para ambas decisiones:

- exige MFA TOTP y rol `administrator`;
- carga la solicitud por `requestId` dentro de la academia del actor;
- rechaza IDs malformados, solicitudes inexistentes o estados no `pending`;
- usa una transacción/lock por target para impedir doble decisión concurrente;
- escribe un único evento de auditoría por decisión.

Para aprobar:

- obtiene el usuario real desde Firebase Auth;
- verifica que el correo y proveedor sigan siendo compatibles;
- asigna únicamente `{ academyId, role: "administrator" }`, preservando claims permitidos no administrativos según el contrato existente;
- actualiza la solicitud a `approved` y persiste el usuario administrativo;
- si la escritura de Firestore falla después de cambiar claims, revierte claims con el patrón de compensación ya existente.

Para rechazar:

- no modifica claims;
- actualiza la solicitud a `rejected` y conserva la auditoría;
- permite que un login administrativo posterior la reabra.

La implementación elimina la dependencia de `requireOwner` para esta capacidad. Los claims antiguos `owner` se aceptan únicamente durante la normalización controlada del rollout y no se muestran como un nivel de autoridad distinto.

## Frontend

### Login administrativo

Después de `signInWithGoogle()` en contexto `Administrator`, el cliente llama `requestAdminAccess()` antes de navegar a `/admin`.

- `approved`: continúa al panel solo si el `AdminGate` confirma claims/MFA; si el token está desactualizado, muestra reautenticación y no concede acceso desde el cliente.
- `pending`: navega a `/admin` para mostrar el estado pendiente, sin renderizar `AdminShell`.
- `rejected`: la nueva ejecución de login reabre la solicitud; no existe un bypass local.
- error: muestra un mensaje genérico y no incluye detalles de Functions o Auth.

### `AdminGate`

Se agregan estados `pending` y `rejected` a la frontera de acceso. La vista de estado no renderiza módulos, registros, navegación administrativa ni acciones de aprobación.

### Panel `Admin Access Requests`

Se agrega una entrada de navegación visible a administradores aprobados. El panel contiene:

- contador de solicitudes pendientes;
- filtro por estado;
- tabla responsive que se convierte en tarjetas en móvil;
- nombre, correo, fecha de solicitud, número de intento y estado;
- botones accesibles `Approve` y `Reject` solo para solicitudes pendientes;
- estados de carga, error, lista vacía y acción en progreso;
- confirmación textual posterior a cada acción;
- actualización de la lista después de decidir, sin refresco completo de página.

El diseño conserva la identidad existente: BPT Purple, Mat Ink, Canvas, tipografías Barlow Condensed/Source Sans 3, bordes rectos, contraste alto, foco visible y `prefers-reduced-motion`.

La sección no se muestra en el área cliente y no cambia el acceso inmediato de los clientes autenticados.

## Manejo de errores y concurrencia

- Solicitud repetida mientras está pendiente: respuesta idempotente.
- Dos administradores deciden a la vez: solo una transición gana; la otra recibe un estado de conflicto sin sobrescribir auditoría.
- Usuario eliminado o proveedor cambiado antes de aprobar: `failed-precondition`, la solicitud permanece pendiente para revisión.
- Function no disponible: la UI conserva el estado actual y muestra un error genérico reintentable.
- Fallo de claims después de mutar Firestore: compensación fail-closed; no se reporta aprobación hasta completar ambos lados.
- No se agregan reintentos infinitos ni se registran correos, tokens o claims en logs.

## Seguridad y privacidad

- Ningún cliente puede escribir claims ni cambiar el estado de una solicitud.
- Solo administradores con MFA TOTP pueden consultar o decidir solicitudes.
- Cada operación valida tenant y actor en backend; el `academyId` del navegador no es autoridad.
- El UID es la única clave de solicitud; los correos no aparecen en rutas ni logs.
- Las respuestas y errores son proyecciones mínimas y mensajes sanitizados.
- La aceptación se audita como cambio sensible.
- La solicitud administrativa no concede acceso a datos de Regyfit ni a ningún módulo adicional hasta que Auth emita los claims aprobados. La proyección de Regyfit excluye la IP para todos los administradores.

## Rollout y rollback

El cambio de colección es aditivo y no requiere migración destructiva. Antes del rollout se debe:

1. Mantener al menos un administrador existente con capacidad de acceso.
2. Normalizar el claim del administrador inicial de `owner` a `administrator` mediante la misma operación backend protegida.
3. Publicar Functions y frontend coordinadamente.
4. Verificar con una cuenta sintética: solicitud, pendiente, aprobación, re-login y rechazo/reintento.

Rollback:

- restaurar la versión anterior de frontend y Functions;
- conservar las solicitudes para no perder evidencia;
- si hubo aprobaciones durante el rollout, revocar únicamente los claims creados por esta funcionalidad mediante la operación administrativa existente y auditarlo;
- no borrar documentos ni ejecutar migraciones destructivas.

El despliegue a staging/producción requiere el checkpoint operativo y confirmación explícita del operador.

## Pruebas

- Domain: contrato de estados, transición de rechazo a nueva solicitud y ausencia de rol `owner` como autoridad de negocio.
- Functions: autenticación requerida, proveedor Google, idempotencia, tenant isolation, MFA, administrador autorizado, payload estricto, aprobación, rechazo, reintento, doble decisión y compensación.
- Rules: cliente anónimo, cliente autenticado y administrador no pueden leer/escribir directamente solicitudes.
- Web: estados `pending`/`rejected`, mensaje sin detalles internos, panel para administrador, acciones disabled durante mutación, estados vacíos/error y preservación del acceso cliente.
- E2E sintético desktop/móvil: client login sin aprobación; solicitud administrativa; panel de aprobación; rechazo y reintento; ausencia de registros para usuarios no autorizados; consola sin errores y sin overflow.

## Criterio de aceptación

La funcionalidad se considera lista cuando una cuenta cliente puede entrar sin aprobación, una cuenta Google nueva puede solicitar acceso desde el login administrativo, todos los administradores aprobados pueden ver y decidir solicitudes de su academia, la aprobación habilita el acceso después de volver a iniciar sesión, el rechazo permite reintentar y todas las pruebas anteriores pasan con evidencia real.
