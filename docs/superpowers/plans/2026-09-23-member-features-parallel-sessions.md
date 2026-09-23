# Funciones de miembros en sesiones paralelas: plan de reparto

> **Para agentes:** este documento no es el plan detallado de ninguna función. Cada sesión lee su
> sección (§3), escribe su propio plan corto en `docs/superpowers/plans/2026-09-2X-<tema>.md` si lo
> necesita y construye **solo** dentro de sus ficheros. Lee primero §1 (reglas comunes) y §2 (sesión 0).

**Fecha:** 2026-09-23. **Pedido por:** Luis (operador), texto original en §6.
**Base:** fase 0 ya en `main` (`c5a1b74`…`a49eca3`): contratos en
`packages/domain/src/members/member-engagement-contracts.ts`, rutas `/account/competitors` y
`/account/settings`, `StreakPanel` vacío, `/animations/streak-flame.json` + `lottie-web`, ficheros de
callables `streak/`, `competitors/` y `account-settings/` ya re-exportados en `apps/functions/src/index.ts`.
Spec de fase 0: `docs/superpowers/specs/2026-09-16-member-engagement-phase-0-design.md`. Este plan la
**amplía**. Donde choca con ella, manda este documento (ver D6).

## Mapa de sesiones

| Sesión | Qué construye | Depende de | Puede empezar |
| --- | --- | --- | --- |
| **0 · Huecos** | Contratos y huecos nuevos que comparten varias sesiones | fase 0 | ya |
| **A · Tutor también entrena + My plan** | El tutor se apunta como miembro; My plan con tutor + hijos; «Add a child» para adultos 18+ | 0 | tras 0 |
| **B · Ajustes de usuario** | Foto propia y de los hijos; acceso propio (email + contraseña) para hijos de 12–17 | 0 | tras 0 |
| **C · Racha** | Panel «Streak»: dos barras, llama «xN», horas desde septiembre | 0 | tras 0 |
| **D · Próxima promoción** | Barra de promoción arriba de la tarjeta + avisos de promoción por asistencia | 0 | tras 0 |
| **E · Competidores** | Dos tablas (asistencia y cinturón) × tres cohortes (kids, teens, adults) | 0 (fotos de B opcionales) | tras 0 |
| **F · Detalle de sesión** | Tocar una sesión reservada: currículum + lista de reservados; tocar a alguien: su ficha | 0 | tras 0 |
| **G · Disclaimer** | Aviso al miembro si no consta aceptado + vista admin de quién aceptó y quién no | nada | **ya** |

Después de la sesión 0, las sesiones A–G pueden correr a la vez. G ni siquiera necesita la 0.

---

## 1. Reglas comunes (valen para todas las sesiones)

1. **Flujo del repo (AGENTS.md):** se trabaja en `main` local, sin ramas, worktrees ni PR. Antes de
   editar: `git pull --rebase origin main`. Hay varias sesiones en el **mismo** checkout:
   - **nunca** `git add -A` ni `git add .`: añade solo tus rutas (`git add <ruta> <ruta>`);
   - no reformatees ni «arregles» ficheros de otra sesión aunque veas cambios suyos sin commit;
   - si un build de `packages/domain` da «does not provide an export named…», otra sesión está
     compilando: espera y reintenta.
2. **Propiedad de ficheros:** cada sesión escribe **solo** en su columna «Escribe» (§3). Si necesitas
   algo de un fichero ajeno, **no lo edites**: déjalo anotado en «Pendientes para otra sesión» al
   final de tu commit y avisa a Luis.
3. **Ficheros compartidos por línea:** `apps/functions/src/deploy-runtime.ts` (cada sesión añade
   solo los nombres de sus callables). Si el rebase choca ahí, conserva las líneas de ambos.
4. **`index.ts` de functions:** no se toca. La sesión 0 ya deja re-exportado el fichero de callables
   de cada sesión.
5. **Push = web en producción.** Un push a `main` publica la web en Cloudflare en unos 90 s. Las
   functions **no**: requieren un despliegue aparte, con OK explícito de Luis, **después** del push
   (el guard `assert-deployable-tree.mjs` exige HEAD == origin/main y árbol limpio). Por eso:
   - toda UI nueva debe **ocultarse sola** si su callable responde `not-found`/`unimplemented`/error
     (sin pantallas rotas mientras la function no está desplegada);
   - orden: commit → push → pedir a Luis el OK de deploy de **tus** functions por nombre.
