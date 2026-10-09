# Rango de edad por miembro + pestaña Access (diseño)

Fecha: 2026-10-10 · Estado: pendiente de revisión de Luis · Clasificación: arquitectónica

## 1. Objetivo

El owner o administrador puede dar a cualquier miembro (sobre todo niños con más nivel que su
edad) un **rango de edad de entrenamiento** «Desde X hasta Y años». Con él, el miembro ve,
reserva y hace check-in en las clases de esa franja, **además de** las de su edad real. Desde el
mismo bloque, el owner puede pasarlo a un nivel de la escalera de cinturones de esa edad, para que
sus asistencias cuenten con los requisitos de los mayores. Todo se gestiona en una pestaña nueva
**Access**, al lado de *Progress management*, en el directorio de miembros (`/admin/members`).

Éxito: un niño de 5 años con rango 8–10 ve y reserva «Over 8 (8–15)» en su calendario, en la
oficina y en la puerta. Sigue pagando su plan Kids. Si el owner lo abre en «White belt 7–10», sus
clases cuentan con los requisitos de 7–10 sin el aviso «Age: Not met».

## 2. Tabla de decisiones

| # | Decisión | Quién | Dónde |
|---|---|---|---|
| D1 | Modelo: un rango completo «Desde X hasta Y» por miembro (no una sola edad, no solo tipos sueltos) | Luis | chat 2026-10-10, pregunta 1 |
| D2 | El rango **se suma** a las clases de su edad real; nunca las pierde | Luis | pregunta 2 |
| D3 | Paga por su edad real y el plan queda intacto: las clases del rango gastan del límite semanal y respetan los centros del plan. Solo se salta la edad y el tipo de participante | Luis | pregunta 3 |
| D4 | El owner elige el nivel de la escalera mayor en el mismo bloque; el rango quita el aviso «Age: Not met» | Luis | pregunta 4 |
| D5 | Al cambiar de nivel, el campo «Clases ya hechas en este nivel» sale precargado y el owner decide | Luis | pregunta 5 |
| D6 | Cualquier rango, también de adultos; si un menor de 16 queda con acceso a clases 16+, aviso que hay que confirmar. El consentimiento del tutor sigue como hoy | Luis | pregunta 6 |
| D7 | Lo ven la oficina, el coach (marca en su lista) y el miembro/tutor. El motivo solo lo ve la oficina | Luis | pregunta 7 |
| D8 | Rango: owner + admin. Nivel: solo owner (se mantiene la D1 de progress management) | Luis | pregunta 8 |
| D9 | Va en una pestaña nueva al lado de *Progress* en el directorio de miembros | Luis | mensajes 2026-10-10 |
| D10 | Motivo obligatorio para el rango y fecha de fin opcional (día de Jersey, inclusive), igual que el acceso extra | Claude (por precedente del 2026-09-21), aceptado con el diseño | diseño aprobado |
| D11 | Se guarda en el documento existente `studentGroupAccess/{studentId}` | Claude, aprobado | diseño aprobado |
| D12 | Corregir `PRODUCT.md:135`: el acceso extra salta solo la edad (así lo hace el código), no centros ni límite semanal | Claude, aprobado | diseño aprobado |
| D13 | Sin tests (regla del repo); push a `main` y deploy de functions solo con OK explícito | AGENTS.md | repo |

## 3. Regla (dominio, un solo punto)

En `packages/domain/src/schedule/student-group-access-contracts.ts`:

- El campo nuevo `ageRange: { minAge, maxAge | null, reason, expiresOn } | null`. Las edades son
  enteros dentro de `programAgeLimits` (3–99), con `maxAge ≥ minAge`; `maxAge` null = sin tope.
  El motivo es obligatorio (1–500 caracteres) y la fecha de fin, opcional.
- `ageRangeAdmits(programAgeRange, memberRange)`: los rangos se cruzan. Un tipo sin `ageRange`
  (null = todas las edades) ya admite a cualquiera, así que el rango no cambia nada para él.
- `effectiveAgeRange(access, todayKey)` devuelve null si no hay rango o si ya pasó su fecha de fin.
- `rangeExtraProgramIds(access, programs, todayKey)` devuelve los tipos que abre el rango. Las
  pantallas los unen a `effectiveGroupProgramIds`.

Con esto el rango funciona **exactamente** como un tipo extra para cada tipo de clase que cruza, y
reutiliza todo el camino que ya existe: se salta la edad y el tipo de participante; se mantienen
plan activo, pagos, centros, límite semanal, capacidad (incluida la de por edad, que usa la edad
real), cierre de reserva e Intro Class (solo adultos en trial). Igual que el acceso extra, el rango
solo actúa con un plan activo; en trial o sin plan no cambia nada.

## 4. Servidor

- **Transacción de reserva** (`booking-transaction-service.ts:855-876`): lee `ageRange` del mismo
  documento ya leído; `additionalAccess = programIds.includes(...) || ageRangeAdmits(...)`. Cubre
  `requestBooking`/`requestBookingEu`, la reserva masiva, la reserva de oficina, `walkInCheckIn`,
  `staffWalkInAttendance` y la lista de espera (todos pasan por `confirmBookingInTransaction`).
  Las reservas hechas antes de que caduque o se quite el rango se mantienen.
