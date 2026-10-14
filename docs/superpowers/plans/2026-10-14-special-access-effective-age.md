# Acceso especial = edad de referencia · plan de implementación

> Para agentes: ejecuta con superpowers:subagent-driven-development (agente `sdd-opus-medium`), una
> tarea por agente y revisión entre tareas.

**Objetivo:** el acceso especial o extra hace que la app trate al miembro con la edad máxima de
las clases a las que tiene acceso (niveles, escalera, leaderboard, competidores). El pago sigue
con su edad real. Además, marcar presente deja de fallar en falso y explica el motivo de cada
rechazo.

**Spec:** `docs/superpowers/specs/2026-10-14-special-access-effective-age-design.md`. Es la
autoridad; las decisiones E1–E12 se citan por número.

**Stack:** monorepo pnpm, TypeScript estricto, Firebase Functions v2 (europe-west9), Next.js 16
con export estático, dominio zod en `packages/domain` (nunca importa Firebase).

## Restricciones globales

- **Sin tests** (AGENTS.md de BPT-Jersey): no añadir, correr ni esperar suites. Se verifica
  compilando solo lo tocado y con la réplica de solo lectura de la tarea 7.
- Trabajo directo en `main`. **Nunca `git add -A`**: solo tus archivos, porque hay otras sesiones
  en el repo. Commit con mensaje corto e imperativo y el trailer
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **No hacer push ni deploy**: lo hace el controlador.
- Estilo ponytail: el cambio más corto que funcione; reusa los helpers existentes; comentarios
  con la densidad del archivo.
- El pago no cambia: planes, precio, límite semanal, centros, tipo de participante del plan,
  tutor, consentimientos, ajustes 12+, Free Trial/Intro y enrol siguen con la edad real (E1, E10).
- Reservar: no cambia qué clases se abren (E9).
- Compilar el dominio: `corepack pnpm --filter @bpt-jersey/domain build:runtime`.
- Tipos de functions: `corepack pnpm --filter @bpt-jersey/functions exec tsc --noEmit -p tsconfig.json`.
  Errores en archivos `*.test.ts` que ya existían se ignoran; solo cuentan los de archivos que
  hayas tocado.
- Tipos de web: `corepack pnpm --filter @bpt-jersey/web exec tsc --noEmit`, con el mismo criterio.

## Lo que vigilar al revisar

1. Un adulto con un grupo extra infantil nunca baja de edad: `referenceAge ≥ edad real`.
2. Sin fecha de nacimiento: `realAge = null` y sigue como adulto; la referencia no lo cambia.
3. Con `expiresOn` pasado (día de Jersey), la referencia vuelve a la real ese día.
4. El cambio de escalera es solo hacia arriba: dar el acceso dos veces no mueve dos veces.
5. Un coach no puede forzar el límite semanal (ni por la UI ni por el callable).

---

### Tarea 1 — La regla en el dominio

**Archivos:**
- `packages/domain/src/schedule/student-group-access-contracts.ts`: junto a `effectiveAgeRange`,
  `ageRangeAdmits` y `storedTrainingRange`.
- `packages/domain/src/levels/level-progress.ts`: junto a `ladderIndexes`.

**Produce:**

```ts
// student-group-access-contracts.ts
export type ReferenceProgram = Readonly<{ programId: string; ageRange?: ProgramAgeRange | null; discipline?: string }>;
/** E1/E2: the age the app uses for everything except payment. Never below the real age. */
export function referenceAge(input: {
  realAge: number | null;
  access: Pick<StudentGroupAccess, "programIds" | "expiresOn" | "ageRange"> | null;
  programs: readonly ReferenceProgram[];
  todayKey: string;
}): number | null;
/** Range handed to evaluateAgeBand: {minAge: realAge ?? reference, maxAge: reference}; null when no grant lifts the age. */
export function referenceTrainingRange(...same input): ProgramAgeRange | null;
/** Like storedTrainingRange but from the raw stored doc + programs (both mechanisms, E3). */
export function storedReferenceAge(data: unknown, academyId: string, studentId: string,
  realAge: number | null, programs: readonly ReferenceProgram[], todayKey: string): number | null;
```

