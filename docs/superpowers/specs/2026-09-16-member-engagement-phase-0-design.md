# Fase 0 de la interfaz de miembros: racha, competidores y ajustes

Fecha: 2026-09-16. Estado: aprobada por el operador en chat (2026-09-16), construida en la misma
serie de commits que este documento.

## Objetivo

Dejar `main` en un estado en el que tres equipos distintos puedan construir en paralelo, sin pisar
los mismos ficheros y sin que sus resultados discrepen, las tres funciones que el operador pidió el
2026-09-16 para `/account`:

- **T042V2 Racha y progreso.** Título «Streak», barra de la próxima meta y barra de la próxima
  recompensa (a falta de una asistencia el tono se intensifica y aparece «Just x1 missing to get
  goal/reward!»), la llama animada con el multiplicador «x2, x3…» al lado, y las horas totales de
  entrenamiento desde septiembre. Avisos de la próxima promoción según la asistencia.
- **T043V2 Competidores.** Dos tablas: asistencia y progresión de cinturón. El miembro ve a los dos
  más cercanos por encima y a los dos más cercanos por debajo, con foto, nombre, cinturón y grados,
  racha de asistencia, y las técnicas que el otro tiene y él no, y al revés.
- **T044V2 Ajustes de cuenta.** El adulto cambia cualquier dato; el menor solo su foto de perfil, y
  ese cambio lo aprueba el tutor. El tutor puede dar acceso al adolescente con usuario y contraseña o
  con su cuenta de Google.

La fase 0 no construye ninguna de las tres. Construye lo que las tres comparten.

## Qué comparten (y por tanto va en la fase 0)

| Pieza compartida | Quién la lee | Quién la escribe | Dónde vive desde la fase 0 |
| --- | --- | --- | --- |
| Racha por sesiones, horas desde septiembre, barras de meta y recompensa | Racha, Competidores (tabla de asistencia) | Nadie: son funciones puras sobre asistencias | `packages/domain/src/members/member-engagement-contracts.ts` |
| Ficha pública de un miembro (foto, nombre, cinturón, grados, racha, técnicas) | Competidores | Ajustes (la foto) | mismo módulo: `MemberPublicCard` |
| Vecinos de una tabla (dos arriba, dos abajo) y diferencia de técnicas | Competidores | — | mismo módulo: `rankNeighbours`, `compareTechniques` |
| Campo `photoUrl` del estudiante | Competidores, Ajustes | Ajustes | `StudentProfile.photoUrl?: string` en `profile-contracts.ts` |
| Huecos en `/account` | Las tres | Fase 0 los abre una sola vez | `page.tsx`, `member-calendar.tsx` (`topSlot`), `calendar-header.tsx` (enlaces) |
| Llama animada | Racha | — | `apps/web/public/animations/streak-flame.json` + `lottie-web` en `apps/web` |
| Punto de registro de callables | Las tres | Fase 0 reserva un fichero por equipo | `apps/functions/src/{streak,competitors,account-settings}/*-callables.ts`, re-exportados en `index.ts` |
| Filas del ledger | Las tres | Fase 0 reserva T041V2–T044V2 | `tasksv2.md`, `Listav2/` |

## Decisiones

1. **Racha por sesiones, no por semanas.** `calculateAttendanceStreak` (levels) cuenta semanas y
   sirve a las metas familiares; sigue igual. La racha nueva cuenta asistencias consecutivas: cada
   una a menos de 7 días de la anterior. Un hueco de más de 7 días la reinicia. Es el número que
   acompaña a la llama («x3») y el que ordena la tabla de asistencia.
2. **Horas desde septiembre.** «Septiembre» es el 1 de septiembre más reciente que no sea futuro,
   en Europe/Jersey. Las horas salen de la duración de cada sesión asistida (`durationMinutes`), no
   de una constante.
3. **Meta y recompensa son objetivos numéricos** (`{ label, target }`) sobre asistencias desde el
   inicio de temporada. Quién los configura (dueño, por defecto del sistema) lo decide el equipo de
   Racha; la fase 0 fija el contrato y los valores por defecto (`goal` 10, `reward` 25).
