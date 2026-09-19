# Limpieza 2a: Cronos, textos de Regyfit y backlog único — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quitar toda mención visible de "Regyfit" de la web, eliminar los restos operativos de Cronos y sustituir los dos ledgers y sus tableros por un único `BACKLOG.md`, sin tocar datos ni funciones de producción.

**Architecture:** Cambio solo de texto y de organización del repositorio. La UI cambia 14 cadenas en 7 archivos, protegidas por un test de guardia que escanea `apps/web/src`. Los ledgers, los tableros `Lista/` y `Listav2/`, los planes y specs anteriores al 2026-09-15 y la evidencia histórica que menciona a Cronos se mueven sin editarlos a `docs/archive/`. Los 6 tests de sincronización ledger↔tablero se borran.

**Tech Stack:** pnpm (vía Corepack), Vitest (proyectos `web` y `node`), ESLint, Prettier, Next.js 16 (export estático), git.

**Spec:** este plan implementa las decisiones del operador del 2026-09-19 (sesión de `/grill-me` de la Fase 1). Se copian aquí porque no hay documento de spec aparte:

| # | Decisión |
| - | -------- |
| Q1 = A | "Regyfit" desaparece solo de lo **visible**. Colecciones (`regyfitMemberRecords`…), callables, reglas e identificadores conservan su nombre interno. |
| Q2/Q3 = B | La unificación de datos (T108 + histórico en colecciones canónicas + ficha viva + retirar el visor) es la **entrega 2b**, con su propio spec. **No entra aquí.** |
| Q4 = A | Un único `BACKLOG.md`. `tasks.md`, `tasksv2.md`, `Lista/` y `Listav2/` van a `docs/archive/`; se borran los 6 tests `qa/unit/lista*` / `listav2*`; `CLAUDE.md` y `README.md` apuntan a `BACKLOG.md`. |
| Q5 | Clasificación aprobada del backlog (críticos C1–C6, normales, descartadas). Ver Task 4. |
| Q6 = A | Cronos: se limpia lo operativo; lo histórico se **archiva sin reescribirse**. Fuera de `docs/archive/` no queda ninguna mención. |
| Q7 = A | 2a y 2b son entregas separadas. Las skills de UI (`/impeccable`…) se aplican en la 2b, no aquí. |

## Global Constraints

- Rama `chore/cleanup-2a`. **Nunca push sin confirmación explícita del operador**: un push a `main` publica la web en Cloudflare Pages.
- Sin deploy de funciones, sin escrituras en Firestore y sin tocar `firestore.rules` (esta entrega no las necesita).
- Todos los comandos, desde la raíz del repo con `corepack pnpm …`. Node `>=22.13 <25`.
- Los documentos históricos se mueven con `git mv` y **no se editan** (Q6 = A). Hay dos excepciones: las rutas en comentarios de código que apuntan a un doc movido, y las líneas de Cronos de los docs posteriores al 2026-09-15 que se quedan fuera del archivo (Task 5).
- No pasar Prettier sobre `tasksv2.md` (lo reformatea entero). Tras moverlo sigue fuera de los globs de `format`.
- Copia nueva de la UI en inglés, neutra: "Imported" / "imported record". Nunca otro nombre de proveedor.
- `CLAUDE.md` empieza con un `/cle` accidental (`/cle# CLAUDE.md`). **No es de este cambio: no tocarlo**, solo mencionarlo en el resumen.

---

### Task 1: Rama y materializar los tableros

Los tableros están excluidos por el sparse-checkout (`!/.cronos`, `!/Lista`, `!/Listav2`), así que `git mv` no puede moverlos hasta materializarlos. `.cronos/` ya no existe desde `ce38a25`.

**Files:**
- Modify (local, no versionado): `.git/info/sparse-checkout`

- [ ] **Step 1: Crear la rama**

```bash
git switch -c chore/cleanup-2a
```
Expected: `Switched to a new branch 'chore/cleanup-2a'`.

- [ ] **Step 2: Desactivar el sparse-checkout**

