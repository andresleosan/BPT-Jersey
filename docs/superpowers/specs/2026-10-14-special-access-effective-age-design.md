# Acceso especial = edad de referencia mayor (diseño)

Fecha: 2026-10-14 · Estado: pendiente de revisión de Luis · Clasificación: arquitectónica
(cambia reglas que usan reservas, asistencia, niveles, competidores y leaderboard)

## 1. Objetivo

Cuando el owner/admin da a un miembro acceso a clases de más edad (con el **rango de edad** de
Members → Access o con los **grupos extra** del perfil → Classes), ese miembro tiene derecho a
entrenar **y competir** a ese nivel. Para el pago cuenta su edad real. Para todo lo demás, la app
lo trata con su **edad de referencia**: la edad máxima de las clases a las que tiene acceso.

Éxito:
- La oficina y el coach pueden marcarlo presente en esas clases sin errores falsos.
- Su cinturón pasa solo a la escalera de esa edad, y sus requisitos (clases y tiempo) son los
  de esa escalera.
- En leaderboard y competidores aparece en la franja de esa edad.
- Sigue pagando lo mismo.

## 2. Diagnóstico de producción (14-oct-2026)

Hoy fallaron los 13 intentos de «marcar presente» (`staffWalkInAttendance`, 400). Reproducido en
solo lectura contra producción con el código del 13-oct:

| Miembro | Qué pasó | Causa |
|---|---|---|
| Evren Chan (8; extra 7-8YO y 9-10YO) | «plan or age doesn't cover this class» | Su plan `town-kids-1x` empieza a las 15:55 (14-oct) y las clases de las 15:30. Marcar presente busca un plan que empiece **antes de la hora de la clase**. Al no encontrarlo, lo manda por la vía de prueba/Intro, que ignora los grupos extra → `ineligible` |
| Marlon G. I. Fantauzzi (9; extra 10-12YO y Kids & Teens NoGI) | rechazo en Kids & Teens NoGI | Plan de 2 clases por semana ya cubierto (9-10YO hoy + sábado) → `weekly-limit`. Es correcto, pero el mensaje no lo explica bien |
| Alfred S Nila (6; extra 7-8YO, 9-10YO, K&T NoGI) | no reproducido | Con su plan (desde 09:53) podría reservar y marcar presente en las tres clases. Luis dirá en qué pantalla le falla |

Además, la pantalla de asistencia muestra la misma frase («plan or age…») para todos los
motivos `ineligible`, aunque el servidor sí sabe el motivo concreto.

## 3. Tabla de decisiones

| # | Decisión | Quién | Dónde |
|---|---|---|---|
| E1 | El pago (plan, precio, límite semanal, centros) se calcula siempre con la **edad real**. Todo lo demás usa la **edad máxima** de las clases a las que tiene acceso especial o extra | Luis | chat 2026-10-14, respuesta 1 |
| E2 | Cinturón, nivel y clases requeridas se miden con la **última edad (la máxima) a la que se le dio acceso**. Leaderboard y competidores lo muestran en esa edad | Luis | respuesta 2 |
| E3 | Las dos vías dan edad de referencia: el rango de Access y los grupos extra del perfil | Luis | «bien sea por acceso especial o extra acceso» |
| E4 | Al dar el acceso, el nivel **se mueve solo** a la escalera de la edad de referencia, con la regla de equivalencia (§5), sin confirmación. El owner puede corregirlo después | Luis | pregunta «Escalera» |
| E5 | Si el acceso caduca o se quita, el cinturón ganado **se queda** y la edad de referencia vuelve a la real | Luis | pregunta «Fin acceso» |
| E6 | Marcar presente respeta el límite semanal. El mensaje dice que ya usó sus clases de la semana y desde qué día puede volver a reservar | Luis | respuesta 3 |
| E7 | **Solo owner o admin** (no el coach) pueden marcarlo presente aunque haya llegado al límite semanal, con un segundo clic explícito | Luis | respuesta 3 |
| E8 | El plan cubre **todo su primer día** (día de Jersey): una clase de ese día cuenta aunque haya empezado antes de crear el plan. No cambia el pago | Claude, fallo de Evren (§2). Luis no lo rechazó: aclaró que el plan no cambia | respuesta 1 |
| E9 | Reservar: siguen abiertas **las clases de su edad real + las clases que el owner le dio** (D2 del 10-oct). La edad de referencia **no** abre más tipos de clase por sí sola | Claude: el owner elige las clases una a una, y abrir más sin que las elija contradice ese control. **Luis: confirma o corrige** | — |
| E10 | No usan la edad de referencia, por ley o por pago: el consentimiento y la gestión del tutor, los ajustes de cuenta 12+, el Free Trial/Intro, el registro (enrol), el precio y el tipo de participante del plan | Claude, por E1 | — |
| E11 | Con edad de referencia 16 o más, cuenta como adulto. Una clase sin edad máxima («16+») aporta su edad mínima | Claude, por E2 | — |
| E12 | Sin tests (regla del repo). Push a `main`; el deploy de functions solo con el OK de Luis | AGENTS.md | repo |

