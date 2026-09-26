# Ciclo de 15 tareas — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar las 15 tareas del ciclo (T01–T15) en `main`, integradas por oleadas, con
tests del área afectada en verde y verificación final con Playwright en WebKit y Chromium.

**Architecture:** Monolito modular existente. Cada tarea sigue las capas del repo: contrato
zod en `packages/domain` → servicio puro + adaptador Firestore + callable en
`apps/functions` → cliente `apps/web/src/lib/*-client.ts` → ruta en `apps/web/src/app`.
Las tareas de interfaz usan un CSS propio de su ruta. Un worktree por tarea (`task/NN-slug`)
y un agente líder que integra en `main` de una en una.

**Tech Stack:** pnpm (Corepack), TypeScript strict, zod, Next.js 16 (`output: "export"`),
React 19, Firebase Functions v2, Firestore, Vitest (`web` jsdom y `node`), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-26-ciclo-15-tareas-design.md`. Léela antes de
cada tarea: fija el qué; este plan fija el cómo y el orden.

## Global Constraints

- Idioma: código, identificadores, textos de interfaz y contratos en inglés británico
  ("Programme", "colour", "cancelled"). Conversación con el operador en español.
- Comandos siempre `corepack pnpm …` desde la raíz. Node `>=22.13 <25`.
- `packages/domain` nunca importa Firebase.
- ADR-018: ningún proceso crea reservas; solo una persona (oficina o miembro) las pide.
- Coaches: sin finanzas, sin pagos, sin gestión de roles, sin importes.
- Cero deploy, cero migración destructiva y cero gasto de APIs pagadas sin confirmación
  explícita del operador en el chat. Callables, reglas e índices nuevos quedan listados
  para que el operador los despliegue.
- DESIGN.md manda sobre skills estéticas: radio 0 (salvo §9, 1rem), sin gradientes, sin
  sombras con blur, sin azul, sin pills de estado, sin spinners (skeletons), sin emojis,
  Barlow Condensed + Source Sans 3, estado = texto + regla izquierda, targets ≥ 44 px, foco
  visible, `prefers-reduced-motion` respetado.
- Cortes (tras T08): móvil `< 48rem`, tablet `48rem–64rem`, escritorio `≥ 64rem`.
- iOS mínimo: 16.
- Importes en unidades menores (pence), GBP. El cliente nunca decide precios.
- Hex de color validado con `/^#[0-9a-fA-F]{6}$/u` antes de llegar al CSS.
- Sin datos personales en URLs ni en logs. Sin `dangerouslySetInnerHTML`.
- Errores al usuario: cadenas seguras desde el cliente `*-client.ts`, nunca errores crudos de
  Firebase.
- Sin dependencias nuevas.
- En `apps/functions/src/index.ts`, exports de `packages/domain/package.json`,
  `tsconfig.runtime.json`, `firestore.rules` y `firestore.indexes.json`: solo añadir o quitar
  bloques; nunca reordenar ni reformatear.
- `admin/admin.css` y `app/globals.css`: solo cambios mínimos de tokens; en una oleada, solo
  una tarea los toca (T08 en la oleada 5; T14/T15 en la oleada 4 solo si es imprescindible y
  lo coordina el líder).
- Commits: `feat(TNN): …`, `fix(TNN): …`, `chore(TNN): …`, `docs(TNN): …`, con la línea
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Nunca commitear los archivos sin seguimiento que ya existen: `docs/reviews/*-2026-09-2*`,
  `qa/.limpiar-restos-personas.mjs`, `qa/.purga-cuentas-regyfit.mjs`, `qa/.tmp-*`. Usar
  siempre `git add <rutas>` explícitas, nunca `git add -A` ni `git add .`.

## Review Focus

1. **Crédito concurrente (T03):** dos reservas de la oficina a la vez para un alumno con 1
   crédito → solo una se confirma; la otra falla con "No private lesson credit available".
   Test en Task 3.3.
2. **Crédito caducado al cancelar (T03):** cancelar una reserva cuya compra ya caducó → la
   reserva se cancela pero el crédito no vuelve (`state: "consumed"` se mantiene). Test en
   Task 3.3.
3. **Activación con alumnos en claves que desaparecen (T04):** borrar en un borrador un
   stripe que usa un alumno y activarlo → rechazo con la clave y el número de alumnos; el
   puntero no cambia. Test en Task 4.2.
4. **Hex malicioso o vacío en el calendario (T09):** un `colour` como
   `red;background:url(x)` o `""` → la tarjeta se pinta sin regla, sin romper estilos. Test
   en Task 9.1.
5. **Filtro "Read" con muchas notificaciones leídas antiguas (T02):** más de 300 documentos
   sin leídas en las primeras páginas → la respuesta devuelve lo encontrado y un cursor para
   seguir, nunca un bucle infinito. Test en Task 2.1.

---

## Protocolo de ejecución (líder)

1. **Oleada a oleada**, en este orden: 1 · Limpieza (T11 → T12 → T05, un solo agente,
   secuencial) · 2 · Dominio y datos (T03 ‖ T04 ‖ T01 ‖ T06) · 3 · Admin UI y calendarios
   (T02 ‖ T07 ‖ T09) · 4 · Público (T14 ‖ T15, después T10) · 5 · Transversal (T13, después
   T08) · 6 · Verificación final.
   Ajuste frente al prompt: T02 pasa a la oleada 3 como estaba; T06 lleva callable nueva en
   `index.ts` en la oleada 2 junto a T03 y T04, así que el líder integra esas tres de una en
   una resolviendo `index.ts`.
2. **Worktree por tarea** (skill superpowers:using-git-worktrees):
   ```bash
   git worktree add ../bpt-task-NN -b task/NN-slug main
   ```
   Dentro del worktree: `corepack pnpm install --frozen-lockfile` y, si la tarea toca
   functions, `corepack pnpm --filter @bpt-jersey/domain build:runtime`.
3. **Implementadores:** subagentes `sdd-opus-medium` (Opus 5.5, esfuerzo medio), uno por
   tarea, con el texto de su tarea + la spec + Global Constraints.
4. **Verificación por tarea** antes de integrar (§7 del prompt):
   ```bash
   corepack pnpm --filter <paquete> typecheck
   corepack pnpm vitest run --project <web|node> <archivos tocados>
   corepack pnpm exec eslint --max-warnings 0 <archivos tocados>
   corepack pnpm exec prettier --check <archivos tocados>
   corepack pnpm test:rules   # solo si cambió firestore.rules
   ```
5. **Integración:** en `main` del repo principal:
   ```bash
   git merge --no-ff task/NN-slug -m "Merge task/NN-slug"
   git worktree remove ../bpt-task-NN && git branch -d task/NN-slug
   git push origin main
   git rev-parse main origin/main   # los dos SHA deben coincidir
   ```
   El **primer push** lo hace el operador en su terminal; el líder se detiene y dice:
   "Listo para el primer push: ejecuta `git push origin main` en tu terminal". Si un push
   pide credenciales, parar y avisar; nunca reintentar en bucle; nunca `--force`.
6. Tras integrar cada oleada: `corepack pnpm typecheck` completo, porque varias tareas tocan
   exports compartidos.

---

## Oleada 1 · Limpieza (un solo agente, secuencial, rama `task/w1-cleanup`)

### Task 11: Texto del login

**Files:**
- Modify: `apps/web/src/app/login/page.tsx:31`
- Modify: `apps/web/src/test-harness.test.tsx:39`

- [ ] **Step 1: Buscar variantes**

Run: `grep -rn "One clear system" apps qa docs | grep -v docs/archive | grep -v node_modules`
Expected: solo `login/page.tsx:31` y `test-harness.test.tsx:39`.

- [ ] **Step 2: Actualizar el test primero**

En `test-harness.test.tsx:39`, cambiar la aserción para exigir el texto nuevo:
```tsx
expect(screen.getByText("Brazilian Jiu-Jitsu Academy")).toBeInTheDocument();
expect(screen.queryByText("One academy. One clear system.")).not.toBeInTheDocument();
```
(Si ese test renderiza otra página distinta del login, añadir el caso en el test del login,
`apps/web/src/app/login/page.test.tsx`, y dejar la línea 39 tal cual.)

- [ ] **Step 3: Verlo fallar**

Run: `corepack pnpm vitest run --project web apps/web/src/test-harness.test.tsx`
Expected: FAIL, no encuentra "Brazilian Jiu-Jitsu Academy".

- [ ] **Step 4: Cambiar el texto**

```tsx
<p className="login-intro-label">Brazilian Jiu-Jitsu Academy</p>
```

- [ ] **Step 5: Verlo pasar y commitear**

Run: `corepack pnpm vitest run --project web apps/web/src/test-harness.test.tsx apps/web/src/app/login`
Expected: PASS.
```bash
git add apps/web/src/app/login/page.tsx apps/web/src/test-harness.test.tsx
git commit -m "fix(T11): show Brazilian Jiu-Jitsu Academy on the sign-in page"
```

### Task 12: Quitar Bulk Operations, Listings & Reports y Drop-ins