```bash
git sparse-checkout disable
ls Lista Listav2
```
Expected: `Lista.css Lista.html Lista.js` y los 7 archivos de `Listav2/` aparecen. `git status --short` no muestra cambios versionados nuevos.

- [ ] **Step 3: Línea base de los gates**

```bash
corepack pnpm --filter @bpt-jersey/domain build:runtime
corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test
```
Expected: los tres en verde. Si algo falla aquí, **anotarlo como fallo previo** (no es de esta rama) y no seguir sin decírselo al operador.

---

### Task 2: Quitar "Regyfit" de la UI, con test de guardia

**Files:**
- Create: `qa/unit/no-visible-regyfit-copy.test.ts`
- Modify: `apps/web/src/app/admin/members/page.tsx:204`
- Modify: `apps/web/src/app/admin/members/search/page.tsx:103,104,119`
- Modify: `apps/web/src/app/admin/members/search/member-profile-panel.tsx:159,264,307,355,396,406,457`
- Modify: `apps/web/src/app/admin/members/profile/manage-view.tsx:589`
- Modify: `apps/web/src/app/admin/members/profile/ibjjf-card.tsx:163`
- Modify: `apps/web/src/app/admin/classes-services/history/page.tsx:41`
- Test (actualizar las aserciones): `apps/web/src/app/admin/members/page.test.tsx:106`, `apps/web/src/app/admin/members/search/page.test.tsx:210,276,376,450`, `apps/web/src/app/admin/classes-services/history/page.test.tsx:216`, `apps/web/src/app/admin/members/profile/ibjjf-card.test.tsx:74`, `apps/web/src/app/admin/members/profile/manage-view.test.tsx:186`, `qa/tests/member-profile.spec.ts:553`

**Interfaces:**
- Produces: la regla "ningún texto visible de `apps/web/src` contiene la palabra `Regyfit`". Los identificadores (`listRegyfitMemberRecords`, `RegyfitMemberRecord`), las rutas en minúsculas (`regyfit-records`) y los comentarios quedan permitidos.

- [ ] **Step 1: Escribir el test de guardia**

`qa/unit/no-visible-regyfit-copy.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const webSource = fileURLToPath(new URL("../../apps/web/src/", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [path] : [];
  });
}

// Comments may explain where data came from; nobody sees them. `\b` also skips identifiers such as
// listRegyfitMemberRecords, which never reach the screen.
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("web copy never names the legacy system (2026-09-19 decision Q1)", () => {
  it("has no visible 'Regyfit' in apps/web/src", () => {
    const offenders = sourceFiles(webSource).flatMap((file) =>
      withoutComments(readFileSync(file, "utf8"))
        .split("\n")
        .filter((line) => /\bRegyfit\b/.test(line))
        .map((line) => `${relative(webSource, file)}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Comprobar que falla**

```bash
corepack pnpm vitest run --project node qa/unit/no-visible-regyfit-copy.test.ts
```
Expected: FAIL con **14** líneas en `offenders` (una dry-run previa del mismo algoritmo dio esas 14: `history/page.tsx` 1, `members/page.tsx` 1, `ibjjf-card.tsx` 1, `manage-view.tsx` 1, `member-profile-panel.tsx` 7, `search/page.tsx` 3).

- [ ] **Step 3: Cambiar las 14 cadenas**

Cambia solo el texto indicado en cada línea; el resto de la línea se queda igual.

