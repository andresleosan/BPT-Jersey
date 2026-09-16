# Classes / Services — Plan 1: reparto en paralelo de las Tareas 7–12

Complemento de `2026-09-16-classes-services-plan-1-shell-locations-types-classes.md` (el plan sigue siendo la fuente de los requisitos; este documento solo dice **quién hace qué, en qué rama, y qué no puede tocar**). Tareas 1–6 ya están en `feature/classes-services-clone` (rama de integración).

## 1. Qué se puede construir en simultáneo y qué no

| Tarea                               | Ficheros que crea/modifica                                                                                                                                                                                                                            | Depende de                                                | Equipo                              | Rama                             | Worktree                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------- | -------------------------------- | --------------------------------------- |
| 7 Locations                         | `classes-services/locations/**` (+ `locations.css` propio); **reduce** `admin/classes/page.tsx` a la redirección; **borra** `admin/classes/{class-form,class-form.test,classes-dialog,page.test,classes.css}` y `qa/tests/admin-classes-form.spec.ts` | 1–6                                                       | **A**                               | `feature/cs-p1-t07-locations`    | `/root/BPT-Jersey` (checkout principal) |
| 8 Types                             | `classes-services/types/**` (+ `types.css` propio)                                                                                                                                                                                                    | 1–6                                                       | **B**                               | `feature/cs-p1-t08-types`        | `/root/BPT-Jersey-wt/b-types`           |
| 9 Rejilla + calendario              | `classes-services/classes/{week-grid.ts,week-grid.test.ts,calendar-view.tsx}`; **`classes-services.css`**                                                                                                                                             | 1–6                                                       | **C**                               | `feature/cs-p1-t09-t10-classes`  | `/root/BPT-Jersey-wt/c-classes`         |
| 10 Página Classes 2.0               | `classes-services/classes/{page,list-view,session-panel,registrations-panel,week-actions}*`; `classes-services.css`                                                                                                                                   | **9** (importa `CalendarView`, `mondayOf`, `GridSession`) | **C** (después de la 9, misma rama) | ídem                             | ídem                                    |
| 11 Reglas Firestore                 | `qa/rules/schedule-boundary.test.ts`                                                                                                                                                                                                                  | 1–4                                                       | **D**                               | `feature/cs-p1-t11-rules`        | `/root/BPT-Jersey-wt/d-rules`           |
| 12 Playwright + verify:mvp + ledger | `qa/tests/admin-classes-services.spec.ts`, `qa/screenshots/cs-*.png`, `tasksv2.md` + `Listav2/*`, `docs/adr/ADR-010…`                                                                                                                                 | **7, 8, 10 fusionadas** (E2E de las tres pestañas) y 11   | Integración                         | `feature/classes-services-clone` | `/root/BPT-Jersey`                      |

**En simultáneo ahora mismo: A (7), B (8), C (9→10) y D (11)** — cuatro sesiones. Ningún par comparte un fichero.
**Secuencial:** 10 detrás de 9 (mismo equipo, misma rama); 12 detrás de la fusión de todas.

### Por qué no chocan (y el cambio que hubo que hacer para que no chocaran)

- La Tarea 10 original **borraba** `admin/classes/*` y la Tarea 7 **movía** `site-geofence-panel.tsx` desde esa misma carpeta, y el `page.tsx` legado (cuyo cuerpo ya es código muerto: su última línea devuelve `<ClassesServicesRedirect />`) todavía importa ese panel. Dos ramas tocando `admin/classes/page.tsx` = conflicto seguro. **Toda la limpieza de `admin/classes/` pasa a la Tarea 7 (Equipo A)**; la 10 ya no toca esa carpeta.
- `classes-services.css` era el otro punto de choque (7, 8, 9 y 10 podían añadirle reglas). **Propietario único: Equipo C.** Las pestañas Locations y Types ponen su CSS nuevo en un fichero propio junto a su `page.tsx` (`locations.css`, `types.css`); Next 16 permite importar CSS global desde cualquier componente de `app/`.
- `listFamilies` (Tarea 10) no existe en `apps/web/src/lib/family-client.ts`; se resolvió en el plan sin añadir callables (que tocarían `apps/functions/**` y `schedule-client.ts`, compartidos).

