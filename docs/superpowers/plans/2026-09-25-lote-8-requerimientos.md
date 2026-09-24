# Lote de 8 requerimientos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar los 8 requerimientos del 2026-09-25 (penalidad fuera, Guardians, Free Trial, ajustes de cuenta, calendario/AppCheck, grupos Town/West con override, pagos editables, código muerto) trabajando en carriles paralelos sin choques.

**Architecture:** Carril 0 fija en `packages/domain` los tipos compartidos y se commitea en `main`. Desde ese commit se crean 6 worktrees (A–F), uno por carril, cada uno dueño exclusivo de sus archivos. El controlador integra en `main` en orden A→F con un commit por carril; G (código muerto) corre después sobre `main` integrado. Capas por feature según CLAUDE.md: domain contracts → service → firestore adapter → callables (+`index.ts`) → web client → UI.

**Tech Stack:** pnpm/Corepack, TypeScript strict, zod, Firebase Functions v2 `onCall`, Firestore, Next.js 16 static export, React 19, Vitest (`web`/`node`), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-25-lote-8-requerimientos-design.md` (léelo entero; las decisiones del operador y las reglas DESIGN.md de ahí son obligatorias).

## Global Constraints

- Comandos siempre `corepack pnpm …` desde la raíz del worktree; Node `>=22.13 <25`.
- `packages/domain` nunca importa Firebase.
- Contrato nuevo en domain → subpath export en `packages/domain/package.json` + `tsconfig.runtime.json` + alias en `apps/functions/src/deploy-runtime.ts` (solo si el módulo es nuevo).
- Toda callable nueva: `requireAdminActor`/actor correcto + `assertAcademyScope` + zod parse + re-export en `apps/functions/src/index.ts` + opciones `browserAdminCallableOptions`.
- Cliente web: `httpsCallable` + zod parse de la respuesta + mensajes de error seguros (nunca el error crudo de Firebase).
- Copy en inglés británico llano; sin emojis; sin clichés ("Elevate", "Seamless").
- UI según DESIGN.md: radio 0 en admin, 1rem en `/account`; solo `#2F2483`/`#211965`/`#D9F36A`/`#F0EFFF`; estado = texto + regla izquierda 0.35rem (`#176B49`/`#E7F6EE`, `#C98B00`/`#765400`/`#FFF8E6`, `#8D1C2F`/`#721626`/`#FFF0F2`); Barlow Condensed display, Source Sans 3 cuerpo; botones `min-height 3.15rem` (≥44px en admin compacto); inputs con etiqueta arriba, `min-height 3rem`; skeleton `#E8E7E3`, **sin spinners**; CSS Grid `minmax(0,…)`, una columna ≤ 50rem, sin scroll horizontal; `prefers-reduced-motion` sin transformaciones.
- Cada carril **solo toca los archivos listados en su tarea**. Si necesita otro, se detiene y lo reporta al controlador (no lo edita).
- Tests unitarios del carril: correr solo los archivos de test del carril (`corepack pnpm vitest run --project <node|web> <archivo>`); el controlador corre la suite completa al final.
- Commits en el worktree: un commit final por carril, mensaje en inglés estilo del repo, con la línea `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Sin push.
- Nunca desplegar, nunca escribir en Firestore de producción.

## Review Focus

1. Free trial expirado o convertido → no debe salir "Free Trial" (sale No plan / plan real). Test en Task B1.
2. Tutor que también entrena con plan vigente → sale con su plan, no como Guardian; tutor cuyos hijos están todos inactivos → no es Guardian. Test en Task B1.
3. Edición de pago que baja el monto por debajo de lo ya cubierto o sube por encima del total de la factura → estado de factura recalculado / sobrepago rechazado. Test en Task F1.
4. Grupo registrado con miembro sin plan pagado → sigue "blocked: Missing Payment" aunque haya override. Test en Task E1.
5. Cambio de email con contraseña errónea o `auth/requires-recent-login` → mensaje amigable, email no cambia. Test en Task C2.

---

### Task 0: Base compartida en domain (controlador, en `main`, antes de los worktrees)

**Files:**
- Modify: `packages/domain/src/members/member-overview-contracts.ts`
- Modify: `packages/domain/src/finance/finance-contracts.ts`
- Modify: `packages/domain/src/audit/audit-event.ts`
- Modify: `packages/domain/src/schedule/groups.ts`
- Test: `packages/domain/src/members/member-overview-contracts.test.ts` (crear si no existe), `packages/domain/src/finance/finance-contracts.test.ts`

**Interfaces (Produces — todos los carriles dependen de estos nombres exactos):**
```ts
// member-overview-contracts.ts
export const memberPlanStates = Object.freeze(["current", "expiring", "expired", "trial", "none"] as const);
// row schema gains:
rowKind: z.enum(["member", "guardian"]).default("member"), // guardian rows have no student actions
userId: z.string().min(1).max(128).optional(),
// counters gain: guardians: z.number().int().min(0)
export function isGuardianOnly(input: Readonly<{
  hasOwnCoveringPlan: boolean; hasActiveTrial: boolean; guardsActiveStudent: boolean;
}>): boolean; // guardsActiveStudent && !hasOwnCoveringPlan && !hasActiveTrial