| Archivo:línea | Antes | Después |
| --- | --- | --- |
| `members/page.tsx:204` | `Regyfit archive` | `Imported archive` |
| `members/search/page.tsx:103` | `Members / Regyfit archive` | `Members / Imported archive` |
| `members/search/page.tsx:104` | `Regyfit archive (read only)` | `Imported archive (read only)` |
| `members/search/page.tsx:119` | `Records captured from Regyfit` | `Records imported` |
| `member-profile-panel.tsx:159` | `` (imported from Regyfit)` `` | `` (imported)` `` |
| `member-profile-panel.tsx:264` | `reflect the Regyfit capture.` | `reflect the imported record.` |
| `member-profile-panel.tsx:307` | `Regyfit holds no payments for this member.` | `The imported record holds no payments for this member.` |
| `member-profile-panel.tsx:355` | `Regyfit holds no class registrations for this member.` | `The imported record holds no class registrations for this member.` |
| `member-profile-panel.tsx:396` | `Regyfit holds no notes for this member.` | `The imported record holds no notes for this member.` |
| `member-profile-panel.tsx:406` | `not part of the captured Regyfit record.` | `not part of the imported record.` |
| `member-profile-panel.tsx:457` | `Captured {record.capturedAt.slice(0, 10)} from Regyfit` | `Imported {record.capturedAt.slice(0, 10)}` |
| `manage-view.tsx:589` | `"Regyfit import"` | `"Imported"` |
| `ibjjf-card.tsx:163` | `` `${classes.imported} from Regyfit + ${inBpt} in BPT` `` | `` `${classes.imported} imported + ${inBpt} in BPT` `` |
| `history/page.tsx:41` | `"Regyfit (imported)"` | `"Imported history"` |

La línea 264 continúa en la 265 (`subscription are saved above.`). Tras el cambio, ejecutar `corepack pnpm format` para que Prettier reajuste el salto de línea.

- [ ] **Step 4: Actualizar las aserciones de los tests existentes**

| Archivo:línea | Antes | Después |
| --- | --- | --- |
| `members/page.test.tsx:106` | `{ name: "Regyfit archive" }` | `{ name: "Imported archive" }` |
| `members/search/page.test.tsx:210` | `/captured from Regyfit on 2026-09-04/` | `/Records imported on 2026-09-04/` |
| `members/search/page.test.tsx:276` | `/not part of the captured Regyfit record/` | `/not part of the imported record/` |
| `members/search/page.test.tsx:376` | `"Regyfit archive (read only)"` | `"Imported archive (read only)"` |
| `members/search/page.test.tsx:450` | `"Regyfit archive (read only)"` | `"Imported archive (read only)"` |
| `history/page.test.tsx:216` | `"Regyfit (imported)"` | `"Imported history"` |
| `ibjjf-card.test.tsx:74` | `"9 from Regyfit + 3 in BPT"` | `"9 imported + 3 in BPT"` |
| `manage-view.test.tsx:186` | `"Regyfit import"` | `"Imported"` |
| `qa/tests/member-profile.spec.ts:553` | `"9 from Regyfit + 3 in BPT"` | `"9 imported + 3 in BPT"` |

Después, buscar aserciones que se hayan escapado:

```bash
grep -rn -E 'Regyfit (archive|holds|import|\(imported\))|from Regyfit|captured Regyfit|imported from Regyfit' apps/web/src qa/tests --include='*.test.*' --include='*.spec.*'
```
Expected: sin salida. Los valores de fixtures como `"Holds this stripe from Regyfit."` en `manage-view.test.tsx` son datos de prueba escritos por el usuario, no copia de la UI: se quedan.

- [ ] **Step 5: Verificar en verde**

```bash
corepack pnpm vitest run --project node qa/unit/no-visible-regyfit-copy.test.ts
corepack pnpm vitest run --project web apps/web/src/app/admin/members apps/web/src/app/admin/classes-services/history
```
Expected: PASS en los dos.

- [ ] **Step 6: Demostrar que la guardia muerde** (`LECCIONES.md` §4)

Reponer temporalmente `Regyfit archive` en `members/page.tsx:204`, ejecutar el test de guardia, ver que FALLA con exactamente 1 offender y restaurar con `git checkout -- apps/web/src/app/admin/members/page.tsx`. Anotar el rojo en el mensaje del commit.

- [ ] **Step 7: Commit**

```bash
git add qa/unit/no-visible-regyfit-copy.test.ts apps/web/src/app/admin qa/tests/member-profile.spec.ts
git commit -m "fix(admin): neutral imported-record copy, no legacy vendor name on screen

Guard qa/unit/no-visible-regyfit-copy.test.ts: red with 14 offenders, green after;
reinserting one string turns it red with 1 offender."
```