6. **Tests:** por política del proyecto, no se añaden ni se corren salvo que Luis los pida. La
   verificación es por inspección de código + vista previa aislada
   (`BPT_ISOLATED_PREVIEW=true next dev -p 3100 -H 127.0.0.1` + Playwright interceptando callables,
   con datos sintéticos). Si no se pudo ver, se dice.
7. **Seguridad:** todo lo que ve un miembro sobre otro sale de un callable en el servidor (nunca de
   una lectura directa de Firestore), pasa por `MemberPublicCard` y respeta las cohortes (D6).
   `firestore.rules` e índices no cambian salvo en la sesión que lo declara (B, por las fotos).
8. **ADR-018:** nada de lo que construyáis reserva clases por nadie.
9. **Diseño:** reutilizar tokens y componentes de `/account` (`account.css`, `DESIGN.md`). Todo el
   texto visible al miembro va en inglés, como el resto de `/account`.
10. **Commits:** mensajes cortos en imperativo en inglés («Show the streak panel on the member
    calendar»), con el pie de coautoría habitual.

---

## 2. Sesión 0 · Huecos compartidos (corta, va primero)

**Objetivo:** que A–G no se pisen. No construye ninguna función, solo contratos y huecos vacíos.
Es la misma idea que la fase 0 del 16-sep.

**Escribe:**

| Pieza | Fichero | Qué deja |
| --- | --- | --- |
| Tres cohortes | `packages/domain/src/members/member-engagement-contracts.ts` | `LeaderboardCohort = "kids" \| "teens" \| "adults"`; `leaderboardCohort(dateOfBirth, nowIso)` con los cortes de `participantBand`: <12 kids, 12–17 teens, 18+ adults, en Europe/Jersey. Sin fecha de nacimiento → `adults` (misma regla del 23-sep: «sin fecha = adulto»). Actualiza su test. |
| Ficha pública ampliada | mismo fichero | `MemberPublicCard` gana `attendancesSinceSeasonStart: number` y `promotionPercent: number \| null` (lo leen E y F; no rompe nada porque aún nadie la usa). |
| Hueco de la barra de promoción | `apps/web/src/app/account/streak/streak-panel.tsx` | `StreakPanel` renderiza `<PromotionBar />` como primer hijo (arriba del todo de la tarjeta, D1) y luego su contenido. |
| Componente vacío de promoción | `apps/web/src/app/account/promotion/promotion-bar.tsx` | `export function PromotionBar() { return null; }` (propiedad de D). |
| Hueco del aviso de disclaimer | `apps/web/src/app/account/page.tsx` | monta `<DisclaimerNotice />` arriba del calendario. |
| Componente vacío del aviso | `apps/web/src/app/account/disclaimer-notice.tsx` | `return null` (propiedad de G). |
| Hueco del detalle de sesión | `apps/web/src/app/account/calendar/session-card.tsx` | en sesiones **reservadas**, el cuerpo de la tarjeta es un botón que abre `<SessionDetailDialog sessionId studentId onClose />`. |
| Componente vacío del detalle | `apps/web/src/app/account/session-detail/session-detail-dialog.tsx` | `return null` (propiedad de F). |
| Ficheros de callables nuevos | `apps/functions/src/{promotion,session-roster,family-plan,disclaimer-status}/*-callables.ts` con `export {};` | re-exportados en `apps/functions/src/index.ts` (única vez que se toca). |
| Enlace de ajustes | ya existe (`/account/settings`) | nada. |

**Verificación:** `corepack pnpm --filter @bpt-jersey/domain build` y
`corepack pnpm --filter @bpt-jersey/functions build` compilan, y `/account` se ve **igual** que antes
(todo lo nuevo devuelve `null`). Commit: `Open slots for the member feature sessions`. Push. No hay
functions que desplegar.

---

## 3. Sesiones A–G

Formato de cada sesión: objetivo → decisiones → ficheros → interfaces → pasos → verificación →
prompt de arranque.

### Sesión A · El tutor también entrena + My plan

**Objetivo (palabras de Luis):** que el tutor pueda ser miembro activo. Donde se seleccionan los
hijos, que también se pueda seleccionar el nombre del tutor si quiere suscripción propia. En la
selección de planes (**solo en My plan**) que siempre se pueda elegir al propio miembro y a los hijos
que haya añadido, e incluso añadir hijos desde membresías de mayores de 18.

