# Gamificación y capa social del miembro: diseño

Fecha: 2026-09-24. Decisiones fijadas por el operador (Luis) en conversación, una a una (Q1–Q10).
**Sustituye** a `docs/superpowers/plans/2026-09-23-member-features-parallel-sessions.md` como plan de
ejecución: aquel reparto en sesiones paralelas no se ejecutó y queda archivado como referencia.
**Hereda sin cambios** sus decisiones D1–D11 (§4 de aquel documento) y las decisiones de sesión A1–A6,
B1–B5, C1–C5, D-1–D-3, E1–E6, F1–F4, G2–G3 y H1–H5, salvo donde este documento diga otra cosa.
Base técnica: fase 0 del 16-sep (`docs/superpowers/specs/2026-09-16-member-engagement-phase-0-design.md`).

## Objetivo

Que un miembro (o su tutor) vea en `/account` su racha, su próxima promoción, su posición frente a
sus compañeros de franja y quién va a su clase; que el tutor gestione su propia suscripción, las de
sus hijos, sus fotos y el acceso propio de los hijos de 12–17; y que nadie reserve sin haber aceptado
los términos vigentes. Todo sin exponer datos de un miembro más allá de su ficha pública.

## Qué ya existe (no se reconstruye)

- `packages/domain/src/members/member-engagement-contracts.ts`: `buildMemberStreakSummary`,
  `sessionStreak`, `seasonStartFor`, `compareTechniques`, `leaderboardCohort`, `MemberPublicCard`,
  `defaultGoal` (10) / `defaultReward` (25).
- `/account/streak/streak-panel.tsx` (vacío), `/account/competitors`, `/account/settings` (vacío),
  `apps/web/public/animations/streak-flame.json` + `lottie-web`.
- `decideMemberAccess` (edad evaluada en cada petición: el tutor pierde el acceso a los 18 solo).
- `WaiverGate` + `hasAcceptedEnrolmentWaiver` (hoy solo lo exige la reserva de prueba).
- R2 `createPrivateImageUrl` (GET firmado) y `sharp` en functions.

## Decisiones de esta ronda

| # | Tema | Decisión |
|---|---|---|
| Q1 | Plan de ayer | Este diseño lo sustituye; ejecución **secuencial** en fases. |
| Q2 | Servir fotos | Bucket **privado**. El perfil guarda `photoObjectKey`, nunca una URL. Los callables firman una URL GET de **15 min** solo si hay `photoConsentAt`. `photoUrl` antiguo no se usa para fichas públicas. |
| Q3 | Saneado | Recorte cuadrado en el cliente con `<canvas>` nativo → WebP 512. El servidor acepta ≤ 2 MB, decodifica con `sharp` (rechaza lo que no sea imagen), **re-codifica** a WebP 512×512 sin metadatos y escribe con clave nueva `avatars/<studentId>/<uuid>.webp`. Borra la anterior. |
| Q4 | Teen a los 18 | Las credenciales no caducan. El primer acceso con edad ≥ 18 por vínculo `self` de una cuenta creada por el tutor muestra un bloqueo único «You're 18 — this account is now yours. Set a new password.» (reautenticación + `updatePassword`); el servidor marca `adultClaimedAt` y revoca los refresh tokens previos. El tutor puede revocar antes de los 18. |
| Q5 | Disclaimer | Bloqueo **por participante**, que **falla cerrado**: si el participante seleccionado no tiene el waiver vigente o un disclaimer T117, su vista queda sustituida por una tarjeta bloqueante con botón a `/account/waiver`; error de comprobación → «We couldn't check your terms — Retry». Settings, My plan y logout nunca se bloquean. Banner para los demás participantes pendientes. El **servidor** rechaza cualquier reserva sin waiver aceptado (`booking-transaction-service`). |
| Q6 | Pruebas | Unitarios solo de funciones puras de dominio + tests de rules de lo que cambie + suite E2E final contra emuladores (`desktop-chromium` y `mobile-chromium`). Todo se ejecuta al final. |
| Q7 | Publicación | Commit por fase en `main` local, **sin push** hasta que la E2E pase; después un push y un único deploy de la lista exacta de functions con OK explícito de Luis. |
| Q8 | Nombre público | Nombre de pila + inicial del apellido («Mia R.»); si colisiona dentro de la cohorte, se añaden letras del apellido hasta distinguir («Mia Ro.»). Lo genera el servidor. |
| Q9 | Visibilidad | Interruptor «Show me to other members» en Settings, **activo por defecto**; para menores lo controla el tutor. Apagado: no sale en ningún leaderboard ajeno y en el roster cuenta como anónimo; sigue viendo su propia posición. |
| Q10 | Ranking | **Snapshot nocturno** (23:30 Europe/Jersey) en `leaderboards/{cohort}`; `getCompetitors` = 1 lectura. La racha propia sigue en vivo. Luis aprobó el job programado nuevo (~0,10 $/mes). |
| Q11 | «Mayores de 18» en My plan | Se mantiene A4: **quien añade** es un adulto 18+ (`adultStudent` o `guardian`); el hijo añadido es menor. No se asocian dependientes ≥ 18 (no hay relación «pagador ≠ tutor»). |
| Q12 | Tutor existente que quiere entrenar | En My plan, si la cuenta no tiene vínculo `self`, tarjeta **«Train yourself»** junto a «Add a child». Mismo callable con `kind: "self" \| "child"` (prerrellena con el perfil del tutor); la oficina aprueba (D2) y se crea el alumno `self`. |
| Q13 | Orden de fases | 0 dominio → 1 H franjas → 2 A familia/My plan → 3 B settings/fotos/teen → 4 C racha → 5 E competidores → 6 F detalle de sesión → 7 G disclaimer → 8 pulido visual (`/impeccable`, `/taste-skill`, `/redesign-skill`) → 9 verificación (unitarios, rules, E2E, revisión) y OK de Luis para push + deploy. |

