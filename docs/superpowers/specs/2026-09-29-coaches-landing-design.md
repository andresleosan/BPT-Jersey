# Coaches de la landing desde la base de datos — diseño

Fecha: 2026-09-29 · Estado: aprobado en conversación, pendiente de revisión escrita

## Objetivo

La sección «The coaching team» de bptjersey.com deja de ser una lista escrita a mano y
refleja automáticamente los coaches que el owner gestiona en `/admin/staff`:

- Coach creado (activo, con cinturón) → aparece en la landing.
- Coach desactivado → desaparece; reactivado → vuelve.
- Coach borrado → desaparece para siempre.

Éxito = el owner nunca vuelve a tocar código para cambiar el equipo de la landing, y un
cambio en `/admin/staff` se ve en la landing en ≤ 60 s.

## Decisiones (trazables a la conversación)

| # | Decisión | Origen |
|---|----------|--------|
| D1 | «Eliminar» significa **ambas** cosas: desactivar (reversible, ya existe) oculta; un botón nuevo **Delete coach** borra definitivamente. Ambas quitan de la landing. | Luis: «Ambas» |
| D2 | La landing muestra **nombre + cinturón**. El owner elige el cinturón en `/admin/staff` al crear y al editar. | Luis: «Nombre + cinturón» |
| D3 | Aparecen **solo perfiles de coach** (`academies/{id}/staff`, roles `coach` y `headCoach`) activos. Owners y administrators nunca, salvo que además tengan perfil de coach. | Luis: «Solo rol coach» |
| D4 | Orden **por cinturón** (mayor grado primero), y a igual cinturón alfabético por nombre. El cinturón es un **desplegable fijo**, no texto libre. | Luis: «Por cinturón» |
| D5 | Transición: antes de publicar, Claude comprueba en producción (lectura) qué coaches tienen cuenta, les pone el cinturón que hoy muestra la landing y lista a Luis los que faltan. Después se borra la lista fija. **Sin lista de respaldo.** | Luis: «Yo reviso y relleno» |
| D6 | **Delete coach bloqueado** si el coach está asignado a clases activas o sesiones futuras; el mensaje dice cuáles reasignar. El historial pasado se conserva. | Propuesta de Claude, aprobada con el diseño |
| D7 | La landing **consulta un endpoint público al cargar** (no se reconstruye la web). Coste aceptado: la lista ya no va en el HTML estático (SEO menor). | Propuesta de Claude, aprobada con el diseño |
| D8 | `academyContent.instructors` **se conserva**: también alimenta el desplegable «Trainer» del calendario de clases (`trainer-options.ts`). Solo la landing deja de usarlo. El calendario no se toca; migrarlo a cuentas reales sería un proyecto aparte. | Luis: «Separar: landing de BD» |
| D9 | El cinturón y **Delete coach** van en el **Team directory** de `/admin/staff`, la tabla que muestra nombres. La tarjeta del perfil de staff muestra solo el identificador. El cinturón se guarda con un callable propio, `setCoachBelt`, en vez de pasar por `updateStaffProfile`. | Ajuste de Claude al planificar (el código lo exige) |
| D10 | Nombre en la landing = `displayName` de Firebase Auth, la misma fuente que el Team directory. Rol y estado = claims de Auth (`coach`/`headCoach`, no deshabilitado). | Ajuste de Claude al planificar |
| D11 | Al borrar, `users/{uid}` queda con `active: false`, `status: "inactive"` y `deletedAt`. «inactive» ya es un valor válido; «deleted» podría romper lectores estrictos. También se borra el acceso por número (`staffLoginCredentials`). | Ajuste de Claude al planificar |
| D12 | Los 5 coaches actuales ya tienen cuenta real (uid `coach-miro`, `coach-charlie`, …) creada por `scripts/provision-landing-coaches.mjs`. La transición solo les pone el cinturón. | Hallazgo al planificar (se confirma leyendo producción) |

> Si alguna sección de abajo contradice D8–D12 (añadidas al planificar), **mandan D8–D12**.
> Por ejemplo, ya no se usa `updateStaffProfile` para el cinturón, ni `status: "deleted"`, ni el texto «Former coach».

## 1. Datos

Campo nuevo **opcional** `belt` en el perfil de staff `academies/{academyId}/staff/{staffId}`
(`StaffProfile` en `packages/domain/src/staff/staff-contracts.ts`).

Valores permitidos, en orden de rango descendente (el índice define el orden de la landing):

| Valor | Texto en la landing |
|-------|---------------------|
| `red-9` | Red belt, 9th degree |
| `coral-8` | Coral belt, 8th degree |
| `coral-7` | Coral belt, 7th degree |
| `black-6` … `black-1` | 6th … 1st degree black belt |
| `black` | Black belt |
| `brown` | Brown belt |
| `purple` | Purple belt |
| `blue` | Blue belt |

- Se crea **una sola vez** en el dominio: `coachBelts` (tupla ordenada) más `coachBeltLabel(belt)`.
  El frontend y las funciones la importan de `@bpt-jersey/domain/staff`.
- Perfil sin `belt` (legado) → **no sale en la landing** hasta que el owner le ponga uno.
- El texto de hoy «4th degree black belt» (Miro) se corresponde con `black-4`.

## 2. Panel del owner (`/admin/staff`)

**Crear** (`direct-staff-form.tsx` → `createStaffWithPassword`)
- Con el rol «Coach / assistant» aparece el desplegable **Belt**, que es obligatorio.
- `directStaffInputSchema` añade `belt` (obligatorio cuando `role === "coach"` y prohibido en los demás roles).
- El documento `staff/{uid}` se crea con `belt`.

**Editar** (`page.tsx` → `updateStaffProfile`)
- El formulario del perfil seleccionado añade el desplegable Belt.
- `updateStaffProfile` acepta `belt` y lo valida contra `coachBelts`.

