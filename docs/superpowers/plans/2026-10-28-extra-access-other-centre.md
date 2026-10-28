# Acceso extra en otro centro + etiqueta T/W — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development o superpowers:executing-plans (lo elige Luis). Los pasos usan casillas (`- [ ]`).

**Goal:** un tipo de clase que la oficina marca a mano en «Extra access (office)» se ve y se reserva en el calendario del miembro aunque sea de un centro que su plan no cubre (caso real: miembro con «West Adult» + «GI All Levels Lunchtime», solo Town). Además, cada tarjeta del calendario lleva una etiqueta **T** (Town) o **W** (West).

**Architecture:** la regla vive en dos sitios que ya existen: `lockedReasonFor` (dominio; lo usan el servidor del calendario y el navegador) y `confirmBookingInTransaction` (reserva; también la usan el check-in en la puerta, el walk-in del coach y la lista de espera). Hoy los dos mezclan los tipos marcados a mano con los que abre el rango de edad (`additionalProgramIds`). La regla nueva solo afecta a los marcados a mano, así que viajan aparte con el nombre `officeProgramIds`. No cambia ningún documento de Firestore, ni las reglas, ni los índices.

**Tech Stack:** pnpm monorepo, TypeScript strict, zod, Firebase Functions v2 (`europe-west9`), Next.js 16 estático (Cloudflare Pages).

**Spec:** sin spec (cambio acotado). La descripción la aprobó Luis en el chat el 2026-10-28. Sus decisiones:

| # | Decisión | Quién |
|---|---|---|
| D1 | El acceso extra se da **por tipo de clase** (el «Extra access (office)» de siempre), no por sesión suelta. | Luis |
| D2 | Un tipo marcado se salta **la edad y el centro del plan**, en clases y en Open Mat. Los centros del propio tipo siguen mandando: Lunchtime solo existe en Town. | Luis (pedido) |
| D3 | Las sesiones extra **cuentan** para el límite semanal del plan (West Adult = 2). | Luis |
| D4 | Etiqueta T/W en **todas** las tarjetas del calendario de miembros. | Luis |
| D5 | Los datos del miembro los cambia Luis desde el admin después de publicar: Change Plan → West Adult, y Classes → marcar GI All Levels Lunchtime. | Luis |
| D6 | El **rango de edad** (Members → Access, «Desde/Hasta») **no** se salta el centro: sigue respetando los centros del plan. | Claude (Luis no lo objetó) |
| D7 | Límite conocido, fuera de alcance: un tipo sin centro marcado (hoy «GI Beginners Lunchtime») sale como «incluido» en un plan West, así que no se puede marcar como extra para Town. | Claude |

## Global Constraints

- **Sin tests**: no añadas, corras ni esperes tests (unit, rules, e2e, `verify:mvp`). Es la regla del repo (`AGENTS.md`).
- **Verificación por tarea**: el typecheck del paquete tocado (cada tarea trae su comando) y la inspección del diff. Nada de lint, format ni typecheck de todo el workspace. `web typecheck` ya da errores antiguos en archivos `*.test.ts(x)`: solo cuentan los errores en archivos que tú tocaste.
- **Git**: `main` local. Nunca `git add -A` ni `git add .`, porque hay otras sesiones en el repo (por ejemplo, `docs/reviews/*` sin seguimiento que no son tuyos). Añade tus archivos por ruta. Commits con la identidad que ya tiene el repo y el trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **No hagas push ni deploy**: lo hace el controlador en la tarea 5.
- `packages/domain` nunca importa Firebase.
- Textos de la UI en inglés británico, sencillos (`DESIGN.md` §8). Docs en español.
- El nombre del campo es **`officeProgramIds`** en todas las capas: dominio, respuesta del callable y web. Significa «tipos que la oficina marcó a mano y que siguen en vigor».
- Compatibilidad entre versiones: el navegador valida `groupAccess` con `studentGroupAccessSchema`, que es un `strictObject`. Por eso `officeProgramIds` va **en el nivel superior** de la respuesta de `getMemberCalendarWeek`, **nunca dentro de `groupAccess`**. Si fuera dentro, rompería a los miembros que tengan el bundle viejo en caché.