**Lo que hay hoy:**
- `/enrol` (`apps/web/src/app/enrol/page.tsx`) es excluyente: «I am joining as an adult student»
  **o** «I am a parent or guardian enrolling a child». El contrato lo impone:
  `enrolment-request-contracts.ts:448` rechaza `applicantIsStudent && minors.length > 0`.
- `/account/membership` (`membership/page.tsx`, «My plan»): si el rol es `guardian` muestra **solo
  hijos** (`getFamily()`); si no, **solo al propio** (`getClientProfile()`).
- El acceso ya contempla las dos vías: `decideMemberAccess` → `via: "self" | "guardian"` y
  `MemberAccessService.listProfiles()` devuelve todos los perfiles de una cuenta.

**Decisiones:**
- A1. En `/enrol`, al elegir «parent or guardian», aparece la casilla **«I also want to train
  (my own membership)»**. Marcada: el tutor pasa a ser alumno además de tutor (datos de alumno +
  plan propio + horarios). El contrato admite `applicantIsStudent && minors.length > 0`.
- A2. Al aprobar esa solicitud se crea el alumno del tutor con vínculo **propio** (`self`) en la
  misma cuenta. El rol de la cuenta sigue siendo `guardian` (no se inventa un rol nuevo). Desde ahí
  el calendario ya muestra un chip más, el del tutor, porque lee `participants`.
- A3. My plan construye la lista de «para quién» con `listProfiles()`: **yo + mis hijos**, para
  cualquier rol. Es la única fuente.
- A4. En My plan, botón **«Add a child»** visible para `guardian` y `adultStudent`: formulario
  mínimo del hijo (nombre, fecha de nacimiento, centro, horarios) que crea una **solicitud** para la
  oficina, con el mismo patrón que `membershipApplications` (D2: la oficina aprueba). Al aprobarla,
  una cuenta `adultStudent` se convierte en tutor: el hijo queda con vínculo `guardian` y la cuenta
  conserva su vínculo `self`.
- A5. Esto solo existe en My plan. `/enrol` para nuevos no cambia salvo A1.

**Escribe:** `apps/web/src/app/enrol/page.tsx`, `packages/domain/src/members/enrolment-request-contracts*.ts`,
el servicio de aprobación de solicitudes de alta (búscalo desde
`apps/web/src/app/admin/members/requests/page.tsx` → su callable en `apps/functions/src/members/`),
`apps/web/src/app/account/membership/*`, `apps/functions/src/family-plan/` (callable
`requestAddChild` + aprobación), `apps/web/src/lib/family-plan-client.ts`,
`apps/web/src/app/admin/members/requests/page.tsx` (sección «Add-child requests»).
**No toca:** `member-access-contracts.ts` (es de B), `account/settings/`, `calendar/`,
`firestore.rules`.

**Interfaces:**
- Consume: `MemberAccessService.listProfiles(academyId, uid) → AccountMemberProfile[]`
  (`{studentId, fullName, via, trainingDetailsRequired}`).
- Produce: callable `requestAddChild({fullName, dateOfBirth, trainingCenter, trainingTimePreferences})
  → {requestId}` y `approveAddChildRequest({requestId})` (solo owner/administrator).

**Pasos:**
1. Contrato: permitir tutor-alumno + hijos. Revisa todas las ramas que hoy asumen exclusión
   (`enrolment-request-contracts.ts:441-560`: `planSelections.applicant`, trial choices).
2. Aprobación de alta: crear también el alumno del tutor con vínculo `self` cuando `applicantIsStudent`.
3. `/enrol`: la casilla A1 y el bloque de datos de alumno del tutor.
4. My plan: sustituir la rama por rol por `listProfiles()`; el selector muestra «You» + hijos.
5. «Add a child»: callable + formulario + sección en admin requests.

**Verificación:** en vista previa, (a) un tutor con la casilla marcada envía el alta con tutor + 2
hijos y la solicitud muestra 3 personas; (b) My plan de un tutor-alumno lista «You» + hijos; (c) un
`adultStudent` pide «Add a child», la oficina aprueba y su My plan muestra al hijo.

**Prompt de arranque (copiar en una sesión nueva):**
```
Proyecto /root/BPT-Jersey. Eres la Sesión A del plan
docs/superpowers/plans/2026-09-23-member-features-parallel-sessions.md.
Lee §1 (reglas comunes) y §3 Sesión A, y construye solo eso, solo en tus ficheros.
Hay otras sesiones trabajando a la vez en el mismo checkout: nunca git add -A.
```