---

### Task 3: Archivar ledgers y tableros, retirar los tests de sincronización

**Files:**
- Move: `tasks.md` → `docs/archive/tasks.md`; `tasksv2.md` → `docs/archive/tasksv2.md`; `Lista/` → `docs/archive/Lista/`; `Listav2/` → `docs/archive/Listav2/`
- Delete: `qa/unit/lista-evidence-sync.test.ts`, `qa/unit/lista-progress.test.ts`, `qa/unit/lista-resolution-board.test.ts`, `qa/unit/listav2-checklist.test.ts`, `qa/unit/listav2-interference.test.ts`, `qa/unit/listav2-ledger-sync.test.ts`
- Modify: `eslint.config.mjs:42-47`, `.gitignore:72`

- [ ] **Step 1: Mover y borrar**

```bash
mkdir -p docs/archive
git mv tasks.md tasksv2.md Lista Listav2 docs/archive/
git rm qa/unit/lista-evidence-sync.test.ts qa/unit/lista-progress.test.ts qa/unit/lista-resolution-board.test.ts qa/unit/listav2-checklist.test.ts qa/unit/listav2-interference.test.ts qa/unit/listav2-ledger-sync.test.ts
```

- [ ] **Step 2: Ignorar el archivo en ESLint**

En `eslint.config.mjs`, sustituir las líneas 42-47 (el comentario de Listav2 y sus dos entradas) por:

```js
    // Historical ledgers and boards, kept verbatim as evidence (2026-09-19 decision Q4).
    "docs/archive/**",
```

- [ ] **Step 3: Corregir el comentario de `.gitignore:72`**

```
# T103/T104: el dataset real de miembros nunca debe volver al repo (ver docs/archive/tasks.md T107)
```

- [ ] **Step 4: Verificar**

```bash
corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test
git ls-files | grep -E '^(Lista|Listav2)/|^tasks(v2)?\.md$|qa/unit/lista'
```
Expected: gates en verde (el total de tests baja en lo que sumaban los 6 archivos borrados); el `grep` sin salida.

- [ ] **Step 5: Commit**

```bash
git add -A docs/archive eslint.config.mjs .gitignore qa/unit
git commit -m "chore: archive tasks/tasksv2 ledgers and Lista boards; drop ledger-board sync tests"
```

---

### Task 4: `BACKLOG.md` con la clasificación aprobada

**Files:**
- Create: `BACKLOG.md`

- [ ] **Step 1: Verificar las 19 filas en `revision`**

Para cada ID: `T026V2 T027V2 T028V2 T029V2 T030V2 T031V2 T032V2 T033V2 T034V2 T035V2 T036V2 T037V2 T038V2 T039V2 T046V2 T050V2 T051V2 T053V2 T055V2`

```bash
for id in T026V2 T027V2 T028V2 T029V2 T030V2 T031V2 T032V2 T033V2 T034V2 T035V2 T036V2 T037V2 T038V2 T039V2 T046V2 T050V2 T051V2 T053V2 T055V2; do
  echo "== $id"; git log main --oneline -i --grep="$id" | head -3
done
```

Regla de decisión, por fila:
- **Cerrada**: tiene commits en `main` **y** (es solo web, porque la web se publica al hacer push a `main`) **o** su fila en `docs/archive/tasksv2.md` registra el deploy de las funciones que toca.
- **Abierta**: le falta el merge o el deploy. En ese caso entra en `BACKLOG.md` diciendo qué falta.
- T050V2 y T055V2 ya están clasificadas como C3 y C2. T046V2 y T051V2 constan como desplegadas (T051V2 "live in prod" 2026-09-19).

- [ ] **Step 2: Escribir `BACKLOG.md`**

Rellenar la tabla "Consolidación" con el resultado del Step 1: una fila por ID, con su commit como evidencia. El resto del contenido va tal cual:

```markdown
# BACKLOG — BPT Jersey Academy Platform

Único registro de trabajo pendiente desde el 2026-09-19. Sustituye a `tasks.md` y `tasksv2.md`,
archivados sin cambios en `docs/archive/` junto con sus tableros.

**Reglas**
- Cada trabajo tiene una fila aquí antes de empezar.
- Una fila se cierra solo con evidencia real (test, commit, deploy medido). Al cerrarla se borra de
  aquí y su evidencia va en el mensaje del commit y en una línea de "Cerradas".
- Estados: `pendiente` → `en-progreso` → `hecha`; `bloqueada` si espera un dato o una decisión.
- Nada se despliega a producción ni escribe en Firestore de producción sin confirmación explícita
  del operador en el chat.

## Críticos (en este orden)

| ID | Tarea | Depende de | Estado | Criterio de salida |
| -- | ----- | ---------- | ------ | ------------------ |
| C1 | Unificación de miembros: `members` (243) → `students`; enlazar los 249 `regyfitMemberRecords` (hoy 1 enlazado); reapuntar 2.607 `auditEvents` de `class.memberId` a `studentId`; pagos, clases y notas históricas a colecciones canónicas con `source: "legacy-import"`; ficha canónica (Plan, Payments, Classes, Notes) con datos vivos; retirar el visor del archivo. Absorbe T108 y T049V2. | — | pendiente | Spec y plan propios (entrega 2b); dry-run en emuladores; conteo en producción: `students` = miembros reales, 0 `auditEvents` de clase sin `studentId` enlazable; las lecturas financieras excluyen `legacy-import`. |
| C2 | T055V2: callables que la web publicada llama y dan 404 en producción (eran 21). | — | pendiente | Re-medir con `POST` sin sesión a cada URL (401 = existe, 404 = falta); desplegar las que falten, con confirmación; 0 respuestas 404. |
| C3 | Desplegar las funciones de T050V2 (planes, precios, aforo) y `selfCheckIn` (T040V2). | C2 | bloqueada | Desbloquear las 82 sesiones importadas sin aforo (runbook en `docs/archive/tasksv2.md` T050V2); deploy confirmado; callables responden 401 sin sesión. |
| C4 | T024V2: programar el barrido de quorum, que hoy no se ejecuta nunca. | — | pendiente | Función programada desplegada; una ejecución registrada en los logs de producción. |
| C5 | T021V2: datos que solo tiene el operador. | operador | bloqueada | Datos entregados y aplicados en las filas que los esperan. |
| C6 | T127: renovación digital del waiver y gate de producción de `consent-callables`. | credenciales R2 | bloqueada | Credenciales R2 creadas por el operador; decisión de producto tomada; flujo probado en emuladores. |

## Normales

| ID | Tarea | Estado |
| -- | ----- | ------ |
| T002V2 | Formulario de inscripción como asistente por pasos de 1 a 3 campos con barra de progreso | pendiente |
| T003V2 | Impedir el zoom automático de iOS al enfocar un campo | pendiente |
| T004V2 | Unificar "Ask for a place" y "Book a free class" en el mismo formulario | pendiente |
| T006V2 | Reservar la primera clase antes de la aprobación y notificar al administrador | pendiente |
| T007V2 | Cancelación gratuita hasta 12 h antes; después, propuesta de fee de inasistencia | pendiente |
| T008V2 | El representante marca la asistencia de sus hijos al llevarlos | pendiente |
| T009V2 | Cuenta propia del menor, con alcance recortado | pendiente |
| T010V2 | Actualizar la sección de instructores | pendiente |
| T011V2 | Publicar las dos direcciones de los centros | pendiente |
| T013V2 | Sesiones del día como primer bloque del panel de administración | pendiente |
| T014V2 | Priorizar el botón de asistencia 15 minutos antes de cada sesión | pendiente |
| T015V2 | Contador de 20 minutos: quien no marca asistencia pierde la clase | pendiente |
| T016V2 | Calendario semanal por días y franjas en el panel de administración | pendiente |
| T017V2 | Siguiente clase con los confirmados y aviso de condiciones médicas | pendiente |
| T018V2 | Bloquear la reserva a quien no se le cobró la mensualidad (depende de C1: hoy no hay `memberships`) | pendiente |
| T019V2 | Etiquetar cada pago con su centro y elegir centro de retirada del merchandising | pendiente |
| T023V2 | Un único conversor canónico de centro, sin migrar datos | pendiente |
| T042V2 | Racha y progreso en lo alto de `/account` | pendiente |
| T043V2 | Competidores en `/account/competitors` | pendiente |
| T044V2 | Ajustes de cuenta en `/account/settings` | pendiente |
| T047V2 | Classes / Services Plan 2: Memberships and Vouchers, Drop-ins, Bulk Operations | pendiente |
| T048V2 | Classes / Services Plan 3: Listings & Reports, Options | pendiente |

## Consolidación del 2026-09-19

| ID | Veredicto | Evidencia |
| -- | --------- | --------- |
<!-- una fila por cada ID del Task 4 Step 1 -->

Descartadas: T017, T036, T061, T068, T069, T070, T071 (canceladas en v1); T049V2 (absorbida por C1);
T005V2 y T020V2 (verificación de algo ya construido: se comprueban y se cierran en esta consolidación).

## Cerradas

<!-- una línea por fila cerrada: fecha · ID · commit/evidencia -->
```