## Review Focus

No hay tests, así que cada punto se comprueba a mano en la tarea 5 (banco local).

1. **El rango de edad no abre el otro centro.** Un miembro West con rango «Desde/Hasta» y sin marcas no ve sesiones de Town. El calendario usa `officeProgramIds`, no el `additionalProgramIds` mezclado. Lo cubren las tareas 1 y 2.
2. **Límite semanal.** Un West Adult con 2 clases reservadas esa semana ve Lunchtime en gris («Weekly limit reached»), y el servidor la rechaza con `weekly-limit`. Lo cubren las tareas 1 y 2.
3. **Acceso caducado o quitado.** Con `expiresOn` pasado, o sin la marca, la sesión de Town desaparece y la reserva da `plan-site`. El calendario mide «hoy» y la reserva mide el día de la clase, como hasta ahora.
4. **Versiones mezcladas.** Web nueva con functions viejas: no llega `officeProgramIds`, así que todo se comporta como hoy, sin errores. Web vieja con functions nuevas: la respuesta trae una clave nueva en el nivel superior, la web la ignora y sigue sin errores. Lo cubren las tareas 2 y 3.
5. **Open Mat de otro centro marcado.** Un plan con `openMatSites: []` (West Kids 1x) que tiene marcado «Kids & Teens Open Mat» (Town) la reserva. Además, la Open Mat no gasta del límite semanal, igual que antes. Lo cubre la tarea 2.

---

## Mapa de archivos

| Archivo | Cambio | Tarea |
|---|---|---|
| `packages/domain/src/schedule/member-calendar-contracts.ts` | `officeProgramIds` en el contexto + la regla en `lockedReasonFor` | 1 |
| `PRODUCT.md` | reglas «Additional member group access» y «Member training age range» | 1 |
| `apps/functions/src/schedule/member-calendar-week-callables.ts` | pasar y devolver `officeProgramIds` | 2 |
| `apps/functions/src/schedule/booking-transaction-service.ts` | la marca de la oficina se salta los centros del plan | 2 |
| `apps/web/src/lib/schedule-client.ts`, `apps/web/src/lib/calendar/calendar-repository.ts`, `apps/web/src/lib/calendar/firebase-calendar-repository.ts`, `apps/web/src/app/account/calendar/member-calendar.tsx` | `officeProgramIds` llega al contexto del calendario | 3 |
| `apps/web/src/app/account/calendar/session-card.tsx`, `apps/web/src/app/account/account.css` | etiqueta T/W | 3 |
| `apps/web/src/app/admin/members/profile/group-access-editor.tsx`, `apps/web/src/app/admin/members/access-tab.tsx` | textos del admin | 4 |

---

### Task 1: Regla en el dominio

**Files:**
- Modify: `packages/domain/src/schedule/member-calendar-contracts.ts` (tipo `CalendarMemberContext`, en torno a la línea 264; `lockedReasonFor`, en torno a las líneas 303-345)
- Modify: `PRODUCT.md:131-143` y `PRODUCT.md:147-151`

**Interfaces:**
- Produces: `CalendarMemberContext.officeProgramIds?: readonly string[]`, el campo opcional que las tareas 2 y 3 rellenan. Si no viene, el comportamiento es el de hoy.

- [ ] **Step 1: Añadir el campo a `CalendarMemberContext`**, justo debajo de `additionalProgramIds`, con un comentario de una línea: *«Types the office ticked by hand (Extra access): since 2026-10-28 they also waive the plan's centres; the age range's types do not.»*