4. **La tabla de competidores se sirve por callable, no por lectura directa de Firestore.** Así
   `firestore.rules` y `firestore.indexes.json` no cambian en ninguna de las tres ramas, y el filtro
   de menores se aplica en el servidor.
5. **Cohortes por edad en las tablas (decisión del operador, 2026-09-16):** dos cohortes
   separadas, calculadas en el servidor con la edad en Europe/Jersey el día de la consulta:
   `under16` (menos de 16 años) y `adult` (16 o más). Un menor de 16 solo ve y solo es visto por
   otros menores de 16; desde los 16 el miembro se trata como adulto en las tablas, y solo en las
   tablas (el resto de su tratamiento sigue siendo el de menor hasta los 18). La cohorte la da
   `leaderboardCohort(dateOfBirth, now)` en `members/engagement`; ningún equipo la recalcula por su
   cuenta. La DPIA de T011 debe recoger este tratamiento; no bloquea la construcción.
6. **Cuenta del adolescente:** ya existe el rol `teenStudent` y la fila T009V2. T044V2 depende de
   T009V2 y no redefine el rol: el adolescente entra con un usuario propio cuyo `studentId` resuelve
   `canonical-client-student-scope.ts`, igual que hoy. Google como proveedor de acceso es
   configuración de Firebase Auth en producción y la hace el operador.
7. **Orden en `/account`:** el slider «Ready for Jiu Jitsu» sigue siendo lo primero cuando aparece
   (T040V2, decisión 9). El bloque de racha va justo debajo y antes de la cabecera morada, en el
   hueco `topSlot`. Los enlaces a Competitors y Settings van en la cabecera, junto al de Progress.
8. **Ficheros que cada equipo puede tocar.** Los conflictos se evitan por propiedad, no por suerte:

   | Equipo | Escribe solo en | No toca |
   | --- | --- | --- |
   | Racha (T042V2) | `packages/domain/src/members/member-engagement-contracts*.ts` (solo añadir), `apps/functions/src/streak/`, `apps/web/src/lib/streak-client*.ts`, `apps/web/src/app/account/streak/` | `page.tsx`, `member-calendar.tsx`, `profile-contracts.ts`, reglas, índices |
   | Competidores (T043V2) | `apps/functions/src/competitors/`, `apps/web/src/lib/competitors-client*.ts`, `apps/web/src/app/account/competitors/` | idem, y no añade campos a `StudentProfile` |
   | Ajustes (T044V2) | `apps/functions/src/account-settings/`, `apps/web/src/lib/account-settings-client*.ts`, `apps/web/src/app/account/settings/`, `apps/functions/src/profiles/profile-service.ts` (foto), `apps/functions/src/families/` (acceso del adolescente) | `page.tsx`, `member-calendar.tsx`, reglas, índices |
   | Todos | su propia fila en `tasksv2.md` y `Listav2.data.js`, `apps/functions/src/deploy-runtime.ts` (una línea en su bloque), `docs/superpowers/{specs,plans}/` con su fecha | `apps/functions/src/index.ts` (ya re-exporta su fichero) |

9. **Orden de subida a `main`:** Ajustes → Racha → Competidores. Cada rama se rebasa sobre `main`
   antes de subir y pasa `corepack pnpm format:check && corepack pnpm lint && corepack pnpm typecheck
   && corepack pnpm test` en local, porque la integración continua de GitHub está parada por la
   facturación de la cuenta.
10. **`STACK.md` y `BRIEF.md` se retiran** en esta misma serie: solo servían al flujo Cronos, ya
    retirado (`ce38a25`). Las decisiones vigentes viven en `CLAUDE.md`, `PRODUCT.md`, `DESIGN.md`,
    `LECCIONES.md` y `docs/adr/`. Las referencias históricas en ledgers y planes antiguos se dejan.

## Lo que un equipo encuentra al empezar

- Contratos con pruebas en `@bpt-jersey/domain/members/engagement`.
- Su carpeta de callables ya re-exportada en `index.ts` (vacía).
- Su ruta o su hueco en `/account` ya renderizado (vacío o «Coming soon»).
- Su fila del ledger con id fijo, dependencias y superficie declarada.
- La llama en `/animations/streak-flame.json` y `lottie-web` instalada.