**Files:**
- Delete: `apps/web/src/app/admin/classes-services/bulk/`, `reports/`, `drop-ins/`
- Modify: `apps/web/src/app/admin/classes-services/classes-services-tabs.ts:18-20`
- Modify: `apps/web/src/app/admin/classes-services/classes-services-placeholder.test.tsx` (quitar los casos de drop-ins :10 y reports :16)
- Modify: `apps/web/src/app/admin/admin-routes.test.ts:44-46`
- Keep: `classes-services-placeholder.tsx` (lo usan memberships y options). **No tocar** `apps/web/src/app/admin/reports/`.

- [ ] **Step 1: Test de pestañas**

En el test de pestañas (crear `classes-services-tabs.test.ts` si no existe):
```ts
import { describe, expect, it } from "vitest";
import { classesServicesTabs } from "./classes-services-tabs";

describe("classes-services tabs", () => {
  it("no longer offers bulk operations, listings or drop-ins", () => {
    const hrefs = classesServicesTabs.map((tab) => tab.href);
    for (const gone of ["bulk", "reports", "drop-ins"]) {
      expect(hrefs).not.toContain(`/admin/classes-services/${gone}`);
    }
  });
});
```
(Usar el nombre de export real de `classes-services-tabs.ts`.)

- [ ] **Step 2: Verlo fallar**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/classes-services/classes-services-tabs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Borrar**

```bash
git rm -r apps/web/src/app/admin/classes-services/bulk apps/web/src/app/admin/classes-services/reports apps/web/src/app/admin/classes-services/drop-ins
```
Quitar las 3 entradas de `classes-services-tabs.ts`, los casos de `classes-services-placeholder.test.tsx`
que apuntan a esas rutas y las 3 aserciones de `admin-routes.test.ts:44-46`.

- [ ] **Step 4: Buscar restos**

Run: `grep -rn "classes-services/\(bulk\|reports\|drop-ins\)" apps qa | grep -v node_modules`
Expected: vacío.

- [ ] **Step 5: Tests y commit**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/classes-services apps/web/src/app/admin/admin-routes.test.ts && corepack pnpm --filter @bpt-jersey/web typecheck`
Expected: PASS.
```bash
git add -A apps/web/src/app/admin/classes-services apps/web/src/app/admin/admin-routes.test.ts
git commit -m "chore(T12): remove classes-services placeholder tabs"
```

### Task 5: Eliminar Lesson Plans

**Files (borrar):**
- `apps/web/src/app/admin/lesson-plans/` (page, panel, test)
- `apps/web/src/lib/lesson-planning-client.ts` (+ test)
- `apps/functions/src/levels/lesson-planning-callables.ts`, `lesson-planning-service.ts`, `lesson-planning-firestore-service.test.ts` (+ tests)
- `packages/domain/src/levels/lesson-planning-contracts.ts` (+ test)
- `qa/rules/lesson-planning-boundary.test.ts`, `qa/scripts/run-lesson-planning-ui-e2e.mjs`, `qa/scripts/seed-lesson-planning-emulator.mjs`, `qa/tests/lesson-planning-auth-emulator.spec.ts`

**Files (editar):**
- `apps/functions/src/index.ts:110` (quitar la línea del export)
- `apps/functions/src/deploy-runtime.ts:53` (+ `deploy-runtime.test.ts`)
- `packages/domain/package.json` (bloque `"./levels/lesson-planning"`), `packages/domain/tsconfig.runtime.json:46`, `packages/domain/src/index.ts`, `packages/domain/src/contracts.test.ts`
- `packages/domain/src/audit/audit-event.ts` (+ test): quitar los tipos de evento de lesson plans
- `apps/web/src/lib/login-flow.ts`, `apps/web/src/app/admin/admin-routes.ts` (+ test), `apps/web/src/app/admin/admin-shell.tsx`, `apps/web/src/app/admin/page.test.tsx`
- `firestore.rules:243-249` (quitar `techniqueLibraries` y `lessonPlans`; el catch-all deniega igual)
- `qa/run-e2e.mjs` (quitar la entrada de lesson-planning)

- [ ] **Step 1: Test de guardia**

En `apps/web/src/app/admin/admin-routes.test.ts`:
```ts
it("has no lesson plans route for any role", () => {
  for (const role of ["owner", "administrator", "headCoach", "coach"] as const) {
    expect(canAccessAdminRoute(role, "/admin/lesson-plans")).toBe(false);
  }
});
```
(Usar el nombre real de la función de acceso de `admin-routes.ts`.)
Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/admin-routes.test.ts`
Expected: FAIL.

- [ ] **Step 2: Borrar archivos y referencias** (listas de arriba, `git rm` para borrar).

- [ ] **Step 3: Comprobar cero referencias**

Run: `grep -rniE "lesson.?plan|lessonplan|lesson-planning|techniqueLibrar" apps packages qa firestore.rules firestore.indexes.json | grep -v node_modules | grep -v "/lib/"`
Expected: vacío.

- [ ] **Step 4: Tests del área**

```bash
corepack pnpm --filter @bpt-jersey/domain build:runtime
corepack pnpm typecheck
corepack pnpm vitest run --project web apps/web/src/app/admin apps/web/src/lib/login-flow.test.ts
corepack pnpm vitest run --project node packages/domain/src apps/functions/src/deploy-runtime.test.ts apps/functions/src/levels
export FUNCTIONS_DISCOVERY_TIMEOUT=300000 && corepack pnpm test:rules
```
Expected: todo PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src packages/domain apps/functions/src qa firestore.rules
git commit -m "chore(T05): remove lesson plans"
```
Anotar para el informe final las callables huérfanas en prod: `approveLessonPlan`, `getLessonPlan`
(colecciones `techniqueLibraries`, `lessonPlans` intactas).

- [ ] **Step 6: Integrar la oleada y primer push**

El líder integra `task/w1-cleanup` y se detiene: "Listo para el primer push: ejecuta
`git push origin main` en tu terminal".

---

## Oleada 2 · Dominio y datos (paralelo: T03 ‖ T04 ‖ T01 ‖ T06)

### Task 3.1: Contratos de private lessons (dominio)

**Files:**
- Create: `packages/domain/src/private-lessons/private-lesson-contracts.ts`
- Test: `packages/domain/src/private-lessons/private-lesson-contracts.test.ts`
- Modify: `packages/domain/package.json` (nuevo export), `packages/domain/tsconfig.runtime.json` (nuevo archivo)
- Modify: `packages/domain/src/schedule/schedule-contracts.ts:34` (`classAccessModes`) y `:1452` (`BookingRecord`)

**Interfaces:**
- Produces:
  - `privateLessonOptionIds: readonly ["single","monthly","pack-10"]`, `PrivateLessonOptionId`
  - `PRIVATE_LESSON_OPTIONS: Record<PrivateLessonOptionId, { displayName: string; priceMinor: number; credits: number; validityMonths: number }>`
  - `privateLessonExpiry(optionId, approvedAt: string): string`
  - `pickCreditPurchase(purchases: readonly PrivateLessonPurchase[], now: string): PrivateLessonPurchase | null`
  - schemas `submitPrivateLessonPurchaseInputSchema`, `reviewPrivateLessonPurchaseInputSchema`, `recordPrivateLessonPurchaseInputSchema`, `privateLessonBookingInputSchema`, `privateLessonPurchaseSchema`
  - `classAccessModes` incluye `"private-lesson"`; `PrivateLessonBookingRecord`

- [ ] **Step 1: Tests que fallan**

```ts
import { describe, expect, it } from "vitest";
import {
  PRIVATE_LESSON_OPTIONS,
  pickCreditPurchase,
  privateLessonExpiry,
  submitPrivateLessonPurchaseInputSchema,
  type PrivateLessonPurchase,
} from "./private-lesson-contracts";

const base = (over: Partial<PrivateLessonPurchase>): PrivateLessonPurchase => ({
  purchaseId: "p1",
  studentId: "s1",
  accountUid: "u1",
  optionId: "single",
  priceMinor: 6500,
  creditsGranted: 1,
  creditsRemaining: 1,
  status: "approved",
  source: "member",
  method: "bank_transfer",
  proofId: "proof1",
  bankReference: "BPT123",
  submittedAt: "2026-09-01T10:00:00Z",
  decidedAt: "2026-09-01T12:00:00Z",
  decidedBy: "admin1",
  expiresAt: "2026-12-01T12:00:00Z",
  invoiceId: "inv1",
  schemaVersion: "1",
  ...over,
});

describe("private lesson catalogue", () => {
  it("fixes prices in pence and credits on the server side", () => {
    expect(PRIVATE_LESSON_OPTIONS.single).toMatchObject({ priceMinor: 6500, credits: 1, validityMonths: 3 });
    expect(PRIVATE_LESSON_OPTIONS.monthly).toMatchObject({ priceMinor: 20000, credits: 4, validityMonths: 1 });
    expect(PRIVATE_LESSON_OPTIONS["pack-10"]).toMatchObject({ priceMinor: 50000, credits: 10, validityMonths: 6 });
  });

  it("rejects a client-supplied price", () => {
    const parsed = submitPrivateLessonPurchaseInputSchema.safeParse({
      studentId: "s1", optionId: "single", proofId: "p", bankReference: "BPT1", priceMinor: 1,
    });
    expect(parsed.success).toBe(false);
  });

  it("clamps expiry to the end of short months", () => {
    expect(privateLessonExpiry("monthly", "2026-01-31T09:00:00Z")).toBe("2026-02-28T09:00:00Z");
    expect(privateLessonExpiry("pack-10", "2026-08-31T09:00:00Z")).toBe("2027-02-28T09:00:00Z");
  });
});