---

### Sesión B · Ajustes de usuario: fotos y acceso de hijos de 12–17

**Objetivo (palabras de Luis):** en la configuración de usuario, el tutor puede dar a sus hijos de
12–17 años una interfaz como la de los miembros: añadirles email y contraseña para que entren a su
membresía como un miembro normal. En configuración, cada uno puede añadir una foto propia y de sus
hijos, que se muestra en la Leaderboard.

Sustituye el alcance de T044V2 de la fase 0.

**Lo que hay hoy:** `/account/settings` es «Coming soon». `StudentProfile.photoUrl?: string` (https,
máx. 512) ya existe. Existe el rol `teenStudent`, pero `teenAccountMinimumAge = 16`
(`member-access-contracts.ts:4`), así que **hoy un hijo de 12–15 no puede tener acceso propio**.
Los ficheros se guardan en R2 (`apps/functions/src/storage/r2-client.ts`).

**Decisiones:**
- B1. `teenAccountMinimumAge` pasa de 16 a **12** (pedido explícito de Luis). Es un cambio de
  tratamiento de datos de menores: anotarlo en la DPIA (T011) y en un ADR corto.
- B2. El tutor crea el acceso del hijo desde Settings: email + contraseña (mín. 10 caracteres). El
  servidor crea el usuario de Firebase Auth con rol `teenStudent` y el vínculo `self` aprobado. Sin
  verificación de email (misma línea que D8 del 23-sep). El tutor puede **revocar** ese acceso.
- B3. El hijo con acceso propio ve `/account` igual que un miembro (calendario, reservas, racha,
  competidores). **No** ve pagos ni My plan: eso sigue en manos del tutor.
- B4. Fotos: el adulto sube la suya y la de sus hijos; el adolescente puede **proponer** la suya y
  el tutor la aprueba (fase 0, T044V2). Subida por callable → R2 → `photoUrl` https. Solo imagen
  (jpeg/png/webp), ≤ 2 MB, redimensionada a 512 px en el servidor.
- B5. Subir la foto de un menor lleva una casilla del tutor: «Show this photo to other members in
  the leaderboard and class lists». Sin esa casilla la foto solo la ve la familia y la academia.
  Se guarda como `photoVisibleToMembers: boolean` en el perfil.

**Escribe:** `apps/web/src/app/account/settings/*`, `apps/functions/src/account-settings/*`,
`apps/web/src/lib/account-settings-client*.ts`, `apps/functions/src/profiles/profile-service.ts`
(foto), `apps/functions/src/families/` (acceso del hijo), `packages/domain/src/members/member-access-contracts.ts`
(solo la constante y lo que dependa de ella), `packages/domain/src/profiles/profile-contracts.ts`
(`photoVisibleToMembers`), `firestore.rules` si hace falta para el campo nuevo, `docs/adr/` (ADR
nuevo). **No toca:** `membership/`, `enrol/`, `calendar/`, `competitors/`.

**Interfaces producidas (las leen E y F):** `photoUrl` y `photoVisibleToMembers` en el perfil del
alumno. Regla para E y F: **mostrar `photoUrl` solo si el alumno es adulto o si
`photoVisibleToMembers === true`**; si no, iniciales.

**Verificación:** en vista previa, (a) un tutor crea acceso para un hijo de 13 y ese usuario entra y
ve su calendario; (b) el tutor revoca y el hijo ya no entra; (c) una foto subida aparece en Settings
y su URL es https de R2; (d) un hijo de 11 **no** puede recibir acceso propio.

**Prompt de arranque:**
```
Proyecto /root/BPT-Jersey. Eres la Sesión B del plan
docs/superpowers/plans/2026-09-23-member-features-parallel-sessions.md.
Lee §1 y §3 Sesión B, y construye solo eso, solo en tus ficheros.
Hay otras sesiones trabajando a la vez en el mismo checkout: nunca git add -A.
```

---

### Sesión C · Racha (T042V2)

**Objetivo (palabras de Luis):** registrar la asistencia a cada sesión. Arriba de todo, un título
pequeño «Streak». Debajo, una barra de progreso hacia la próxima meta (Goal) y otra hacia la próxima
recompensa (Reward). Cuando a una barra le falta **1** asistencia, su color se intensifica (mismo
tono) y aparece debajo «Just x1 missing to get goal!» / «…reward!». La llama animada
(«Soguk Seri Atesi.json») con «x2, x3, x4…» al lado, con un diseño que case con la animación.
Debajo, las horas totales de entrenamiento desde septiembre.