## 4. La regla (dominio, un solo punto)

`packages/domain/src/schedule/student-group-access-contracts.ts`:

```ts
/** E1/E2: the age the app uses for everything except payment. Real age when no grant is in force. */
export function referenceAge(input: {
  realAge: number | null;            // null = sin fecha de nacimiento (ya cuenta como adulto)
  access: Pick<StudentGroupAccess, "programIds" | "expiresOn" | "ageRange">;
  programs: readonly { programId: string; ageRange?: ProgramAgeRange | null; discipline?: string }[];
  todayKey: string;
}): number | null
```

- Toma los grupos extra en vigor (`effectiveGroupProgramIds`) y, de cada uno, `maxAge ?? minAge`.
  Las clases de Open Mat no cuentan: un Open Mat 4–15 subiría a cualquier niño a 15.
- Toma el rango en vigor (`effectiveAgeRange`) y usa `maxAge ?? minAge`.
- Devuelve el máximo entre esos valores y la edad real. **Nunca baja de la edad real.**
- `referenceTrainingRange(...)` devuelve `{minAge: realAge, maxAge: referenceAge}` y sustituye a
  `storedTrainingRange` / `trainingRangesById` allí donde estos alimentan niveles. Así, los grupos
  extra también quitan «Age: Not met».

## 5. Escalera y regla de equivalencia (E4)

`packages/domain/src/levels/level-progress.ts`, función nueva `ladderEquivalent(definitions,
currentKey, referenceAge)`, construida sobre `ladderIndexes`:

1. **Escalera destino:** la más alta cuya ventana de edad de apertura contiene `referenceAge`.
   El catálogo real tiene cuatro: 4–7, 7–10, Teens 10–15 y adultos 16+.
2. **Solo hacia arriba:** si la escalera destino no es más alta que la actual, no se hace nada.
3. **Color:** se lee del nombre del cinturón quitando la parte de edad, en orden IBJJF: white,
   grey-white, grey, grey-black, yellow-white, yellow, yellow-black, orange-white, orange,
   orange-black, green-white, green, green-black.
   - En la escalera destino se elige el cinturón del mismo color.
   - Si ese color no existe allí, el de color inferior más cercano.
   - Hacia adultos siempre White (regla IBJJF a los 16).
4. **Rayas:** las mismas que tenía, con tope en el máximo de la escalera destino (11 → 6 → 4).
5. Se conservan la fecha de inicio del nivel y las clases ya contadas: no es una promoción, es
   medirlo con otra escalera.
6. Se escribe con la misma forma que `setProgressLevel`, es decir, una promoción `owner-set` con
   `restore`. Así sale en el historial y el **Undo** existente la deshace. El actor es quien guardó
   el acceso y el motivo es «Special access: measured as age N».