// finance-contracts.ts
export type PaymentAuditEntry = Readonly<{
  editedAt: string; editedBy: string; editedByName: string; reason: string;
  previousValues: Readonly<Record<string, unknown>>;
}>;
// LegacyManualPaymentRecord gains optional: auditHistory?: readonly PaymentAuditEntry[]
export const editPaymentReasonSchema: z.ZodString; // trim, min 10, max 280
export const editManualPaymentInputSchema: z.ZodObject<{
  paymentId, amountMinor?: int>0, method?: ManualPaymentMethod, manualReference?: string(1..128),
  occurredAt?: ISO datetime, reason: editPaymentReasonSchema, requestId: uuid
}>; // refine: at least one of the four editable fields present
export type EditManualPaymentInput = z.infer<typeof editManualPaymentInputSchema>;

// audit-event.ts: action "payment.edited", same shape/fields as "payment.recorded"
// (amountMinor = new amount, currency, method). Reason lives in the payment's auditHistory.

// groups.ts
export const groupSites = Object.freeze(["Town", "West"] as const);
export type GroupSite = (typeof groupSites)[number];
// saveMemberGroupSchema gains: site: z.enum(groupSites)
// MemberGroup stored/read type: site?: GroupSite (legacy groups have none)
```

- [ ] **Step 1:** Test `isGuardianOnly` (3 casos: tutor sin plan → true; con plan → false; con trial → false; sin hijo activo → false) y que `parseManualPaymentRecord` acepta un pago v1 con `auditHistory` de 1 entrada y rechaza una entrada con `reason` vacía.
- [ ] **Step 2:** `corepack pnpm vitest run --project node packages/domain/src/members/member-overview-contracts.test.ts packages/domain/src/finance/finance-contracts.test.ts` → FAIL.
- [ ] **Step 3:** Implementar los tipos arriba. En finance: `paymentFields` exactos → permitir `auditHistory` opcional (validar cada entrada: strings no vacías, `reason` 10–280, `editedAt` ISO). En audit: añadir `"payment.edited"` al enum, a la unión (`action: "payment.recorded" | "payment.edited"`), al mapa de campos y a las dos ramas del parser donde aparece `payment.recorded`. `buildMemberOverview` sigue sin emitir `trial`/`guardian` (eso es Task B1) pero sí `counters.guardians: 0`.
- [ ] **Step 4:** Tests en verde + `corepack pnpm --filter @bpt-jersey/domain typecheck` + `corepack pnpm --filter @bpt-jersey/web typecheck` + `corepack pnpm --filter @bpt-jersey/functions typecheck` (el nuevo valor de enum no debe romper switches existentes; si rompe, añadir el caso mínimo).
- [ ] **Step 5:** Commit en `main` "Add shared domain types for guardians, trials, payment edits and group sites".

---

### Task A1: Quitar la penalidad por no-show

**Files:**
- Delete: `apps/functions/src/penalties/` (todo), `packages/domain/src/penalties/` (todo, si nada fuera de penalties lo importa), `apps/web/src/lib/no-show-penalties-client.ts`, `apps/web/src/app/admin/billing/no-show-penalty-queue.tsx` (+`.test.tsx`), `apps/web/src/app/account/calendar/penalty-banner.tsx`, `qa/tests/no-show-penalty-auth-emulator.spec.ts`
- Modify: `apps/functions/src/index.ts` (quitar 3 exports), `apps/functions/src/deploy-runtime.ts` (alias `penalties`), `packages/domain/package.json` + `packages/domain/tsconfig.runtime.json` (subpath `./penalties`), `packages/domain/src/contracts.test.ts` (refs), `apps/web/src/app/admin/billing/page.tsx` (+`page.test.tsx`), `apps/web/src/app/account/calendar/member-calendar.tsx` (+test), `apps/web/src/lib/calendar/calendar-repository.ts`, `firebase-calendar-repository.ts`, `fixture-calendar-repository.ts` (+tests), `apps/web/src/app/account/account.css` (estilos del banner), `apps/web/src/app/account/classes/page.tsx` (texto £15), `apps/web/src/app/admin/staff/page.tsx` (ocultar etiqueta `reviewPenalties`), `qa/run-e2e.mjs`, `qa/tests/admin-billing-home.spec.ts`, `qa/tests/member-engagement-auth-emulator.spec.ts`, `qa/scripts/run-golden-path-e2e.mjs`, `qa/scripts/account-calendar-shots.mjs`
- Keep: colección/regla `noShowPenalties`, acciones `penalty.no_show.*` en `audit-event.ts`, valor `reviewPenalties` en el enum de grants (y `staff/permission-grant-*` sin cambios de datos).

**Interfaces:** Consumes nada. Produces nada.

- [ ] **Step 1:** Actualizar los tests existentes que afirmaban la penalidad: `billing/page.test.tsx` debe afirmar que **no** hay región "No-show penalties"; `member-calendar.test.tsx` que no se renderiza banner aunque el repo fixture tenga datos antiguos.
- [ ] **Step 2:** Borrar/editar los archivos listados. El texto de `account/classes/page.tsx` que menciona £15 se elimina (no se sustituye por otra política).
- [ ] **Step 3:** `grep -rniE "penalt|no-show-penalt|noShowPenalt" apps/web/src apps/functions/src packages/domain/src qa` → solo quedan: `audit-event.ts` (acciones históricas), enum de grant `reviewPenalties`, `firestore.rules`. Las asistencias `no_show` siguen intactas (`grep -n no_show apps/functions/src/schedule/schedule-service.ts` sin cambios).
- [ ] **Step 4:** `corepack pnpm --filter @bpt-jersey/domain typecheck && corepack pnpm --filter @bpt-jersey/functions typecheck && corepack pnpm --filter @bpt-jersey/web typecheck`; vitest de `billing/page.test.tsx`, `member-calendar.test.tsx`, `lib/calendar/*.test.ts`, `packages/domain/src/contracts.test.ts`.
- [ ] **Step 5:** Commit "Remove the no-show penalty from the platform".

---

### Task B1: Directorio — Free Trial y Guardians (backend + builder)

**Files:**
- Modify: `packages/domain/src/members/member-overview-contracts.ts` (solo `buildMemberOverview` y tipos de fuente; no tocar lo que dejó Task 0 salvo usarlo)
- Modify: `apps/functions/src/members/member-overview-callables.ts`
- Test: `packages/domain/src/members/member-overview-contracts.test.ts`, `apps/functions/src/members/member-overview-callables.test.ts` (si existe; si no, solo domain)

**Interfaces:**
- Consumes: `isGuardianOnly`, `memberPlanStates` con `"trial"`, `rowKind`, `userId`, `counters.guardians` (Task 0); `trialStatusAt` de `@bpt-jersey/domain/memberships` (`trial-access-contracts.ts`).
- Produces: `buildMemberOverview` input gana
  ```ts
  trialsByStudent: ReadonlyMap<string, Readonly<{ status: string; expiresAt: string; allowance: number; countedAttendanceIds: readonly string[] }>>;
  guardianUsers: readonly Readonly<{ userId: string; fullName: string; familyIds: readonly string[] }>[]; // primaryContactUserId de familias
  ```
  `OverviewFamilySource` gana `primaryContactUserId?: string`.

- [ ] **Step 1: Tests que fallan** (domain):
  - trial activo sin membresía → `planState "trial"`, `plan.displayName "Free Trial"`, `plan.planId "free-trial"`, `active true`, cuenta en `counters.active`.
  - trial expirado (`expiresAt` < now) o `status "converted"`/`"exhausted"` → `planState "none"`, no "Free Trial".
  - membresía vigente + trial → gana la membresía.
  - tutor con ficha de alumno sin plan, hijo activo en su familia → fila `rowKind "guardian"`, `active false`, cuenta en `counters.guardians` y **no** en `inactive`.
  - tutor con ficha + plan vigente → `rowKind "member"` con su plan.
  - tutor sin ficha de alumno (solo en `guardianUsers`) con hijo activo → fila sintética `studentId: \`guardian:${userId}\``, `rowKind "guardian"`, `userId`, `trainingCenter` = el del primer hijo activo, `source "bpt"`, `flags []`, `ownAccount true`.
  - tutor cuyos hijos están todos inactivos → no aparece como guardian (sin fila sintética; con ficha sale como member normal).
- [ ] **Step 2:** Correr → FAIL.
- [ ] **Step 3:** Implementar en `buildMemberOverview`: "hijo activo" = alumno de la familia distinto del tutor con `active` y (plan cubriente o trial activo). `hasActiveTrial` = `trialStatusAt(trial, now) === "active"` (usar la firma real de `trialStatusAt`). En `memberOverviewHandler`: leer `academies/{a}/trialAccess` (`.limit(500)`), incluir `primaryContactUserId` al mapear familias y construir `guardianUsers` desde los `users` de contacto principal que ya se cargan (nombre desde `users/{uid}.fullName`/`displayName`).
- [ ] **Step 4:** Tests verdes + typecheck domain y functions.
- [ ] **Step 5:** (commit al final de B2)

### Task B2: Directorio — UI (etiquetas, filtro Guardians)

**Files:**
- Modify: `apps/web/src/app/admin/members/members-workspace.tsx` (+test), `apps/web/src/app/admin/members/families-view.tsx` (+test), el cliente web del overview si parsea el esquema (buscar `memberOverviewSchema` en `apps/web/src/lib`), CSS del workspace si hace falta.

**Interfaces:** Consumes filas de B1.

- [ ] **Step 1: Tests que fallan:** `planLabel` de fila `planState "trial"` → título "Free Trial"; fila guardian → título "Guardian", detalle "Parent or guardian of an active member"; mosaico/filtro "Guardians" con el contador `counters.guardians`; filtro "Inactive" excluye guardians; búsqueda por nombre encuentra un guardian; una fila guardian sintética (`studentId` empieza por `guardian:`) no renderiza enlace al perfil de alumno ni acciones de alumno.
- [ ] **Step 2:** FAIL → **Step 3:** implementar siguiendo el estilo existente del workspace (mismos componentes de mosaico/filtro; estado como texto + regla izquierda, nunca pill) → **Step 4:** vitest de ambos archivos + typecheck web.
- [ ] **Step 5:** Commit "Show free trials and guardians in the member directory".

---

### Task C1: Contacto de emergencia propio (backend)

**Files:**
- Create: `apps/functions/src/account-settings/own-emergency-contact.ts` (servicio puro + adaptador), `apps/functions/src/account-settings/own-emergency-contact.test.ts`
- Modify: `apps/functions/src/account-settings/account-settings-callables.ts` (2 callables), `apps/functions/src/index.ts` (2 exports), `packages/domain/src/account-settings/…` o el módulo de contratos que ya usa account-settings (añadir `ownEmergencyContactInputSchema = z.strictObject({ studentId, contact: emergencyContactSchema, requestId: z.uuid() })`)

**Interfaces:**
- Produces callables `getOwnEmergencyContact({ studentId }) → { contact: EmergencyContact | null }` y `saveOwnEmergencyContact({ studentId, contact, requestId }) → { saved: true }`.
- Autorización: el actor es el propio alumno (`students/{id}.userId === uid`) o su tutor (`families/{familyId}.primaryContactUserId === uid` o relación `relationships` activa `adultUserId === uid`). Cualquier otro → `permission-denied`.
- Escribe `academies/{a}/studentAdminProfiles/{studentId}.emergencyContact` (merge), `profileWriteReceipts/{requestId}` (idempotencia) y un evento de auditoría con acción existente de actualización de perfil (buscar la que usa `profile-service.ts`; no crear acción nueva).

- [ ] **Step 1:** Tests del servicio con fakes: propio alumno guarda; tutor guarda para su hijo; tercero → denied; esquema inválido (teléfono vacío, `relationship` > 80) → invalid-argument; mismo `requestId` dos veces → una sola escritura.
- [ ] **Step 2:** FAIL → **Step 3:** implementar → **Step 4:** verde + typecheck functions.
- [ ] **Step 5:** (commit al final de C3)

### Task C2: Email y contraseña (cliente)

**Files:**
- Modify: `apps/web/src/lib/account-settings-client.ts` (+test)
- Modify: `apps/functions/src/account-settings/account-settings-callables.ts` + `index.ts`: callable `syncOwnAccountEmail()` que toma `request.auth.token.email` (solo si `email_verified`) y lo escribe en `academies/{a}/users/{uid}.email` (y `students` con ese `userId` si guardan email). Test en el archivo de test de callables existente.

**Interfaces (Produces):**
```ts
export async function requestEmailChange(input: { currentPassword: string; newEmail: string }): Promise<{ ok: true; sentTo: string } | { ok: false; message: string }>;
export async function changePassword(input: { currentPassword: string; newPassword: string; confirmPassword: string }): Promise<{ ok: true } | { ok: false; message: string }>;
export async function syncOwnAccountEmail(): Promise<void>; // silencioso si no hay cambio
export async function getOwnEmergencyContact(studentId: string): Promise<EmergencyContact | null>;
export async function saveOwnEmergencyContact(studentId: string, contact: EmergencyContact): Promise<{ ok: true } | { ok: false; message: string }>;
```
- `requestEmailChange`: zod (`z.email().trim().toLowerCase()`, distinto del actual) → `reauthenticateWithCredential(EmailAuthProvider.credential(user.email, currentPassword))` → `verifyBeforeUpdateEmail(user, newEmail)`.
- `changePassword`: zod (mín. 12, `newPassword === confirmPassword`, distinta de la actual) → reauth → `updatePassword` → reauth con la nueva (mismo patrón que `claimAdultAccount`).
- Mapa de errores: `auth/wrong-password`|`auth/invalid-credential`|`auth/invalid-login-credentials` → "That password is not right."; `auth/too-many-requests` → "Too many attempts. Wait a few minutes and try again."; `auth/email-already-in-use` → "That email is already used by another account."; `auth/requires-recent-login` → "Please sign in again, then retry."; `auth/invalid-email` → "Enter a valid email address."; otro → "We couldn't update your account. Try again later."

- [ ] **Step 1:** Tests con los mocks de `firebase/auth` que ya usa `account-settings-client.test.ts`: contraseña errónea → mensaje y **no** se llama `verifyBeforeUpdateEmail`; éxito → `sentTo` = email nuevo; contraseñas distintas → error sin llamar a Firebase; `requires-recent-login` mapeado.
- [ ] **Step 2–4:** FAIL → implementar → verde + typecheck web y functions.

### Task C3: Ajustes de cuenta (UI)

**Files:**
- Create: `apps/web/src/app/account/settings/email-section.tsx`, `password-section.tsx`, `phone-section.tsx`, `emergency-contact-section.tsx` (+ un test `account-settings-sections.test.tsx`)
- Modify: `apps/web/src/app/account/settings/page.tsx` (montar secciones; llamar `syncOwnAccountEmail()` al cargar), `apps/web/src/app/account/settings/settings.css`
- Teléfono: reusar `saveClientProfile` (miembro) / `saveGuardianProfile` (tutor) de `profile-client.ts` sin modificarlos; zod `z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/u)`.

- [ ] **Step 1:** Tests: cada formulario deshabilita el botón y muestra "Saving…" mientras guarda; muestra banda verde de éxito ("Check {email} to confirm the change" para email); muestra banda roja con el mensaje del cliente; errores de validación debajo del campo; contacto de emergencia exige nombre, relación y teléfono; para un tutor con varios hijos hay selector de alumno.
- [ ] **Step 2–4:** FAIL → implementar (DESIGN §9 app de miembro: radio 1rem, labels arriba, `min-height 3rem`, estado con regla izquierda, sin spinners) → verde + typecheck web.
- [ ] **Step 5:** Commit "Let members change their email, password, phone and emergency contact".

---

### Task D1: Barra del calendario de oficina responsive + avisos consolidados

**Files:**
- Modify: `apps/web/src/app/admin/classes-services/classes/page.tsx` (+`page.test.tsx`), `apps/web/src/app/admin/classes-services/classes-services.css`, `apps/web/src/app/admin/classes-services/classes/week-actions.tsx` (solo clases/wrap si hace falta), `apps/web/src/lib/callable.ts` (+test)

**Interfaces (Produces):** en `callable.ts`
```ts
export function isAppCheckFailure(error: unknown): boolean; // code/message con "appCheck/" o functions/unauthenticated|permission-denied cuyo mensaje menciona App Check
export const appCheckFailureMessage = "We couldn't verify this device. Try again in a moment.";
```

- [ ] **Step 1: Tests que fallan (page.test.tsx):** si catálogo, horario y conteos fallan con error App Check → **un** solo aviso con `appCheckFailureMessage` y **un** botón "Retry" que recarga los tres; el texto crudo "appCheck/initial-throttle" no aparece. Error no-App-Check → se mantienen los avisos actuales. El enlace "Create course / seminar" tiene clase `cs-toolbar-action`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** CSS ≤ 50rem en `.cs-calendar-page .cs-toolbar`: `grid-template-columns: 44px minmax(0,1fr) 44px`; título fila 1 `1/-1`; ‹ Today › fila 2; `.cs-field` fila 3 `1/-1`; `.cs-range-buttons` fila 4 `1/-1` con `grid-template-columns: repeat(3, minmax(0,1fr))`; `.cs-toolbar-action` y `.cs-button-primary` `grid-column: 1/-1`. `.cs-button`: `display:inline-flex; align-items:center; justify-content:center; text-align:center; min-width:0; white-space:normal; overflow-wrap:anywhere`. `.cs-week-actions { flex-wrap: wrap }`. Avisos con el patrón DESIGN (tinte + regla izquierda 0.35rem, botón a la derecha en desktop y debajo en móvil, sin texto partido alrededor del botón).
- [ ] **Step 4:** Verde + typecheck web.

### Task D2: App Check en callables de lectura del calendario

**Files:**
- Modify: `apps/functions/src/schedule/schedule-callable-options.ts` (+ test si existe), `apps/functions/src/schedule/schedule-callables.ts` (solo las opciones de `listScheduleCatalog`, `listSessions`, `listSessionBookedCounts` y demás lecturas puras), `apps/web/src/lib/schedule-client.ts` (escrituras con `limitedUseAppCheckTokens: true`)

**Interfaces (Produces):** `scheduleReadCallableOptions = { ...browserAdminCallableOptions, enforceAppCheck: true }` (sin `consumeAppCheckToken`); `scheduleCallableOptions` se queda para escrituras.

- [ ] **Step 1:** Test: las opciones de lectura tienen `enforceAppCheck: true` y **no** `consumeAppCheckToken`; las de escritura siguen con `consumeAppCheckToken: true`. Test web: `httpsCallable` para reservas/copyWeek recibe `{ limitedUseAppCheckTokens: true }`.
- [ ] **Step 2–4:** FAIL → implementar → verde + typecheck functions/web.

### Task D3: Script de series Regyfit duplicadas + runbook App Check

**Files:**
- Create: `apps/functions/scripts/retire-duplicate-regyfit-series.mjs`, `apps/functions/scripts/retire-duplicate-regyfit-series.test.mjs` (lógica pura exportada `findDuplicateSeries(sessions)` testeada con vitest `node`), `docs/runbooks/2026-09-25-app-check-y-duplicados-regyfit.md`

**Interfaces:**
- `findDuplicateSeries(sessions: {id, weeklySeriesId, createdBy, locationId, startAt, title, programId}[], timeZone = "Europe/Jersey") → { importedSeriesId, nativeSeriesId, locationId, weekday, localTime, title }[]` — duplicado = serie `regyfit-*` con `createdBy "regyfit-import"` y una serie nativa con misma sede, día de la semana y hora local, y mismo `programId` **o** mismo título normalizado (minúsculas, sin espacios dobles).
- CLI: `--academy=<id>` obligatorio; por defecto dry-run (imprime tabla y sesiones futuras afectadas con nº de reservas); `--apply` cancela solo sesiones futuras con 0 reservas (`status: "cancelled"`, `cancelledBy: "retire-duplicate-regyfit-series"`, `cancelledAt`) y reporta las que tienen reservas sin tocarlas. Nunca borra. Credenciales: ADC / `GOOGLE_APPLICATION_CREDENTIALS` del operador.
- Runbook en español, pasos numerados para el operador (formato de CLAUDE.md global): comprobar en consola Firebase → App Check → app web → reCAPTCHA Enterprise que la clave es la de `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY`; en Google Cloud → reCAPTCHA → la clave → dominios `bptjersey.com`, `www.bptjersey.com` y el dominio `*.pages.dev`; cómo ejecutar el dry-run y el apply del script.

- [ ] **Step 1:** Test de `findDuplicateSeries`: STRIVE BJJ West nativa + `regyfit-1420` misma hora → 1 duplicado; misma clase distinta hora → 0; distinta sede → 0.
- [ ] **Step 2–4:** FAIL → implementar → verde.
- [ ] **Step 5:** Commit "Fix the office calendar on phones, calm App Check failures and add the Regyfit duplicate retirement script".

---

### Task E1: Grupos — sede, exclusión de Guardians y override de elegibilidad (backend)

**Files:**
- Modify: `apps/functions/src/schedule/group-service.ts` (+test), `apps/functions/src/schedule/group-callables.ts` (si parsea `site`), `apps/functions/src/schedule/booking-transaction-service.ts` (+test)

**Interfaces:**
- Consumes: `groupSites`, `GroupSite`, `saveMemberGroupSchema.site`, `isGuardianOnly` (Task 0).
- Produces: `confirmBookingInTransaction`/`executeBookingInTransaction` input: `groupRegistration?: true; groupOverride?: true`. `groupOverride` solo se pasa desde `group-service.ts` `syncMember`; el esquema público de `requestBooking*` no lo acepta.
- `save()`: exige `site`; para cada `studentId` carga alumno, membresías, `trialAccess` y familia (si es contacto principal de una familia) y rechaza con `failed-precondition` "Guardians can't be added to a group: {nombre}" si `isGuardianOnly(...)`, y "Only active members can be added" si inactivo.
- `list()` devuelve `site` (o `undefined` para grupos antiguos).

- [ ] **Step 1: Tests que fallan:**
  - `save` sin `site` → invalid-argument; con Guardian → failed-precondition con su nombre; con alumno inactivo → failed-precondition.
  - `executeBookingInTransaction` con `groupOverride: true`: alumno de 30 años en sesión de programa `ageRange` 4–5 → reserva OK; sesión West con plan solo `classSites: ["Town"]` → OK; open mat con plan sin `openMatSites` → OK; límite semanal alcanzado → OK.
  - Con `groupOverride: true` y sin membresía activa pagada → sigue bloqueado (`syncMember` guarda "blocked"/"Missing Payment").
  - Sin `groupOverride` → los rechazos actuales se mantienen (no regresión).
- [ ] **Step 2:** FAIL → **Step 3:** en `executeBookingInTransaction` envolver solo `programAdmits`, `audience()`/participante y `evaluatePlanAccess` con `if (!input.groupOverride)`; `evaluateFinancialAccess`, waiver, cutoff, capacidad y `trainingCenterStatus` siempre corren. → **Step 4:** verde + typecheck functions.

### Task E2: Grupos — UI Town/West

**Files:**
- Modify: `apps/web/src/lib/groups-client.ts` (+test), `apps/web/src/app/admin/classes-services/groups/page.tsx` (+test), `apps/web/src/app/admin/classes-services/groups/groups.css`, `apps/web/src/app/admin/classes-services/classes/group-registrations.tsx` (mostrar/filtrar por sede de la sesión)

- [ ] **Step 1:** Tests: formulario exige sede (radio Town/West, etiqueta arriba); lista agrupada en "Town", "West" y "Unassigned site"; filtro Town/West; el selector de miembros no ofrece Guardians (usa `listMemberOverview` filas `rowKind "member"` activas o el listado actual de nombres filtrado — elegir el que ya use la página; si hay que pedir datos nuevos, pedir al backend y no duplicar lógica); error del backend "Guardians can't be added…" se muestra en banda roja; en `group-registrations.tsx` solo se ofrecen grupos de la misma sede que la sesión (más los "Unassigned site").
- [ ] **Step 2–4:** FAIL → implementar → verde + typecheck web.
- [ ] **Step 5:** Commit "Split groups by Town and West, keep guardians out and let a group override session eligibility".

---

### Task F1: Editar pagos manuales con razón (backend)

**Files:**
- Modify: `apps/functions/src/finance/finance-service.ts` (+test), `apps/functions/src/finance/finance-callables.ts` (+test), `apps/functions/src/index.ts` (1 export), `apps/functions/src/memberships/manual-subscription-service.ts` (+test), `packages/domain/src/memberships/subscription-admin-contracts.ts`

**Interfaces:**
- Consumes: `editManualPaymentInputSchema`, `PaymentAuditEntry`, acción `payment.edited` (Task 0); `calculateInvoiceBalance`.
- Produces: callable `editManualPayment(EditManualPaymentInput) → { paymentId, invoiceId, invoiceStatus: InvoiceStatus }`; fila de pago en `subscriptionBillingSchema`: `{ paymentId, invoiceId, amountMinor, method, reference, occurredAt, lastEdit: { editedAt, editedByName, reason } | null, auditHistory: PaymentAuditEntry[] }`; lista de facturas abiertas ya disponible en el mismo resultado (`invoices` con `status` `open|partially_paid` y `balanceMinor`).
- Transacción: lee pago (debe ser v1 `status "recorded"`) y su factura (no `void`); calcula nuevo balance con el pago modificado; rechaza sobrepago (`failed-precondition` "This change would overpay the invoice"); `auditHistory` = `[...previo, entry]` (nunca modifica entradas previas); `previousValues` solo de los campos cambiados; actualiza estado de la factura (`paid`/`partially_paid`/`open`, y `paidAt`); `updatedAt/By`; evento `payment.edited`. Idempotente por `requestId` (documento de recibo como en otros callables de finanzas). `editedByName` desde el perfil del actor.
- `requireAdministrator` (owner y administrador).

- [ ] **Step 1: Tests que fallan:** edición de monto 50→30 en factura de 50 → factura `partially_paid`; 30→50 → `paid`; 50→60 en factura de 50 → rechazo; razón de 9 caracteres → invalid-argument; sin campos editables → invalid-argument; dos ediciones → `auditHistory.length === 2` y la primera intacta; pago de curso (v2) → rechazo; coach → permission-denied; `requestId` repetido → una sola entrada.
- [ ] **Step 2–4:** FAIL → implementar → verde + typecheck domain/functions.

### Task F2: Pestaña Payments — Record payment y Edit (UI)

**Files:**
- Modify: `apps/web/src/lib/billing-client.ts` (+test), `apps/web/src/lib/subscription-admin-client.ts` (+test), `apps/web/src/app/admin/members/profile/payments-tab.tsx` (+test), `apps/web/src/app/admin/members/member-subscription-editor.tsx` (solo `SubscriptionBillingHistory`)
- Create: `apps/web/src/app/admin/members/profile/payment-dialogs.tsx`

**Interfaces:** `editManualPayment(input: EditManualPaymentInput): Promise<{ ok: true; invoiceStatus } | { ok: false; message: string }>` en `billing-client.ts`; "Record payment" reusa `recordManualPayment` existente de `billing-client.ts`.

- [ ] **Step 1: Tests que fallan:** botón "Record payment" abre `<dialog>` con selector de factura abierta (referencia + saldo); sin facturas abiertas → texto "Issue an invoice first to record a payment." y sin formulario; "Edit" por fila abre diálogo con valores actuales; el botón "Save changes" está deshabilitado hasta que la razón tenga ≥ 10 caracteres (contador visible "x/280"); guardar llama `editManualPayment` con solo los campos cambiados; fila editada muestra "Edited on 25 Sep 2026, 14:05 by {nombre} — Reason: {razón}" y un `<details>` "Edit history" con todas las entradas; error del backend en banda roja dentro del diálogo.
- [ ] **Step 2–4:** FAIL → implementar (admin: radio 0, tabla con reglas 1px, acciones inline al final de la fila, `tabular-nums` en importes, `<dialog>` nativo) → verde + typecheck web.
- [ ] **Step 5:** Commit "Let the office record and edit a member's payments with a mandatory reason".

---

### Task G1: Código muerto y cliente R2 (después de integrar A–F, en `main`)

**Files:**
- Modify: `apps/functions/src/index.ts`, módulos de callables listados en el spec (§ Carril G), `apps/functions/src/storage/r2-client.ts` (+test)
- Delete: `apps/web/src/lib/reminders-client.ts`, `apps/web/src/lib/announcements-client.ts`, `apps/web/src/app/admin/families/health-support-admin-panel.tsx` y sus tests; callables/servicios que queden sin uso tras quitar los exports.

- [ ] **Step 1:** Para cada candidata del spec: `grep -rn "<nombre>" apps/web/src scripts qa docs apps/functions/src --include=*.{ts,tsx,mjs,md}` → borrar solo si no hay referencia fuera de su propio módulo/tests y no es de runbook. Registrar la lista final en el mensaje de commit.
- [ ] **Step 2:** Quitar de `index.ts` los re-exports de helpers (`assertAcademyScope`, `getRegyfitProjectionScope`, `requireAdminActor`, `bootstrapEmulatorOwner`) comprobando que nadie importa esos nombres desde `index`.
- [ ] **Step 3:** R2: test que `createPrivateStorageR2Client()` llamado dos veces con el mismo entorno devuelve el mismo cliente (misma referencia); implementar caché a nivel de módulo por clave de configuración.
- [ ] **Step 4:** typecheck de los tres paquetes + tests de `r2-client`.
- [ ] **Step 5:** Commit "Remove unused callables and web files and reuse the R2 client".

---

### Task V: Verificación final (controlador, sobre `main` integrado)

- [ ] `corepack pnpm --filter @bpt-jersey/domain build:runtime`
- [ ] `corepack pnpm format:check && corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test`
- [ ] `corepack pnpm --filter @bpt-jersey/web build`
- [ ] Playwright (emuladores `demo-bpt-jersey`, viewport 375×667): spec nueva `qa/tests/lote-2026-09-25.spec.ts` con: barra del calendario sin desbordes (ancho de "Create course / seminar" ≥ 90% del contenedor y sin scroll horizontal); Guardian rechazado al añadir a grupo; editar pago sin razón → botón deshabilitado; settings: cambiar teléfono y contacto de emergencia OK, contraseña errónea en email → mensaje amigable.
- [ ] Informe honesto de resultados (qué pasó, qué falló, qué no se pudo correr).
- [ ] Despliegue solo con confirmación explícita del operador (orden en el spec).