**Desactivar / activar** (ya existe, `setStaffActive`)
- No cambia nada. El endpoint público filtra por `active === true`.

**Delete coach** (nuevo)
- Callable nuevo `deleteCoachAccount({ staffKey })` en `apps/functions/src/staff/`,
  región `europe-west9`, con `browserAdminCallableOptions`.
- **Solo el owner**: se exige `actor.role === "owner"`; cualquier otro rol recibe `permission-denied`.
- Bloqueos (`failed-precondition`). El mensaje lista los nombres y las fechas afectados:
  - clases activas (`classes`, `active == true`, `instructorIds` contiene el coach);
  - sesiones futuras (`sessions`, `instructorId == uid`, `startAt >= ahora`,
    `status != "cancelled"`). Las clases privadas también son `sessions`, así que esta
    condición ya las cubre.
- Si no hay bloqueos, **una sola transacción de Firestore** hace lo siguiente:
  - borra `staff/{uid}`;
  - borra su disponibilidad (`staffAvailability`) y sus asignaciones (`staffAssignments`) y
    permisos (`staffPermissionGrants`);
  - marca `users/{uid}` como `status: "deleted"`, `active: false` y guarda la fecha
    (no se borra, para que el historial pasado pueda resolver el nombre);
  - escribe `auditEvents` con `action: "staff.coach_deleted"`.
- Después de la transacción se ejecuta `auth.deleteUser(uid)`. Si el login ya no existe
  (`auth/user-not-found`), se ignora el error.
- La interfaz es un botón **Delete coach**, visible solo para el owner, en la tarjeta del perfil
  junto a Deactivate. Abre una confirmación en la que hay que **escribir el nombre del coach**.
  Al terminar, el perfil desaparece de la lista.
- Historial: las pantallas que muestran sesiones pasadas siguen resolviendo el nombre desde
  `users/{uid}`. Donde hoy no se resuelva, se muestra «Former coach». No se reescriben
  datos pasados.

## 3. Endpoint público `coachesPublic`

- Archivo nuevo `apps/functions/src/staff/coaches-public-http.ts`. Sigue el patrón de
  `course-public-http.ts`: `onRequest`, `invoker: "public"`, CORS `browserOrigins` y región
  `europe-west9`.
- Solo acepta GET; con cualquier otro método responde 405. No tiene parámetros.
- El academyId sale de un parámetro de despliegue (reutiliza `COURSES_ACADEMY_ID`, que ya se
  usa para lo público).
- Lógica:
  1. lee `staff` con `active == true`;
  2. descarta los perfiles sin `belt` válido;
  3. lee los `users/{uid}` correspondientes con `getAll` y descarta los que no estén activos;
  4. ordena por el índice de `coachBelts` y después por nombre (`localeCompare` en inglés).
- Respuesta con una **lista explícita de campos permitidos**:
  `{ coaches: [{ name, belt, beltLabel }] }`. Nunca sale el uid, el email, el teléfono ni el rol.
- Cabeceras: `Cache-Control: public, max-age=60` y `X-Content-Type-Options: nosniff`.
- Errores: 500 con `{ error: "unavailable" }` y sin detalles.

## 4. Landing

- `apps/web/src/app/page.tsx`: el bloque «The coaching team» pasa a ser un componente
  cliente `CoachingTeam` que hace un fetch a `coachesPublic` al montarse.
  - Mientras carga, muestra un esqueleto con el mismo `instructor-list` y 3 tarjetas vacías.
  - Si la respuesta es correcta y trae coaches, pinta `name` y `beltLabel` (React escapa el texto).
  - Si hay error, o si la lista viene vacía, **oculta el bloque entero**, título incluido.
- URL del endpoint: igual que en `apps/web/src/lib/courses/course-public-client.ts`, es
  decir, `NEXT_PUBLIC_COACHES_API_URL` o, si no está definida,
  `https://europe-west9-${projectId}.cloudfunctions.net/coachesPublic`.
- `instructors` en `apps/web/src/content/academy.ts` **se conserva** para el calendario (D8);
  la landing ya no lo lee.

## 5. Transición y entrega

1. Implementar en `main` local.
2. Comprobar en el emulador local: crear un coach con cinturón → sale; desactivarlo → sale
   de la lista; borrarlo → sale; borrarlo con una sesión futura → se bloquea con el mensaje;
   el orden por cinturón es correcto.
3. Leer en producción (solo lectura) los perfiles `staff` y sus nombres, y cruzarlos con los
   5 de hoy (Miro `black-4`, Charlie `black`, Amoné `black`, Connor `black`, Catalina `brown`).
4. Informar a Luis de qué coaches faltan o no tienen perfil de coach (Miro probablemente es
   owner: necesitará un perfil de coach para salir, según D3).
5. Con el visto bueno de Luis, escribir `belt` en los perfiles existentes (script en
   `/root/compartido`, con dry-run primero).
6. Commit y push a `origin/main`; desplegar las funciones `coachesPublic`,
   `createStaffWithPassword`, `updateStaffProfile` y `deleteCoachAccount`, en ese orden:
   **push antes del deploy de functions**. Cloudflare publica la web.
7. Verificar en bptjersey.com que la lista coincide con los perfiles activos.

## Fuera de alcance

- Fotos o biografías de los coaches.
- Una casilla «Show on website» (D3 la descarta).
- Mostrar owners o administrators sin perfil de coach.
- Reasignar automáticamente las clases al borrar (D6 bloquea en su lugar).

## Pruebas

Según `AGENTS.md` de BPT-Jersey no se añaden ni se ejecutan tests automáticos salvo petición
expresa. La verificación es la del paso 2 (emulador) y la del paso 7 (producción).