- [ ] **Step 2: En `lockedReasonFor`, en la rama de miembro con plan, devolver `undefined`** si `member.officeProgramIds` incluye `program.programId`. Va justo antes de calcular `site` y de los chequeos de Open Mat y de centro (los dos `return` del final). Los chequeos anteriores siguen igual: el centro y la edad del propio tipo (`programTypeReason`) y la banda. El límite semanal no está aquí: lo aplica `deriveSessionStatus` después, y debe seguir aplicándose (D3). Cambia también el comentario «An office-granted extra group waives the age rules only; the plan's centres…» para que diga lo nuevo.

- [ ] **Step 3: PRODUCT.md.** En «Additional member group access (2026-09-20)», cambia «the plan's centres and weekly limit still apply.» por: «the plan's weekly limit still applies. Since 2026-10-28 a grant also waives the plan's centres (a West member can book a Town-only type the office ticked); the type's own centres still apply. Member calendar cards show a T (Town) or W (West) mark.» En «Member training age range», cambia «exactly like an extra group:» por «like an extra group, but keeping the plan's centres:».

- [ ] **Step 4: Verificar**

Run: `corepack pnpm --filter @bpt-jersey/domain typecheck`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/schedule/member-calendar-contracts.ts PRODUCT.md
git commit -m "feat(domain): office-ticked class types open at either centre in the member calendar"
```

### Task 2: Servidor (calendario y reserva)

**Files:**
- Modify: `apps/functions/src/schedule/member-calendar-week-callables.ts:115-124` (antes de mezclar el rango), `:197-219` (contexto `member`) y `:247-255` (respuesta)
- Modify: `apps/functions/src/schedule/booking-transaction-service.ts:903-911` y `:966-1003`

**Interfaces:**
- Consumes: `CalendarMemberContext.officeProgramIds` (tarea 1).
- Produces: la respuesta de `getMemberCalendarWeek` lleva `officeProgramIds: string[]` en el nivel superior, **solo cuando lleva `groupAccess`** (miembro con plan activo). La tarea 3 la lee.

- [ ] **Step 1: Calendario.** En `getMemberCalendarWeek`, guarda `const officeProgramIds = [...groupAccess.programIds]` **antes** de añadir `rangeExtraProgramIds`, porque `memberView` ya filtra los caducados. Pásalo al contexto `member` (`officeProgramIds`) y añádelo a la respuesta junto a `groupAccess`: `...(member.hasActiveMembership ? { groupAccess, officeProgramIds } : {})`.

- [ ] **Step 2: Reserva.** En `confirmBookingInTransaction`, calcula `const officeTicked = additionalProgramIds.includes(storedSession.programId)`. `additionalProgramIds` sale de `effectiveGroupProgramIds`, que solo trae los marcados a mano y ya mide la caducidad con el día de la clase. Dentro del `if (input.groupOverride !== true)` (donde ya viven `sessionSite` y `evaluatePlanAccess`), si `officeTicked`, pasa a `evaluatePlanAccess` una copia del plan con los centros de la sesión, `{ ...storedPlan, classSites: [sessionSite], openMatSites: [sessionSite] }`, con el comentario `// ponytail: an office-ticked type borrows the session's centre, as it borrows the plan's participant type.` Así siguen valiendo el plan activo, el límite semanal (D3) y la tarifa. No toques `programAdmits`: los centros del propio tipo siguen mandando. Cambia el comentario «Additional groups waive the age rules only: the plan's centres and weekly limit still apply.» para que diga lo nuevo.

- [ ] **Step 3: Verificar**