**Lo que hay hoy:** `buildMemberStreakSummary` ya calcula todo (`streakCount`,
`hoursSinceSeasonStart`, `goal`/`reward` con `almost`/`complete`). La llama está en
`apps/web/public/animations/streak-flame.json` (es «Soguk Seri Atesi.json» renombrado; compruébalo).
`StreakPanel` está vacío y montado en `topSlot`.

**Decisiones:**
- C1. Orden dentro de la tarjeta: [PromotionBar de la sesión D, que ya monta la sesión 0] →
  «Streak» → llama + «xN» → barra Goal → barra Reward → «N h trained since September».
- C2. «xN» = `streakCount`. Con 0 o 1 no se muestra multiplicador (la llama queda quieta/apagada).
- C3. Meta y recompensa: valores por defecto 10/25. Cuando se completa una, la siguiente es el
  siguiente múltiplo (20, 30… / 50, 75…). La configuración por el owner queda fuera (YAGNI).
- C4. Tutor: el panel sigue al chip del hijo seleccionado.
- C5. `lottie-web` se carga en diferido, y con `prefers-reduced-motion` se muestra un fotograma fijo.

**Escribe:** `apps/web/src/app/account/streak/*` (menos la línea de `<PromotionBar />`, que la dejó
la 0), `apps/functions/src/streak/*`, `apps/web/src/lib/streak-client*.ts`,
`member-engagement-contracts.ts` (**solo añadir**, p. ej. `nextTarget`).
**No toca:** `page.tsx`, `member-calendar.tsx`, `promotion/`.

**Interfaces:** callable `getMemberStreak({studentId}) → MemberStreakSummary`. El scope se comprueba
con `createFirestoreCanonicalClientStudentScopeResolver`. Asistencia = registros asistidos o tarde
(la misma definición que `countClassesAtLevel`).

**Verificación:** vista previa con fixtures para 0, 9, 10 y 24 asistencias. En 9 y 24 se ve el tono
intenso y la frase «Just x1 missing…». Racha 3 → «x3». Horas = suma de `durationMinutes` desde el 1-sep.

**Prompt de arranque:**
```
Proyecto /root/BPT-Jersey. Eres la Sesión C del plan
docs/superpowers/plans/2026-09-23-member-features-parallel-sessions.md.
Lee §1 y §3 Sesión C, y la spec de fase 0. Construye solo eso, solo en tus ficheros.
Hay otras sesiones trabajando a la vez en el mismo checkout: nunca git add -A.
```

---

### Sesión D · Próxima promoción: barra + avisos

**Objetivo (palabras de Luis):** avisos de la próxima promoción según la asistencia del miembro, y
una barra de progreso encima de la tarjeta/sección.

**Lo que hay hoy:** `StudentProgressSummary` (initialized) trae `progressPercent` (0–100, fórmula
única §6.2), `criteria.classes` y `targetDefinition`. `listPromotionGaps` existe en
`level-progress.ts`. `/account/progress` ya muestra el progreso propio.

**Decisiones:**
- D-1. **Barra (D1):** `PromotionBar` arriba de la tarjeta de racha: «Next belt: <nombre>» + barra
  con `progressPercent` + «N classes to go» (clases requeridas − completadas, si el nivel las exige).
  Sin nivel abierto o sin siguiente nivel → no se renderiza.
- D-2. **Avisos (D3):** solo dentro de la app. Se calculan al abrir `/account` (sin cron ni triggers):
  hitos al 75 %, al 90 % y con 1 clase restante. Texto de ejemplo: «2 more classes and your coach can
  assess you for your next stripe». Cada hito se muestra una vez por miembro y nivel (se guarda como
  visto en el cliente, en localStorage, que basta porque es solo un aviso). El aviso vive dentro del
  mismo componente, bajo la barra.
- D-3. Nunca se promete la promoción: la aprueba el head coach. El texto dice «can be assessed».

**Escribe:** `apps/web/src/app/account/promotion/*`, `apps/functions/src/promotion/*`,
`apps/web/src/lib/promotion-client*.ts`, `packages/domain/src/levels/promotion-notice*.ts` (nuevo:
función pura `promotionMilestone(summary) → "75" | "90" | "oneLeft" | null`).
**No toca:** `streak/`, `level-progress.ts` (solo lo importa), `progress/`.