El comentario `<!-- una fila por cada ID… -->` **se sustituye** por las 19 filas reales antes del commit. El de "Cerradas" se queda como guía.

- [ ] **Step 3: Verificar**

```bash
grep -c '^| T0' BACKLOG.md
grep -n 'una fila por cada ID' BACKLOG.md
```
Expected: el primer conteo es 22 normales + 19 de consolidación = 41 (+/- las abiertas que el Step 1 haya pasado a "Normales"); el segundo, sin salida.

- [ ] **Step 4: Commit**

```bash
git add BACKLOG.md
git commit -m "docs: single BACKLOG.md with the approved 2026-09-19 classification"
```

---

### Task 5: Restos operativos de Cronos y archivo de la documentación histórica

**Files:**
- Modify (local, no versionado): `.git/info/sparse-checkout` (ya desactivado en Task 1)
- Move: `docs/data/migrations/regyfit/cronos-handoff.md` → `docs/data/migrations/regyfit/capture-handoff.md`
- Modify: `docs/data/migrations/regyfit/capture-handoff.md:1`, `docs/data/migrations/regyfit/README.md:40`, `docs/data/migrations/regyfit/source-inventory.md:49`
- Modify: `docs/operations/t056-pilot-operator-acta-draft.md:12`
- Move: `docs/data/migrations/member-pdf-import-run-2026-08-12.yaml` → `docs/archive/data/migrations/`; Modify: `docs/data/migrations/README.md:26`
- Move: todos los `docs/superpowers/plans/*` y `docs/superpowers/specs/*` con fecha anterior al `2026-09-15` → `docs/archive/superpowers/plans/` y `docs/archive/superpowers/specs/`
- Modify (rutas en comentarios): `packages/domain/src/schedule/member-calendar-contracts.ts:4`, `packages/domain/src/schedule/self-check-in-contracts.ts:3`
- Modify (líneas de Cronos en docs que se quedan): los 8 docs posteriores al 2026-09-15 del Step 5

- [ ] **Step 1: Renombrar el handoff**

```bash
git mv docs/data/migrations/regyfit/cronos-handoff.md docs/data/migrations/regyfit/capture-handoff.md
sed -i '1s/^# Cronos Handoff:/# Capture Handoff:/' docs/data/migrations/regyfit/capture-handoff.md
sed -i 's/cronos-handoff\.md/capture-handoff.md/g' docs/data/migrations/regyfit/README.md docs/data/migrations/regyfit/source-inventory.md
grep -rn -i cronos docs/data/migrations/regyfit/
```
Expected: el último `grep` sin salida. Si queda alguna mención en el cuerpo de `capture-handoff.md`, cambiar "Cronos" por "the capture agent" solo en ese archivo: es un documento vivo, enlazado desde dos sitios.