Run: `corepack pnpm --filter @bpt-jersey/domain build:runtime && corepack pnpm --filter @bpt-jersey/functions typecheck`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add apps/functions/src/schedule/member-calendar-week-callables.ts apps/functions/src/schedule/booking-transaction-service.ts
git commit -m "feat(functions): office-ticked class types book at either centre"
```

### Task 3: Calendario del miembro (datos + etiqueta T/W)

**Files:**
- Modify: `apps/web/src/lib/schedule-client.ts:382-393` (`MemberCalendarWeek`)
- Modify: `apps/web/src/lib/calendar/calendar-repository.ts:56-67` (`CalendarWeekData`)
- Modify: `apps/web/src/lib/calendar/firebase-calendar-repository.ts:216-224` (`loadOrdinary`)
- Modify: `apps/web/src/app/account/calendar/member-calendar.tsx:361-366` (contexto del miembro)
- Modify: `apps/web/src/app/account/calendar/session-card.tsx:201` y `apps/web/src/app/account/account.css:408-413`

**Interfaces:**
- Consumes: `officeProgramIds` en la respuesta (tarea 2) y `CalendarMemberContext.officeProgramIds` (tarea 1).
- Produces: `MemberCalendarWeek.officeProgramIds?: readonly string[]` y `CalendarWeekData.officeProgramIds?: readonly string[]`.

- [ ] **Step 1: Tipos.** Añade `officeProgramIds?: readonly string[]` a `MemberCalendarWeek` y a `CalendarWeekData`.

- [ ] **Step 2: Repositorio.** En `loadOrdinary`, valida con zod y pásalo: `...(week.officeProgramIds ? { officeProgramIds: z.array(z.string()).max(200).parse(week.officeProgramIds) } : {})`. Es el mismo tope de 200 que `programIds` en `studentGroupAccessSchema`. La caché `bpt-member-calendar:{uid}` guarda la semana entera, así que no hay nada más que tocar.

- [ ] **Step 3: Contexto.** En `member-calendar.tsx`, dentro del bloque `...(selectedWeek.groupAccess ? {…} : {})`, añade `officeProgramIds: selectedWeek.officeProgramIds ?? []`.

- [ ] **Step 4: Etiqueta.** En `SessionCard`, el `.session-time` pasa a tener dos hijos: el rango horario y `<span className="session-centre" aria-hidden="true">{site === "Town" ? "T" : "W"}</span>`. El `aria-hidden` evita que un lector de pantalla diga el centro dos veces, porque la línea `.session-site` ya dice «Town» o «West». En el CSS, `.session-time` pasa a ser una fila flex con `align-items: center`, `justify-content: space-between` y `gap: 0.5rem`. `.session-centre` lleva: 1.5rem × 1.5rem, `border-radius: 999px` (píldora, permitido en el área de miembros, `DESIGN.md` §9), fondo `var(--bpt-purple)`, letra `var(--gi-white)`, `var(--font-display)` a 0.9rem y `flex: none`. Es el mismo estilo para T y para W: la letra es lo único que cambia. La lista del check-in en la puerta no lleva etiqueta.

- [ ] **Step 5: Verificar**

Run: `corepack pnpm --filter @bpt-jersey/web typecheck`
Expected: ningún error en los 6 archivos de esta tarea (los errores de `*.test.ts(x)` ya existían).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/schedule-client.ts apps/web/src/lib/calendar/calendar-repository.ts apps/web/src/lib/calendar/firebase-calendar-repository.ts apps/web/src/app/account/calendar/member-calendar.tsx apps/web/src/app/account/calendar/session-card.tsx apps/web/src/app/account/account.css
git commit -m "feat(web): member calendar books office-ticked types at either centre and marks each class T or W"
```

### Task 4: Textos del admin

**Files:**
- Modify: `apps/web/src/app/admin/members/profile/group-access-editor.tsx:143-144`
- Modify: `apps/web/src/app/admin/members/access-tab.tsx:283-284`

Cada tipo de la lista ya muestra su centro (`audienceSummary` → «Ages 16+ · Town»), así que solo cambia el texto.

