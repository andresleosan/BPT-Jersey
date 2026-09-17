# Classes / Services — History (registro de inscripciones): diseño

Fecha: 2026-09-17 · Tarea: T048V2-H (parte History de T048V2) · Estado: decidido con el operador
(Luis) en chat el 2026-09-17 · Rama de trabajo: `feature/cs-history` (worktree
`/root/BPT-Jersey-wt/history`, creada desde `main` en `1b72e0b`).

Evidencia de origen: `docs/data/migrations/regyfit/classes-services-inventory.md` §9 y la captura
cruda `/root/regyfit-capture/raw/09-history/` + `/root/regyfit-capture/data/history-log.json`
(1000 filas con nombres e IP; se queda fuera del repositorio, runbook
`docs/data/migrations/regyfit/private-staging-runbook.md`).

Spec hermana: `2026-09-16-regyfit-classes-services-clone-design.md` (decisiones 1, 2, 3, 10, 13,
14, 17 y 18 se aplican aquí sin cambios).

## 1. Qué se pide

Replicar la novena pestaña de Regyfit, `CLASS REGISTRATIONS LOG`, en
`/admin/classes-services/history`: un registro inmutable de quién reservó, canceló o marcó
asistencia, con fecha, usuario, IP y una frase legible, filtrable y exportable a PDF; e importar
el histórico real de Regyfit.

Estado de partida, verificado en el código el 2026-09-17:

- `auditEvents` existe con 70 acciones, escritura solo desde callables y reglas que deniegan toda
  lectura de cliente (`firestore.rules:207`).
- La **asistencia sí** audita (`attendance.checked_in`, `attendance.corrected`,
  `attendance.proximity_override`, `student.checked_out` en
  `apps/functions/src/schedule/attendance-transaction-service.ts`).
- **Reservar y cancelar no auditan nada** (`booking-transaction-service.ts` no llama al escritor
  de auditoría).
- Ningún evento guarda IP ni el rol del actor, y **no hay ninguna pantalla en `/admin` que lea
  auditoría**.

Por tanto esta pestaña es, sobre todo, backend nuevo: sin los eventos, la pantalla no tiene qué
mostrar.

## 2. Decisiones del operador (2026-09-17)

| # | Pregunta | Decisión |
| - | -------- | -------- |
| H1 | ¿De dónde salen las filas? | **Eventos de auditoría nuevos + importación del histórico de Regyfit.** No se deriva el registro de los documentos de reserva (sería mutable y sin IP ni autor). |
| H2 | ¿Qué eventos y con qué detalle? | Cuatro acciones nuevas (`booking.created`, `booking.cancelled`, `dropin.created`, `dropin.cancelled`) escritas **dentro de la transacción** de reserva; se reutilizan las de asistencia. Cada evento de clase añade `actorIp`, `actorRole`, `studentId`, `sessionId`, `sessionStartAt`, `programId`. |
| H3 | IP | Se guarda solo en eventos de clases, se muestra **solo a admin**, retención **12 meses** (enmienda de una línea a ADR-008). |
| H4 | ¿Cuánto histórico? | **Todo**: recaptura completa por VNC desde el 16 de enero de 2026 paginando con el filtro `Since`, y después importación. |