- [ ] **Step 2: Responsable del acta**

En `docs/operations/t056-pilot-operator-acta-draft.md:12`:

```
| Responsable técnico | Operador, con ejecución asistida por agentes de código |
```

- [ ] **Step 3: Archivar la evidencia de la importación de PDFs**

```bash
mkdir -p docs/archive/data/migrations
git mv docs/data/migrations/member-pdf-import-run-2026-08-12.yaml docs/archive/data/migrations/
```
En `docs/data/migrations/README.md:26`, cambiar `` `member-pdf-import-run-2026-08-12.yaml` `` por `` `docs/archive/data/migrations/member-pdf-import-run-2026-08-12.yaml` ``.

- [ ] **Step 4: Archivar planes y specs anteriores al 2026-09-15**

```bash
mkdir -p docs/archive/superpowers/plans docs/archive/superpowers/specs
for dir in plans specs; do
  for f in docs/superpowers/$dir/2026-0[0-8]-* docs/superpowers/$dir/2026-09-0* docs/superpowers/$dir/2026-09-1[0-4]-*; do
    [ -e "$f" ] && git mv "$f" docs/archive/superpowers/$dir/
  done
done
sed -i 's#docs/superpowers/specs/2026-09-10-member-calendar-design.md#docs/archive/superpowers/specs/2026-09-10-member-calendar-design.md#' packages/domain/src/schedule/member-calendar-contracts.ts
sed -i 's#docs/superpowers/specs/2026-09-14-ready-for-jiu-jitsu-self-check-in-design.md#docs/archive/superpowers/specs/2026-09-14-ready-for-jiu-jitsu-self-check-in-design.md#' packages/domain/src/schedule/self-check-in-contracts.ts
ls docs/superpowers/plans docs/superpowers/specs
```
Expected: solo quedan archivos con fecha `2026-09-15` o posterior. Deben ser 16 planes (incluido este) y 8 specs.

- [ ] **Step 5: Quitar Cronos de los docs que se quedan**

```bash
F="docs/superpowers/plans/2026-09-17-member-profile-b-e1-record.md docs/superpowers/plans/2026-09-17-member-profile-c-e2-ibjjf.md docs/superpowers/plans/2026-09-17-member-profile-d-regyfit-import.md docs/superpowers/plans/2026-09-17-classes-services-plan-4a-import-types-sessions.md"
sed -i -e 's/ \.cronos\b//g' -e 's/ \x27!\/\.cronos\x27//g' $F   # comillas simples: `!` sin expansión de historial
sed -i 's/browser test suite, Cronos workflow, or external/browser test suite, or external/' docs/superpowers/plans/2026-09-18-member-subscription-alerts-release.md
sed -i 's/^- No Cronos or automated test suites;/- No automated test suites;/' docs/superpowers/plans/2026-09-18-member-subscription-alerts.md
sed -i 's/no Cronos workflow, no automated/no automated/' docs/superpowers/specs/2026-09-18-member-subscription-alerts-design.md
sed -i 's/(Cronos-only documents)/(retired agency-workflow documents)/' docs/superpowers/plans/2026-09-16-member-engagement-phase-0.md
sed -i 's/solo servían al flujo Cronos/solo servían al flujo de agencia retirado/' docs/superpowers/specs/2026-09-16-member-engagement-phase-0-design.md
```

- [ ] **Step 6: Verificar que Cronos solo queda en el archivo**

```bash
git grep -n -i cronos -- . ':!docs/archive'
```
Expected: sin salida. Si aparece algo, aplicar la regla: un doc histórico se mueve al archivo sin editarlo; un doc vivo se edita.

- [ ] **Step 7: Commit**

```bash
git add -A docs packages/domain/src/schedule
git commit -m "chore: remove remaining Cronos operational traces; archive pre-2026-09-15 plans and specs verbatim"
```

---