- [ ] **Step 1: `group-access-editor.tsx`.** Primer párrafo: «Groups included by the member's plan and age are ticked and locked. Tick an extra group to let this member book it outside their age range, plan type or centre.» Segundo párrafo: «Extra groups can be at either centre and still count towards the plan's weekly limit. Active membership, payment standing, available places and booking deadlines also apply. Clearing a group stops new bookings in it.»

- [ ] **Step 2: `access-tab.tsx`.** `access-lead`: «Let a member book classes for another age range, or extra class types at either centre. An age range keeps the plan's centres. The plan's weekly limit always applies.»

- [ ] **Step 3: Verificar**

Run: `corepack pnpm --filter @bpt-jersey/web typecheck`
Expected: ningún error en esos 2 archivos.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/admin/members/profile/group-access-editor.tsx apps/web/src/app/admin/members/access-tab.tsx
git commit -m "copy(web): extra access in Members says it opens either centre"
```

### Task 5: Comprobar, publicar y entregar (controlador)

- [ ] **Step 1: Revisión del diff.** `/code-review high` sobre los commits 1–4 (toca permisos de reserva).
- [ ] **Step 2: Banco local** (`node qa/scripts/run-recovery-stack.mjs start`, proyecto `demo-bpt-jersey`; no es una suite de tests, es una comprobación a mano). Siembra en el emulador lo siguiente: un adulto con membresía `west-adult` y waiver aceptado (`enrolmentWaiverAcceptances/{uid}__<versión>`); un tipo solo Town (16+); sesiones esta semana en Town y West; y `studentGroupAccess/{id}` con ese tipo en `programIds`. Comprueba, como el miembro:
  1. La sesión de Town sale con **Book** y etiqueta **T**, y la de West con **W**. «Book» → confirmada.
  2. Los 5 puntos del Review Focus: rango sin marca → no sale; límite 2/semana → gris + `weekly-limit`; `expiresOn` de ayer → no sale y la reserva da `plan-site`; Open Mat de Town marcada en `west-kids-1x` → se reserva.
  3. Capturas de la tarjeta a 1280, 768 y 390 px: la etiqueta no rompe la fila de la hora en la vista semana (columnas estrechas).
- [ ] **Step 3: Push.** `git fetch` y, si hace falta, `git rebase origin/main` (sin tocar trabajo ajeno). Después `git push origin main` y comprobar que el SHA local y el remoto coinciden. Cloudflare publica la web en ~90 s.
- [ ] **Step 4: Functions — solo con OK explícito de Luis en el chat.** `corepack pnpm --filter @bpt-jersey/domain build:runtime`; después, una sola tanda **sin `--force`**:
  `corepack pnpm exec firebase deploy --project bptjersey-f5a25 --only functions:getMemberCalendarWeek,functions:requestBooking,functions:requestBookingEu,functions:walkInCheckIn,functions:staffWalkInAttendance,functions:joinWaitlist,functions:issueNextWaitlistOffer,functions:acceptWaitlistOffer,functions:respondWaitlistClassInvitation`
  El guardián exige árbol limpio y `HEAD == origin/main`. Los `docs/reviews/*` sin seguimiento no le molestan; los cambios sin commit de otras sesiones en `apps/functions` o `packages/domain` sí. En ese caso, despliega desde un worktree limpio de `origin/main` con `apps/functions/.env` copiado.
- [ ] **Step 5: Comprobación en producción.** Que el bundle de `/account` contenga `session-centre`. Que `firebase functions:list --json` muestre la generación nueva de las 9 functions.
- [ ] **Step 6: Pasos de Luis (D5)**, con su regla de oro: en el admin, Members → el miembro → Change Plan → West Adult; Classes → marcar «GI All Levels Lunchtime» → Save. Él comprueba en el calendario del miembro (o con el miembro) que Lunchtime sale con T y Book.
- [ ] **Step 7: Memoria.** Crear `project-bpt-jersey-extra-access-other-centre.md` con commits, qué está LIVE, D1–D7 y pendientes, y añadir su línea en `MEMORY.md`.
