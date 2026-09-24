# Lote de 8 requerimientos (2026-09-25) — diseño

Estado: aprobado por el operador en chat (2026-09-25). Ejecución en paralelo con worktrees
(autorizado explícitamente para este lote; agentes Opus 5.5 medium). Tests Vitest + Playwright
solicitados explícitamente al final, sobre `main` integrado.

## Decisiones del operador

| Tema | Decisión |
|---|---|
| Paralelismo | Worktrees por carril; integración local en `main`, un commit por carril |
| Override de grupo | Solo elegibilidad: edad, sede, tipo de sesión, tipo de participante, límite semanal. Se mantienen alumno activo, waiver y plan pagado |
| Cambio de email | `verifyBeforeUpdateEmail` con reautenticación previa |
| Clases Regyfit | Retirar solo series importadas duplicadas de una serie nativa; lista revisada por el operador antes de aplicar |
| Nuevo pago | Contra una factura abierta del miembro (reusa `recordManualPayment`) |
| Permiso pagos | Owner y administrador (`requireAdministrator`) |
| Guardian | Tutor de ≥1 alumno activo sin plan vigente propio ni trial activo; incluye tutores sin ficha de alumno |

## Hechos verificados que acotan el alcance

- Marcar no-show (`reconcileSessionNoShows`) nunca crea penalidades; solo la callable
  `proposeNoShowPenalties`, que ninguna UI invoca. Ningún saldo/factura/dashboard lee `noShowPenalties`.
- El directorio real de oficina es `members-workspace.tsx` ← `memberOverviewHandler`
  (`member-overview-callables.ts`) ← `buildMemberOverview` (`member-overview-contracts.ts`).
  Los `canonical-member-directory-*` no calculan etiquetas y no se tocan.
- Un trial no es membresía: vive en `academies/{a}/trialAccess/{studentId}`; el overview no lo lee →
  "No plan" + "Inactive".
- Los grupos no tienen sede. Todas las reglas de elegibilidad de reserva están en
  `executeBookingInTransaction` (`booking-transaction-service.ts`). No existen reglas de faja ni género.
- El horario de adultos en producción corre sobre series `regyfit-14xx` (`createdBy: "regyfit-import"`),
  que son el horario vigente. Hay duplicados con series nativas (p. ej. STRIVE BJJ West ×3).
- Callables de calendario usan `consumeAppCheckToken: true` pero el cliente no pide tokens de uso
  limitado. El 403 `appCheck/initial-throttle` es del intercambio reCAPTCHA → configuración de consola.
- No existe edición de pagos ni `auditHistory`. `recordManualPayment` exige factura v1 abierta.

## Reglas de interfaz (DESIGN.md, obligatorias en todos los carriles)

- Admin: radio 0; bordes 1–2 px Mat Ink `#1A1A18`/Line `#8A8880`; canvas `#F2F1ED`; paneles Gi White.
- `/account`: app de miembro, radio 1rem (999px en pills/acciones), encabezado BPT Purple.
- Color: solo BPT Purple `#2F2483` (hover `#211965`), Lime `#D9F36A` para acento escaso, Purple Wash
  `#F0EFFF`/`#D9D6FF`. Sin azul, sin gradientes, sin negro puro, sin sombras con blur.
- Estado = texto + regla izquierda 0.35rem: verde `#176B49`/`#E7F6EE`, ámbar `#C98B00`/`#765400`/`#FFF8E6`,
  rojo `#8D1C2F`/`#721626`/`#FFF0F2`. Nunca pill de color sola.
- Tipografía: display Barlow Condensed mayúsculas `letter-spacing .035em`; cuerpo Source Sans 3 1rem/1.5;
  eyebrow 0.72rem 700 mayúsculas `.15em` morado; botones 0.9rem 700; números `tabular-nums`.
- Botones: `min-height 3.15rem` (≥44px en tablas/admin compacto), hover `translateY(-2px)` 160ms,
  focus `outline 3px solid #2F2483; offset 4px`. Sin botones solo-icono.
- Inputs: etiqueta arriba (600), `min-height 3rem`, borde 1px Line, error en rojo debajo con tinte en
  el grupo. Sin labels flotantes.
- Carga: skeleton Paper Edge `#E8E7E3` con dimensiones reales; **sin spinners**. Vacíos: eyebrow +
  titular + una frase + un botón.