Decisiones heredadas que siguen vigentes: solo inglés en la interfaz; PDF servidor con `pdf-lib`
(#18); personas sin casar se resuelven por número de socio y, si falta, nombre normalizado (#17);
estilo BPT según DESIGN.md, no el de Regyfit (#3).

## 3. Fuera de alcance

- Drop-ins como funcionalidad: las acciones `dropin.*` se definen y el importador las escribe,
  pero **no hay nada en BPT que cree drop-ins todavía** (eso es T047V2). Se dejan definidas para
  no tener que tocar el contrato de auditoría dos veces.
- Un visor general de auditoría para toda la academia (opción C descartada): esta pantalla es el
  clon de Regyfit, limitado a eventos de clases.
- Exportación a Excel: Regyfit solo ofrece PDF en esta pantalla.
- Un visor de auditoría con paginación infinita: la pantalla lista un tramo (100–1000 filas), como
  Regyfit, y punto.
- Borrar o editar eventos: el registro es inmutable por definición.

## 4. Arquitectura por capas

1. `packages/domain/src/audit/audit-event.ts` — cuatro acciones nuevas, campos de clase y `actorIp`
   en el borrador; validación pura.
2. `packages/domain/src/audit/class-history-contracts.ts` — entrada y salida de la consulta, los
   diez tipos de registro de Regyfit y el **compositor de frases** (función pura: evento +
   nombres → frase en inglés).
3. `apps/functions/src/schedule/booking-transaction-service.ts` — escribe los eventos de reserva y
   cancelación **en la misma transacción** que la reserva.
4. `apps/functions/src/audit/class-history-service.ts` — consulta, resolución de nombres y límite;
   `class-history-firestore.ts` — adaptador; `class-history-pdf.ts` — documento con `pdf-lib`.
5. `apps/functions/src/audit/class-history-callables.ts` — `listClassHistory`,
   `exportClassHistoryPdf` (`requireAdminActor`, `assertAcademyScope`, zod), reexportadas en
   `src/index.ts` y en `deploy-runtime.ts`.
6. `apps/web/src/lib/class-history-client.ts` — `httpsCallable` + zod + errores seguros.
7. `apps/web/src/app/admin/classes-services/history/page.tsx` + `history.css`.
8. `qa/scripts/regyfit-history-import.mjs` — importación del histórico.

## 5. Modelo de datos

El evento de auditoría de clases es un `auditEvents` normal con un bloque nuevo, **opcional**, que
solo llevan estas acciones (los 70 eventos existentes no cambian y el parser los sigue aceptando):

```
action: "booking.created" | "booking.cancelled" | "dropin.created" | "dropin.cancelled"
        | (las cuatro de asistencia que ya existen)
class: {
  studentId: string | null        // null cuando el importador no casó a la persona
  studentName: string | null      // solo lo escribe el importador para filas sin casar
  sessionId: string
  sessionStartAt: string          // ISO, UTC
  programId: string | null
  locationId: string | null
}
actorIp: string | null            // IPv4/IPv6 validada; null cuando no hay petición HTTP
actorRole: UserRole | "system" | "regyfit"   // G1: el rol real de actor-context.ts, sin agrupar
actorGroup: "member" | "staff" | "system"    // G2: derivado del rol, solo para poder filtrar
actorName: string | null          // solo para actores importados que no existen en BPT
source: "bpt" | "regyfit"
```

`actorRole` guarda el rol tal cual estaba en el momento del hecho (`owner`, `administrator`,
`headCoach`, `coach`, `guardian`, `adultStudent`, `teenStudent`, `shopper`), más `"system"` y
`"regyfit"` para los dos casos sin usuario (G1). `actorGroup` se deriva al escribir: *member* =
`guardian`, `adultStudent`, `teenStudent`, `shopper`; *staff* = `owner`, `administrator`,
`headCoach`, `coach`; *system* = el resto. Es redundante a propósito: Firestore no sabe filtrar
por un conjunto de valores y ordenar por otra cosa sin multiplicar los índices, y sin este campo
el recuento "RECORDS (N)" mentiría (G2).

Reglas de validación: `sessionStartAt` es ISO con zona; `actorIp` se valida con zod contra IPv4 e
IPv6 y se rechaza cualquier otra cosa; el resto de campos son ids con formato de segmento. El
parser actual **rechaza campos extra**, así que el cambio va en el contrato del dominio, con
pruebas de que un evento antiguo sigue siendo válido.

`firestore.rules`: `auditEvents` sigue **sin lectura de cliente**. Todo pasa por los callables.

## 6. Escritura de los eventos

- `booking.created`: dentro de `executeBookingInTransaction`, con el mismo `transaction.create`
  que ya se usa para la reserva. Si la auditoría falla, falla la reserva: no puede haber una
  reserva sin su línea de registro.
- `booking.cancelled`: igual, dentro de `cancelBookingInTransaction`.
- **Id del evento (G6)**: el id de una reserva es determinista a partir de sesión + alumno
  (`buildBookingIdCandidates`, `booking-transaction-service.ts:430`), así que el documento se
  reutiliza cuando alguien reserva, cancela y vuelve a reservar la misma clase. Por eso el id del
  evento **no** se deriva del de la reserva: se genera con id automático **antes** de abrir la
  transacción, y el cuerpo solo usa esa referencia. Un reintento de la transacción reutiliza la
  misma referencia (no duplica) y cada reserva o cancelación deja su propia línea.
- **IP (G4)**: se toma la primera entrada de `X-Forwarded-For` y, si no la hay,
  `request.rawRequest.ip`; se valida como IPv4/IPv6 y, si no es válida, se guarda `null` en vez de
  basura. Las funciones v2 están detrás del balanceador de Google, así que esto **se verifica con
  una reserva real** (emulador y producción) antes de dar la columna por buena: una columna de IP
  que miente es peor que no tenerla. En llamadas sin petición HTTP es `null`.
- `actorRole` sale de las claims ya resueltas por el contexto de actor; no se vuelve a calcular.
  `actorGroup` se deriva de él en el mismo sitio.
- **Fallo cerrado (G9)**: si el evento no se puede escribir, la reserva no se crea. Para que eso
  sea aceptable, el evento **no puede depender de datos opcionales**: `programId` y `locationId`
  son anulables, y la primera prueba del cambio es que una sesión sin programa ni sede se reserva
  igual y deja su línea con esos campos vacíos (hay sesiones importadas con datos incompletos).
- Las cuatro acciones de asistencia solo ganan el bloque `class` y la IP; su escritura no cambia.

## 7. La consulta

`listClassHistory({ since, sinceTime, actorId?, registrationType, limit })`:

- `limit` se recorta en el servidor al rango 100–1000 (los valores del selector de Regyfit).
- Consulta: `auditEvents` filtrando por academia, acción dentro del conjunto que corresponde al
  tipo elegido, `actorGroup` y `occurredAt >= since`, ordenado por `occurredAt` descendente.
  `auditEvents` es
  subcolección de la academia, así que el ámbito ya está implícito; el índice compuesto nuevo en
  `firestore.indexes.json` es `auditEvents (action asc, actorGroup asc, occurredAt desc)` y se
  añade en el mismo commit que la consulta (CLAUDE.md: un índice que falta no se ve hasta ejecución).
- `registrationType` traduce los diez tipos de Regyfit a pares de acción + `actorGroup`: por
  ejemplo "Registrations in classes/services by members" = `booking.created` + `member`, y
  "…by coachs" = `booking.created` + `staff`. El filtro va **en la consulta**, no recortando
  después, de modo que el recuento mostrado es el real (G2).
- **Resolución de nombres (G7)**: los `studentId` distintos de la página se leen en bloque con un
  solo `getAll`, y lo mismo con las sesiones necesarias para la frase. El evento guarda ids, no
  nombres, para que el borrado de un socio (ADR-008) lo borre **también del registro** sin
  recorrer la auditoría. Un alumno borrado o no encontrado sale como "Former member" y nunca rompe
  la fila; el nombre solo se guarda en el evento cuando no hay a quién apuntar (filas importadas
  sin casar).
- **"Logged by" (G3)**: el desplegable se rellena con `listStaffProfiles`
  (`apps/functions/src/staff/staff-callables.ts:568`), es decir personal y admins. No se carga el
  directorio de socios en la pantalla; filtrar por un socio concreto se hace desde su ficha.
- La respuesta lleva, por fila: `occurredAt`, `actorLabel` (nombre corto del actor), `actorIp`
  (solo si quien pregunta es admin) y `text` (la frase ya compuesta), más los campos
  estructurados que la tabla necesita.
- La propia consulta se audita con una acción restringida nueva, `class.history.read`, con el
  mismo vocabulario de resultado que `member.detail.read` (`completed`, `unavailable`,
  `rate-limited`): leer este registro es ver nombres e IP de socios.

**Frases** (inglés, compositor puro, una por acción):

- `booking.created`, rol miembro o tutor: `"<Student> booked the class of 16 Sep 2026 at 17:30"`.
- `booking.created`, rol staff: `"<Student> was booked by <Actor> into <Program> on 16 Sep 2026 at 17:30"`.
- `booking.cancelled`, miembro: `"<Student> cancelled the booking for the class of 16 Sep 2026 at 17:30"`.
- `booking.cancelled`, staff: `"The booking of <Student> for the class of 16 Sep 2026 at 17:30 was cancelled by <Actor>"`.
- asistencia: `"Attendance and absences were marked for the class: <sessionRef> | 16-09-2026 | 12:00"`.
- `dropin.created` / `dropin.cancelled`: equivalentes, con el nombre del visitante.

Las fechas se formatean en hora de Jersey (`Europe/Jersey`), como las ve el operador.

## 8. La pantalla

Ruta `/admin/classes-services/history`, admin únicamente (`staffVisible: false` ya está en
`classes-services-tabs.ts`). Estructura idéntica a Regyfit, estilo BPT (DESIGN.md):

- **Panel de filtros** (Gi White, `border-top: 0.35rem` BPT Purple, esquinas rectas): `Since`
  (`<input type="date">` + `<input type="time">` nativos), `Logged by` (`<select>` con el personal
  y los admins), `Registration type` (`<select>` con los diez tipos), `No. of records`
  (`<select>` 100/250/500/750/1000) y el botón `LIST`. **Nada se carga hasta pulsar LIST**, igual
  que Regyfit: la pantalla no dispara consultas caras al entrar.
- **Tarjeta `RECORDS (N)`** con el botón `PDF` alineado a la derecha del título, y la tabla
  `DATE/TIME · USER · IP · TASK`: reglas de 1 px en Line, cabecera en estilo eyebrow (0.72rem,
  700, mayúsculas, espaciado 0.15em, BPT Purple), `font-variant-numeric: tabular-nums` en fecha e
  IP, `overflow-wrap: anywhere` en la frase. Sin píldoras, sin iconos, sin menú de tres puntos.
- **Responsive**: por debajo de `50rem` cada fila se convierte en un bloque apilado con etiquetas
  (`DATE/TIME`, `USER`, `IP`, `TASK`), sin scroll horizontal. Objetivos táctiles ≥ 44 px.
- **Carga**: bloques de esqueleto en Paper Edge con la altura real de la tabla; nunca un spinner.
- **Vacío**: eyebrow + titular condensado + una frase ("No records for these filters.") y nada más.
- **Error**: banda con tinte y filo izquierdo Refused Red y una frase honesta ("The log is
  temporarily unavailable. Please try again."). Nunca el error de Firebase.
- **Accesibilidad**: `<table>` real con `<caption>` e `scope` en las cabeceras; el recuento de
  filas se anuncia con `aria-live="polite"`; foco visible con el anillo púrpura de 3 px; sin
  movimiento (DESIGN.md §7).

## 9. El PDF

`exportClassHistoryPdf` recibe los mismos filtros, aplica el mismo límite y la misma auditoría, y
devuelve los bytes generados con `pdf-lib` (ya es dependencia de functions, versión 1.17.1). El
documento lleva título, los filtros aplicados, la fecha de generación en hora de Jersey y la
tabla; sin adornos. El cliente lo descarga como `class-history-<fecha>.pdf`.

## 10. La importación del histórico

Captura previa (fuera del repo, runbook de staging privado): recaptura completa por VNC desde el
16 de enero de 2026, paginando con `Since` en ventanas semanales que no superen las 1000 filas por
consulta, a `/root/regyfit-capture/data/history-log.full.json`. Nunca se pulsa guardar ni borrar
en Regyfit.

**La captura no bloquea la construcción (G8)**: todo se construye y se prueba con datos falsos, y
la recaptura y la importación son las **dos últimas tareas** del plan. El túnel SSH lo abre el
operador cuando se llegue ahí; si ese día no puede, el resto ya está desplegado y el histórico
entra después.

`qa/scripts/regyfit-history-import.mjs`:

- Lee solo de `/root/regyfit-capture/data/` (jamás del repositorio).
- Traduce cada frase portuguesa a un evento estructurado con expresiones regulares explícitas, una
  por patrón conocido. **Una fila que no case con ningún patrón no se inventa**: va a
  `unmatched.json` con su texto original.
- Cruza a la persona por número de socio y, si falta, por nombre normalizado (decisión #17). Sin
  casar → el evento se escribe igual, con `studentId: null` y `studentName` con el nombre tal cual,
  y la fila se apunta en la lista de revisión.
- Actores que no existen en BPT: `actorId` del sistema, `actorRole: "regyfit"` y `actorName` con el
  nombre de Regyfit. No se crean usuarios.
- `source: "regyfit"`, IP importada tal cual (todas las filas son de 2026, dentro de los 12 meses).
- Id del documento derivado del hash del contenido: **idempotente**, repetirlo no duplica.
- `--dry-run` por defecto: cuenta, muestra los primeros diez eventos y el número de filas sin
  casar, y no escribe nada. Emulador primero; producción solo con confirmación del operador en
  chat y con `demo-` guardado como en el importador de sesiones.

## 11. Seguridad

- Los dos callables exigen admin y ámbito de academia; ningún rol de coach o staff los ve ni los
  puede llamar (los coaches no tienen esta pestaña, ADR-010).
- La IP solo se incluye en la respuesta y en el PDF si quien pregunta es admin.
- Sin datos personales en los `logger` ni en los mensajes de error; el cliente recibe cadenas
  seguras fijas.
- Todo lo que entra se valida con zod: fechas ISO, límites numéricos recortados, tipo de registro
  dentro de su enumeración, IP con formato válido.
- Salida a la vista: la frase se compone en el servidor y React la pinta como texto, nunca con
  `dangerouslySetInnerHTML`; la frase no admite marcado.
- Leer el registro deja rastro (`class.history.read`), de modo que la auditoría también cubre a
  quien audita.
- **Retención de la IP (G5)**: comprobado que `apps/functions/src/retention/` solo **genera
  avisos**; no hay ningún proceso que borre nada. Prometer 12 meses sin quien los aplique sería
  una política falsa, así que esta spec incluye un barrido propio: una función programada diaria
  que **borra el campo `actorIp`** (no el evento: el registro sigue íntegro) de los eventos de
  clases con más de 12 meses, por lotes. Se apunta en
  `docs/operations/t011-retention-residency-erasure-policy.md` y en la matriz de pruebas, con una
  prueba que la ejecuta sobre eventos con fecha vieja y comprueba que la IP desaparece y el evento
  sobrevive. ADR-008 se enmienda con esa línea.

## 12. Pruebas

- **Dominio**: contrato del evento (campos nuevos, IP válida e inválida, evento antiguo sigue
  siendo válido), traducción de tipo de registro a acciones y roles, y compositor de frases (una
  prueba por patrón, incluidos alumno desconocido y actor importado).
- **Functions**: servicio de consulta con fakes en memoria (límite recortado, filtro por rol,
  nombres no encontrados, IP oculta a un actor no admin); transacción de reserva (una reserva
  escribe su evento; si la escritura del evento falla, la reserva no se crea); PDF (el documento
  generado contiene las filas esperadas); callables (admin exigido, ámbito de academia, App Check).
- **Reglas**: `qa/rules` comprueba que ningún cliente puede leer `auditEvents`.
- **E2E (`/playwright`, etiqueta `@classes-services`)**: filtrar y listar, tabla con las cuatro
  columnas, estado vacío, descarga del PDF, y la vista móvil apilada; capturas en
  `qa/screenshots/cs-history-*.png`. Se ejecuta contra el export estático con emuladores
  (`NEXT_PUBLIC_FIREBASE_ENV=local`, `USE_FIREBASE_EMULATORS=true`, `ADMIN_E2E=true`).
- **Prueba negativa obligatoria** (LECCIONES.md §4): al desactivar la comprobación de admin en el
  callable, la prueba de seguridad tiene que fallar; se comprueba a mano y se deja anotado en la
  evidencia de la tarea.
- `verify:mvp` en verde antes de integrar.

## 13. Despliegue

Web y functions **juntos** (lección del 2026-09-17: un despliegue de web sin sus functions rompió
producción en silencio). Orden: `pnpm --filter @bpt-jersey/domain build:runtime` → functions →
push a `main` (Cloudflare Pages publica la web sola). Comprobación en producción: un POST sin
autenticar a `listClassHistory` debe responder 401, no 404. La importación del histórico va
después del despliegue y solo con confirmación explícita del operador.

## 14. Decisiones del grill (2026-09-17, sobre esta spec)

| # | Tema | Decisión |
| - | ---- | -------- |
| G1 | Roles | Se guarda el `UserRole` real de `actor-context.ts` (más `system` y `regyfit`), no una agrupación inventada. |
| G2 | Filtro socio/coach | Campo derivado `actorGroup` para poder filtrar en la consulta; el recuento mostrado es el real. |
| G3 | "Logged by" | Solo personal y admins, vía `listStaffProfiles`; no se carga el directorio de socios. |
| G4 | IP | Primera entrada de `X-Forwarded-For`, con `rawRequest.ip` de respaldo, validada; se verifica con una reserva real antes de dar la columna por buena. |
| G5 | Retención | Barrido programado diario que borra `actorIp` a los 12 meses y deja el evento intacto, con prueba. |
| G6 | Id del evento | Id automático generado antes de la transacción; el id de reserva es determinista y se reutiliza. |
| G7 | Nombres | Se resuelven al leer agrupando ids; el evento guarda ids para que el borrado de un socio alcance también al registro. |
| G8 | Captura | No bloquea: recaptura e importación son las dos últimas tareas del plan. |
| G9 | Fallo de auditoría | Falla cerrado (sin reserva sin registro), pero el evento no depende de datos opcionales y hay prueba con sesión incompleta. |