### Task 6: Apuntar la documentación raíz a `BACKLOG.md`

**Files:**
- Modify: `CLAUDE.md:11-13`, `README.md:9,115-116,360-362,372-373`, `LECCIONES.md:5`

- [ ] **Step 1: `CLAUDE.md`**

Sustituir la frase `` `tasks.md` / `tasksv2.md` are the task ledger: every piece of work has a task entry, and a task is only "done" with real test evidence recorded there. `` por:

```
`BACKLOG.md` is the task ledger: every piece of work has a row there, and a row is only closed with real evidence (test, commit or measured deploy). The pre-2026-09-19 ledgers and boards are archived verbatim in `docs/archive/`.
```
Reajustar el párrafo a ~100 columnas como el resto. No tocar el `/cle` de la línea 1.

- [ ] **Step 2: `README.md`**

- Línea 9: `` construir esta en `tasks.md` y `tasksv2.md`; `` → `` construir esta en `BACKLOG.md`; ``
- Líneas 115-116: borrar las filas `Lista/` y `Listav2/` del árbol y añadir en `docs/`: `docs/           ADRs, operaciones, seguridad, desarrollo y archivo historico (docs/archive/).`
- Líneas 360-362: borrar el aviso de `qa/unit/listav2-*.test.ts` (los tres renglones del bullet).
- Líneas 372-373: sustituir las dos filas por una sola:

```
| `BACKLOG.md`              | Trabajo pendiente y criterio de cierre. Lo anterior, en `docs/archive/`.         |
```

- [ ] **Step 3: `LECCIONES.md:5`**

`` trazadas al ledger (`tasks.md`) `` → `` trazadas al ledger archivado (`docs/archive/tasks.md`) ``

- [ ] **Step 4: Verificar**

```bash
git grep -n -E '(^|[^/])tasks(v2)?\.md|Listav2?/' -- . ':!docs/archive' ':!docs/superpowers'
```
Expected: sin salida. Los planes y specs vivos que citan `tasksv2.md` son historia de su propia ejecución y se quedan. Las menciones en `BACKLOG.md` usan la ruta `docs/archive/…`, que el patrón `[^/]` excluye.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md LECCIONES.md
git commit -m "docs: point CLAUDE.md, README and LECCIONES at BACKLOG.md and docs/archive"
```

---

### Task 7: Gate completo y entrega

- [ ] **Step 1: Gates**

```bash
corepack pnpm --filter @bpt-jersey/domain build:runtime
corepack pnpm format:check && corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test
corepack pnpm --filter @bpt-jersey/web build
```
Expected: todo en verde. Anotar el total de tests frente a la línea base del Task 1.

- [ ] **Step 2: E2E afectado**

`qa/tests/member-profile.spec.ts` cambió una aserción. Necesita emuladores (JDK 21, Docker con `--network none` en este VPS; ver `README.md`). Si el entorno está disponible, ejecutarlo; si no, **decir explícitamente en la entrega que no se ejecutó** y que queda para la Fase 3.

- [ ] **Step 3: Resumen para el operador**

Presentar: los commits, el total de tests antes y después, el rojo y verde de la guardia, lo no ejecutado y el aviso del `/cle` en `CLAUDE.md`. **Preguntar antes de hacer push**: un push a `main` publica la web. Tras el merge, restaurar el sparse-checkout no hace falta, porque ya no hay nada que excluir.

---

## Fuera de alcance (va en la 2b o más tarde)

- Renombrar colecciones, callables o mensajes `HttpsError` internos que contienen "Regyfit" (Q1 = A: nunca llegan a pantalla, porque `members-client.ts` devuelve mensajes seguros).
- **Datos** almacenados en Firestore que contengan la palabra (p. ej. notas de decisión escritas a mano, nombres de actor sin enlazar en el historial). Los resuelve C1; la prueba E2E de "sin Regyfit en el DOM" de la Fase 3 se hace con datos sintéticos.
- Re-ejecutar `graphify` (Fase 3, con extracción semántica de los docs ya movidos).