- Layout: CSS Grid con `minmax(0, …)`, `min-width: 0`; colapsa a una columna ≤ 50rem; sin scroll
  horizontal; `overflow-wrap: anywhere`; breakpoints en rem. `prefers-reduced-motion` desactiva
  transformaciones. Copy en inglés británico llano, sin clichés.

## Carril 0 — Base compartida (secuencial, antes de repartir)

Solo tipos/funciones puras en `packages/domain`, para que ningún carril edite estos archivos:
- `packages/domain/src/members/member-overview-contracts.ts`: añadir `"trial"` a `memberPlanStates`
  y `rowKind: "member" | "guardian"` al esquema de fila (opcional, default `"member"`); función pura
  `isGuardianOnly({ hasOwnCoveringPlan, hasActiveTrial, guardsActiveStudent })`.
- `packages/domain/src/audit/audit-event.ts`: acción `payment.edited` (campos comunes + `paymentId`,
  `reason`, `changedFields`).
- `packages/domain/src/finance/finance-contracts.ts`: tipo/esquema `PaymentAuditEntry
  { editedAt: string; editedBy: string; editedByName: string; reason: string; previousValues: Record<string, unknown> }`
  y `auditHistory?: PaymentAuditEntry[]` opcional en el registro de pago; `editPaymentReasonSchema`
  (trim, 10–280).
- `packages/domain/src/schedule/groups.ts`: `groupSites = ["Town","West"]`; `site` en
  `saveMemberGroupSchema` y en la vista.
Commit en `main` antes de crear los worktrees.

## Carril A — Quitar penalidad por no-show

Borrar: `apps/functions/src/penalties/*` (+tests), exports en `index.ts`, alias
`@bpt-jersey/domain/penalties` en `deploy-runtime.ts`, `apps/web/src/lib/no-show-penalties-client.ts`,
`admin/billing/no-show-penalty-queue.tsx` (+test) y su montaje en `billing/page.tsx`,
`account/calendar/penalty-banner.tsx` y su uso (`hasPendingPenalty`) en `member-calendar.tsx`,
`loadPenalties` y la penalidad fixture en `lib/calendar/*`, estilos del banner en `account.css`,
el texto de política £15 en `account/classes/page.tsx`, la etiqueta del permiso `reviewPenalties` en
`admin/staff/page.tsx`, specs QA dedicadas (`no-show-penalty-auth-emulator.spec.ts`) y referencias en
`qa/run-e2e.mjs`. Borrar `packages/domain/src/penalties/*` y su export si nada más lo usa.
Conservar: colección `noShowPenalties` (histórico; regla `if false` se queda), las acciones
`penalty.no_show.*` en `audit-event.ts` (para parsear eventos antiguos) y el valor de grant
`reviewPenalties` en el enum (datos guardados). El no-show sigue guardándose como asistencia.
Hecho cuando: `grep -ri "penalt" apps/web/src apps/functions/src` solo devuelve lo conservado.

## Carril B — Directorio: Free Trial + Guardians

- `member-overview-callables.ts`: leer `trialAccess` (acotado 500 como el resto) y pasar al builder.
- `buildMemberOverview`: si no hay membresía cubriente y hay `trialAccess` con `trialStatusAt(...) === "active"`
  → `planState: "trial"`, `plan.displayName: "Free Trial"`, cuenta como activo/entrenando.
- Guardians: con `families.primaryContactUserId` + `students.familyId` ya cargados, calcular
  `guardsActiveStudent`. Si el tutor tiene ficha de alumno y `isGuardianOnly` → fila con
  `rowKind:"guardian"`; si el tutor no tiene ficha de alumno → fila sintética `rowKind:"guardian"`
  desde `users/{uid}` (nombre, email, familia), sin enlaces a acciones de alumno.
- `members-workspace.tsx`: `planLabel` → "Free Trial" / "Guardian"; mosaico y filtro **Guardians**;
  los guardians no cuentan en "Inactive"; búsqueda por texto los incluye. `families-view.tsx`: etiqueta
  "Free Trial". Tests unitarios del builder para trial activo/expirado/convertido y los tres casos de guardian.

## Carril C — Ajustes de cuenta en `/account/settings`

- Secciones nuevas en `account/settings/page.tsx` (componentes en archivos propios dentro de
  `account/settings/`): Email, Password, Phone, Emergency contact. Settings ya está enlazado desde la
  cabecera del miembro; verificar visibilidad en móvil.