Lo disparan `saveStudentAgeRange` y `saveStudentGroupAccess` después de guardar. No hace nada si
el nivel del miembro aún no está abierto. La respuesta indica si se movió y a qué nivel, y la
pantalla lo muestra («Level moved to Grey Teens · 2nd stripe»).

## 6. Dónde se aplica la edad de referencia

| Área | Archivo | Cambio |
|---|---|---|
| Requisitos y aviso de edad del nivel | `apps/functions/src/levels/level-service.ts` (resumen, candidatos, `listPromotionGaps`), `progress-report-service.ts` | `trainingRange` y `ageYears` salen de §4 |
| Leaderboard y competidores (kids/teens/adults) | `competitors/competitors-callables.ts`, `competitors/public-card.ts`, `session-roster/session-roster-callables.ts` | La franja usa `bandForAge(referenceAge)` en vez de la edad real (`leaderboardCohort`) |
| Marca para el coach | `schedule/pre-class-service.ts` | Sin cambios de regla; sigue mostrando el rango |
| Reservar y marcar presente | `booking-transaction-service.ts` | Sin cambios de edad (E9); cambios de §7 |

Graduaciones (`assessGraduation`) no miran la edad: cambian solas al cambiar el nivel (E4).

## 7. Marcar presente (oficina y coach)

1. **E8:** el plan cubre todo su primer día.
   - `membership()` en `booking-transaction-service.ts` compara el día de Jersey del inicio del
     plan con el día de la clase.
   - La búsqueda de plan de `createStaffWalkInAttendanceHandler` usa la misma regla.
   - El fin del plan no cambia.
2. **Motivo concreto:** `staffWalkInAttendance` añade a `details` un `why` corto (`age-centre`,
   `plan-site`, `plan-start`, `trial`, `weekly-limit`…) tomado del punto donde se rechaza.
   `walkInFailureMessage` lo traduce a una frase para la oficina. Si llega un motivo desconocido,
   se muestra la frase actual.
3. **E6 límite semanal:** «Evren Chan has already used this week's class (1 a week). They can
   book again from Monday 19 Oct.»
4. **E7 forzar:** si el que marca es owner o admin y el motivo es `weekly-limit`, aparece el botón
   «Mark present anyway».
   - Llama a `staffWalkInAttendance` con `overrideWeeklyLimit: true`.
   - El servidor solo lo acepta de owner o administrator; un coach recibe `permission-denied`.
   - Se salta solo el límite semanal y queda anotado en la reserva (`weeklyLimitOverriddenBy`).

## 8. Miembros que ya tienen acceso hoy

Script de una vez, `apps/functions/scripts/apply-special-access-ladder.mjs` (patrón de
`align-level-catalog-pdf.mjs`):
- Por defecto hace un **dry-run** que lista miembro → nivel actual → nivel equivalente.
- Solo escribe con `--apply` y el OK de Luis en el chat.

## 9. Despliegue

- Web: push a `main`.
- Functions, en tandas con `--only`: `saveStudentAgeRange`, `saveStudentGroupAccess`,
  `staffWalkInAttendance`, `requestBooking`, `requestBookingEu`, `getMemberCalendarWeek`,
  `getStudentProgressSummary`, `getProgressManagement`, `listGraduationBoard`, `getCompetitors`,
  `buildLeaderboards` y las de session-roster y public card que importen la regla.
- La lista exacta se saca del import graph al construir.

Sin índices nuevos ni cambios en `firestore.rules`.

## 10. Lo que vigilar al revisar

1. Un adulto con un grupo extra infantil (para ayudar) no debe bajar de edad: el máximo nunca
   baja de la real.
2. Un niño sin fecha de nacimiento ya cuenta como adulto; la edad de referencia no lo cambia.
3. Caducidad: con `expiresOn` pasado, la edad de referencia vuelve a la real ese mismo día y el
   nivel no se toca (E5).
4. Quitar y volver a dar el acceso no debe mover el nivel dos veces: «solo hacia arriba» lo
   impide.
5. Un coach no puede forzar el límite semanal, ni desde la UI ni llamando al callable.