## Arquitectura

Capas estándar del repo (domain → service → firestore → callables → client → UI). El dominio no
importa Firebase.

### Dominio (`packages/domain`)

- `memberships/participant-band.ts`: `participantBandAt({dateOfBirth, onIso}) → "kids" | "teens" | "adult"`
  (Europe/Jersey; <12, 12–15, 16+; sin fecha → `adult`). `leaderboardCohort` delega aquí.
- `members/member-engagement-contracts.ts` (solo añadir):
  - `MemberPublicCard` gana `attendancesSinceSeasonStart`, `promotionPercent: number | null`;
    `photoUrl` pasa a significar «URL firmada efímera o null».
  - `publicDisplayNames(people) → Map<studentId, string>` (Q8).
  - `leaderboardNeighbours(rows, studentId, radius = 2) → {above, current, below}`.
  - `nextProgressTarget(count, base)`: siguiente múltiplo tras completar (C3).
  - Esquemas zod de `LeaderboardSnapshot` y de las respuestas de los callables nuevos.
- `levels/promotion-notice.ts`: `promotionMilestone(summary) → "75" | "90" | "oneLeft" | null`.
- `members/member-access-contracts.ts`: `teenAccountMinimumAge = 12`;
  `needsAdultClaim({age, via, createdByGuardian, adultClaimedAt})`.
- `profiles/profile-contracts.ts`: `photoObjectKey`, `photoConsentAt`, `photoConsentBy`,
  `showToMembers` (por defecto `true`).

### Functions (`apps/functions/src`)

| Carpeta | Callables | Notas |
|---|---|---|
| `family-plan/` | `requestAddChild`, `approveAddChildRequest` | `kind: "self" \| "child"` (Q12). Aprobación solo owner/administrator. |
| `members/` (alta) | — | La aprobación del alta crea también el alumno del tutor con vínculo `self` cuando `applicantIsStudent` (A1–A2). |
| `account-settings/` | `uploadProfilePhoto`, `removeProfilePhoto`, `setMemberVisibility`, `createTeenAccess`, `revokeTeenAccess`, `claimAdultAccount` | Scope por `authorise()`; foto/visibilidad de un menor solo por el tutor; el teen puede **proponer** foto (B4). |
| `streak/` | `getMemberStreak` | En vivo. |
| `promotion/` | `getPromotionOutlook` | Reutiliza el servicio de `getStudentProgressSummary`. |
| `competitors/` | `getCompetitors`, `buildLeaderboards` (`onSchedule`) | El snapshot incluye todos los activos con marca `hidden`; la respuesta filtra ocultos salvo el propio. |
| `session-roster/` | `getSessionDetail` | `permission-denied` si el alumno no tiene reserva en la sesión. Roster: misma cohorte y visible → ficha; resto → `hiddenCount`. |
| `disclaimer-status/` | `getMyDisclaimerStatus`, `listDisclaimerAcceptances` | Lo segundo, solo office (nunca coach). |
| `schedule/` | — | `booking-transaction-service` exige `hasAcceptedEnrolmentWaiver`. Franja H (`participantBandAt`) en planes y reservas. |