- **Calendario** (`member-calendar-week-callables.ts`): suma `rangeExtraProgramIds` a
  `additionalProgramIds` y devuelve `ageRange {minAge, maxAge}` (sin motivo ni fecha) al miembro.
- **Guardar** (`student-group-access-callables.ts`): `saveStudentGroupAccess` acepta `ageRange`.
  Lo pueden usar owner y admin, como hoy. La revisión, `studentGroupAccessEvents` y `auditEvents`
  guardan el antes y el después del rango. `getStudentGroupAccess` lo devuelve.
- **Lista de excepciones**: callable nuevo `listStudentAccessExceptions` (owner/admin). Lee la
  colección `studentGroupAccess` de la academia y devuelve las que tienen tipos extra o rango
  vigente, con nombre y edad. Sin índice compuesto: es una lectura de colección pequeña.
- **Lista del coach** (`getSessionOperationalView`): añade `ageRange {minAge, maxAge}` vigente a
  cada alumno del roster (un `getAll` de los documentos de acceso de esos alumnos). No incluye
  motivo ni fecha.
- **Aviso de edad en niveles** (`level-contracts.ts`): `evaluateAgeBand` recibe un
  `trainingRange` opcional. Se cumple si la edad real encaja o si la franja del nivel se cruza con
  el rango. `level-service.ts` lo pasa en el resumen de progreso (2230, 3699), en los candidatos
  (2468, 3780) y al abrir un nivel (279). Graduaciones no cambia (`assessGraduation` no usa edad).
- **Nivel**: sin lógica nueva. El bloque llama a `setProgressLevel` (solo owner, con clases y días
  iniciales y sus límites actuales).

## 5. Pantalla: pestaña Access (`/admin/members?view=access`)

- `memberViews` añade `{ value: "access", label: "Access" }` justo después de *Progress
  management*. La ven owner y administrador; los coaches no tienen el directorio.
- **Lista** (AdminDataTable): Member (nombre + edad real), Age range, Extra classes, Ends, y la
  acción *Edit* en la fila. Vacía → estado vacío de DESIGN.md (eyebrow + titular + una frase).
- **Add exception**: buscador de miembros (reutiliza `member-name-search`/las filas del overview).
  Al elegir uno, o con *Edit*, se abre el bloque con:
  1. **Age range**: From / To (number, ≥16 px, To vacío = sin tope), con una ayuda que lista los
     tipos que abriría («Opens: Over 8 (8–15), Kids & Teens Open Mat»).
  2. **Extra classes**: el `GroupAccessEditor` actual, reutilizado (sigue también en perfil →
     Classes).
  3. **Reason** (obligatorio) y **Ends on** (opcional).
  4. **Level** (solo owner): selector de niveles del catálogo filtrado a las escaleras que cruzan
     el rango, más «Classes done at this level» precargado con las actuales y sus límites. Es un
     guardado aparte (`setProgressLevel`) para que un fallo de uno no deshaga el otro.
  5. Si la edad real es menor de 16 y el rango llega a 16+, aparece una banda roja de DESIGN.md
     («Gets access to adult (16+) classes») y una casilla de confirmación obligatoria antes de
     *Save*.
  6. *Remove range* quita solo el rango (motivo de la retirada en el historial).
- Diseño: radio 0 en admin, tabla con filetes de 1 px, estados con borde izquierdo, acciones en
  línea, sin spinners (esqueleto). Al implementar se aplican `impeccable` y `taste-skill` sobre
  `DESIGN.md`.

## 6. Lo que ve el miembro y el coach

- `/account` calendario: una línea bajo la cabecera, «You can also book classes for ages 8–10»
  (o «ages 8+»). Sin motivo ni fecha. Las clases aparecen como cualquier otra reservable.
- Coach, lista de la clase: etiqueta discreta «Age range 8–10» junto al nombre.

## 7. Fuera de alcance

- Conversión automática de nivel entre escaleras (D4 la descarta).
- Cambiar precio o plan por el rango (D3).
- Edición masiva de varios miembros a la vez.
- Tests automáticos (D13).

## 8. Entrega

1. Push a `origin/main`: la web se publica sola en Cloudflare Pages.
2. Con OK de Luis, deploy en tandas, en `europe-west9`: `getStudentGroupAccess`,
   `saveStudentGroupAccess`, `listStudentAccessExceptions`, `getMemberCalendarWeek`,
   `requestBooking`, `requestBookingEu`, `walkInCheckIn`, `staffWalkInAttendance`, las de reserva
   masiva y lista de espera que usan la transacción, `getSessionOperationalView`, y las de niveles
   que llaman `evaluateAgeBand` (`getStudentProgressSummary` y candidatos). La lista exacta sale
   del plan con `grep` de importadores.
3. Hasta que se desplieguen las functions, la pestaña puede guardar el rango, pero las reservas no
   lo aplican: por eso, functions justo después del push.