**Interfaces:** callable `getPromotionOutlook({studentId}) → {nextName, percent, classesToGo,
milestone}`. Reutiliza el servicio que ya alimenta `getStudentProgressSummary`.

**Verificación:** vista previa con 74 %, 75 %, 90 % y 1 clase restante: la barra y el aviso cambian;
al recargar, un hito ya visto no vuelve a salir; un alumno sin nivel no ve nada.

**Prompt de arranque:**
```
Proyecto /root/BPT-Jersey. Eres la Sesión D del plan
docs/superpowers/plans/2026-09-23-member-features-parallel-sessions.md.
Lee §1 y §3 Sesión D. Construye solo eso, solo en tus ficheros.
Hay otras sesiones trabajando a la vez en el mismo checkout: nunca git add -A.
```

---

### Sesión E · Competidores (T043V2)

**Objetivo (palabras de Luis):** dos tablas, una de asistencia y otra de progresión de cinturón. En
la página del alumno puede comparar y ver «Competitors», los otros miembros de la escuela, y seguir
su progreso. Solo ve foto, nombre y todo su progreso. Muestra los dos más cercanos por debajo y los
dos más cercanos por encima, colores de cinturón y grados, racha de asistencia, las técnicas que el
otro tiene y él no, y al revés. **Una tabla para kids, otra para teens y otra para adults.**

**Decisiones:**
- E1. Cohortes (D6): el miembro solo ve su cohorte (kids <12, teens 12–17, adults 18+), vía
  `leaderboardCohort` de la sesión 0. Nadie elige la cohorte: la calcula el servidor.
- E2. Tabla de asistencia ordenada por `attendancesSinceSeasonStart` (empate → `streakCount`).
  Tabla de cinturón ordenada por posición en la escalera (`ladderIndexes`) y, dentro, por grados y
  `promotionPercent`.
- E3. Cada fila es un `MemberPublicCard`. Tocar una fila abre la comparación de técnicas
  (`compareTechniques`).
- E4. Foto con la regla de B (adulto o `photoVisibleToMembers`); si no, iniciales.
- E5. Tutor: ve la tabla de la cohorte del hijo seleccionado, **como** ese hijo.
- E6. Miembros sin plan activo no aparecen.

**Escribe:** `apps/web/src/app/account/competitors/*`, `apps/functions/src/competitors/*`,
`apps/web/src/lib/competitors-client*.ts`, `member-engagement-contracts.ts` (solo añadir).
**No toca:** `streak/`, `profile-contracts.ts`, reglas, índices.

**Interfaces:** callable `getCompetitors({studentId}) → {cohort, attendance: Neighbours,
belt: Neighbours}` con `Neighbours = {above: MemberPublicCard[], current, below: MemberPublicCard[]}`.
Produce también la función de servidor `buildPublicCard(studentId)`, que **F reutiliza importándola**
(no la copia).

**Verificación:** vista previa con 7 adultos, 3 teens y 3 kids: un adulto ve solo adultos (2 arriba,
2 abajo); el primero de la tabla ve 0 arriba; un teen no ve adultos ni kids; las técnicas «they
have / you have» coinciden con `compareTechniques`.

**Prompt de arranque:**
```
Proyecto /root/BPT-Jersey. Eres la Sesión E del plan
docs/superpowers/plans/2026-09-23-member-features-parallel-sessions.md.
Lee §1 y §3 Sesión E, y la spec de fase 0. Construye solo eso, solo en tus ficheros.
Hay otras sesiones trabajando a la vez en el mismo checkout: nunca git add -A.
```

---

### Sesión F · Detalle de una sesión reservada

**Objetivo (palabras de Luis):** en la interfaz de miembros, tocar el botón de una sesión ya
reservada y ver el currículum que se va a enseñar y la lista entera de personas que reservaron esa
clase (nombre y foto). Al tocar a otro miembro de la lista, ver sus datos de progreso y su foto.

**Lo que hay hoy:** las sesiones ya guardan `curriculum` (`SessionCurriculum`: title, techniques,
details; `schedule-contracts.ts:241`) y hay estilos `.session-curriculum` en `account.css`. La
sesión 0 deja el botón en la tarjeta y el diálogo vacío.