### Web (`apps/web/src`)

- `/enrol`: casilla «I also want to train (my own membership)».
- `/account/membership`: selector «You + hijos» desde `listProfiles()`, «Add a child» y, sin vínculo
  `self`, «Train yourself» (Q12).
- `/account/settings`: foto (recorte), interruptor de visibilidad, acceso de hijos (crear/revocar).
- `/account`: `StreakPanel` (con `PromotionBar` arriba), `DisclaimerGate` por participante, bloqueo
  «You're 18».
- `/account/competitors`: dos tablas (Attendance / Belt), ±2, ficha + comparador en `<dialog>`.
- `/account/calendar/session-card.tsx` → `SessionDetailDialog` (`<dialog>` nativo).
- `/admin/waivers`: pestaña «Acceptances» (filtro «Missing only», búsqueda, CSV).
- `/admin/members`: filtro «Plan band differs from age band».
- Cada `lib/<feature>-client.ts` valida la respuesta con zod y devuelve errores legibles.

## Seguridad

- Nada de otro miembro se lee directamente de Firestore: todo sale de un callable y pasa por
  `MemberPublicCard` (sin edad, contacto ni familia).
- `firestore.rules`: `leaderboards/*` sin acceso de cliente; los campos `photoObjectKey`,
  `photoConsent*`, `showToMembers` y `adultClaimedAt` solo se escriben por callable.
- La cohorte la decide el servidor. Un tutor ve como su hijo seleccionado, y solo mientras el hijo
  tenga < 18.
- Fotos: límite de tamaño antes de decodificar, `sharp` con `limitInputPixels`, re-codificación y
  URL firmada de vida corta. Retirar el consentimiento o la foto borra el objeto.
- Acceso teen: contraseña ≥ 10 caracteres, rol `teenStudent`, revocar = `disabled` + `revokeRefreshTokens`.
  Cambio de edad mínima 16 → 12: ADR-019 + nota en la DPIA (T011).
- Ninguna función reserva por nadie (ADR-018).

## Diseño visual

`DESIGN.md` §9: radio 1rem dentro de `/account` (0 fuera), BPT Purple `#2F2483` como único acento,
botones ≥ 3.15rem, etiquetas encima de los inputs, esqueletos en lugar de spinners y `<dialog>` nativo.
Barra «x1 missing»: el mismo tono púrpura, más intenso. Llama Lottie en diferido, con fotograma fijo
bajo `prefers-reduced-motion`. Sin desbordes a 360 px. Copy en inglés UK.

## Errores

Toda UI nueva se oculta sola ante `not-found`/`unimplemented`. Excepción: el bloqueo del disclaimer,
que falla cerrado con opción de reintentar. Los clientes nunca muestran errores crudos de Firebase.

## Pruebas (se ejecutan al final)

- Unitarios (`node`): `participantBandAt` (11/12, 15/16, sin fecha), `leaderboardNeighbours` (primero,
  último, empates, ocultos), `nextProgressTarget` (9, 10, 24), `promotionMilestone`,
  `decideMemberAccess` (11, 12, 17, 18), `needsAdultClaim`, `publicDisplayNames` (colisión).
- Rules (`qa/rules`): `leaderboards` denegado y campos nuevos no escribibles por el cliente.
- E2E `qa/tests/member-engagement-auth-emulator.spec.ts` (`demo-bpt-jersey`, desktop + mobile): subida
  de avatar; racha + llama (y `reduced-motion`); ranking ±2 por cohorte; currículum + roster + ficha;
  bloqueo por disclaimer y reserva rechazada; acceso teen creado → login → revocado.
- Cierre: `verification-before-completion` + `requesting-code-review` sobre el diff completo.

## Fuera de alcance

Alias elegidos por el miembro; avisos por correo (promoción, disclaimer); metas configurables por el
owner; ranking en tiempo real.