- Email: esquema zod (email, trim, lowercase); pedir contraseña actual → `reauthenticateWithCredential`
  → `verifyBeforeUpdateEmail(user, newEmail)`; mensaje "Check {email} to confirm". Sincronización:
  callable `syncOwnAccountEmail` que lee el email verificado del token Auth y lo escribe en
  `academies/{a}/users/{uid}` (y `students` si aplica); se llama al cargar settings/login cuando
  `auth.currentUser.email` difiere del perfil guardado.
- Password: zod (mín. 12, confirmación igual), reautenticación → `updatePassword` → reautenticar con
  la nueva (patrón existente de `claimAdultAccount`). Mapear `auth/*` a mensajes amigables
  (`wrong-password`, `invalid-credential`, `requires-recent-login`, `too-many-requests`, `email-already-in-use`).
- Phone: reusar `saveClientProfile`/`saveGuardianProfile` según rol; zod para teléfono.
- Emergency contact: callables `getOwnEmergencyContact` / `saveOwnEmergencyContact` (miembro o tutor
  sobre su alumno, `assertAcademyScope`, zod con `emergencyContactSchema`) escribiendo
  `studentAdminProfiles/{studentId}` + recibo en `profileWriteReceipts` + evento de auditoría.
- Estados: botón deshabilitado con texto "Saving…", banda verde de confirmación, banda roja de error.

## Carril D — Calendario de oficina + AppCheck + duplicados Regyfit

- `classes/page.tsx` + `classes-services.css`: barra en grid; ≤ 50rem: fila 1 = título; fila 2 =
  ‹ / Today / › (`44px minmax(0,1fr) 44px`); fila 3 = fecha; fila 4 = vistas en grid 3 cols
  `minmax(0,1fr)`; fila 5 = acciones ("Create course / seminar", "Add a class") a ancho completo
  (`grid-column: 1/-1`, `display:inline-flex; justify-content:center; text-align:center`). `white-space`
  y `min-width:0` en botones; `.cs-week-actions` con `flex-wrap`. Verificar a 320, 375 y 400 px.
- Errores: un solo aviso consolidado si falla App Check ("We couldn't verify this device. Try again in a
  moment." + un botón "Retry"), en lugar de tres; avisos con estilo DESIGN (tinte + regla, sin
  repetir). Mapear `appCheck/*` y `functions/unauthenticated|permission-denied` por App Check en `callable.ts`.
- Quitar `consumeAppCheckToken` de las callables de solo lectura del calendario (`listScheduleCatalog`,
  `listSessions`, `listSessionBookedCounts` y demás lecturas en `schedule-callable-options.ts`): son
  lecturas y la protección de replay no aporta seguridad, pero rompe llamadas paralelas con el mismo
  token. Las escrituras (reservas, copyWeek) mantienen `consumeAppCheckToken` y el cliente les pasa
  `limitedUseAppCheckTokens: true` en `httpsCallable`. `firebase-client.ts`: debug token sigue solo
  con emuladores; sin cambios de proveedor.
- Script `apps/functions/scripts/retire-duplicate-regyfit-series.mjs`: `--dry-run` por defecto; detecta
  series `regyfit-*` con una serie nativa de misma sede, día, hora local y programa/título; lista las
  sesiones futuras; con `--apply` cancela solo sesiones futuras **sin reservas** y marca la serie
  importada como retirada; nunca borra documentos. El operador revisa la lista antes de `--apply`.
- Runbook para el operador: revisar en consola App Check → reCAPTCHA Enterprise los dominios
  `bptjersey.com`, `www.bptjersey.com` y el dominio de Cloudflare Pages.

## Carril E — Grupos Town/West + override de elegibilidad

- `group-service.ts` `save()`: exigir `site`; rechazar alumnos inactivos y Guardians (usando
  `isGuardianOnly` con los mismos datos: plan cubriente, trial, familias).
- `group-service.ts` `list()`/vistas y `admin/classes-services/groups/page.tsx`: selector de sede
  obligatorio, filtro Town/West, agrupación por sede; el selector de miembros oculta Guardians.
  Grupos existentes sin sede: mostrados en "Unassigned site" hasta que se editen (sin migración).
- Registro: `syncMember` pasa `groupOverride: true` a `confirmBookingInTransaction`;
  `executeBookingInTransaction` omite `programAdmits`, `audience`/tipo de participante y
  `evaluatePlanAccess` (sede/tipo de sesión/límite semanal) cuando `groupOverride` es true. Se mantienen:
  alumno activo, waiver, `trainingCenterStatus`, cutoff, capacidad, `evaluateFinancialAccess` y
  exigencia de membresía activa. Solo el camino de grupo puede poner la bandera (no está en el input
  público de reservas).