**Regla:**
- Toma los grupos extra en vigor (`effectiveGroupProgramIds`), excluye `discipline === "open-mat"`
  y saca `ageRange.maxAge ?? ageRange.minAge` de cada uno. Los programas sin `ageRange` no
  aportan nada.
- Toma el rango en vigor (`effectiveAgeRange`): `maxAge ?? minAge`.
- Devuelve `max(realAge, …)`. Si `realAge` es null, devuelve null (cuenta como adulto, regla
  existente).
- `referenceTrainingRange` devuelve null cuando la referencia es igual a la edad real.
- `storedReferenceAge` valida el documento igual que `storedTrainingRange` (academyId y studentId
  coinciden), lo parsea con `studentGroupAccessSchema` en modo safe y, si no es válido, devuelve
  la edad real.

```ts
// level-progress.ts
/** E4: the equivalent rank on the ladder for referenceAge; null when no upward move applies. */
export function ladderEquivalent(definitions: readonly LevelDefinitionRecord[],
  currentKey: string, referenceAge: number): LevelDefinitionRecord | null;
```

**Regla (spec §5):**
1. Escalera destino: la de índice más alto (según `ladderIndexes`) cuya ventana de apertura (el
   min/max de su primera definición) contiene `referenceAge`.
2. Si no es más alta que la actual, devuelve null.
3. Color del cinturón: el nombre de la definición `belt` en minúsculas, quitando desde «belt».
   Ejemplos: «grey and white belt 7-8…» → `grey-white`; «yellow belt teens…» → `yellow`.
   Para una `stripe`, el color es el de su `parentDefinitionKey`.
4. Orden: white, grey-white, grey, grey-black, yellow-white, yellow, yellow-black, orange-white,
   orange, orange-black, green-white, green, green-black.
   - En la escalera destino se elige el cinturón del mismo color; si no existe, el del rango
     inferior más cercano; y si tampoco, el primero de la escalera.
   - Hacia adultos (ventana 16+) siempre su White.
5. Rayas: `stripeNumber` actual (0 si es cinturón), con tope en la raya más alta de ese
   cinturón en la escalera destino. Se devuelve esa raya, o el cinturón si queda en 0.

Exporta las tres funciones de schedule por el subpath existente, sin subpaths nuevos. Si añades
alguno, regístralo también en `apps/functions/src/deploy-runtime.ts`.

**Verificar:** `build:runtime` limpio. Usa este self-check con node sobre `packages/domain/lib`
(el script va en el scratchpad, no en el repo):
- 8 años, extras 7-8 y 9-10 → 10;
- 8 años, extra Open Mat 4–15 → 8;
- adulto de 30 con extra 7-8 → 30;
- rango 8–null → 8;
- con `expiresOn` de ayer → la edad real.

**Commit:** `feat(domain): reference age from special access and ladder equivalent`.

---

### Tarea 2 — Niveles miden con la edad de referencia

**Archivos:**
- `apps/functions/src/levels/level-service.ts`: usos de `storedTrainingRange` y
  `trainingRangesById` en ~2253, ~2365–2404 y ~2731, y donde se calcula `ageYears` para
  `listPromotionGaps` / `evaluateAgeBand`.
- `apps/functions/src/levels/progress-report-service.ts` (~64–127).

**Cambio:**
- En cada sitio, cambia el rango de edad (`trainingRange`) por `referenceTrainingRange` y la
  edad que se pasa a `listPromotionGaps` por `referenceAge`.
- Necesitas los programas: léelos una vez por llamada del store o de la colección `programs` que
  ese servicio ya use (busca un `listPrograms` existente).
- En los listados (2365) lee los programas una sola vez, nunca una vez por alumno.

**Verificar:** tsc de functions limpio en los archivos tocados.

**Commit:** `feat(levels): measure special-access members at their reference age`.

---

### Tarea 3 — Leaderboard y competidores en la franja de referencia

**Archivos:**
- `apps/functions/src/competitors/competitors-callables.ts` (~183)
- `apps/functions/src/competitors/public-card.ts` (~128)
- `apps/functions/src/session-roster/session-roster-callables.ts` (~183–192)
- dominio: `packages/domain/src/members/member-engagement-contracts.ts`

**Cambio:**
- Añade `leaderboardCohortForAge(age: number | null): LeaderboardCohort` con
  `bandForAge(age)`; `adult` pasa a `adults`.