**Decisiones:**
- F1. Solo se abre en sesiones que el miembro (o el hijo seleccionado) tiene **reservadas**.
- F2. Currículum: título, técnicas y detalles. Si no hay: «The coach hasn't published the plan for
  this class yet».
- F3. Lista de reservados (D4): se muestran con nombre + foto (regla de B) **los de la misma
  cohorte** que quien mira. Los de otras cohortes solo cuentan: «+3 members from other age groups».
  El que mira sale marcado «You».
- F4. Tocar a alguien abre su `MemberPublicCard` (progreso, cinturón, grados, racha) con el
  `buildPublicCard` de E. Si E aún no está, F lo importa cuando llegue y mientras tanto muestra solo
  nombre y foto.

**Escribe:** `apps/web/src/app/account/session-detail/*`, `apps/functions/src/session-roster/*`,
`apps/web/src/lib/session-roster-client*.ts`.
**No toca:** `session-card.tsx` (el botón lo puso la 0), `competitors/` (solo importa).

**Interfaces:** callable `getSessionDetail({sessionId, studentId}) → {curriculum | null, roster:
MemberPublicCard[], hiddenCount}`. Rechaza `permission-denied` si `studentId` no tiene reserva en
`sessionId`.

**Verificación:** vista previa: sesión reservada → se abre con currículum y 4 nombres; sesión sin
reservar → no hay botón; un kid no ve nombres de adultos, solo el contador; tocar un nombre abre su ficha.

**Prompt de arranque:**
```
Proyecto /root/BPT-Jersey. Eres la Sesión F del plan
docs/superpowers/plans/2026-09-23-member-features-parallel-sessions.md.
Lee §1 y §3 Sesión F. Construye solo eso, solo en tus ficheros.
Hay otras sesiones trabajando a la vez en el mismo checkout: nunca git add -A.
```

---

### Sesión G · Disclaimer: aviso al miembro + vista admin

**Objetivo (palabras de Luis):** que aparezca una notificación en la interfaz de miembros si el
sistema no reconoce que tenga marcado que acepta los términos y condiciones del disclaimer. Y en
admin, una opción para ver qué miembros aceptaron el disclaimer y quiénes no.

**Lo que hay hoy (léelo antes de construir):** hay **dos** mecanismos y hay que decidir a cuál se
refiere cada caso:
- `WaiverGate` (`account/waiver-acceptance.tsx`, D12 del 23-sep): bloquea el calendario hasta aceptar
  los términos de la academia (`enrolmentWaiverAcceptances/{studentId}__{version}`). **Si falla la
  comprobación, deja pasar**, y ahí es donde un miembro puede quedar sin aviso.
- `DisclaimersPanel` (`account/disclaimers.tsx`, T117): disclaimers pendientes por participante.
- `/admin/waivers` hoy solo publica y retira versiones: no lista aceptaciones.

**Decisiones:**
- G1. `DisclaimerNotice` (hueco de la 0) muestra un aviso visible y persistente en `/account` cuando
  a **cualquier** alumno de la cuenta le falta el waiver vigente o un disclaimer T117, con botón a
  `/account/waiver`. Se muestra también cuando `WaiverGate` dejó pasar por error de comprobación.
- G2. En `/admin/waivers`, pestaña **«Acceptances»**: tabla de alumnos activos con columnas «Terms
  (version)» ✓/✗ con fecha y «Disclaimers» ✓/✗, filtro «Missing only», búsqueda por nombre y
  exportación CSV. Solo owner/administrator (nunca coach).
- G3. Sin envíos por correo (solo la vista); recordar por correo queda fuera.

**Escribe:** `apps/web/src/app/account/disclaimer-notice.tsx`, `apps/functions/src/disclaimer-status/*`,
`apps/web/src/lib/disclaimer-status-client*.ts`, `apps/web/src/app/admin/waivers/*`.
**No toca:** `waiver-acceptance.tsx`, `disclaimers.tsx`, `page.tsx`.

**Interfaces:** callables `getMyDisclaimerStatus() → {missing: {studentId, fullName, what: "terms" |
"disclaimer"}[]}` y `listDisclaimerAcceptances({missingOnly}) → rows[]` (solo office).

**Verificación:** vista previa: un alumno sin aceptación ve el aviso y, al aceptar, desaparece; en
admin, el filtro «Missing only» lista exactamente a los que faltan; un coach no tiene acceso a la
pestaña.