- Tests: override deja pasar edad/sede/tipo; no deja pasar sin pago; Guardian rechazado en `save()`.

## Carril F — Pagos manuales editables con razón

- Domain (del carril 0) + `subscription-admin-contracts.ts`: la fila de pago incluye `invoiceId`,
  `auditHistory`, `lastEdit`.
- `finance-service.ts`: `editManualPayment({ paymentId, amountMinor?, method?, manualReference?, occurredAt?, reason })`
  en transacción: lee pago y factura, valida que el nuevo monto no sobrepague la factura, añade entrada
  a `auditHistory` (`arrayUnion`, nunca reescribe entradas previas), recalcula estado de factura
  (paid/partially_paid/open) y escribe evento `payment.edited`. Rechaza pagos v2 (cursos) y online.
- `finance-callables.ts`: `editManualPayment` con `requireAdministrator`, zod, `browserAdminCallableOptions`.
- `manual-subscription-service.ts` `listSubscriptionBilling`: exponer `paymentId`, `invoiceId`, historial.
- Web: `billing-client.ts` (`editManualPayment`), `payments-tab.tsx`: botón "Record payment"
  (diálogo que elige factura abierta; si no hay, explica que primero se emite una) y "Edit" por fila
  (diálogo `<dialog>` nativo, razón obligatoria con contador, botón deshabilitado hasta 10 caracteres).
  Nota visible por pago editado: "Edited on {fecha hora} by {nombre} — Reason: {razón}" (última
  edición; historial completo desplegable).

## Carril G — Código muerto (después de integrar A–F)

Eliminar callables sin uso web ni runbook (lista de exploración, reverificada con grep en ese momento):
alias/reconciliación de identidad, `reviewMemberHistoryEntry`, `saveMemberAttendanceBaseline`,
`getMemberInventoryPage`, `changeChildGuardian`, `cancelBooking`/`requestBooking` (no-Eu),
`getMembership`, `getPlan`, `createCrmLead`, waivers privados, preferencias de notificación,
`exportCourseSubject`, `listClientReminders` y las 9 de announcements; archivos web huérfanos
(`reminders-client.ts`, `announcements-client.ts`, `health-support-admin-panel.tsx`); quitar los
helpers re-exportados desde `index.ts` (`assertAcademyScope`, `getRegyfitProjectionScope`,
`requireAdminActor`, `bootstrapEmulatorOwner`). R2: memoizar el `S3Client` a nivel de módulo en
`r2-client.ts`. Conservar las de runbook (recovery, backup/restore, provisionAdminRole, quorum).
Antes de borrar cada una: confirmar cero referencias en `apps/web/src`, `scripts/`, `qa/`, docs de runbook.

## Mapa de propiedad de archivos (anti-choques)

Cada archivo pertenece a un solo carril. Compartidos: `apps/functions/src/index.ts` (solo añadir/quitar
líneas de export propias; el integrador resuelve) y `qa/run-e2e.mjs` (solo A). El carril 0 es el
único que edita `audit-event.ts`, `finance-contracts.ts`, `member-overview-contracts.ts` (tipos) y
`groups.ts`; B puede ampliar `buildMemberOverview` (lógica) en `member-overview-contracts.ts` porque
nadie más lo toca después del carril 0. E y F ambos leen `finance-contracts` sin editarlo.

## Integración, verificación y despliegue

1. Carril 0 en `main` → 6 worktrees desde ese commit → A–F en paralelo.
2. Integración en `main` en orden A, B, C, D, E, F (rebase de cada rama, un commit por carril),
   `typecheck` del paquete afectado tras cada uno.
3. Carril G sobre `main` integrado.
4. Verificación solicitada: `corepack pnpm typecheck`, `lint`, `test`; Playwright (viewport 375×667)
   para barra del calendario, Guardian no añadible a grupo, edición de pago sin razón bloqueada y
   formularios de settings. Informe honesto de resultados.
5. Despliegue solo con confirmación explícita: functions nuevas/cambiadas (B, C, E, F, D-options)
   **antes** del push (el push publica la web); borrado de functions (A, G) confirmado aparte ⚠️;
   script de duplicados Regyfit: dry-run → revisión del operador → `--apply`.