- Cada sitio calcula la `referenceAge` de cada miembro: lee `studentGroupAccess` en bloque (una
  lectura de la colección o `getAll`, como `trainingRangesById` en level-service) y los programas
  una vez.
- `leaderboardEligible` no cambia: sin fecha de nacimiento sigue fuera.

**Verificar:** tsc limpio.

**Commit:** `feat(competitors): place special-access members in their reference cohort`.

---

### Tarea 4 — Mover el nivel solo al dar acceso (E4)

**Archivos:**
- `apps/functions/src/levels/progress-management-callables.ts` (`setProgressLevel`, ~251):
  extrae el cuerpo de la transacción a un helper exportado
  `writeOwnerSetLevel(db, {academyId, actorId, studentId, definitionKey, startedAt, classes, days, note})`.
  `setProgressLevel` pasa a llamarlo sin cambiar su comportamiento.
- `apps/functions/src/schedule/student-group-access-callables.ts`: `saveStudentGroupAccess`
  (~96) y `saveStudentAgeRange` (~158).
- Web: `apps/web/src/lib/student-group-access-client.ts`, `apps/web/src/app/admin/members/access-tab.tsx`
  y `apps/web/src/app/admin/members/profile/group-access-editor.tsx`.

**Cambio:**
1. Después de guardar con éxito:
   - calcula `referenceAge` con el documento recién guardado;
   - lee la cabeza `studentLevelProgress/{studentId}` (si no está `initialized`, no hace nada)
     y el catálogo publicado;
   - `ladderEquivalent(defs, head.currentDefinitionKey, ref)`;
   - si devuelve algo, `writeOwnerSetLevel`:
     - conserva `currentLevelStartedAt` y las clases ya contadas (las del head);
     - nota «Special access: measured as age N»;
     - el actor es quien guardó.
2. La respuesta añade `levelMove: { definitionKey, name } | null`.
3. Un fallo al mover el nivel **no** revierte el acceso guardado: se registra con `logError` y
   la respuesta lleva `levelMove: null`.
4. El cliente parsea `levelMove` como opcional. La UI muestra, junto al aviso de guardado,
   «Level moved to {name}.» (texto en inglés, como la app).
5. La pestaña Access refresca el bloque de nivel tras guardar.

**Verificar:** tsc de functions y web limpio.

**Commit:** `feat(access): move the level to the reference-age ladder when access is granted`.

---

### Tarea 5 — Marcar presente: primer día, motivo concreto, límite semanal, forzar

**Archivos:**
- `apps/functions/src/schedule/booking-transaction-service.ts`: `BookingTransactionError` (69),
  `invalid` (154), `membership()` (~262), las comprobaciones de ~794–970 y
  `executeBookingInTransaction`.
- `apps/functions/src/schedule/schedule-callables.ts`:
  `createStaffWalkInAttendanceHandler` (~1281) y `mapBookingError`.
- La ruta Intro (`requestIntroBookingTransaction`): solo añadirle `why`, sin cambiar sus reglas.
- `apps/web/src/lib/schedule-client.ts` (`walkInFailureMessage` ~593, `staffWalkInAttendance`).
- `apps/web/src/app/admin/attendance/page.tsx` (`handleWalkIn` ~310) y `session-roster.tsx`.

**Cambio:**
1. **E8.** En `membership()`, el inicio compara días de Jersey: el plan vale si el día de su
   `startsAt` es igual o anterior al día de la clase (usa `localDate`/`dateKeyInJersey`). El fin
   no cambia. La búsqueda de plan del handler de walk-in usa la misma regla, con un helper
   compartido exportado del servicio.