**Prompt de arranque:**
```
Proyecto /root/BPT-Jersey. Eres la Sesión G del plan
docs/superpowers/plans/2026-09-23-member-features-parallel-sessions.md.
Lee §1 y §3 Sesión G. Puedes empezar ya (no dependes de la Sesión 0 salvo el hueco
DisclaimerNotice: si aún no existe, construye primero la vista admin).
Hay otras sesiones trabajando a la vez en el mismo checkout: nunca git add -A.
```

---

## 4. Decisiones que tomé por defecto (Luis, confírmalas o cámbialas)

| # | Decisión | Por defecto | Alternativa |
| --- | --- | --- | --- |
| D1 | «Progress bar on top of the Card/Section» | Barra de **próxima promoción** arriba de la tarjeta de racha | Encima de cada tarjeta de clase del calendario |
| D2 | Tutor que se apunta a entrenar / adulto que añade un hijo | La **oficina aprueba** (igual que el registro y los planes) | Inmediato |
| D3 | Avisos de promoción | Solo **dentro de la app** | App + correo |
| D4 | Lista de reservados de una clase | Nombres y fotos **solo de la misma cohorte**; el resto como contador | Todos visibles para todos |
| D5 | Acceso propio de hijos | Desde **12 años** (antes 16), con ADR + nota DPIA | Mantener 16 |
| D6 | Cohortes de las tablas | **kids <12, teens 12–17, adults 18+**. Sustituye la decisión 5 de la fase 0 (under16/adult) | Mantener el corte de 16 |
| D7 | Foto de menores visible a otros | Solo con la casilla del tutor (`photoVisibleToMembers`) | Visible siempre que exista |

## 5. Orden de subida y cierre

1. Sesión 0 → push (nada que desplegar en functions).
2. A–G en paralelo. Cada una: `git pull --rebase origin main` → commit de sus rutas → push → OK de
   Luis → deploy **solo** de sus functions (`firebase deploy --only functions:<nombre>,…`).
3. Si E llega antes que F, F importa `buildPublicCard` al rebasar. Si F llega antes, muestra la
   ficha mínima (F4).
4. Cierre: una sesión final (o Luis) recorre `/account` con un tutor-alumno con dos hijos (uno de 13
   con acceso propio) y un adulto, y comprueba: racha + barra de promoción, competidores en las tres
   cohortes, detalle de clase, aviso de disclaimer y la pestaña de admin.

## 6. Texto original de Luis (23-sep)

- **Guardian/Children:** que el tutor también pueda ser miembro activo para entrenar. Donde se
  seleccionan los hijos, que también se seleccione el nombre del tutor si desea suscripción activa.
  En la selección de planes, que siempre se pueda seleccionar al miembro y a los hijos que haya
  añadido, incluso la opción de añadir hijos en las membresías de mayores de 18, pero solo en
  «My plan». Además, opción para que el tutor dé a los hijos de 12–17 años una interfaz como la de
  los miembros, en la configuración de usuario: añadir email y contraseña a los hijos mayores de 12
  para que accedan a su membresía como un miembro normal. Que en configuración puedan añadir una foto
  de sí mismos y de sus hijos, para mostrarla en la Leaderboard.
- **Streak/Progress:** (registra la asistencia a cada sesión) título pequeño «Streak»; barra hacia
  el próximo Goal y barra hacia el próximo Reward (a falta de 1 asistencia, color más intenso del
  mismo tono y el texto «Just x1 missing to get goal/reward!»); llama «Soguk Seri Atesi.json» con
  «x2, x3, x4…» al lado (diseño a juego con la animación); debajo, horas totales desde septiembre.
- **Class Streak:** avisos de la próxima promoción según la asistencia.
- **Barra de progreso** encima de la tarjeta/sección.
- **Leaderboard/Competitions:** dos tablas (asistencia y cinturón); foto, nombre y todo su progreso;
  dos más cercanos por encima y dos por debajo; colores de cinturón y grados, racha, técnicas que el
  otro tiene y él no, y al revés. Una tabla para kids, otra para teens y otra para adults.
- **Calendar:** tocar sesiones reservadas y ver el currículum y la lista entera de quienes
  reservaron (nombre y foto); tocar a otro miembro muestra su progreso y su foto. Aviso en la
  interfaz de miembros si no consta la aceptación del disclaimer. En admin, ver quién aceptó el
  disclaimer y quién no.