describe("pickCreditPurchase", () => {
  const now = "2026-10-01T00:00:00Z";
  it("uses the credit that expires first", () => {
    const later = base({ purchaseId: "later", expiresAt: "2027-01-01T00:00:00Z" });
    const sooner = base({ purchaseId: "sooner", expiresAt: "2026-11-01T00:00:00Z" });
    expect(pickCreditPurchase([later, sooner], now)?.purchaseId).toBe("sooner");
  });
  it("ignores pending, empty and expired purchases", () => {
    expect(
      pickCreditPurchase(
        [
          base({ purchaseId: "pending", status: "pending", expiresAt: null }),
          base({ purchaseId: "empty", creditsRemaining: 0 }),
          base({ purchaseId: "expired", expiresAt: "2026-09-30T23:59:59Z" }),
        ],
        now,
      ),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Verlos fallar**

Run: `corepack pnpm vitest run --project node packages/domain/src/private-lessons`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar**

```ts
import { z } from "zod";
import { addSubscriptionMonth } from "../memberships/subscription-admin-contracts.js";

export const privateLessonOptionIds = Object.freeze(["single", "monthly", "pack-10"] as const);
export type PrivateLessonOptionId = (typeof privateLessonOptionIds)[number];

export const PRIVATE_LESSON_OPTIONS = Object.freeze({
  single: Object.freeze({ displayName: "Private lesson", priceMinor: 6500, credits: 1, validityMonths: 3 }),
  monthly: Object.freeze({ displayName: "Private lessons monthly (4 sessions)", priceMinor: 20000, credits: 4, validityMonths: 1 }),
  "pack-10": Object.freeze({ displayName: "Private lessons pack of 10", priceMinor: 50000, credits: 10, validityMonths: 6 }),
} satisfies Record<PrivateLessonOptionId, Readonly<{ displayName: string; priceMinor: number; credits: number; validityMonths: number }>>);

export function privateLessonExpiry(optionId: PrivateLessonOptionId, approvedAt: string): string {
  // Each step clamps from the original day, so 31 Aug + 6 months ends on 28 Feb.
  let expiry = approvedAt;
  for (let month = 0; month < PRIVATE_LESSON_OPTIONS[optionId].validityMonths; month += 1) {
    expiry = addSubscriptionMonth(expiry);
  }
  return expiry;
}

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const instant = z.string().datetime({ offset: false });
const optionId = z.enum(privateLessonOptionIds);
const reference = z.string().trim().min(2).max(80);

export const privateLessonPurchaseStatuses = Object.freeze(["pending", "approved", "rejected"] as const);
export const privateLessonPurchaseSchema = z.strictObject({
  purchaseId: id,
  studentId: id,
  accountUid: id.nullable(),
  optionId,
  priceMinor: z.number().int().positive(),
  creditsGranted: z.number().int().positive(),
  creditsRemaining: z.number().int().nonnegative(),
  status: z.enum(privateLessonPurchaseStatuses),
  source: z.enum(["member", "office"]),
  method: z.enum(["bank_transfer", "cash", "other"]),
  proofId: id.nullable(),
  bankReference: reference.nullable(),
  submittedAt: instant,
  decidedAt: instant.nullable(),
  decidedBy: id.nullable(),
  expiresAt: instant.nullable(),
  invoiceId: id.nullable(),
  schemaVersion: z.literal("1"),
});
export type PrivateLessonPurchase = z.infer<typeof privateLessonPurchaseSchema>;

export const submitPrivateLessonPurchaseInputSchema = z.strictObject({
  studentId: id, optionId, proofId: id, bankReference: reference,
});
export const reviewPrivateLessonPurchaseInputSchema = z.strictObject({
  purchaseId: id, decision: z.enum(["approve", "reject"]), reason: z.string().trim().max(300).nullable(),
});
export const recordPrivateLessonPurchaseInputSchema = z.strictObject({
  studentId: id, optionId, method: z.enum(["bank_transfer", "cash", "other"]), reference: reference.nullable(),
});
export const privateLessonBookingInputSchema = z.strictObject({ sessionId: id, studentId: id });
export const cancelPrivateLessonBookingInputSchema = z.strictObject({
  bookingId: id, reason: z.string().trim().min(2).max(300),
});

export function pickCreditPurchase(
  purchases: readonly PrivateLessonPurchase[],
  now: string,
): PrivateLessonPurchase | null {
  const usable = purchases.filter(
    (p) => p.status === "approved" && p.creditsRemaining > 0 && p.expiresAt !== null && p.expiresAt > now,
  );
  usable.sort((a, b) => a.expiresAt!.localeCompare(b.expiresAt!) || a.purchaseId.localeCompare(b.purchaseId));
  return usable[0] ?? null;
}
```
Comprobar que `id` e `instant` coinciden con los helpers de `subscription-admin-contracts.ts`;
si allí están exportados, importarlos en vez de redefinirlos.

En `schedule-contracts.ts`:
```ts
export const classAccessModes = Object.freeze(["membership", "intro", "private-lesson"] as const);
// …
export type PrivateLessonBookingRecord = Omit<LegacyBookingRecord, "membershipId" | "schemaVersion"> & {
  schemaVersion: "4";
  membershipId: null;
  source: { kind: "private-lesson"; purchaseId: string };
};
export type BookingRecord =
  | LegacyBookingRecord
  | CourseBookingRecord
  | IntroBookingRecord
  | PrivateLessonBookingRecord;
```
Actualizar los mensajes `"accessMode must be membership or intro"` a
`"accessMode must be membership, intro or private-lesson"` y cualquier `switch` exhaustivo
que el typecheck marque.

Export en `package.json`:
```json
"./private-lessons": {
  "types": "./src/private-lessons/private-lesson-contracts.ts",
  "import": "./src/private-lessons/private-lesson-contracts.ts",
  "default": "./lib/private-lessons/private-lesson-contracts.js"
},
```
y `"src/private-lessons/private-lesson-contracts.ts"` en `tsconfig.runtime.json`.

- [ ] **Step 4: Verlos pasar**

Run: `corepack pnpm vitest run --project node packages/domain/src/private-lessons packages/domain/src/schedule && corepack pnpm --filter @bpt-jersey/domain typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/private-lessons packages/domain/src/schedule/schedule-contracts.ts packages/domain/package.json packages/domain/tsconfig.runtime.json
git commit -m "feat(T03): add private lesson contracts"
```

### Task 3.2: Compras de private lessons (functions)

**Files:**
- Create: `apps/functions/src/private-lessons/private-lesson-service.ts` (+ `.test.ts`)
- Create: `apps/functions/src/private-lessons/private-lesson-firestore.ts`
- Create: `apps/functions/src/private-lessons/private-lesson-callables.ts` (+ `.test.ts`)
- Modify: `apps/functions/src/index.ts` (añadir un bloque de export), `apps/functions/src/deploy-runtime.ts` si lista callables
- Modify: `firestore.rules` (`privateLessonPurchases`, `privateLessonCreditUses`: `allow read, write: if false`)
- Test: `qa/rules/private-lesson-boundary.test.ts`
- Referencias: `apps/functions/src/memberships/intro-application-service.ts` (subida de justificante y re-lectura de precio), `apps/functions/src/courses/course-finance.ts` (factura + pago), `apps/functions/src/members/participant-band.ts` (edad)

**Interfaces:**
- Consumes: Task 3.1.
- Produces (callables): `submitPrivateLessonPurchase(input) → { purchase }`,
  `listMyPrivateLessons({ studentId }) → { purchases, creditsAvailable, nextExpiry }`,
  `listPrivateLessonPurchases({ status }) → { purchases }`,
  `reviewPrivateLessonPurchase(input) → { purchase }`,
  `recordPrivateLessonPurchase(input) → { purchase }`.

- [ ] **Step 1: Tests del servicio con fakes en memoria**

Casos (un `it` cada uno, con el patrón de fakes de `intro-application-service.test.ts`):
1. Miembro de 16 años (`dateOfBirth` = hoy − 16 años) → `pending`, `priceMinor` 6500 leído del catálogo.
2. Miembro de 15 años → rechazo `"Private lessons are for members aged 16 or over."`.
3. Cuenta sin vínculo con `studentId` → rechazo de tenant.
4. Aprobar `pack-10` a las `2026-08-31T09:00:00Z` → `creditsRemaining 10`,
   `expiresAt "2027-02-28T09:00:00Z"`, una factura `chargeKind: "private-lesson"` de 50000 y
   un evento de auditoría.
5. Aprobar un `monthly` cuando ya hay otro `monthly` aprobado y vigente → rechazo
   `"This member already has an active monthly private lesson plan."`.
6. Aprobar dos veces la misma compra → la segunda falla (`conflict`) y no crea otra factura.
7. `recordPrivateLessonPurchase` con `method: "cash"` → compra `approved`, `source: "office"`,
   `proofId: null`.
8. Rol `coach` en cualquier callable de oficina → `permission-denied`.

- [ ] **Step 2: Verlos fallar**

Run: `corepack pnpm vitest run --project node apps/functions/src/private-lessons`
Expected: FAIL.

- [ ] **Step 3: Implementar servicio, adaptador y callables**

Servicio puro con puertos (`readStudent`, `readPurchases`, `writePurchase`, `writeInvoice`,
`appendAudit`) como `intro-application-service.ts`; la aprobación va en una transacción. Las
callables siguen el patrón de las existentes: `requireAdminActor` (owner/administrator) para
`list/review/record`; sesión de cliente + `assertAcademyScope` + vínculo cuenta→alumno para
`submit` y `listMyPrivateLessons`; `schema.parse(request.data)`; errores `HttpsError` con
mensajes seguros.

- [ ] **Step 4: Reglas**

En `firestore.rules`, junto a las demás colecciones de solo servidor:
```
match /academies/{academyId}/privateLessonPurchases/{purchaseId} {
  allow read, write: if false;
}
match /academies/{academyId}/privateLessonCreditUses/{bookingId} {
  allow read, write: if false;
}
```
`qa/rules/private-lesson-boundary.test.ts`: para anonymous, client, coach, headCoach, owner y
administrator, `assertFails` en get, list, create, update y delete de ambas colecciones
(copiar la estructura de `qa/rules/level-catalog-boundary.test.ts`).

- [ ] **Step 5: Verlos pasar**

```bash
corepack pnpm --filter @bpt-jersey/domain build:runtime
corepack pnpm vitest run --project node apps/functions/src/private-lessons
corepack pnpm --filter @bpt-jersey/functions typecheck
export FUNCTIONS_DISCOVERY_TIMEOUT=300000 && corepack pnpm test:rules
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/functions/src/private-lessons apps/functions/src/index.ts apps/functions/src/deploy-runtime.ts firestore.rules qa/rules/private-lesson-boundary.test.ts
git commit -m "feat(T03): let members buy private lessons and the office approve them"
```

### Task 3.3: Reservar y cancelar private lessons (functions)

**Files:**
- Create: `apps/functions/src/schedule/private-lesson-booking-service.ts` (+ `.test.ts`), modelado sobre `intro-booking-service.ts`
- Modify: `apps/functions/src/schedule/schedule-callables.ts` (callables `bookPrivateLesson`, `cancelPrivateLessonBooking`) e `index.ts`
- Modify: rutas de reserva de miembro (`requestBooking`, `bulkBookEligibleSessions`, `cancelBooking` de miembro): rechazar `accessMode === "private-lesson"`

**Interfaces:**
- Consumes: `pickCreditPurchase`, `PrivateLessonBookingRecord`, `privateLessonBookingInputSchema`, `cancelPrivateLessonBookingInputSchema`.
- Produces: `bookPrivateLesson({ sessionId, studentId }) → { booking }`, `cancelPrivateLessonBooking({ bookingId, reason }) → { booking, creditRestored: boolean }`.

- [ ] **Step 1: Tests que fallan**

1. Sesión `private-lesson` capacidad 1, alumno con 1 crédito → reserva `confirmed`,
   `schemaVersion "4"`, `source.purchaseId` correcto, `creditsRemaining 0`,
   `privateLessonCreditUses/{bookingId}.state === "consumed"`.
2. Sin crédito vigente → `"No private lesson credit available."`.
3. **Review Focus 1:** dos `bookPrivateLesson` concurrentes (dos alumnos o dos sesiones, un
   solo crédito del mismo alumno) con el fake transaccional → exactamente una confirma.
4. Sesión `membership` → `bookPrivateLesson` rechaza (`"This session is not a private lesson."`).
5. `requestBooking` del miembro sobre sesión `private-lesson` → rechazo
   `"Private lessons are arranged by the office."`.
6. Cancelar con compra vigente → `creditRestored: true`, `creditsRemaining` vuelve a 1,
   `state: "restored"`.
7. **Review Focus 2:** cancelar con la compra ya caducada → reserva cancelada,
   `creditRestored: false`, `state: "consumed"`.
8. Rol `coach` → `permission-denied` en ambas callables.
9. Auditoría: cada reserva y cancelación deja un evento con el `actorId` humano (ADR-018).

- [ ] **Step 2: Verlos fallar**

Run: `corepack pnpm vitest run --project node apps/functions/src/schedule/private-lesson-booking-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Transacción: leer sesión (debe ser `scheduled`, futura, `accessMode "private-lesson"`, con
plaza), compras aprobadas del alumno, elegir con `pickCreditPurchase(purchases, now)`,
decrementar `creditsRemaining`, escribir reserva + `privateLessonCreditUses/{bookingId}` +
auditoría. Reutilizar `buildBookingId` y las comprobaciones de capacidad de
`booking-transaction-service.ts`.

- [ ] **Step 4: Verlos pasar**

Run: `corepack pnpm vitest run --project node apps/functions/src/schedule && corepack pnpm --filter @bpt-jersey/functions typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/schedule apps/functions/src/index.ts
git commit -m "feat(T03): book private lessons from the office using credits"
```

### Task 3.4: Private lessons en la web

**Files:**
- Create: `apps/web/src/lib/private-lesson-client.ts` (+ test)
- Create: `apps/web/src/app/account/private-lessons/page.tsx`, `private-lessons.css` (+ test)
- Modify: `apps/web/src/app/plan-price-list.tsx` (fila "Private lessons" con los tres precios, en texto)
- Modify: `/admin/billing` (sección "Private lessons": pendientes, aprobar/rechazar)
- Modify: ficha de miembro (`apps/web/src/app/admin/members/profile/…`): botón "Record private lesson purchase" (owner/admin)
- Modify: `apps/web/src/app/admin/classes-services/classes/session-panel.tsx` + `registrations-panel.tsx`: si `session.accessMode === "private-lesson"`, "Register member" llama `bookPrivateLesson` y "Cancel" llama `cancelPrivateLessonBooking`; selector de "Access" en el editor de sesión con la opción "Private lesson"
- Modify: calendario de miembros: sesiones `private-lesson` → tarjeta `locked` con "Arranged by the office" (en `member-calendar-contracts.ts`, donde se calcula el estado)

**Interfaces:**
- Consumes: callables de 3.2 y 3.3.
- Produces: `submitPrivateLessonPurchase`, `listMyPrivateLessons`, `listPrivateLessonPurchases`, `reviewPrivateLessonPurchase`, `recordPrivateLessonPurchase`, `bookPrivateLesson`, `cancelPrivateLessonBooking` en `private-lesson-client.ts`, cada uno con parseo zod de la respuesta y mensajes seguros.

- [ ] **Step 1: Tests que fallan** (Testing Library, `--project web`)

1. `/account/private-lessons` con alumno de 16+: muestra las tres opciones con
   "£65.00", "£200.00 a month", "£500.00" y, al enviar, llama `submitPrivateLessonPurchase`
   con `{ studentId, optionId, proofId, bankReference }` y **sin** precio.
2. Con alumno menor de 16: muestra "Private lessons are for members aged 16 or over." y
   ningún formulario.
3. Muestra créditos disponibles y "Expires 28 Feb 2027" desde `listMyPrivateLessons`.
4. Billing: aprobar una pendiente llama `reviewPrivateLessonPurchase` y la fila sale de
   "Pending".
5. Session panel de una sesión `private-lesson`: registrar llama `bookPrivateLesson`; con rol
   `coach` no aparece ningún control ni importe.
6. Calendario de miembros: una sesión `private-lesson` muestra "Arranged by the office" y
   ningún botón "Book".
7. El cliente traduce un error de Firebase a "We could not save the private lesson request.
   Try again." (nunca el mensaje crudo).

- [ ] **Step 2: Verlos fallar**, **Step 3: Implementar**, **Step 4: Verlos pasar**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/private-lesson-client.test.ts apps/web/src/app/account/private-lessons apps/web/src/app/admin/billing apps/web/src/app/admin/classes-services/classes apps/web/src/app/account/calendar && corepack pnpm --filter @bpt-jersey/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/private-lesson-client.ts apps/web/src/lib/private-lesson-client.test.ts apps/web/src/app/account/private-lessons apps/web/src/app/plan-price-list.tsx apps/web/src/app/admin/billing apps/web/src/app/admin/members/profile apps/web/src/app/admin/classes-services/classes apps/web/src/app/account/calendar packages/domain/src/schedule/member-calendar-contracts.ts
git commit -m "feat(T03): add private lessons to the member area, billing and sessions"
```

### Task 4.1: Contratos del editor de cinturones (dominio)

**Files:**
- Create: `packages/domain/src/levels/level-editor-contracts.ts` (+ test)
- Modify: `packages/domain/package.json` (`"./levels/editor"`), `tsconfig.runtime.json`

**Interfaces:**
- Produces:
  - `customLevelSystemIdPattern = /^bpt-\d{8}-\d{1,3}$/u`
  - `levelDraftLevelSchema` (definitionKey, kind, parentDefinitionKey, name, sequence, stripeNumber, criteria, visual) y `levelDraftSkillSchema`, `levelDraftRequirementSchema`
  - `saveLevelCatalogDraftInputSchema = z.strictObject({ systemId, displayName, levels, skills, requirements })`
  - `createLevelCatalogDraftInputSchema = z.strictObject({ fromSystemId })`
  - `publishLevelCatalogDraftInputSchema`, `activateLevelCatalogInputSchema = z.strictObject({ systemId })`
  - `missingProgressKeys(targetKeys: ReadonlySet<string>, progress: readonly { studentId: string; currentDefinitionKey: string }[]): readonly { definitionKey: string; students: number }[]`

- [ ] **Step 1: Tests que fallan**

```ts
import { describe, expect, it } from "vitest";
import { missingProgressKeys, saveLevelCatalogDraftInputSchema } from "./level-editor-contracts";

const level = {
  definitionKey: "white", kind: "belt", parentDefinitionKey: null, name: "White belt",
  sequence: 1, stripeNumber: null,
  criteria: { minAge: 4, maxAge: null, minClasses: 0, minimumTime: null },
  visual: { colors: ["#FFFFFF"], stripeColor: "#111111", stripeCount: 4 },
};

describe("level draft validation", () => {
  it("accepts a valid belt", () => {
    expect(saveLevelCatalogDraftInputSchema.safeParse({
      systemId: "bpt-20260926-1", displayName: "BPT 2026", levels: [level], skills: [], requirements: [],
    }).success).toBe(true);
  });
  it.each([
    ["colour that is not hex", { visual: { ...level.visual, colors: ["red;background:url(x)"] } }],
    ["too many stripes", { visual: { ...level.visual, stripeCount: 11 } }],
    ["negative classes", { criteria: { ...level.criteria, minClasses: -1 } }],
    ["age out of range", { criteria: { ...level.criteria, minAge: 2 } }],
    ["name too long", { name: "x".repeat(81) }],
  ])("rejects %s", (_label, patch) => {
    expect(saveLevelCatalogDraftInputSchema.safeParse({
      systemId: "bpt-20260926-1", displayName: "BPT 2026", levels: [{ ...level, ...patch }], skills: [], requirements: [],
    }).success).toBe(false);
  });
  it("rejects editing a code catalogue", () => {
    expect(saveLevelCatalogDraftInputSchema.safeParse({
      systemId: "ibjjf-v3", displayName: "x", levels: [level], skills: [], requirements: [],
    }).success).toBe(false);
  });
});

describe("missingProgressKeys", () => {
  it("lists keys students hold that the target version lacks", () => {
    const result = missingProgressKeys(new Set(["white", "blue"]), [
      { studentId: "a", currentDefinitionKey: "white" },
      { studentId: "b", currentDefinitionKey: "white-stripe-2" },
      { studentId: "c", currentDefinitionKey: "white-stripe-2" },
    ]);
    expect(result).toEqual([{ definitionKey: "white-stripe-2", students: 2 }]);
  });
});
```
El número de stripes se expresa como `stripeCount` en el borrador y el servicio lo traduce a
definiciones `kind: "stripe"` hijas del cinturón (una por stripe), con claves
`<beltKey>-stripe-<n>`; la vista previa usa `stripeColor`.

- [ ] **Step 2–4: fallar, implementar (zod, hex `/^#[0-9a-fA-F]{6}$/u`, stripes 0–10, clases ≥ 0, edades 3–99, tiempo ≥ 0, textos 1–80), pasar**

Run: `corepack pnpm vitest run --project node packages/domain/src/levels/level-editor-contracts.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/levels/level-editor-contracts.ts packages/domain/src/levels/level-editor-contracts.test.ts packages/domain/package.json packages/domain/tsconfig.runtime.json
git commit -m "feat(T04): add level catalogue editor contracts"
```

### Task 4.2: Versiones editables del catálogo (functions)

**Files:**
- Create: `apps/functions/src/levels/level-editor-service.ts` (+ test)
- Create: `apps/functions/src/levels/level-editor-callables.ts` (+ test)
- Modify: `apps/functions/src/levels/level-service.ts` (lectura de sistemas `origin: "custom"`; `assertApprovedLevelCatalogSource` solo para `origin` ausente o `"code"`; reutilizar el `activate` existente, que ya exige `status: "published"` y `contentHash`)
- Modify: `apps/functions/src/index.ts`
- Test: `qa/rules/level-catalog-boundary.test.ts` (añadir `levelCatalogActivations` si no está)

**Interfaces:**
- Consumes: Task 4.1.
- Produces (callables, solo owner/administrator salvo la lista): `listLevelCatalogVersions() → { versions: { systemId, displayName, origin, status, active, publishedAt }[] }` (también headCoach/coach, solo lectura), `createLevelCatalogDraft`, `saveLevelCatalogDraft`, `publishLevelCatalogDraft`, `activateLevelCatalog`.

- [ ] **Step 1: Tests que fallan**

1. `createLevelCatalogDraft({ fromSystemId: "ibjjf-v3" })` → sistema `bpt-<yyyymmdd>-1`,
   `origin "custom"`, `status "draft"`, mismas definiciones y requisitos.
2. Segundo borrador el mismo día → `bpt-<yyyymmdd>-2`.
3. `saveLevelCatalogDraft` sobre un sistema `published` o `ibjjf-*` → `failed-precondition`.
4. `publishLevelCatalogDraft` → `status "published"`, manifiesto con `contentHash` sha256 de
   64 hex; un segundo `save` sobre él falla.
5. **Review Focus 3:** borrador sin la clave `white-stripe-2` que tienen 2 alumnos →
   `activateLevelCatalog` rechaza con `details.missing = [{ definitionKey: "white-stripe-2", students: 2 }]`
   y `levelCatalogState.activeSystemId` no cambia.
6. Activación válida → puntero movido, cada `studentLevelProgress` con el `systemId` nuevo y
   el mismo `currentDefinitionKey` y `currentLevelStartedAt`, recibo en
   `levelCatalogActivations`, auditoría con `fromSystemId`/`toSystemId`.
7. Rollback: activar de nuevo `ibjjf-v3` pasa por la misma comprobación.
8. `coach` y `headCoach` → `permission-denied` en todas salvo `listLevelCatalogVersions`.
9. `listLevelCatalog` (existente) sigue sirviendo v3 y ahora también una versión custom
   activa, sin fallo de hash.

- [ ] **Step 2: Verlos fallar**

Run: `corepack pnpm vitest run --project node apps/functions/src/levels/level-editor-service.test.ts`

- [ ] **Step 3: Implementar**

Nada de lo existente en `ibjjf-v1..v3` se reescribe. El `activate` actual del store ya hace
la transacción sobre estado, sistemas y progreso: se extiende con `missingProgressKeys`
antes de mover el puntero.

- [ ] **Step 4: Verlos pasar**

```bash
corepack pnpm --filter @bpt-jersey/domain build:runtime
corepack pnpm vitest run --project node apps/functions/src/levels
export FUNCTIONS_DISCOVERY_TIMEOUT=300000 && corepack pnpm test:rules
```

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/levels apps/functions/src/index.ts qa/rules/level-catalog-boundary.test.ts
git commit -m "feat(T04): version the belt catalogue as editable drafts"
```

### Task 4.3: Editor en `/admin/levels`

**Files:**
- Create: `apps/web/src/lib/level-editor-client.ts` (+ test)
- Create: `apps/web/src/app/admin/levels/level-versions.tsx`, `level-draft-editor.tsx`, `levels-editor.css` (+ tests)
- Modify: `apps/web/src/app/admin/levels/page.tsx` (pestañas "Active catalogue" | "Versions"; "Versions" solo owner/administrator)
- Modify: `DESIGN.md` §10 si el editor añade un uso de color (solo si hace falta: la vista previa usa `.belt-bar`, `.belt-tip`, `.levels-colour`)

- [ ] **Step 1: Tests que fallan**

1. Owner ve "Versions" con la lista y "Create draft from active".
2. Coach ve solo "Active catalogue" y ningún control de edición.
3. En el editor, escribir `#12` en el hex muestra "Enter a colour like #1A2B3C" y deshabilita
   "Save draft"; la vista previa no aplica el valor.
4. "Activate" que devuelve `missing` muestra "2 students hold White belt · stripe 2, which
   this version removes. Keep that level or move those students first." y no cambia la
   versión activa en pantalla.
5. Los colores del cinturón solo aparecen en elementos con clase `belt-bar`, `belt-tip` o
   `levels-colour` (consultar `container.querySelectorAll('[style*="background"]')` y
   comprobar la clase).

- [ ] **Step 2–4: fallar, implementar, pasar**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/levels apps/web/src/lib/level-editor-client.test.ts && corepack pnpm --filter @bpt-jersey/web typecheck`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/level-editor-client.ts apps/web/src/lib/level-editor-client.test.ts apps/web/src/app/admin/levels DESIGN.md
git commit -m "feat(T04): edit, publish and activate belt catalogue versions"
```

### Task 1: Enrolment requests en "Waiting"

**Files:**
- Modify: `apps/web/src/app/admin/members/requests/page.tsx:311-312, 540-546, 591-600, 672`
- Test: `apps/web/src/app/admin/members/requests/page.test.tsx`

- [ ] **Step 1: Tests que fallan**

```tsx
it("shows only waiting and failed approvals by default", async () => {
  // fixture with one of each status: submitted, returned, approving, approval-failed, approved, withdrawn
  renderRequestsPage(allStatusesFixture);
  const rows = await screen.findAllByRole("row");
  const labels = rows.slice(1).map((row) => within(row).getByTestId("request-status").textContent);
  expect(labels.sort()).toEqual(["Approval stopped", "Waiting"]);
  expect(screen.getByLabelText("Status")).toHaveValue("waiting");
});

it("keeps the history reachable from the status filter", async () => {
  renderRequestsPage(allStatusesFixture);
  await userEvent.selectOptions(screen.getByLabelText("Status"), "all");
  expect(await screen.findAllByRole("row")).toHaveLength(7);
});

it("drops an approved request from the default view without a page reload", async () => {
  // approve mock resolves; reload returns the same request as approved
  // …click "Approve" on the Waiting row
  await waitFor(() => expect(screen.queryByText("Waiting")).not.toBeInTheDocument());
});
```
(Ajustar los selectores al marcado real: etiqueta del `<select>` y cómo se pinta el estado.
Si no hay `data-testid`, usar el texto de la celda de estado.)

- [ ] **Step 2–4: fallar; añadir la opción `"waiting"` ("Waiting") como valor inicial y como destino de "Clear filters", con filtro `status === "submitted" || status === "approval-failed"`; pasar**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/members/requests`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/members/requests
git commit -m "feat(T01): open enrolment requests on the waiting list"
```

### Task 6: Waitlists por grupo

**Files:**
- Create: `apps/functions/src/schedule/admin-waitlist-groups.ts` (+ test): `groupWaitlistEntries(entries, sessions)` puro + callable `listAdminWaitlistGroups`
- Modify: `apps/functions/src/schedule/advanced-booking-callables.ts` o el archivo de callables de waitlist, e `index.ts`
- Modify: `apps/web/src/lib/admin-waitlist-client.ts` (+ test): `listAdminWaitlistGroups()`
- Modify: `apps/web/src/app/admin/waitlists/page.tsx`; Create: `apps/web/src/app/admin/waitlists/waitlists.css`
- Posible: `firestore.indexes.json` si la consulta `waitlistEntries where status in [...] orderBy createdAt` lo necesita

**Interfaces:**
- Produces: `WaitlistGroup = { groupId: string; title: string; location: string; count: number; sessions: { sessionId: string; startAt: string; entries: AdminWaitlistEntry[] }[] }`; `listAdminWaitlistGroups() → { groups: WaitlistGroup[] }`.

- [ ] **Step 1: Tests que fallan**

Servicio:
1. Tres entradas `waiting` en dos sesiones de la misma `classId` y una en otra clase → dos
   grupos; el primero con `count 3` y dos sesiones ordenadas por `startAt`.
2. Sesión sin `classId` → grupo con `groupId` `session:<sessionId>` y su título.
3. Entradas `accepted`, `expired` o de sesiones pasadas → excluidas.
4. Coach → permitido (la ruta ya es de coach) pero sin campos financieros.

Página:
1. Por defecto "All groups": un encabezado por grupo con "3 waiting".
2. Elegir un grupo actualiza la URL a `?group=<classId>` con `history.replaceState` y
   muestra solo ese grupo.
3. Cargar la página con `?group=<classId>` preselecciona ese grupo.
4. "Offer next place" en una fecha llama `issueNextWaitlistOffer` con ese `sessionId`.

- [ ] **Step 2–4: fallar, implementar, pasar**

```bash
corepack pnpm vitest run --project node apps/functions/src/schedule/admin-waitlist-groups.test.ts
corepack pnpm vitest run --project web apps/web/src/app/admin/waitlists apps/web/src/lib/admin-waitlist-client.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/schedule apps/functions/src/index.ts apps/web/src/lib/admin-waitlist-client.ts apps/web/src/lib/admin-waitlist-client.test.ts apps/web/src/app/admin/waitlists firestore.indexes.json
git commit -m "feat(T06): group waitlists by class with an all-groups view"
```

---

## Oleada 3 · Admin UI y calendarios (paralelo: T02 ‖ T07 ‖ T09)

### Task 2.1: Filtros de notificaciones (dominio + functions)

**Files:**
- Modify: `packages/domain/src/memberships/subscription-admin-contracts.ts:59-63`
- Modify: `apps/functions/src/notifications/admin-notification-service.ts:97-104` (+ test)
- Modify: `firestore.indexes.json` (tres índices de la spec)

**Interfaces:**
- Produces:
```ts
export const adminNotificationKinds = ["subscription-expiring", "membership", "registration", "payment", "class"] as const;
export const adminInboxQuerySchema = z.strictObject({
  kind: z.enum(adminNotificationKinds).nullable(),
  readState: z.enum(["all", "unread", "read"]),
  from: instant.nullable(),
  to: instant.nullable(),
  cursor: cursorSchema.nullable(),
}).refine((q) => q.from === null || q.to === null || q.from <= q.to, { message: "from must be before to" });
```
(`adminNotificationSchema.kind` pasa a usar `z.enum(adminNotificationKinds)`.)

- [ ] **Step 1: Tests que fallan**

1. `kind: "payment"` → solo pagos, orden `createdAt desc`.
2. `readState: "unread"` + `from/to` → solo no leídas dentro del rango.
3. `readState: "read"` con 35 leídas mezcladas → página de 30 + `nextCursor`.
4. **Review Focus 5:** 400 no leídas seguidas de 5 leídas y `readState: "read"` → la función
   escanea como máximo 10 páginas (310 docs), devuelve `notifications: []` y un `nextCursor`
   para seguir; nunca más lecturas.
5. `from > to` → `invalid-argument`.
6. `unreadCount` sigue contando todas las no leídas, ignorando filtros.

- [ ] **Step 2–4: fallar, implementar, pasar**

Run: `corepack pnpm vitest run --project node apps/functions/src/notifications packages/domain/src/memberships`

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/memberships/subscription-admin-contracts.ts apps/functions/src/notifications firestore.indexes.json
git commit -m "feat(T02): filter admin notifications by type, read state and date"
```

### Task 2.2: Interfaz de notificaciones

**Files:**
- Modify: `apps/web/src/app/admin/notifications/admin-notification-panel.tsx` (+ test)
- Modify: `apps/web/src/app/admin/notifications/admin-notifications.css`
- Modify: `apps/web/src/lib/subscription-admin-client.ts`
- Modify: `apps/web/src/app/admin/overview-page.tsx` solo si cambia el montaje

- [ ] **Step 1: Tests que fallan**

1. Filtros "Type", "Status" (All / Unread / Read), "From", "To" y atajos "Last 7 days",
   "Last 30 days"; cambiar uno llama `listAdminNotifications` con la query completa y
   `cursor: null`.
2. Bajo 48rem (mock de `matchMedia`) los filtros están dentro de un `<details>` cuyo
   `<summary>` dice "Filters · 2 active".
3. Una no leída muestra el texto "Unread" y la clase de regla izquierda; ningún elemento
   tiene clase `pill` ni fondo de color de estado.
4. En escritorio se pinta una tabla (`role="table"`); en móvil una lista (`role="list"`).
5. El sondeo cada 60 s conserva los filtros activos.

- [ ] **Step 2–4: fallar, implementar, pasar**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/notifications apps/web/src/app/admin/overview-page.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/notifications apps/web/src/lib/subscription-admin-client.ts apps/web/src/app/admin/overview-page.tsx
git commit -m "feat(T02): redesign the admin notifications panel"
```

### Task 7: Attendance profesional

**Files:**
- Modify: `apps/web/src/app/admin/attendance/attendance.css`, `page.tsx`, `session-roster.tsx`, `attendance-dialog.tsx` (solo marcado/clases)
- Test: `apps/web/src/app/admin/attendance/page.test.tsx`, `session-roster.test.tsx`
- Create: `qa/tests/t07-attendance-layout.spec.ts`

- [ ] **Step 1: Tests que fallan**

Unit:
1. Los controles existentes siguen presentes y llaman a lo mismo: "Clock in", "Check in",
   "Correct", "Checkout" (mismos nombres accesibles que hoy).
2. La tabla de correcciones incluye `data-label` en cada celda para la lista apilada.

Playwright (`desktop-chromium`, `mobile-chromium`; más tarde también WebKit):
```ts
for (const width of [320, 390, 768, 1024, 1440]) {
  test(`attendance has no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin/attendance");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const button of await page.getByRole("button").all()) {
      const box = await button.boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
}
```
(Usar el fixture/seed de admin que ya usan los specs de `qa/tests/` para entrar en
`/admin/attendance`.)

- [ ] **Step 2–4: fallar; CSS: escala de espaciado del sistema, `min-width` de 12rem fuera, tabla de correcciones → lista con `data-label` bajo 48rem, textarea `font-size: 1rem`, `100vh` → `100dvh` en `:161`; pasar**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/attendance qa/tests/t07-attendance-layout.spec.ts
git commit -m "fix(T07): make attendance fit phones and desktops"
```

### Task 9.1: Calendario de admin — semana

**Files:**
- Modify: `apps/web/src/app/admin/classes-services/classes/week-grid.ts` (+ test), `calendar-view.tsx` (+ test), `week-actions.tsx`, `use-compact-calendar.ts` (`50rem` → `48rem`), `page.tsx`
- Modify: `apps/web/src/app/admin/classes-services/classes-services.css`
- Create: `apps/web/src/app/admin/classes-services/classes/type-colour.ts` (+ test)

**Interfaces:**
- Produces:
  - `safeTypeColour(value: unknown): string | null` — hex válido o `null`.
  - `compressEmptyRows(layout: WeekLayout): readonly RowBand[]` con `RowBand = { kind: "rows"; startRow: number; endRow: number } | { kind: "gap"; startRow: number; endRow: number; label: string }`.

- [ ] **Step 1: Tests que fallan**

```ts
import { safeTypeColour } from "./type-colour";

describe("safeTypeColour", () => {
  it.each(["#1A2B3C", "#ffffff"])("keeps %s", (hex) => expect(safeTypeColour(hex)).toBe(hex));
  it.each(["red;background:url(x)", "", "#FFF", "#GGGGGG", null, 42])("drops %s", (value) =>
    expect(safeTypeColour(value)).toBeNull(),
  );
});
```
`week-grid.test.ts`:
1. Semana con sesiones solo 07:00–09:00 y 18:00–21:00 → bandas `rows`, `gap "09:00 – 18:00 · no classes"`, `rows`.
2. Una sesión el martes a las 13:30 → no hay hueco entre 13:00 y 14:00 en ninguna columna.
3. `nowMarker` en un hueco → el marcador se asigna a la banda `gap`.

`calendar-view.test.tsx`:
1. La tarjeta tiene fondo Gi White (sin `style.background`), `--type-colour` con el hex y el
   nombre del tipo en texto.
2. **Review Focus 4:** con `colour: "red;background:url(x)"` la tarjeta no tiene
   `--type-colour` ni `background` en su estilo.
3. Nombre accesible = nombre completo + franja + ocupación, aunque el texto visible se recorte.
4. "Delete week" está en un grupo separado al final de la barra, con la clase destructiva, y
   su diálogo sigue pidiendo motivo.
5. Clic en una banda `gap` la expande (`aria-expanded="true"`).
6. Con rol coach no aparece ninguna acción de edición.

- [ ] **Step 2–4: fallar, implementar, pasar**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/classes-services/classes`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/classes-services
git commit -m "feat(T09): calm the admin week timetable"
```

### Task 9.2: Calendario de admin — vista de 1 día

**Files:**
- Create: `apps/web/src/app/admin/classes-services/classes/day-view.tsx` (+ test)
- Modify: `calendar-view.tsx` (routing `view === "day"` → `DayView` en escritorio; `DayAgenda` mejorada en móvil), `classes-services.css`

**Interfaces:**
- Consumes: `layoutWeek`, `safeTypeColour`, `nowMarker`, `localParts`.
- Produces: `DayView({ sessions, date, timezone, canEdit, onOpen, onCreate })`.

- [ ] **Step 1: Tests que fallan**

1. Dos sesiones solapadas → dos tarjetas lado a lado con el nombre completo visible (sin
   `text-overflow: ellipsis`).
2. Con cuatro solapadas y ancho < 4 × 12rem (mock de `ResizeObserver`) → se pintan como filas
   dentro de la misma franja.
3. Cada tarjeta muestra nombre, "18:00 – 19:00", "12 / 20" con `tabular-nums`, una barra
   (`role="meter"`, `aria-valuenow=12`, `aria-valuemax=20`), coach, sede y tipo.
4. Sesión cancelada: texto "Cancelled" + regla izquierda, sin barra.
5. Móvil (< 48rem): agenda agrupada por hora, cabecera sticky con "Previous day" / "Next day".
6. Clic → `onOpen(sessionId)` (abre el `session-panel` existente).
7. El resalte de hoy y la línea "now" usan `Europe/Jersey` (`timezone` del catálogo).

- [ ] **Step 2–4: fallar, implementar, pasar**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/classes-services/classes`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/classes-services
git commit -m "feat(T09): add a proper single-day view to the admin timetable"
```

### Task 9.3: Calendario de miembros — vista de 1 día y Week/Day

**Files:**
- Modify: `packages/domain/src/schedule/member-calendar-contracts.ts:168-214` (+ test)
- Modify: `apps/web/src/app/account/calendar/member-calendar.tsx`, `calendar-header.tsx`, `day-column.tsx`, `session-card.tsx`, `apps/web/src/app/account/account.css` (+ tests)
- Delete: `apps/web/src/app/account/classes/` (página + tests)
- Modify: `apps/web/src/lib/login-flow.ts:8,36` (+ test): `/account/classes` → `/account/calendar`

**Interfaces:**
- Produces: `CalendarMode = "day" | "week"`; `visibleDays({ now, mode, offset, includeSunday })`
  (day = 1 día, offset en días hasta `calendarMaxOffsetDays`; week = Lun–Dom, offset en semanas);
  `nextOffset(mode, …)`, `prevOffset(mode, …)`. El viewport móvil fuerza `mode "day"`.

- [ ] **Step 1: Tests que fallan**

Dominio:
1. `visibleDays({ mode: "day", offset: 3 })` → un solo día, hoy + 3.
2. `mode: "week"` igual que el `desktop` actual.
3. `nextOffset("day", 14, …)` → `null`.

Web:
1. Móvil: un solo `.day-column`; tocar una pastilla del day strip muestra ese día;
   "Later" avanza un día.
2. Escritorio: selector "Week" / "Day" (`role="radiogroup"`), "Week" por defecto; "Day"
   muestra una columna ancha con la agenda.
3. Cada tarjeta: hora primero, luego clase, luego sede · coach, luego estado; el nombre no
   tiene `text-overflow: ellipsis`.
4. Los fondos de estado de §9 no cambian (snapshot de clases `session-card--open`, etc.).
5. `/account/courses/calendar` sigue mostrando "Course included · session 2/8" y el toggle de
   ausencia.
6. `sanitizeReturnPath("/account/classes")` → `"/account/calendar"`.

- [ ] **Step 2–4: fallar, implementar, pasar**

```bash
corepack pnpm vitest run --project node packages/domain/src/schedule/member-calendar-contracts.test.ts
corepack pnpm vitest run --project web apps/web/src/app/account/calendar apps/web/src/app/account/courses apps/web/src/lib/login-flow.test.ts
```

- [ ] **Step 5: Comprobar que no queda otro calendario**

Run: `grep -rlnE "calendar|timetable" apps/web/src/app --include='*.tsx' | grep -v test`
Expected: solo archivos de `admin/classes-services/classes/`, `account/calendar/`,
`account/courses/calendar/`, `admin/classes-services/types/` (selector de color) y
`coach/page.tsx` (lista de hoy, no calendario).

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/schedule/member-calendar-contracts.ts packages/domain/src/schedule/member-calendar-contracts.test.ts apps/web/src/app/account apps/web/src/lib/login-flow.ts apps/web/src/lib/login-flow.test.ts
git commit -m "feat(T09): give members a one-day agenda and a week/day switch"
```

### Task 9.4: DESIGN.md — "Timetable colours are data" y §9

**Files:**
- Modify: `DESIGN.md` (nueva sección tras §10; §9 con el cambio de móvil a 1 día y el selector Week/Day)

- [ ] **Step 1: Texto**

```markdown
## 11. Timetable colours are data

- A class type's timetable colour (Types → "Timetable colour") is catalogue data, validated
  as `#RRGGBB` before it reaches CSS.
- It may appear only as the `0.35rem` left rule of a session card in the admin/coach
  timetable and as the swatch in Types. Never as a card fill, tint, text colour, border
  elsewhere, or anywhere in the member app.
- The type is always named in text; colour is never the only carrier of information.
```
§9: "Phone (< 48rem) shows one day chosen from the day strip; tablet and desktop show the
week (seven columns, today at `1.6fr`) with a Week / Day switch."

- [ ] **Step 2: Commit**

```bash
git add DESIGN.md
git commit -m "docs(T09): document timetable colours and the member day view"
```

---

## Oleada 4 · Público (T14 ‖ T15, después T10)

### Task 14: Fichas de cursos en la landing

**Files:**
- Modify: `apps/web/src/app/courses/courses.css`, `course-ui.tsx`, `course-catalogue.tsx`
- Modify: `DESIGN.md` §7 (excepción de la banda)
- Test: `apps/web/src/app/courses/course-catalogue.test.tsx`, `course-promotion-bar.test.tsx`

- [ ] **Step 1: Tests que fallan**

1. La banda conserva el botón "Pause" con `aria-pressed` y, con `prefers-reduced-motion`
   (mock de `matchMedia`), no se renderiza la pista duplicada.
2. La descripción de cada ficha tiene la clase que aplica `max-width: 65ch`.

- [ ] **Step 2–4: CSS con la escala de DESIGN (títulos con `clamp()` existentes, cuerpo
  ≥ 1rem, sin tamaños sueltos de 0.72/0.85rem en texto de lectura), ritmo vertical con los
  tokens de espaciado; texto de DESIGN §7:**

"The course promotion band is the only permitted perpetual motion: linear marquee, visible
Pause control, pauses on hover/focus, static wrapped list under reduced motion."

Run: `corepack pnpm vitest run --project web apps/web/src/app/courses`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/courses DESIGN.md
git commit -m "fix(T14): tidy course card typography and spacing"
```

### Task 15: Precios de la tienda en escritorio

**Files:**
- Modify: `apps/web/src/app/shop/page.tsx`; Create: `apps/web/src/app/shop/shop.css` (mover allí las reglas `.shop-*` de `globals.css:1577-1877` solo si el líder lo autoriza en esta oleada; si no, sobrescribir en `shop.css`)
- Test: `qa/tests/t15-shop-prices.spec.ts`

- [ ] **Step 1: Test que falla (Playwright)**

```ts
test("shop prices line up on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/shop");
  const prices = page.locator(".shop-product-price");
  await expect(prices.first()).toBeVisible();
  const tops = await prices.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  const firstRow = tops.filter((top) => top === tops[0]);
  expect(firstRow.length).toBe(2); // two columns between 48rem and 64rem
  expect(await prices.first().evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain("tabular-nums");
});

test("shop mobile layout is unchanged", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/shop");
  await expect(page).toHaveScreenshot("shop-390.png");
});
```
Generar la captura de referencia de 390 px **antes** de cambiar nada
(`--update-snapshots` en la rama sin cambios) y commitearla con el test.

- [ ] **Step 2–4: fallar; 2 columnas entre 48 y 64rem, 3 desde 64rem, precio con `tabular-nums` y alineado al pie de la tarjeta; pasar**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/shop qa/tests/t15-shop-prices.spec.ts qa/tests/t15-shop-prices.spec.ts-snapshots
git commit -m "fix(T15): align shop prices on desktop"
```

### Task 10: Anti-slop

**Files:** los que salgan de la auditoría (landing `apps/web/src/app/page.tsx`, `content/academy.ts`, `globals.css` del hero; `/account`).

- [ ] **Step 1: Auditoría** con las skills `antislop`, `antislop-copywriting`, `antislop-ui`
  sobre el estado tras T14 y T15. Lista numerada: hallazgo · archivo:línea · propuesta de
  texto o cambio.
- [ ] **Step 2: PARAR y mostrar la lista al operador.** No corregir nada sin su visto bueno.
- [ ] **Step 3: Corregir lo aprobado**, con tests de texto donde ya existan (actualizar las
  aserciones de copy en los tests afectados).
- [ ] **Step 4: Tests**: `corepack pnpm vitest run --project web apps/web/src/app/page.test.tsx apps/web/src/app/account`
- [ ] **Step 5: Commit**: `git commit -m "fix(T10): replace generic copy on the landing and member area"`

---

## Oleada 5 · Transversal (T13, después T08)

### Task 13: Coach con los componentes de admin

**Files:**
- Modify: `apps/web/src/app/coach/page.tsx`, `access/page.tsx`, `coach.css`
- Delete: `apps/web/src/app/coach/levels/` (+ tests)
- Modify: `apps/web/src/app/admin/admin-shell.tsx:117-123` (el enlace "Progression syllabus" apunta a `/admin/levels`), `admin-routes.ts` (quitar `/coach/levels`) (+ tests)
- Output: tabla "pantalla admin → equivalente coach → diferencias por permiso" en el informe final

- [ ] **Step 1: Tests que fallan**

1. `/coach` usa `AdminSectionHeader` (encabezado con la misma clase que admin) y
   `admin-panel-card`; no quedan clases `coach-card` ni tamaños de 0.875rem en texto de
   lectura.
2. El menú de coach no contiene "Waitlists", "Billing", "Financial dashboard", "Shop",
   "Staff" ni "Memberships".
3. "Progression syllabus" enlaza a `/admin/levels`; `/coach/levels` no es ruta permitida.
4. `/admin/levels` con rol coach no muestra la pestaña "Versions".

- [ ] **Step 2–4: fallar, implementar, pasar**

Run: `corepack pnpm vitest run --project web apps/web/src/app/coach apps/web/src/app/admin/admin-routes.test.ts apps/web/src/app/admin/admin-shell.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/coach apps/web/src/app/admin/admin-shell.tsx apps/web/src/app/admin/admin-routes.ts apps/web/src/app/admin/admin-routes.test.ts
git commit -m "feat(T13): build the coach workspace from the admin components"
```

### Task 8: Móvil y tablet

**Files:**
- Modify: `apps/web/src/app/globals.css` (17 `100vh` totales entre archivos; breakpoints; menú de la landing en `:826-829`), `admin/admin.css`, resto de CSS con `max-width: 50rem` de rejillas
- Modify: `apps/web/src/app/page.tsx` (botón "Menu" con `aria-expanded` y `aria-controls`)
- Modify: `DESIGN.md` §6 y §9
- Modify: `qa/playwright.config.ts` (proyectos nuevos)
- Create: `qa/tests/t08-responsive.spec.ts`

- [ ] **Step 1: Proyectos de Playwright**

```ts
{ name: "mobile-webkit", use: { ...devices["iPhone 15"] } },
{ name: "tablet-webkit", use: { ...devices["iPad Pro 11"] } },
{ name: "tablet-webkit-landscape", use: { ...devices["iPad Pro 11 landscape"] } },
{ name: "tablet-chromium", use: { ...devices["Galaxy Tab S4"] } },
{ name: "desktop-webkit", use: { ...devices["Desktop Safari"] } },
```
Instalar el navegador una vez: `corepack pnpm --dir qa exec playwright install webkit`.

- [ ] **Step 2: Test que falla**

```ts
const routes = ["/", "/login", "/shop", "/courses", "/levels", "/account/calendar", "/admin", "/admin/attendance", "/admin/classes-services/classes", "/coach"];
for (const width of [320, 390, 768, 1024, 1440]) {
  for (const route of routes) {
    test(`${route} has no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `qa/screenshots/${route.replaceAll("/", "_") || "home"}-${width}.png`, fullPage: true });
    });
  }
}
test("landing menu opens on phones", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("link", { name: "Classes" })).toBeVisible();
});
test("form controls are at least 16px", async ({ page }) => {
  await page.goto("/login");
  for (const input of await page.locator("input, select, textarea").all()) {
    expect(parseFloat(await input.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  }
});
```
Las rutas autenticadas usan el login de emulador de los specs existentes.

- [ ] **Step 3: Implementar**

- `100vh` → `100dvh` en layouts de pantalla completa.
- `padding-top: env(safe-area-inset-top)` (y laterales) en cabeceras fijas/sticky y en el cajón de admin.
- Rejillas: `@media (max-width: 50rem)` de colapso a una columna → `47.99rem`; donde el escritorio tiene 3+ columnas, añadir el paso a 2 columnas entre 48 y 64rem.
- Hero: colapso bajo 48rem; entre 48 y 64rem, dos columnas compactas.
- Landing: menú plegable bajo 58rem en vez de `display:none` de los enlaces.
- Controles `font-size: max(1rem, 16px)`.
- DESIGN §6: "Breakpoints: phone below `48rem`; tablet `48rem–64rem` uses the desktop layout at two columns; desktop from `64rem`. Every grid collapses to one column below `48rem`."

- [ ] **Step 4: Pasar**

```bash
corepack pnpm --filter @bpt-jersey/web build
corepack pnpm --dir qa exec playwright test tests/t08-responsive.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src qa/playwright.config.ts qa/tests/t08-responsive.spec.ts DESIGN.md
git commit -m "fix(T08): support phones, tablets and iOS Safari across the site"
```
(Las capturas de `qa/screenshots/` no se commitean salvo que el operador lo pida.)

---

## Oleada 6 · Verificación final

### Task V: Verificación y informe

- [ ] **Step 1:** `corepack pnpm format:check && corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test`
- [ ] **Step 2:** `export FUNCTIONS_DISCOVERY_TIMEOUT=300000 && corepack pnpm test:rules` (emuladores con `demo-bpt-jersey`, JDK 21; en este VPS, contenedor `bpt-emu:local --network none` según la memoria del proyecto)
- [ ] **Step 3:** `corepack pnpm --filter @bpt-jersey/web build && corepack pnpm test:e2e:smoke`
- [ ] **Step 4:** Playwright de los specs nuevos en todos los proyectos (`desktop-chromium`, `mobile-chromium`, `mobile-webkit`, `tablet-webkit`, `tablet-webkit-landscape`, `tablet-chromium`, `desktop-webkit`); capturas en `qa/screenshots/`.
- [ ] **Step 5:** Pasada `security-best-practices` + `frontend-security-coder` sobre `git diff d875983..main` (precios, permisos, hex, URLs, logs) y `web-performance-optimization` (CLS al cargar datos, carga diferida de paneles pesados). Corregir en commits `fix(TNN)`.
- [ ] **Step 6:** Informe final (tabla tarea · estado · commits · evidencia · tests y resultado),
  con:
  - Callables huérfanas en prod (T05): `approveLessonPlan`, `getLessonPlan`.
  - Pendiente de deploy (solo con confirmación): callables nuevas de T03
    (`submitPrivateLessonPurchase`, `listMyPrivateLessons`, `listPrivateLessonPurchases`,
    `reviewPrivateLessonPurchase`, `recordPrivateLessonPurchase`, `bookPrivateLesson`,
    `cancelPrivateLessonBooking`), T04 (`listLevelCatalogVersions`, `createLevelCatalogDraft`,
    `saveLevelCatalogDraft`, `publishLevelCatalogDraft`, `activateLevelCatalog`), T06
    (`listAdminWaitlistGroups`), las functions modificadas (`listAdminNotifications`,
    `requestBooking` y demás rutas de reserva, `listLevelCatalog`), reglas e índices.
    Recordatorio: el push a `main` publica la web en Cloudflare Pages; la web nueva llama a
    callables que no existirán hasta el deploy de functions.
  - Cambios a `DESIGN.md` (§6, §7, §9, §11 nueva).
  - Riesgos pendientes y qué revisar en un iPhone/iPad reales: `<dialog>` y teclado en
    Safari, `100dvh` con la barra de Safari, `input type="color"` y `range` en iOS, zonas
    seguras con notch, scroll del day strip.