2. **Motivo.** `BookingTransactionError` gana un `why?: string` opcional (tercer argumento de
   `invalid`). Asígnalo en cada rechazo `ineligible`/`weekly-limit` de la ruta de reserva:

   | Rechazo | `why` |
   |---|---|
   | Plan fuera de fechas o no activo | `plan-dates` |
   | Alumno inactivo | `member-inactive` |
   | Centro sin confirmar | `centre-unconfirmed` |
   | Clase de curso | `course` |
   | Clase privada | `private` |
   | Clase Intro | `intro` |
   | Tipo cerrado por edad o centro (~950) | `age-centre` |
   | `PLAN_INACTIVE` | `plan-inactive` |
   | `PARTICIPANT_TYPE_NOT_ELIGIBLE` | `plan-age` |
   | `CLASS_SITE_NOT_ELIGIBLE` | `plan-site` |
   | `OPEN_MAT_SITE_NOT_ELIGIBLE` | `plan-open-mat` |
   | Límite semanal | `weekly-limit` (el `code` ya lo es) |
   | Franja de edad (`audience`) | `plan-age` |
   | Ruta Intro, cuando el alumno no tiene plan | `trial` |

   `mapBookingError` pone `why` en `details`.
3. **Registro.** En el handler de walk-in, cada rechazo escribe una línea con `logError` o
   `console.warn`: `walk-in-refused`, `sessionId`, `studentId`, `code`, `why` y `message`. Solo
   ids, sin nombres.
4. **E6.** `walkInFailureMessage(error, name)` traduce cada `why` a una frase clara para la
   oficina, en inglés. Para `weekly-limit`:
   «{name} has already used this week's classes on their plan. They can book again from Monday
   {d MMM}.» El lunes siguiente se calcula en el cliente a partir de la fecha de la sesión.
   - Si el `why` es desconocido, la frase actual.
   - `age-centre`: «This class is outside {name}'s age or centre, and no special access covers it.»
   - `plan-dates`: «{name}'s plan doesn't cover this date.»
   - `trial`: «{name} has no plan for this class; their trial doesn't cover it.»
   - Las demás, una frase corta equivalente.
5. **E7.**
   - `staffWalkInAttendance` acepta `overrideWeeklyLimit?: boolean`. Si es true y el rol no es
     `owner`/`administrator`, devuelve `permission-denied`.
   - El handler lo pasa a `confirmBookingInTransaction` (`overrideWeeklyLimit`), que solo se salta
     `WEEKLY_LIMIT_REACHED` y escribe `weeklyLimitOverriddenBy: actorId` en la reserva.
   - En la UI, cuando el fallo es `weekly-limit` y el usuario es owner o admin (mira cómo la
     página ya distingue el rol), junto al error sale el botón «Mark present anyway», que repite
     la llamada con el flag.
   - El coach no ve el botón.

**Verificar:** tsc de functions y web limpio.

**Commit:** `fix(attendance): first-day plans, specific walk-in reasons and an office weekly-limit override`.

---

### Tarea 6 — Script para los miembros que ya tienen acceso

**Archivo:** `apps/functions/scripts/apply-special-access-ladder.mjs` (patrón de
`align-level-catalog-pdf.mjs`: `GCLOUD_PROJECT`, academia `demo-academy`, actor = uid del owner
por argumento).

**Cambio:**
- Recorre `studentGroupAccess`, calcula `referenceAge` y `ladderEquivalent` con el dominio
  compilado y lista `alumno → nivel actual → nivel nuevo`.
- Solo escribe con `--apply`, usando la misma forma que `writeOwnerSetLevel`: si es importable
  desde el build de functions, impórtalo; si no, replica su escritura citándolo.
- Sin `--apply` no escribe nada.

**Commit:** `chore(levels): script to move existing special-access members to their ladder`.

---

### Tarea 7 — Verificación (controlador)

1. Compilar el artefacto de functions con `build-deploy-artifact.mjs`.
2. Réplica de solo lectura contra producción con el artefacto nuevo:
   - todos los miembros con `studentGroupAccess` × las sesiones de esta semana de sus programas
     (los de su edad y los extra);
   - todas las escrituras de la transacción se descartan;
   - se espera «WOULD BOOK» o un rechazo legítimo con su `why` (límite semanal, plan, centro).
     Ninguno de la ruta Intro por culpa de un plan creado el mismo día.
3. Dry-run del script de la tarea 6: se le enseña a Luis la lista.
4. En local (`qa/scripts/run-recovery-stack.mjs`) o con la réplica:
   - el mensaje concreto de cada rechazo;
   - «Mark present anyway» para owner y no para coach;
   - el aviso «Level moved to…».
5. Push y deploy de functions en tandas de 10 con `--only`, **solo con el OK de Luis**.