## 2. Propiedad única de ficheros compartidos (regla dura)

| Fichero / carpeta                                                                                                      | Propietario durante el reparto            | Los demás…                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/app/admin/classes-services/classes-services.css`                                                         | Equipo C                                  | no lo editan; CSS propio por pestaña                                                                            |
| `apps/web/src/app/admin/classes-services/{layout.tsx,classes-services-tabs.ts,classes-services-redirect.tsx,page.tsx}` | nadie (congelados)                        | si una tarea lo necesita, el controlador anota un _ruling_ en su ledger y lo reporta; se hace en la integración |
| `apps/web/src/lib/schedule-client.ts`, `apps/functions/**`, `packages/domain/**`                                       | nadie (congelados)                        | ídem — cualquier necesidad es señal de que el plan tiene un hueco; reportar, no parchear                        |
| `apps/web/src/app/admin/{admin-routes.ts,admin-shell.tsx,overview-page.tsx}`                                           | nadie                                     | ídem                                                                                                            |
| `apps/web/src/app/admin/classes/**`, `qa/tests/admin-classes-form.spec.ts`                                             | Equipo A                                  | C no borra ni edita nada ahí (recupera `classes.css` con `git show 8f884cb:…` si quiere reutilizar reglas)      |
| `tasksv2.md`, `Listav2/**`, `docs/adr/**`                                                                              | Integración (Tarea 12)                    | no se tocan                                                                                                     |
| `.superpowers/sdd/**`                                                                                                  | cada worktree tiene el suyo (git-ignored) | nunca se comparte                                                                                               |

## 3. Cómo se abre cada equipo (Luis)

Los cuatro worktrees ya existen con `node_modules` instalado desde el store de pnpm (≈23 s cada uno, offline) y con el ledger sembrado. Cada equipo es **una sesión de Claude Code distinta**, abierta en su carpeta:

```
📍 Terminal B — VPS, usuario root:   cd /root/BPT-Jersey-wt/b-types  && claude
📍 Terminal C — VPS, usuario root:   cd /root/BPT-Jersey-wt/c-classes && claude
📍 Terminal D — VPS, usuario root:   cd /root/BPT-Jersey-wt/d-rules  && claude
```

Primer mensaje de cada sesión: el prompt de su equipo (§5). El Equipo A es esta sesión, en `/root/BPT-Jersey` sobre `feature/cs-p1-t07-locations`.

Reglas comunes a los cuatro:

1. Nunca `git checkout` de otra rama dentro del worktree, nunca `git stash` a secas (el stash es compartido), nunca `push`, nunca `merge`.
2. Cada equipo termina con su rama limpia (`git status` vacío), commits pequeños con el pie `Co-Authored-By`, y su controlador reporta: rama, commits, comandos de prueba con recuentos, rulings tomados, ficheros congelados que hubiera necesitado tocar.
3. `corepack pnpm typecheck && corepack pnpm lint` en verde antes de declararse listo (la Tarea 11 solo `test:rules`).

## 4. Orden de fusión (lo hace la sesión de integración, en `/root/BPT-Jersey`)

```bash
git checkout feature/classes-services-clone
git merge --no-ff feature/cs-p1-t11-rules          # D: 1 fichero, sin riesgo
git merge --no-ff feature/cs-p1-t08-types          # B
git merge --no-ff feature/cs-p1-t07-locations      # A
git merge --no-ff feature/cs-p1-t09-t10-classes    # C (la más grande, la última)
corepack pnpm typecheck && corepack pnpm lint && corepack pnpm vitest run --project web apps/web/src/app/admin
```

Tras cada `merge` que no sea limpio: parar, mirar el conflicto (por la tabla §2 no debería haber ninguno). Después: Tarea 12 en la rama de integración, revisión final de toda la rama (modelo más capaz, una ronda de fixes), `superpowers:finishing-a-development-branch`, y el push/PR a `main` lo hace Luis. Al final se borran los worktrees: `git worktree remove /root/BPT-Jersey-wt/<x>` y `git branch -d feature/cs-p1-…`.

## 5. Prompts por equipo (copiar y pegar como primer mensaje)

### Equipo B — Tarea 8 (Types)

```
Eres el Equipo B del reparto en paralelo del Plan 1 del clon de Classes / Services. Ejecuta SOLO la Tarea 8 con superpowers:subagent-driven-development.

- Estás en el worktree /root/BPT-Jersey-wt/b-types, rama feature/cs-p1-t08-types. No cambies de rama, no hagas stash, push ni merge.
- Plan: docs/superpowers/plans/2026-09-16-classes-services-plan-1-shell-locations-types-classes.md · Reparto: docs/superpowers/plans/2026-09-16-classes-services-plan-1-reparto-paralelo.md (léelo: §2 dice qué ficheros NO puedes tocar) · Spec: docs/superpowers/specs/2026-09-16-regyfit-classes-services-clone-design.md
- Ledger SDD ya sembrado: .superpowers/sdd/2026-09-16-classes-services-plan-1-shell-locations-types-classes/progress.md. Tareas 1–6 completas; 7, 9–12 marcadas "delegated" (no las despaches). Brief: task-8-brief.md (ya extraído). Informe: task-8-report.md. Paquetes de revisión con scripts/review-package PLAN BASE HEAD.
- Proceso: implementador (modelo explícito: sonnet) → review-package → revisor → rondas de fixes reanudando al mismo implementador con SendMessage (máx. 5) → re-revisión acotada → "Task 8: complete" en el ledger. Nunca dos implementadores a la vez; espera por notificación.
- Rulings vigentes (no re-litigar): LocationId es string; capacidad null = ilimitada; título de sección en <h2>; los defaults materializados no traen campos v2 (la UI cae a programDefaultsV2, `kind` puede faltar); CSS nuevo en types/types.css, nunca en classes-services.css.
- Al terminar la Tarea 8: NO hagas revisión final de rama ni finishing-a-development-branch. Deja `git status` limpio, corre `corepack pnpm typecheck && corepack pnpm lint`, y responde con: rama, commits, comandos de prueba y recuentos, rulings, y cualquier fichero congelado que hubieras necesitado tocar.
- Restricciones fijas: nada de nombres reales, IPs ni capturas en el repo o el chat; no desplegar; commits con "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>".
```

### Equipo C — Tareas 9 → 10 (rejilla, calendario y página Classes 2.0)

```
Eres el Equipo C del reparto en paralelo del Plan 1 del clon de Classes / Services. Ejecuta SOLO las Tareas 9 y luego 10 (en ese orden, la 10 importa la 9) con superpowers:subagent-driven-development.

- Estás en el worktree /root/BPT-Jersey-wt/c-classes, rama feature/cs-p1-t09-t10-classes. No cambies de rama, no hagas stash, push ni merge.
- Plan: docs/superpowers/plans/2026-09-16-classes-services-plan-1-shell-locations-types-classes.md · Reparto: docs/superpowers/plans/2026-09-16-classes-services-plan-1-reparto-paralelo.md (léelo: §2 dice qué ficheros NO puedes tocar; eres el ÚNICO propietario de classes-services.css) · Spec: docs/superpowers/specs/2026-09-16-regyfit-classes-services-clone-design.md
- Ledger SDD ya sembrado: .superpowers/sdd/2026-09-16-classes-services-plan-1-shell-locations-types-classes/progress.md. Tareas 1–6 completas; 7, 8, 11, 12 marcadas "delegated" (no las despaches). Briefs task-9-brief.md y task-10-brief.md ya extraídos; informes task-9-report.md / task-10-report.md.
- Proceso: implementador (modelo explícito: sonnet para la 9, opus para la 10) → review-package → revisor → rondas de fixes reanudando al mismo implementador con SendMessage (máx. 5) → re-revisión acotada → "Task N: complete". Nunca dos implementadores a la vez; espera por notificación.
- Rulings vigentes (no re-litigar): LocationId es string; capacidad null = ilimitada; shiftIso fue sustituido por shiftIsoInZone(iso, days, timezone) en el dominio; título de sección en <h2>; pickers de sede town/west legados se quedan hasta el Plan 2; los defaults materializados no traen campos v2 (la UI cae a programDefaultsV2); deleteWeek no libera reservas; la Tarea 10 NO borra nada en apps/web/src/app/admin/classes/ (lo hace el Equipo A); `listFamilies` no existe — la pestaña Group se resuelve con listMembers sin añadir callables (tu ruling, anótalo en el ledger).
- Al terminar la Tarea 10: NO hagas revisión final de rama ni finishing-a-development-branch. Deja `git status` limpio, corre `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm vitest run --project web apps/web/src/app/admin`, y responde con: rama, commits, comandos de prueba y recuentos, rulings, y cualquier fichero congelado que hubieras necesitado tocar.
- Restricciones fijas: nada de nombres reales, IPs ni capturas en el repo o el chat (el crudo vive en /root/regyfit-capture/); no desplegar; commits con "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>".
```

### Equipo D — Tarea 11 (reglas de Firestore)

```
Eres el Equipo D del reparto en paralelo del Plan 1 del clon de Classes / Services. Ejecuta SOLO la Tarea 11 con superpowers:subagent-driven-development.

- Estás en el worktree /root/BPT-Jersey-wt/d-rules, rama feature/cs-p1-t11-rules. No cambies de rama, no hagas stash, push ni merge.
- Plan: docs/superpowers/plans/2026-09-16-classes-services-plan-1-shell-locations-types-classes.md · Reparto: docs/superpowers/plans/2026-09-16-classes-services-plan-1-reparto-paralelo.md · Spec: docs/superpowers/specs/2026-09-16-regyfit-classes-services-clone-design.md
- Ledger SDD ya sembrado: .superpowers/sdd/2026-09-16-classes-services-plan-1-shell-locations-types-classes/progress.md. Tareas 1–6 completas; 7–10 y 12 marcadas "delegated" (no las despaches). Brief: task-11-brief.md; informe: task-11-report.md.
- La suite de reglas corre dentro del contenedor Docker bpt-emu:local sin red, montando ESTE worktree y con npm_config_verify_deps_before_run=false (el brief trae el comando exacto). ⚠️ Nunca montar /root/BPT-Jersey ni correr `pnpm install` dentro del contenedor.
- Proceso: implementador (modelo explícito: sonnet) → review-package → revisor → fixes (máx. 5 rondas) → "Task 11: complete".
- Al terminar: NO hagas revisión final ni finishing-a-development-branch. Deja `git status` limpio y responde con: rama, commit, salida resumida de test:rules (recuentos), rulings.
- Restricciones fijas: no desplegar; nada de nombres reales ni IPs; commits con "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>".
```

## 6. Siembra del ledger de cada worktree

Cada worktree recibe una copia íntegra del `progress.md` de la integración (Tareas 0–6 con sus rulings) más este bloque, con las tareas ajenas marcadas para que el controlador del equipo no las despache:

```
## Reparto en paralelo — Equipo <X> (rama <rama>, worktree <ruta>)
Ruling: este worktree ejecuta solo las Tareas <n…>; el resto está delegado a otros equipos y se fusiona en feature/classes-services-clone (ver docs/superpowers/plans/2026-09-16-classes-services-plan-1-reparto-paralelo.md).
Task 7: delegated to Equipo A (feature/cs-p1-t07-locations) — do not dispatch
Task 8: delegated to Equipo B (feature/cs-p1-t08-types) — do not dispatch
Task 9: delegated to Equipo C (feature/cs-p1-t09-t10-classes) — do not dispatch
Task 10: delegated to Equipo C (feature/cs-p1-t09-t10-classes) — do not dispatch
Task 11: delegated to Equipo D (feature/cs-p1-t11-rules) — do not dispatch
Task 12: delegated to la sesión de integración — do not dispatch
```

(sin la línea de las tareas propias del equipo).
