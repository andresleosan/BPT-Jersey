# Planes, precios, límites de reserva y aforo obligatorio (T050V2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajustar `PLAN_CATALOG` a las tarifas reales, exigir aforo en toda sesión y aplicar de forma coherente (servidor autoritativo, cliente orientativo) sede, audiencia, límite semanal y open mats, mostrando planes y precios desde una única fuente.

**Architecture:** Cambio acotado sobre el monolito modular existente. Dominio (`packages/domain`) define catálogo y parsers; `apps/functions` aplica reglas dentro de la transacción de reserva existente; `apps/web` deriva todo texto de precios de `plan-copy.ts`. Sin colecciones, reglas de Firestore ni índices nuevos.

**Tech Stack:** TypeScript strict, pnpm vía Corepack, Vitest (proyectos `web`, `node`, `firestore-integration`), Next.js 16 static export, Firebase Functions v2, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-plans-pricing-capacity-design.md`

## Global Constraints

- Comandos siempre `corepack pnpm <script>` desde la raíz (o desde el worktree); Node `>=22.13 <25`.
- Proyecto de emuladores `demo-bpt-jersey`; exportar `FUNCTIONS_DISCOVERY_TIMEOUT=300000` antes de arrancarlos. En este VPS los emuladores corren en Docker `bpt-emu:local --network none` (puerto 8080 del host es code-server).
- `packages/domain` nunca importa Firebase.
- Precios en peniques (`priceMinor`), moneda `"GBP"`.
- Aforo de sesión: entero 1–300 al crear/editar; `SessionRecord.capacity` sigue siendo `number | null` solo para leer legado.
- Límite semanal: `1 | 2 | 3 | null`; cuenta solo clases (programa con `discipline !== "open-mat"`), lunes–domingo hora de Jersey.
- Códigos nuevos de reserva: `capacity-not-set`, `weekly-limit` (viajan en `details.reason`).
- Copy en inglés británico llano. Mensajes: `capacity-not-set` ⇒ "This session isn't open for booking yet."; `weekly-limit` ⇒ "You've used this week's classes on your plan."
- UI según `DESIGN.md`: radio 0 (salvo `/account` 1rem), sin azul/gradientes/emojis/pills/spinners, estado = texto + regla izquierda, etiqueta encima del input, `tabular-nums` en dinero, sin fila de tres tarjetas iguales, una columna por debajo de 50rem.
- Nunca `dangerouslySetInnerHTML`; errores al usuario solo como cadenas fijas.
- No ejecutar Prettier sobre `tasksv2.md`.
- Nada se despliega ni escribe en Firebase real sin confirmación explícita del operador en chat.
- Commits terminan con `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Trabajo en paralelo: existe `docs/superpowers/plans/2026-09-17-classes-services-plan-4a-import-types-sessions.md` (otra sesión) que toca schedule; hacer `git fetch && git merge origin/main` antes del Task 10 y resolver conflictos a favor de ambas intenciones.

---

### Task 0: Worktree, rama y spec

**Files:**
- Create: worktree `../BPT-Jersey-wt/plans-pricing` en rama `feature/plans-pricing-capacity`
- Commit: `docs/superpowers/specs/2026-09-17-plans-pricing-capacity-design.md`, este plan

- [ ] **Step 1: Crear worktree desde `main`** (usar `superpowers:using-git-worktrees`). Los cambios sin commitear de `admin/classes-services/types/` del checkout principal NO deben viajar.

```bash
cd /root/BPT-Jersey
git worktree add ../BPT-Jersey-wt/plans-pricing -b feature/plans-pricing-capacity main
cp docs/superpowers/specs/2026-09-17-plans-pricing-capacity-design.md ../BPT-Jersey-wt/plans-pricing/docs/superpowers/specs/
cp docs/superpowers/plans/2026-09-17-plans-pricing-capacity.md ../BPT-Jersey-wt/plans-pricing/docs/superpowers/plans/
cd ../BPT-Jersey-wt/plans-pricing && corepack pnpm install --frozen-lockfile
```

- [ ] **Step 2: Línea base verde**

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS (anotar número de ficheros/pruebas para el ledger).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-17-plans-pricing-capacity-design.md docs/superpowers/plans/2026-09-17-plans-pricing-capacity.md
git commit -m "docs(plans): spec y plan de planes, precios, limites y aforo (T050V2)"
```

Después, en el checkout principal borrar las copias sin trackear de esos dos ficheros (ya viven en la rama).

---

### Task 1: Catálogo de planes en dominio

**Files:**
- Modify: `packages/domain/src/memberships/plan-contracts.ts` (líneas 4-41, 290-331, 424-489)
- Modify: `packages/domain/src/index.ts:225` (exportar `retiredPlanIds`)
- Modify: `apps/functions/src/memberships/plan-service.ts:339-375` (`seedPlanCatalog`)
- Modify: `apps/web/src/lib/membership-admin-client.ts:69-92`
- Test: `packages/domain/src/memberships/plan-contracts.test.ts`, `apps/functions/src/memberships/plan-service.test.ts`

**Interfaces:**
- Produces: `billingPeriods = ["per-session","monthly","term"]`; `type WeeklyClassLimit = 1 | 2 | 3 | null`; `planIds` incluye `"west-teens-payg"`; `retiredPlanIds: readonly PlanId[]` (= `["town-teens"]`); `PLAN_CATALOG` de 11 planes según la tabla de la spec; `openMatSites` puede ser `[]`.

- [ ] **Step 1: Actualizar tests del catálogo (fallarán)**

En `plan-contracts.test.ts` sustituir `expectedCatalog` completo por:

```ts
const expectedCatalog = [
  ["payg", "West Pay as you go", 1000, "per-session", ["adult"], ["West"], null, [], null],
  [
    "bpt-jersey-adult",
    "BPT Jersey Town & West",
    12500,
    "monthly",
    ["adult"],
    ["Town", "West"],
    null,
    ["Town", "West"],
    null,
  ],
  ["west-kids-1x", "West Kids 1x", 9500, "term", ["kids"], ["West"], 1, [], null],
  ["west-kids-2x", "West Kids 2x", 11500, "term", ["kids"], ["West"], 2, ["Town"], null],
  ["west-adult", "West Adult", 6500, "monthly", ["adult"], ["West"], 2, ["Town"], null],
  ["west-teens", "West Teens", 4500, "monthly", ["teens"], ["West"], 2, [], null],
  ["west-teens-payg", "West Teens single class", 750, "per-session", ["teens"], ["West"], null, [], null],
  ["town-adult", "Town Adult", 8500, "monthly", ["adult"], ["Town"], null, ["Town"], null],
  ["town-kids-1x", "Town Kids & Teens 1x", 9500, "term", ["kids", "teens"], ["Town"], 1, [], null],
  ["town-kids-2x", "Town Kids & Teens 3x", 13500, "term", ["kids", "teens"], ["Town"], 3, ["Town"], null],
  ["town-teens", "Town Teens", 4500, "monthly", ["teens"], ["Town"], 2, ["Town"], 750],
] as const;
```

Cambios en tests existentes:
- `"publishes the closed vocabularies"`: `expect(billingPeriods).toEqual(["per-session", "monthly", "term"]);`
- `"contains exactly the approved ten-plan catalog"` → renombrar a `"contains exactly the approved eleven-plan catalog"` y `toHaveLength(11)`.
- `"uses the PAYG price for both class and Open Mat sessions"` → reemplazar el cuerpo por:

```ts
  it("charges PAYG per West adult class and refuses Town, other audiences and open mats", () => {
    const payg = record();
    const west = { participantType: "adult", site: "West", sessionType: "class", weeklyClassesUsed: 9 } as const;
    expect(evaluatePlanAccess(payg, west)).toEqual({ allowed: true, code: "ALLOWED", feeMinor: 1000 });
    expect(evaluatePlanAccess(payg, { ...west, site: "Town" }).code).toBe("CLASS_SITE_NOT_ELIGIBLE");
    expect(evaluatePlanAccess(payg, { ...west, participantType: "teens" }).code).toBe(
      "PARTICIPANT_TYPE_NOT_ELIGIBLE",
    );
    expect(evaluatePlanAccess(payg, { ...west, sessionType: "openMat" }).code).toBe(
      "OPEN_MAT_SITE_NOT_ELIGIBLE",
    );
  });
```

- En `"fails closed for malformed eligibility plans and inputs"` cambiar `weeklyClassLimit: 3` por `weeklyClassLimit: 4`.

Añadir al final del `describe`:

```ts
  it("lists town-teens as the only retired plan", () => {
    expect(retiredPlanIds).toEqual(["town-teens"]);
    expect(Object.isFrozen(retiredPlanIds)).toBe(true);
  });

  it("accepts a limit of 3, a term period and no open-mat sites; refuses a limit of 4", () => {
    const draft = { ...PLAN_CATALOG.find((plan) => plan.planId === "town-kids-2x")! };
    expect(parsePlanDraft({ ...draft, openMatSites: [] }).ok).toBe(true);
    expect(parsePlanDraft({ ...draft, weeklyClassLimit: 4 }).ok).toBe(false);
  });

  it("applies each catalog plan's real entitlements", () => {
    const plan = (planId: string) =>
      record(PLAN_CATALOG.find((item) => item.planId === planId) as PlanDraft);
    const at = (
      participantType: PlanAccessInput["participantType"],
      site: PlanAccessInput["site"],
      sessionType: PlanAccessInput["sessionType"],
      weeklyClassesUsed = 0,
    ): PlanAccessInput => ({ participantType, site, sessionType, weeklyClassesUsed });
    const code = (planId: string, input: PlanAccessInput) => evaluatePlanAccess(plan(planId), input).code;

    expect(code("bpt-jersey-adult", at("adult", "Town", "class", 50))).toBe("ALLOWED");
    expect(code("bpt-jersey-adult", at("adult", "West", "openMat"))).toBe("ALLOWED");
    expect(code("west-adult", at("adult", "West", "class", 1))).toBe("ALLOWED");
    expect(code("west-adult", at("adult", "West", "class", 2))).toBe("WEEKLY_LIMIT_REACHED");
    expect(code("west-adult", at("adult", "Town", "openMat", 2))).toBe("ALLOWED");
    expect(code("west-adult", at("adult", "West", "openMat"))).toBe("OPEN_MAT_SITE_NOT_ELIGIBLE");
    expect(code("west-kids-1x", at("kids", "West", "openMat"))).toBe("OPEN_MAT_SITE_NOT_ELIGIBLE");
    expect(code("west-kids-2x", at("kids", "Town", "openMat", 2))).toBe("ALLOWED");
    expect(code("west-kids-2x", at("kids", "Town", "class"))).toBe("CLASS_SITE_NOT_ELIGIBLE");
    expect(code("west-teens", at("teens", "West", "openMat"))).toBe("OPEN_MAT_SITE_NOT_ELIGIBLE");
    expect(evaluatePlanAccess(plan("west-teens-payg"), at("teens", "West", "class", 5))).toEqual({
      allowed: true,
      code: "ALLOWED",
      feeMinor: 750,
    });
    expect(code("town-adult", at("adult", "Town", "class", 40))).toBe("ALLOWED");
    expect(code("town-adult", at("adult", "West", "class"))).toBe("CLASS_SITE_NOT_ELIGIBLE");
    expect(code("town-kids-1x", at("teens", "Town", "class"))).toBe("ALLOWED");
    expect(code("town-kids-1x", at("kids", "Town", "class", 1))).toBe("WEEKLY_LIMIT_REACHED");
    expect(code("town-kids-2x", at("teens", "Town", "class", 2))).toBe("ALLOWED");
    expect(code("town-kids-2x", at("kids", "Town", "class", 3))).toBe("WEEKLY_LIMIT_REACHED");
    expect(code("town-kids-2x", at("kids", "Town", "openMat", 3))).toBe("ALLOWED");
  });
```

Importar `retiredPlanIds` en la cabecera del test.

- [ ] **Step 2: Ejecutar y ver fallo**

Run: `corepack pnpm vitest run --project node packages/domain/src/memberships/plan-contracts.test.ts`
Expected: FAIL (`retiredPlanIds` no exportado, catálogo distinto).

- [ ] **Step 3: Implementar en `plan-contracts.ts`**

1. `planIds`: insertar `"west-teens-payg",` justo después de `"west-teens",`.
2. `export const billingPeriods = Object.freeze(["per-session", "monthly", "term"] as const);`
3. Tras `SessionType` añadir:

```ts
export const weeklyClassLimits = Object.freeze([1, 2, 3, null] as const);
export type WeeklyClassLimit = (typeof weeklyClassLimits)[number];
```

4. En `PlanFields`: `weeklyClassLimit: WeeklyClassLimit;`
5. En `parsePlanFields`: `openMatSites` pasa `false` como `nonEmpty`; sustituir las dos comprobaciones de límite por una constante:

```ts
  const weeklyClassLimitValid = weeklyClassLimits.includes(value.weeklyClassLimit as WeeklyClassLimit);
  if (!weeklyClassLimitValid) issues.push(issue(["weeklyClassLimit"], "invalid_limit"));
```

y en el `if` de retorno temprano reemplazar el bloque `(value.weeklyClassLimit !== null && … !== 2)` por `!weeklyClassLimitValid ||`; en el objeto devuelto `weeklyClassLimit: value.weeklyClassLimit as WeeklyClassLimit,`.
6. `draft(...)`: parámetro `weeklyClassLimit: WeeklyClassLimit`.
7. Sustituir `PLAN_CATALOG` por:

```ts
export const PLAN_CATALOG: readonly PlanDraft[] = Object.freeze([
  draft("payg", "West Pay as you go", 1000, "per-session", ["adult"], ["West"], null, [], null),
  draft(
    "bpt-jersey-adult",
    "BPT Jersey Town & West",
    12500,
    "monthly",
    ["adult"],
    ["Town", "West"],
    null,
    ["Town", "West"],
    null,
  ),
  draft("west-kids-1x", "West Kids 1x", 9500, "term", ["kids"], ["West"], 1, [], null),
  draft("west-kids-2x", "West Kids 2x", 11500, "term", ["kids"], ["West"], 2, ["Town"], null),
  draft("west-adult", "West Adult", 6500, "monthly", ["adult"], ["West"], 2, ["Town"], null),
  draft("west-teens", "West Teens", 4500, "monthly", ["teens"], ["West"], 2, [], null),
  draft(
    "west-teens-payg",
    "West Teens single class",
    750,
    "per-session",
    ["teens"],
    ["West"],
    null,
    [],
    null,
  ),
  draft("town-adult", "Town Adult", 8500, "monthly", ["adult"], ["Town"], null, ["Town"], null),
  draft(
    "town-kids-1x",
    "Town Kids & Teens 1x",
    9500,
    "term",
    ["kids", "teens"],
    ["Town"],
    1,
    [],
    null,
  ),
  draft(
    "town-kids-2x",
    "Town Kids & Teens 3x",
    13500,
    "term",
    ["kids", "teens"],
    ["Town"],
    3,
    ["Town"],
    null,
  ),
  draft("town-teens", "Town Teens", 4500, "monthly", ["teens"], ["Town"], 2, ["Town"], 750),
]);

// ponytail: retired plans stay in the catalog so existing memberships still resolve; T047V2 replaces
// this list with a per-plan flag when plans become dynamic.
export const retiredPlanIds: readonly PlanId[] = Object.freeze(["town-teens"]);
```

8. `packages/domain/src/index.ts`: añadir `retiredPlanIds,` y `weeklyClassLimits,` junto a `PLAN_CATALOG,` (y `type WeeklyClassLimit` donde se reexportan tipos de planes, si existe esa lista).

- [ ] **Step 4: Tests del dominio en verde**

Run: `corepack pnpm vitest run --project node packages/domain/src/memberships/plan-contracts.test.ts`
Expected: PASS.

- [ ] **Step 5: `seedPlanCatalog` crea retirados inactivos (test primero)**

En `apps/functions/src/memberships/plan-service.test.ts`, dentro del `describe` que ya llama a `seedPlanCatalog(baseInput)` (línea ~276), añadir:

```ts
  it("seeds retired catalog plans as inactive", async () => {
    const seeded = await store.seedPlanCatalog(baseInput);
    expect(seeded.find((plan) => plan.planId === "town-teens")?.active).toBe(false);
    expect(seeded.find((plan) => plan.planId === "town-kids-2x")?.active).toBe(true);
  });
```

(Usar el mismo `store`/`baseInput` que el test vecino; si el store se crea dentro de cada test, copiar esas dos líneas de creación del test de la línea ~270.)

Run: `corepack pnpm vitest run --project node apps/functions/src/memberships/plan-service.test.ts -t "retired"` → FAIL.

En `plan-service.ts` (rama `const created = parseCreatedRecord({...})`) cambiar `active: true,` por:

```ts
              active: !retiredPlanIds.includes(plan.planId),
```

e importar `retiredPlanIds` junto a `PLAN_CATALOG`.

Run de nuevo → PASS.

- [ ] **Step 6: Cliente admin acepta 3 y sedes de open mat vacías**

En `apps/web/src/lib/membership-admin-client.ts`:

```ts
const uniqueSites = z.array(siteSchema).refine((values) => new Set(values).size === values.length);
const uniqueNonEmptySites = uniqueSites.refine((values) => values.length > 0);
```

y en `planDraftSchema`: `weeklyClassLimit: z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]),` y `openMatSites: uniqueSites,`.

- [ ] **Step 7: Arreglar consumidores y tests colaterales**

Run: `corepack pnpm typecheck`
Expected: errores solo donde se asume `1 | 2` (p. ej. `apps/web/src/app/admin/memberships/page.tsx:547` cast `as 1 | 2`) → cambiar a `as WeeklyClassLimit` importado de `@bpt-jersey/domain/memberships`. No tocar aún la UI (Task 6).

Run: `corepack pnpm vitest run --project node apps/functions/src/memberships apps/functions/src/regyfit packages/domain/src/contracts.test.ts packages/domain/src/consents`
Expected: los fallos que aparezcan deben ser aserciones sobre el catálogo antiguo (10 planes, `"monthly"` en kids, payg en Town, `west-teens` con 750). Actualizar cada aserción al catálogo de la spec; no cambiar lógica de producción para contentarlas. Luego:

Run: `corepack pnpm vitest run --project web apps/web/src/app/account apps/web/src/app/admin/billing`
Expected: PASS tras ajustar aserciones del mismo tipo.

- [ ] **Step 8: Commit**

```bash
git add -A packages/domain apps/functions/src/memberships apps/functions/src/regyfit apps/web/src/lib/membership-admin-client.ts apps/web/src/app
git commit -m "feat(memberships): real price catalogue with term billing, 3x limit and retired town-teens (T050V2)"
```

---

### Task 2: Aforo obligatorio en sesiones y en "Copy week"

**Files:**
- Modify: `packages/domain/src/schedule/schedule-contracts.ts:240-268, 760-773, 875-910`
- Modify: `apps/functions/src/schedule/schedule-service.ts:627-650` (`copyWeekWith`)
- Modify: `apps/functions/src/schedule/schedule-callables.ts:208-219` (`mapWeekError`)
- Modify: `apps/web/src/lib/schedule-client.ts:229-237` (`copyWeek`)
- Test: `packages/domain/src/schedule/schedule-contracts.test.ts`, `apps/functions/src/schedule/schedule-service.test.ts`, `apps/functions/src/schedule/schedule-callables.test.ts`, `apps/web/src/lib/schedule-client.test.ts`

**Interfaces:**
- Produces: `CreateSessionInput.capacity: number`; `UpdateSessionInput.capacity?: number`; `copyWeek` del servidor lanza `Error("Every session in the source week needs a capacity before it can be copied")` → `HttpsError("failed-precondition")`; `copyWeek` del cliente lanza `Error("Set a capacity on every session in this week before copying it.")` ante `functions/failed-precondition`.

- [ ] **Step 1: Tests de parser (fallarán)**

En `schedule-contracts.test.ts`, localizar los 5 usos de `capacity: null`: los que esperan éxito pasan a esperar error; añadir:

```ts
describe("session capacity is required", () => {
  const create = {
    classId: null,
    programId: "p1",
    locationId: "town",
    instructorId: "coach-1",
    title: "Adults BJJ",
    startAt: "2099-09-01T18:00:00.000Z",
    endAt: "2099-09-01T19:00:00.000Z",
    capacity: 20,
    minParticipants: 0,
  };

  it.each([null, undefined, 0, 301, 2.5, "20"])("refuses capacity %s when creating", (capacity) => {
    expect(parseCreateSessionInput({ ...create, capacity }).ok).toBe(false);
  });

  it("accepts 1 and 300 when creating", () => {
    expect(parseCreateSessionInput({ ...create, capacity: 1 }).ok).toBe(true);
    expect(parseCreateSessionInput({ ...create, capacity: 300 }).ok).toBe(true);
  });

  it("refuses clearing the capacity when updating", () => {
    expect(parseUpdateSessionInput({ sessionId: "s1", capacity: null }).ok).toBe(false);
    expect(parseUpdateSessionInput({ sessionId: "s1", capacity: 12 }).ok).toBe(true);
  });
});
```

Run: `corepack pnpm vitest run --project node packages/domain/src/schedule/schedule-contracts.test.ts` → FAIL.

- [ ] **Step 2: Implementar parsers**

`CreateSessionInput`: borrar el comentario `/** Null means unlimited. */` y dejar `capacity: number;`. `UpdateSessionInput`: `capacity?: number;`.

En `parseCreateSessionInput` reemplazar el bloque de capacidad y el de `minParticipants` por:

```ts
  if (
    typeof capacity !== "number" ||
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    capacity > 300
  ) {
    return err("capacity must be an integer between 1 and 300");
  }

  if (
    typeof minParticipants !== "number" ||
    !Number.isInteger(minParticipants) ||
    minParticipants < 0 ||
    minParticipants > capacity
  ) {
    return err("minParticipants must be an integer between 0 and capacity");
  }
```

En `parseUpdateSessionInput`:

```ts
  if (
    capacity !== undefined &&
    (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity < 1 || capacity > 300)
  ) {
    return err("capacity must be an integer between 1 and 300");
  }
```

y `if (capacity !== undefined) result.capacity = capacity;`.

Run el test → PASS.

- [ ] **Step 3: `copyWeek` rechaza sesiones sin aforo (test primero)**

En `schedule-service.test.ts`, junto a los tests de `copyWeek` existentes, añadir (reutilizando el helper de creación de sesión que usan esos tests; el `null` legado se inyecta con cast porque el tipo ya no lo permite):

```ts
  it("refuses to copy a week that holds a session without capacity", async () => {
    const store = createInMemoryScheduleStore();
    await store.createSession(
      academyId,
      { ...weekSessionInput("2026-09-14T17:00:00.000Z"), capacity: null as unknown as number },
      "admin",
    );
    await expect(
      store.copyWeek(
        academyId,
        { fromWeekStart: "2026-09-14", toWeekStart: "2026-09-21", copyBookings: false },
        "Europe/Jersey",
        "admin",
      ),
    ).rejects.toThrow("needs a capacity");
  });
```

Si el fichero no tiene `weekSessionInput`, usar el objeto de sesión literal que ya emplean los tests de `copyWeek` de ese fichero (buscar `copyWeek(` en el test) con `startAt`/`endAt` dentro de la semana 2026-09-14. Revisar los otros 4 `capacity: null` del fichero: pasan a un número (p. ej. `20`) salvo que el test verifique justamente legado, en cuyo caso usar el mismo cast.

Run: `corepack pnpm vitest run --project node apps/functions/src/schedule/schedule-service.test.ts -t "without capacity"` → FAIL.

Implementar en `copyWeekWith`, justo después de `const source = liveSessions(...)`:

```ts
  if (source.some((session) => session.capacity === null)) {
    throw new Error("Every session in the source week needs a capacity before it can be copied");
  }
```

y en el objeto de `store.createSession` dentro del bucle: `capacity: session.capacity as number,` con comentario `// checked above: no source session is uncapped`.

Run → PASS.

- [ ] **Step 4: Callable devuelve `failed-precondition`**

En `mapWeekError`, antes del `console.error`:

```ts
  if (/needs a capacity/u.test(message)) {
    throw new HttpsError("failed-precondition", message);
  }
```

Test en `schedule-callables.test.ts` junto a los de `copyWeek` (mismo patrón de handler/fake store del fichero): el fake store rechaza con `new Error("Every session in the source week needs a capacity before it can be copied")` y se espera `rejects.toMatchObject({ code: "failed-precondition" })`. Run el fichero → PASS.

- [ ] **Step 5: Cliente web traduce el rechazo**

En `schedule-client.ts` reemplazar `copyWeek`:

```ts
export async function copyWeek(input: CopyWeekInput): Promise<readonly SessionRecord[]> {
  const callable = httpsCallable<CopyWeekInput, { sessions: SessionRecord[] }>(
    getFirebaseFunctions(),
    "copyWeek",
  );
  try {
    return (await callable(input)).data.sessions;
  } catch (error) {
    const code = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
    throw new Error(
      code === "functions/failed-precondition"
        ? "Set a capacity on every session in this week before copying it."
        : "Unable to copy the week",
    );
  }
}
```

Test en `apps/web/src/lib/schedule-client.test.ts` con el mock de `httpsCallable` que ya usa el fichero: callable rechaza `{ code: "functions/failed-precondition" }` → `rejects.toThrow("Set a capacity on every session in this week before copying it.")`; rechaza `{ code: "functions/internal" }` → `"Unable to copy the week"`.

`week-actions.tsx` ya muestra `error.message`: no requiere cambios.

- [ ] **Step 6: Typecheck y colaterales**

Run: `corepack pnpm typecheck`
Expected: errores en quien construye `CreateSessionInput`/`UpdateSessionInput` con `null` (`session-panel.tsx:227,237,262`, fixtures de test). En `session-panel.tsx` dejarlo compilando provisionalmente con `Number(draft.capacity)`; Task 5 añade la validación visible. Tests con `capacity: null` en `apps/web/src/app/admin/classes-services/classes/page.test.tsx`, `week-grid.test.ts`, `qa/tests/admin-classes-services.spec.ts`: cambiar a un número salvo que prueben la lectura de legado (entonces mantener `null` en un `SessionRecord`, no en un input).

Run: `corepack pnpm vitest run --project node apps/functions/src/schedule packages/domain/src/schedule` → PASS.

- [ ] **Step 7: Guardia desactivada ⇒ rojo** (`LECCIONES.md` §4)

Comentar temporalmente el `if (source.some(...))` de `copyWeekWith` y ejecutar el test del Step 3 → debe FALLAR. Restaurar y confirmar PASS. Anotar el resultado para el ledger.

- [ ] **Step 8: Commit**

```bash
git add -A packages/domain/src/schedule apps/functions/src/schedule apps/web/src qa/tests/admin-classes-services.spec.ts
git commit -m "feat(schedule): require session capacity on create, update and copy week (T050V2)"
```

---

### Task 3: Reserva — aforo legado, límite semanal solo clases, códigos nuevos

**Files:**
- Modify: `apps/functions/src/schedule/booking-transaction-service.ts:38-39, 161-177, 374-435, 612-692`
- Modify: `apps/functions/src/schedule/schedule-service.ts:577` (`uncopyableBookingCodes`)
- Test: `qa/integration/booking-transaction.test.ts` (proyecto `firestore-integration`, requiere emulador Firestore)

**Interfaces:**
- Consumes: `PLAN_CATALOG` (Task 1).
- Produces: `BookingErrorCode` incluye `"capacity-not-set" | "weekly-limit"`; `mapBookingError` ya los propaga como `HttpsError("failed-precondition", "Booking is not available", { reason })`.

- [ ] **Step 1: Tests de integración (fallarán)**

En `qa/integration/booking-transaction.test.ts`:

1. Añadir `"west-adult"` al `beforeAll`: programa open mat y plan West Adult:

```ts
    firestore.doc("academies/" + academyId + "/programs/adult-open-mat").set({
      programId: "adult-open-mat",
      academyId,
      name: "Adult Open Mat",
      ageBand: "adult",
      discipline: "open-mat",
      level: "all-levels",
      active: true,
      schemaVersion: "1",
    }),
    firestore.doc("academies/" + academyId + "/plans/west-adult").set({
      ...PLAN_CATALOG.find((item) => item.planId === "west-adult")!,
      academyId,
      active: true,
      schemaVersion: "1",
      createdAt: "2026-01-01T00:00:00Z",
      createdBy: "owner-1",
      updatedAt: "2026-01-01T00:00:00Z",
      updatedBy: "owner-1",
    }),
```

2. Reemplazar el test `"never reports capacity for an unlimited session"` por:

```ts
  it("refuses a legacy session without capacity before touching plan or locks", async () => {
    const sessionId = "session-uncapped";
    const contender = { studentId: "uncapped-student", membershipId: "uncapped-membership" };
    await Promise.all([
      firestore.doc("academies/" + academyId + "/sessions/" + sessionId).set(session(sessionId, null)),
      seedStudentMembership(contender),
    ]);

    await expect(
      store.requestBooking(academyId, { sessionId, ...contender }, contender.studentId),
    ).rejects.toMatchObject({ code: "capacity-not-set" });
    const lock = await firestore
      .doc("academies/" + academyId + "/sessionCapacityStates/" + sessionId)
      .get();
    expect(lock.exists).toBe(false);
  });
```

3. Añadir:

```ts
  it("counts only classes towards the weekly limit and keeps open-mat sites per plan", async () => {
    const member = { studentId: "west-adult-student", membershipId: "west-adult-membership" };
    await seedStudentMembership({ ...member, planId: "west-adult" });
    // Week of Monday 2099-08-31 (Jersey). Open mat first: if it counted, the second class would fail.
    const rows = [
      { id: "wk-open-mat-town", program: "adult-open-mat", location: "town", startAt: "2099-08-31T18:00:00Z" },
      { id: "wk-class-1", program: "adult-fundamentals", location: "west", startAt: "2099-09-01T18:00:00Z" },
      { id: "wk-class-2", program: "adult-fundamentals", location: "west", startAt: "2099-09-02T18:00:00Z" },
      { id: "wk-class-3", program: "adult-fundamentals", location: "west", startAt: "2099-09-03T18:00:00Z" },
      { id: "wk-open-mat-west", program: "adult-open-mat", location: "west", startAt: "2099-09-04T18:00:00Z" },
    ];
    await Promise.all(
      rows.map((row) =>
        firestore.doc("academies/" + academyId + "/sessions/" + row.id).set({
          ...session(row.id, 10, row.startAt),
          programId: row.program,
          locationId: row.location,
        }),
      ),
    );
    const book = (sessionId: string) =>
      store.requestBooking(academyId, { sessionId, ...member }, member.studentId);

    expect((await book("wk-open-mat-town")).status).toBe("confirmed");
    expect((await book("wk-class-1")).status).toBe("confirmed");
    expect((await book("wk-class-2")).status).toBe("confirmed");
    await expect(book("wk-class-3")).rejects.toMatchObject({ code: "weekly-limit" });
    await expect(book("wk-open-mat-west")).rejects.toMatchObject({ code: "ineligible" });
  });
```

Run (emulador Firestore arrancado según memoria `vps-emulators-docker-sparse`):
`corepack pnpm vitest run --project firestore-integration qa/integration/booking-transaction.test.ts`
Expected: FAIL (`code` `ineligible`/`capacity` en vez de los nuevos; la 2.ª clase falla por contar el open mat).

- [ ] **Step 2: Implementar**

1. Tipo:

```ts
type BookingErrorCode =
  | "capacity"
  | "capacity-not-set"
  | "conflict"
  | "financial"
  | "ineligible"
  | "invalid"
  | "not-found"
  | "tenant"
  | "weekly-limit";
```

2. `historicalSession` devuelve también `programId`: tipo de retorno `Pick<SessionRecord, "startAt" | "status" | "programId">` y añadir `typeof value.programId !== "string" ||` a la condición de `"Stored session is invalid"`.

3. En `weeklyUsage`, antes del bucle `const openMatByProgram = new Map<string, boolean>();` y sustituir `used += 1;` por:

```ts
      if (!(await isOpenMatProgram(input, historical.programId, openMatByProgram))) used += 1;
```

con, encima de `weeklyUsage`:

```ts
/** Open mats never use up a weekly class place. A missing program counts as a class (fail closed). */
async function isOpenMatProgram(
  input: { firestore: BookingFirestore; transaction: BookingTransaction; academyId: string },
  programId: string,
  cache: Map<string, boolean>,
): Promise<boolean> {
  const cached = cache.get(programId);
  if (cached !== undefined) return cached;
  const snapshot = await input.transaction.get(
    input.firestore.doc(path(input.academyId, "programs") + "/" + programId),
  );
  const openMat = snapshot.exists && snapshot.data()?.discipline === "open-mat";
  cache.set(programId, openMat);
  return openMat;
}
```

4. En `executeBookingInTransaction`, justo después del bloque `if (target.existing?.status === "confirmed") {…}`:

```ts
  if (storedSession.capacity === null) {
    return invalid("capacity-not-set", "Session has no capacity set");
  }
```

5. Sustituir la evaluación de plan y la comprobación de aforo por:

```ts
  const access = evaluatePlanAccess(storedPlan, {
    participantType: audience(storedStudent, storedProgram, storedSession.startAt),
    site: storedSession.locationId === "town" ? "Town" : "West",
    sessionType: storedProgram.discipline === "open-mat" ? "openMat" : "class",
    weeklyClassesUsed: used,
  });
  if (!access.allowed) {
    return invalid(
      access.code === "WEEKLY_LIMIT_REACHED" ? "weekly-limit" : "ineligible",
      "Plan access is not eligible",
    );
  }
  if (occupied.confirmed + occupied.reserved >= storedSession.capacity) {
    return invalid("capacity", "Session capacity reached");
  }
```

6. `schedule-service.ts:577`: `const uncopyableBookingCodes: readonly string[] = ["capacity", "capacity-not-set", "financial", "ineligible", "weekly-limit"];`

- [ ] **Step 3: Tests en verde**

Run: `corepack pnpm vitest run --project firestore-integration qa/integration/booking-transaction.test.ts qa/integration/waitlist-offer-transaction.test.ts qa/integration/financial-access.test.ts`
Expected: PASS.

Run: `corepack pnpm vitest run --project node apps/functions/src/schedule` → PASS.

- [ ] **Step 4: Guardias desactivadas ⇒ rojo**

(a) Cambiar temporalmente `if (!(await isOpenMatProgram(...))) used += 1;` por `used += 1;` → el test del límite semanal FALLA en `wk-class-2`. (b) Comentar el `if (storedSession.capacity === null)` → el test legado FALLA. Restaurar ambos, confirmar PASS, anotar para el ledger.

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/schedule qa/integration/booking-transaction.test.ts
git commit -m "feat(booking): open mats outside weekly limit, refuse uncapped sessions, precise refusal reasons (T050V2)"
```

---

### Task 4: Textos de planes y banda de edad compartidos (web)

**Files:**
- Create: `apps/web/src/lib/plan-copy.ts`, `apps/web/src/lib/plan-copy.test.ts`
- Create: `apps/web/src/lib/participant-band.ts`, `apps/web/src/lib/participant-band.test.ts`
- Modify: `apps/web/src/app/account/membership/page.tsx:38-55, 262-273`

**Interfaces:**
- Consumes: `PLAN_CATALOG`, `retiredPlanIds`, `PlanDraft`, `Site`, `ParticipantType` de `@bpt-jersey/domain/memberships`.
- Produces:
  - `formatPlanPrice(plan: Pick<PlanDraft, "priceMinor" | "billingPeriod">): string`
  - `describePlanAccess(plan: Pick<PlanDraft, "billingPeriod" | "eligibleParticipantTypes" | "classSites" | "weeklyClassLimit" | "openMatSites">): string`
  - `type PlanGroup = Readonly<{ title: string; plans: readonly PlanDraft[] }>`
  - `publicPlanGroups(site?: Site): readonly PlanGroup[]`
  - `participantBand(dateOfBirth: string, today?: Date): ParticipantType`

- [ ] **Step 1: Tests (fallarán)**

`apps/web/src/lib/plan-copy.test.ts`:

```ts
import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";
import { describe, expect, it } from "vitest";

import { describePlanAccess, formatPlanPrice, publicPlanGroups } from "./plan-copy";

const byId = (planId: string) => PLAN_CATALOG.find((plan) => plan.planId === planId)!;

describe("plan copy", () => {
  it.each([
    ["bpt-jersey-adult", "£125 per month", "Unlimited classes at Town and West · open mats at Town and West"],
    ["payg", "£10 per class", "Pay per class at West"],
    ["west-adult", "£65 per month", "2 classes a week at West · open mats at Town"],
    ["west-kids-1x", "£95 per term", "1 class a week at West"],
    ["west-kids-2x", "£115 per term", "2 classes a week at West · kids open mat at Town"],
    ["west-teens", "£45 per month", "2 classes a week at West"],
    ["west-teens-payg", "£7.50 per class", "Pay per class at West"],
    ["town-adult", "£85 per month", "Unlimited classes at Town · open mats at Town"],
    ["town-kids-1x", "£95 per term", "1 class a week at Town"],
    ["town-kids-2x", "£135 per term", "3 classes a week at Town · kids open mat at Town"],
  ])("describes %s", (planId, price, access) => {
    expect(formatPlanPrice(byId(planId))).toBe(price);
    expect(describePlanAccess(byId(planId))).toBe(access);
  });

  it("groups live public plans by site and hides retired ones", () => {
    const groups = publicPlanGroups();
    expect(groups.map((group) => group.title)).toEqual(["Town & West", "BPT West", "BPT Town"]);
    const ids = groups.flatMap((group) => group.plans.map((plan) => plan.planId));
    expect(ids).not.toContain("town-teens");
    expect(ids).toHaveLength(10);
  });

  it("keeps only the groups that train at the chosen site", () => {
    expect(publicPlanGroups("West").map((group) => group.title)).toEqual(["Town & West", "BPT West"]);
    expect(publicPlanGroups("Town").map((group) => group.title)).toEqual(["Town & West", "BPT Town"]);
  });
});
```

`apps/web/src/lib/participant-band.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { participantBand } from "./participant-band";

describe("participantBand", () => {
  const today = new Date("2026-09-17T12:00:00Z");
  it.each([
    ["2014-09-18", "kids"],
    ["2014-09-17", "teens"],
    ["2008-09-18", "teens"],
    ["2008-09-17", "adult"],
    ["not-a-date", "adult"],
  ])("maps %s to %s", (dateOfBirth, band) => {
    expect(participantBand(dateOfBirth, today)).toBe(band);
  });
});
```

Run: `corepack pnpm vitest run --project web apps/web/src/lib/plan-copy.test.ts apps/web/src/lib/participant-band.test.ts` → FAIL (módulos inexistentes).

- [ ] **Step 2: Implementar**

`apps/web/src/lib/plan-copy.ts`:

```ts
import {
  PLAN_CATALOG,
  retiredPlanIds,
  type PlanDraft,
  type Site,
} from "@bpt-jersey/domain/memberships";

const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const periodLabel = { "per-session": "per class", monthly: "per month", term: "per term" } as const;

export function formatPlanPrice(plan: Pick<PlanDraft, "priceMinor" | "billingPeriod">): string {
  // Whole pounds read as "£85"; pence stay visible ("£7.50").
  const amount =
    plan.priceMinor % 100 === 0 ? `£${plan.priceMinor / 100}` : money.format(plan.priceMinor / 100);
  return `${amount} ${periodLabel[plan.billingPeriod]}`;
}

function sites(values: readonly Site[]): string {
  return values.join(" and ");
}

export function describePlanAccess(
  plan: Pick<
    PlanDraft,
    "billingPeriod" | "eligibleParticipantTypes" | "classSites" | "weeklyClassLimit" | "openMatSites"
  >,
): string {
  const at = sites(plan.classSites);
  const classes =
    plan.billingPeriod === "per-session"
      ? `Pay per class at ${at}`
      : plan.weeklyClassLimit === null
        ? `Unlimited classes at ${at}`
        : `${plan.weeklyClassLimit} class${plan.weeklyClassLimit === 1 ? "" : "es"} a week at ${at}`;
  if (plan.openMatSites.length === 0) return classes;
  // The session's age band decides which open mat a child can book; the copy names the kids one.
  const openMat = plan.eligibleParticipantTypes.includes("adult") ? "open mats" : "kids open mat";
  return `${classes} · ${openMat} at ${sites(plan.openMatSites)}`;
}

export type PlanGroup = Readonly<{ title: string; plans: readonly PlanDraft[] }>;

export function publicPlanGroups(site?: Site): readonly PlanGroup[] {
  const live = PLAN_CATALOG.filter((plan) => !retiredPlanIds.includes(plan.planId));
  const only = (value: Site) =>
    live.filter((plan) => plan.classSites.length === 1 && plan.classSites[0] === value);
  const groups: PlanGroup[] = [
    { title: "Town & West", plans: live.filter((plan) => plan.classSites.length === 2) },
    { title: "BPT West", plans: only("West") },
    { title: "BPT Town", plans: only("Town") },
  ];
  return groups.filter(
    (group) =>
      group.plans.length > 0 &&
      (site === undefined || group.plans.every((plan) => plan.classSites.includes(site))),
  );
}
```

`apps/web/src/lib/participant-band.ts` (mover la función existente de `account/membership/page.tsx:43-55`, con `today` inyectable):

```ts
import type { ParticipantType } from "@bpt-jersey/domain/memberships";

/** Age band on `today` from a YYYY-MM-DD birth date: under 12 kids, 12–17 teens, else adult. */
export function participantBand(dateOfBirth: string, today = new Date()): ParticipantType {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dateOfBirth);
  if (!parts) return "adult";
  let age = today.getUTCFullYear() - Number(parts[1]);
  const month = Number(parts[2]) - 1;
  const day = Number(parts[3]);
  if (today.getUTCMonth() < month || (today.getUTCMonth() === month && today.getUTCDate() < day)) {
    age -= 1;
  }
  if (age >= 18) return "adult";
  return age >= 12 ? "teens" : "kids";
}
```

Run los dos tests → PASS.

- [ ] **Step 3: Ficha del socio usa los textos compartidos**

En `apps/web/src/app/account/membership/page.tsx`: borrar `moneyFormatter`, `planPeriod` y `participantBand` locales; importar `participantBand` de `../../../lib/participant-band` y `describePlanAccess, formatPlanPrice` de `../../../lib/plan-copy`. Sustituir el contenido de `<article className="client-plan-card">` por:

```tsx
                        <h3>{plan.displayName}</h3>
                        <p>
                          <strong>{formatPlanPrice(plan)}</strong>
                        </p>
                        <span>{describePlanAccess(plan)}</span>
```

y justo después de `</div>` de `client-plan-grid` (dentro de la rama con planes) añadir:

```tsx
                    <p className="account-helper">Open mats don't count towards your weekly classes.</p>
```

(Si `account-helper` no existe en el CSS de `/account`, usar la clase de texto secundario que ya usa esa página para párrafos, buscándola con `grep -n "className=\"" apps/web/src/app/account/membership/page.tsx`.)

Actualizar `apps/web/src/app/account/membership/page.test.tsx` si asierta "per month"/"per week": las nuevas cadenas son las del test de `plan-copy`.

Run: `corepack pnpm vitest run --project web apps/web/src/app/account/membership apps/web/src/lib` → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/plan-copy.ts apps/web/src/lib/plan-copy.test.ts apps/web/src/lib/participant-band.ts apps/web/src/lib/participant-band.test.ts apps/web/src/app/account/membership
git commit -m "feat(web): one source for plan price and entitlement copy (T050V2)"
```

---

### Task 5: Admin — aforo obligatorio visible

**Files:**
- Modify: `apps/web/src/app/admin/classes-services/classes/session-panel.tsx:227, 237, 262, 289-291, 379-393`
- Modify: `apps/web/src/app/admin/classes-services/classes/list-view.tsx:186, 346-348`
- Modify: `apps/web/src/app/admin/classes-services/classes/calendar-view.tsx:75-77`
- Modify: `apps/web/src/app/coach/page.tsx:465, 479`
- Test: `session-panel.test.tsx`, `list-view.test.tsx`, `calendar-view.test.tsx`

**Interfaces:**
- Consumes: `CreateSessionInput.capacity: number` (Task 2).

- [ ] **Step 1: Tests (fallarán)**

`session-panel.test.tsx`:
- En `"creates a session with several trainers, unlimited capacity and custom rules"`: renombrar a `"creates a session with several trainers, a capacity and custom rules"`, añadir antes del click en Create `fireEvent.change(screen.getByLabelText("Maximum capacity"), { target: { value: "24" } });` y esperar `capacity: 24`.
- Añadir:

```tsx
  it("blocks creating a session until a capacity between 1 and 300 is entered", () => {
    render(
      <SessionPanel
        mode="create"
        catalog={catalog}
        staff={staff}
        timezone="Europe/Jersey"
        defaults={{ date: "2026-09-14", startTime: "17:30" }}
        canEdit
        canReadMemberships
        onSaved={vi.fn()}
        onCancelled={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "coach-a" }));
    const create = screen.getByRole("button", { name: "Create" });
    const capacity = screen.getByLabelText("Maximum capacity");
    expect(capacity).toBeRequired();
    expect(screen.getByText("Enter a capacity between 1 and 300")).toBeInTheDocument();
    expect(create).toBeDisabled();
    fireEvent.change(capacity, { target: { value: "301" } });
    expect(create).toBeDisabled();
    fireEvent.change(capacity, { target: { value: "12" } });
    expect(create).toBeEnabled();
    expect(screen.queryByText("Enter a capacity between 1 and 300")).not.toBeInTheDocument();
  });
```

- En `"refuses an end time at or before the start and a class with no trainer"`: tras marcar `coach-a`, añadir `fireEvent.change(screen.getByLabelText("Maximum capacity"), { target: { value: "10" } });` antes de `expect(...Create...).toBeEnabled()`.

`list-view.test.tsx`:

```tsx
  it("asks for a capacity instead of showing an unlimited session", () => {
    renderList([{ ...sessionAt(0, "Legacy class"), capacity: null }]);
    expect(screen.getByText("Set capacity")).toBeInTheDocument();
    expect(screen.queryByText(/∞/u)).not.toBeInTheDocument();
  });
```

`calendar-view.test.tsx`: mismo caso con el helper de sesión del fichero (buscar el que construye `GridSession`), esperando `"Set capacity"` en el chip.

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/classes-services/classes` → FAIL.

- [ ] **Step 2: Implementar**

`session-panel.tsx`:

```ts
  const capacityValue = Number(draft.capacity);
  const capacityInvalid =
    draft.capacity.trim() === "" ||
    !Number.isInteger(capacityValue) ||
    capacityValue < 1 ||
    capacityValue > 300;
  const blocked = busy || endsBeforeStart || noTrainer || capacityInvalid;
```

(junto a `endsBeforeStart`/`noTrainer`). En `submit`: `const capacity = capacityValue;` (borrar la línea con `null`); `if (capacity !== session.capacity) changes.capacity = capacity;` compila sin cambios.

Campo:

```tsx
            <div className="cs-field">
              <label htmlFor="cs-capacity">Maximum capacity</label>
              <input
                id="cs-capacity"
                type="number"
                required
                min={1}
                max={300}
                step={1}
                value={draft.capacity}
                disabled={readOnly}
                aria-invalid={canEdit && capacityInvalid}
                aria-describedby="cs-capacity-help"
                onChange={(event) => patch({ capacity: event.target.value })}
              />
              <small id="cs-capacity-help">Maximum people on the mat (1–300)</small>
            </div>
          </div>
          {canEdit && capacityInvalid ? (
            <p className="cs-notice" data-kind="error" role="alert">
              Enter a capacity between 1 and 300
            </p>
          ) : null}
```

(el `</div>` de cierre ya existe tras el campo: insertar el aviso inmediatamente después de él, siguiendo el patrón de `endsBeforeStart`).

`list-view.tsx`: CSV `row.capacity === null ? "Set capacity" : String(row.capacity)`; celda:

```tsx
                <td data-label="Registrations">
                  {row.capacity === null ? "Set capacity" : `${row.booked} / ${row.capacity}`}
                </td>
```

`calendar-view.tsx`:

```tsx
      <span className="cs-event-chip">
        {session.capacity === null ? "Set capacity" : `${session.booked} / ${session.capacity}`}
      </span>
```

`coach/page.tsx`: `{s.capacity ?? "not set"}` en ambas líneas (el coach no puede editar; solo informa).

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/classes-services apps/web/src/app/coach` → PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/admin/classes-services/classes apps/web/src/app/coach
git commit -m "feat(admin): capacity is required in the session panel; uncapped sessions ask for one (T050V2)"
```

---

### Task 6: Admin — editor de planes (term, 3x, diferencia con catálogo)

**Files:**
- Modify: `apps/web/src/app/admin/memberships/page.tsx:194, 283-290, 515-554, 646-660`
- Modify: CSS del admin donde vive `.membership-message` (`grep -rn "membership-message" apps/web/src/app/admin/*.css apps/web/src/app/admin/**/*.css`)
- Test: `apps/web/src/app/admin/memberships/page.test.tsx`

**Interfaces:**
- Consumes: `formatPlanPrice` (Task 4), `WeeklyClassLimit`, `weeklyClassLimits`, `PLAN_CATALOG` (Task 1).

- [ ] **Step 1: Test (fallará)**

En `page.test.tsx` añadir (el mock ya devuelve `inactivePlan` = `west-adult` sin límite y open mats Town+West, que ahora difiere del catálogo; copiar el `render`/`mockResolvedValue` iniciales del test `"manages connected plans…"`):

```tsx
  it("flags a stored plan that differs from the catalogue and loads the catalogue values", async () => {
    const user = userEvent.setup();
    membershipApi.listManagedPlans.mockResolvedValue([activePlan, inactivePlan]);
    membershipApi.listMemberships.mockResolvedValue([]);
    membersApi.listMembers.mockResolvedValue({ rows: directoryRows, nextCursor: undefined });
    render(<MembershipsAdminPage />);

    await user.selectOptions(await screen.findByLabelText("Plan to edit"), "west-adult");
    expect(screen.getByText("Differs from catalogue")).toBeInTheDocument();
    expect(screen.getByLabelText("Weekly class limit")).toHaveValue("none");

    await user.click(screen.getByRole("button", { name: "Load catalogue values" }));
    expect(screen.getByLabelText("Weekly class limit")).toHaveValue("2");
    expect(membershipApi.saveMembershipPlan).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText("Plan to edit"), "town-adult");
    expect(screen.queryByText("Differs from catalogue")).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Per term" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "3 classes" })).toBeInTheDocument();
  });
```

(Si `render` requiere props o el nombre del mock de miembros difiere, usar exactamente lo que hace el primer test del fichero.)

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/memberships` → FAIL.

- [ ] **Step 2: Implementar**

1. Helper de módulo, junto a `copyPlan`:

```ts
const billingLabel = { "per-session": "Per session", monthly: "Monthly", term: "Per term" } as const;

function samePlan(left: PlanDraft, right: PlanDraft): boolean {
  return JSON.stringify(copyPlan(left)) === JSON.stringify(copyPlan(right));
}
```

2. Tabla: `<td>{billingLabel[plan.billingPeriod]}</td>` y `<td>{formatPlanPrice(plan)}</td>` (borrar `formatMoney` si queda sin uso).
3. Select de billing: `{billingLabel[period]}` como texto de cada `option`.
4. Select de límite:

```tsx
                    onChange={(event) =>
                      setPlanDraft((plan) => ({
                        ...plan,
                        weeklyClassLimit:
                          event.target.value === "none"
                            ? null
                            : (Number(event.target.value) as WeeklyClassLimit),
                      }))
                    }
                    value={planDraft.weeklyClassLimit ?? "none"}
                  >
                    <option value="none">Unlimited</option>
                    <option value="1">1 class</option>
                    <option value="2">2 classes</option>
                    <option value="3">3 classes</option>
```

5. Tras la línea `const configuredPlan = …` (283):

```ts
  const catalogPlan = PLAN_CATALOG.find((plan) => plan.planId === selectedPlanId);
  const differsFromCatalogue =
    configuredPlan !== undefined && catalogPlan !== undefined && !samePlan(configuredPlan, catalogPlan);
```

6. Dentro del `<form className="membership-card">` del editor, justo después del bloque de título `<div><p className="admin-eyebrow">Plan editor</p>…</div>`:

```tsx
              {differsFromCatalogue ? (
                <div className="membership-message membership-message-warning" role="status">
                  <p>
                    <strong>Differs from catalogue</strong>
                  </p>
                  <p>This saved plan doesn't match the published prices and rules.</p>
                  <button
                    className="membership-secondary-button"
                    disabled={busy !== undefined}
                    onClick={() => catalogPlan && setPlanDraft(copyPlan(catalogPlan))}
                    type="button"
                  >
                    Load catalogue values
                  </button>
                </div>
              ) : null}
```

7. CSS (mismo fichero donde está `.membership-message-error`), si no existe variante warning:

```css
.membership-message-warning {
  background: #fff8e6;
  border-left: 0.35rem solid #c98b00;
  color: #765400;
}
```

Run el test → PASS. Run `corepack pnpm vitest run --project web apps/web/src/app/admin/memberships` → PASS completo.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/admin/memberships apps/web/src/app/admin
git commit -m "feat(admin): term billing, 3x limit and catalogue drift notice in the plan editor (T050V2)"
```

---

### Task 7: Socio — calendario y mensajes de reserva

**Files:**
- Modify: `packages/domain/src/schedule/member-calendar-contracts.ts:217-290, 326-338` (+ helper `jerseyWeekKey`)
- Modify: `apps/web/src/lib/calendar/calendar-repository.ts:20-28`
- Modify: `apps/web/src/lib/calendar/firebase-calendar-repository.ts:37-85`
- Modify: `apps/web/src/lib/calendar/fixture-calendar-repository.ts:65-101`
- Modify: `apps/web/src/app/account/calendar/member-calendar.tsx:133-134, 220-256`
- Modify: `apps/web/src/lib/calendar/booking-messages.ts`, `apps/web/src/app/account/classes/page.tsx:78-100`
- Test: `packages/domain/src/schedule/member-calendar-contracts.test.ts`, `apps/web/src/lib/calendar/booking-messages.test.ts`, `apps/web/src/lib/calendar/firebase-calendar-repository.test.ts`, `apps/web/src/app/account/classes/page.test.tsx`

**Interfaces:**
- Consumes: `participantBand` (Task 4); `weekRangeFor(weekStart, timezone): Result<{from,to}, string>` de `@bpt-jersey/domain/schedule/classes-services`.
- Produces: `LockedReason = "age_band" | "site" | "open_mat" | "weekly_limit"`; `CalendarMemberContext.weeklyClassLimit: WeeklyClassLimit`; `deriveSessionStatus` input `weeklyClassesBooked?: number` (por defecto 0); `jerseyWeekKey(iso: string): string` (lunes `YYYY-MM-DD`); `CalendarParticipant.weeklyClassLimit: WeeklyClassLimit`.

- [ ] **Step 1: Tests de dominio (fallarán)**

En `member-calendar-contracts.test.ts`: añadir `weeklyClassLimit: 2,` a `maya` (y a cualquier otro `CalendarMemberContext` del fichero), e importar `jerseyWeekKey`. Añadir dentro de `describe("deriveSessionStatus")`:

```ts
  it("locks a class once the weekly class limit is used, but never an open mat or a booked class", () => {
    expect(deriveSessionStatus({ ...base, weeklyClassesBooked: 2 })).toEqual({
      status: "locked",
      lockedReason: "weekly_limit",
    });
    expect(deriveSessionStatus({ ...base, weeklyClassesBooked: 1 }).status).toBe("open");
    expect(
      deriveSessionStatus({ ...base, program: openMatProgram, weeklyClassesBooked: 2 }).status,
    ).toBe("open");
    expect(deriveSessionStatus({ ...base, booking, weeklyClassesBooked: 2 }).status).toBe("booked");
    expect(
      deriveSessionStatus({ ...base, member: { ...maya, weeklyClassLimit: null }, weeklyClassesBooked: 9 })
        .status,
    ).toBe("open");
  });

  it("closes a session that has no capacity set", () => {
    expect(deriveSessionStatus({ ...base, session: { ...session, capacity: null } }).status).toBe(
      "closed",
    );
  });
```

Y fuera:

```ts
describe("jerseyWeekKey", () => {
  it("returns the Jersey Monday, including late Sunday UTC that is already Monday in BST", () => {
    expect(jerseyWeekKey("2026-09-16T17:00:00.000Z")).toBe("2026-09-14");
    expect(jerseyWeekKey("2026-09-20T22:30:00.000Z")).toBe("2026-09-14");
    expect(jerseyWeekKey("2026-09-20T23:30:00.000Z")).toBe("2026-09-21");
  });
});

describe("lockedReasonLabel weekly limit", () => {
  it("names the weekly limit", () => {
    expect(lockedReasonLabel("weekly_limit", "Town", "teens")).toBe("Weekly class limit reached");
  });
});
```

Run: `corepack pnpm vitest run --project node packages/domain/src/schedule/member-calendar-contracts.test.ts` → FAIL.

- [ ] **Step 2: Implementar dominio**

```ts
export type LockedReason = "age_band" | "site" | "open_mat" | "weekly_limit";

export type CalendarMemberContext = Readonly<{
  studentId: string;
  membershipId: string;
  participantType: ParticipantType;
  planClassSites: readonly Site[];
  planOpenMatSites: readonly Site[];
  weeklyClassLimit: WeeklyClassLimit;
}>;
```

(importar `WeeklyClassLimit` desde `../memberships/plan-contracts`, igual que ya se importan `ParticipantType`/`Site`).

`jerseyWeekKey`, junto a `dateKeyInJersey`:

```ts
/** Monday (YYYY-MM-DD) of the Jersey week holding `iso`; the week the booking limit counts. */
export function jerseyWeekKey(iso: string): string {
  const [year, month, day] = splitKey(dateKeyInJersey(new Date(iso)));
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  const mondayOffset = (noon.getUTCDay() + 6) % 7;
  return new Date(noon.getTime() - mondayOffset * dayMs).toISOString().slice(0, 10);
}
```

(`dayMs` ya existe en el fichero; si se declara más abajo, mover la función después de su declaración.)

`deriveSessionStatus`: input añade `weeklyClassesBooked?: number;`. Tras `if (booked) return …`:

```ts
  if (
    input.program.discipline !== "open-mat" &&
    input.member.weeklyClassLimit !== null &&
    (input.weeklyClassesBooked ?? 0) >= input.member.weeklyClassLimit
  ) {
    return Object.freeze({ status: "locked", lockedReason: "weekly_limit" });
  }
```

y la condición de bookable: `if (!bookable || input.session.capacity === null) return Object.freeze({ status: "closed" });`.

`lockedReasonLabel`: antes del `return` final `if (reason === "weekly_limit") return "Weekly class limit reached";`.

Run → PASS.

- [ ] **Step 3: Repositorios y calendario**

`calendar-repository.ts`: `CalendarParticipant` añade `weeklyClassLimit: WeeklyClassLimit;` (import de `@bpt-jersey/domain/memberships`).

`firebase-calendar-repository.ts`:

```ts
function participantFromPlan(
  studentId: string,
  membershipId: string,
  planId: string,
  name: string,
  dateOfBirth: string | undefined,
): CalendarParticipant | undefined {
  const plan = PLAN_CATALOG.find((candidate) => candidate.planId === planId);
  if (!plan) return undefined;
  // A plan open to several bands (Town Kids & Teens) needs the member's own band.
  const band = dateOfBirth === undefined ? undefined : participantBand(dateOfBirth);
  const participantType =
    band !== undefined && plan.eligibleParticipantTypes.includes(band)
      ? band
      : plan.eligibleParticipantTypes[0];
  if (!participantType) return undefined;
  return {
    studentId,
    firstName: firstName(name),
    membershipId,
    planId: plan.planId,
    participantType,
    planClassSites: plan.classSites,
    planOpenMatSites: plan.openMatSites,
    weeklyClassLimit: plan.weeklyClassLimit,
  };
}
```

En `loadMember`, junto a `names` crear `const births = new Map<string, string>();`, llenarla con `births.set(student.studentId, student.dateOfBirth)` en el bucle de la familia y pasar `births.get(membership.studentId)` como último argumento.

`firebase-calendar-repository.test.ts`: añadir caso — familia con un alumno `dateOfBirth` de 13 años y membresía `town-kids-2x` ⇒ `participantType: "teens"`, `weeklyClassLimit: 3` (seguir el patrón de mocks del fichero para `getFamily`/`listClientMemberships`).

`fixture-calendar-repository.ts`: añadir `weeklyClassLimit` a cada participante fixture (valores coherentes con su plan: `null` para adultos Town, `2` para West, `3` para Town kids).

`member-calendar.tsx`:

```ts
  const loadFrom = days[0] ? weekRangeFor(jerseyWeekKey(days[0].startAt), calendarTimeZone) : undefined;
  const lastDay = days[days.length - 1];
  const loadTo = lastDay ? weekRangeFor(jerseyWeekKey(lastDay.startAt), calendarTimeZone) : undefined;
  // Whole Monday–Sunday weeks, so the weekly class count is right even when a phone shows two days.
  const rangeFrom = loadFrom?.ok ? loadFrom.value.from : "";
  const rangeTo = loadTo?.ok ? loadTo.value.to : "";
```

(`calendarTimeZone` se exporta de `member-calendar-contracts`; si no, usar `"Europe/Jersey"`.) En `entriesByDay`, `memberContext` añade `weeklyClassLimit: participant.weeklyClassLimit,` y antes del bucle:

```ts
    const classesBookedByWeek = new Map<string, number>();
    for (const row of selectedWeek.sessions) {
      const rowProgram = programs.get(row.programId);
      if (row.status === "cancelled" || !bookings.has(row.sessionId) || !rowProgram) continue;
      if (rowProgram.discipline === "open-mat") continue;
      const key = jerseyWeekKey(row.startAt);
      classesBookedByWeek.set(key, (classesBookedByWeek.get(key) ?? 0) + 1);
    }
```

y en `deriveSessionStatus({...})` añadir `weeklyClassesBooked: classesBookedByWeek.get(jerseyWeekKey(sessionRecord.startAt)) ?? 0,`.

- [ ] **Step 4: Mensajes de rechazo (test primero)**

`booking-messages.test.ts`:

```ts
  it.each([
    ["weekly-limit", "You've used this week's classes on your plan."],
    ["capacity-not-set", "This session isn't open for booking yet."],
  ])("explains the %s refusal", (reason, text) => {
    expect(
      bookingFailureMessage({ code: "functions/failed-precondition", details: { reason } }),
    ).toBe(text);
  });
```

Run → FAIL. En `bookingFailureMessage`, antes del caso `ineligible`:

```ts
  if (code === "functions/failed-precondition" && reason === "weekly-limit") {
    return "You've used this week's classes on your plan.";
  }
  if (code === "functions/failed-precondition" && reason === "capacity-not-set") {
    return "This session isn't open for booking yet.";
  }
```

En `account/classes/page.tsx` `bookingFailure`, mismo par de ramas devolviendo `{ text: <misma cadena>, waitlist: false }`; test equivalente en `account/classes/page.test.tsx` siguiendo el caso existente de `"capacity"`.

- [ ] **Step 5: Verde y commit**

Run: `corepack pnpm vitest run --project node packages/domain/src/schedule && corepack pnpm vitest run --project web apps/web/src/lib/calendar apps/web/src/app/account`
Expected: PASS (ajustar fixtures de `CalendarParticipant`/`CalendarMemberContext` que el typecheck marque por el campo nuevo).

```bash
git add packages/domain/src/schedule apps/web/src/lib/calendar apps/web/src/app/account
git commit -m "feat(account): calendar shows the weekly class limit and uncapped sessions as closed (T050V2)"
```

---

### Task 8: Público — landing y `/enrol` con la lista de planes

**Files:**
- Create: `apps/web/src/app/plan-price-list.tsx`, `apps/web/src/app/plan-price-list.test.tsx`
- Modify: `apps/web/src/content/academy.ts:9-13, 155-171`, `apps/web/src/content/academy.test.ts:141`
- Modify: `apps/web/src/app/page.tsx:143-156`
- Modify: `apps/web/src/app/enrol/page.tsx:597-611`, `apps/web/src/app/enrol/page.test.tsx`
- Modify: `apps/web/src/app/globals.css:558-624, 805-815`
- Modify: `qa/tests/public-home.spec.ts:53-56`

**Interfaces:**
- Consumes: `publicPlanGroups`, `formatPlanPrice`, `describePlanAccess` (Task 4).
- Produces: `PlanPriceList({ site?: Site }): ReactElement`.

- [ ] **Step 1: Test del componente (fallará)**

`apps/web/src/app/plan-price-list.test.tsx`:

```tsx
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PlanPriceList } from "./plan-price-list";

describe("PlanPriceList", () => {
  afterEach(cleanup);

  it("lists every live plan grouped by site with its price", () => {
    render(<PlanPriceList />);
    const town = screen.getByRole("region", { name: "BPT Town" });
    expect(within(town).getByText("Town Kids & Teens 3x")).toBeInTheDocument();
    expect(within(town).getByText("£135 per term")).toBeInTheDocument();
    expect(screen.getByText("£7.50 per class")).toBeInTheDocument();
    expect(screen.queryByText("Town Teens")).not.toBeInTheDocument();
  });

  it("shows only plans that train at the chosen site", () => {
    render(<PlanPriceList site="West" />);
    expect(screen.getByText("£65 per month")).toBeInTheDocument();
    expect(screen.getByText("£125 per month")).toBeInTheDocument();
    expect(screen.queryByText("£85 per month")).not.toBeInTheDocument();
  });
});
```

Run: `corepack pnpm vitest run --project web apps/web/src/app/plan-price-list.test.tsx` → FAIL.

- [ ] **Step 2: Componente**

`apps/web/src/app/plan-price-list.tsx`:

```tsx
import type { Site } from "@bpt-jersey/domain/memberships";
import type { ReactElement } from "react";

import { describePlanAccess, formatPlanPrice, publicPlanGroups } from "../lib/plan-copy";

export function PlanPriceList({ site }: Readonly<{ site?: Site }>): ReactElement {
  return (
    <div className="plan-price-list">
      {publicPlanGroups(site).map((group) => {
        const headingId = `plans-${group.title.replace(/\W+/gu, "-").toLowerCase()}`;
        return (
          <section aria-labelledby={headingId} key={group.title}>
            <h3 id={headingId}>{group.title}</h3>
            <ul>
              {group.plans.map((plan) => (
                <li className="plan-price-row" key={plan.planId}>
                  <div>
                    <strong>{plan.displayName}</strong>
                    <span>{describePlanAccess(plan)}</span>
                  </div>
                  <p className="plan-price-amount">{formatPlanPrice(plan)}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
```

Run → PASS.

- [ ] **Step 3: Landing**

`academy.ts`: borrar el tipo `FeeItem` y la clave `fees`. `academy.test.ts`: borrar la aserción de `fees`. `page.tsx`: sustituir el `<ul className="fee-list fee-grid">…</ul>` por `<PlanPriceList />` (import `./plan-price-list`); mantener `<h2 id="fees-title">Simple ways to train</h2>`.

`globals.css`: borrar las reglas `.fee-list`, `.fee-list.fee-grid`, `.fee-card*`, `.fee-amount` (quitar solo los selectores `fee-*` de las reglas compartidas con `.program-*`, incluidas las de la media query ~810) y añadir:

```css
.plan-price-list {
  display: grid;
  gap: 2.5rem;
  margin: 3rem 0 0;
}

.plan-price-list h3 {
  color: var(--bpt-purple);
  font-family: var(--font-display), Impact, sans-serif;
  font-size: 1.45rem;
  letter-spacing: 0.035em;
  line-height: 1;
  margin: 0 0 0.75rem;
  text-transform: uppercase;
}

.plan-price-list ul {
  border-top: 2px solid var(--mat-ink);
  list-style: none;
  margin: 0;
  padding: 0;
}

.plan-price-row {
  align-items: baseline;
  border-bottom: 1px solid var(--line);
  display: grid;
  gap: 0.25rem 1.5rem;
  grid-template-columns: minmax(0, 1fr) auto;
  padding: 1rem 0;
}

.plan-price-row span {
  color: var(--muted);
  display: block;
}

.plan-price-row .plan-price-amount {
  color: var(--mat-ink);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  margin: 0;
  text-align: right;
  white-space: nowrap;
}

@media (max-width: 42rem) {
  .plan-price-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .plan-price-row .plan-price-amount {
    text-align: left;
  }
}
```

(Verificar con `grep -n "\-\-bpt-purple\|\-\-mat-ink\|\-\-line\|\-\-muted" apps/web/src/app/globals.css` que las variables existen con esos nombres.)

- [ ] **Step 4: `/enrol` (test primero)**

En `enrol/page.test.tsx`, siguiendo el render existente:

```tsx
  it("shows the plans of the chosen training centre without selling one", async () => {
    // render as the existing tests do
    fireEvent.change(screen.getByLabelText("Training centre"), { target: { value: "West" } });
    const plans = screen.getByRole("region", { name: "Plans at West" });
    expect(within(plans).getByText("£65 per month")).toBeInTheDocument();
    expect(within(plans).queryByText("£85 per month")).not.toBeInTheDocument();
    expect(within(plans).queryByRole("button")).not.toBeInTheDocument();
  });
```

(Si hay dos "Training centre" — solicitante y menor — usar `document.getElementById("enrol-center")`.) Run → FAIL.

En `enrol/page.tsx`, inmediatamente después del `</label>` del select `enrol-center`:

```tsx
            <section aria-labelledby="enrol-plans-title" className="enrol-plans">
              <h2 className="enrol-plans-title" id="enrol-plans-title">
                Plans at {form.trainingCenter}
              </h2>
              <PlanPriceList site={form.trainingCenter} />
            </section>
```

(ajustar el nivel `h2`/`h3` al del resto de secciones del formulario para no saltar niveles; import `../plan-price-list`). CSS:

```css
.enrol-plans {
  grid-column: 1 / -1;
}

.enrol-plans .plan-price-list {
  margin-top: 1rem;
}
```

Run → PASS.

- [ ] **Step 5: E2E público**

`qa/tests/public-home.spec.ts` líneas 53-56:

```ts
    const feesSection = page.locator("#fees");
    await expect(feesSection.getByText("£125 per month", { exact: true })).toBeVisible();
    await expect(feesSection.getByText("£135 per term", { exact: true })).toBeVisible();
    await expect(feesSection.getByText("£7.50 per class", { exact: true })).toBeVisible();
    await expect(feesSection.getByText("Town Teens", { exact: true })).toHaveCount(0);
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app apps/web/src/content qa/tests/public-home.spec.ts
git commit -m "feat(public): plans and prices from the catalogue on the home page and enrolment (T050V2)"
```

---

### Task 9: E2E de servidor contra emuladores

**Files:**
- Modify: `qa/tests/schedule-auth-emulator.spec.ts` (nuevo `test` dentro de `test.describe("T096 …")`)

**Interfaces:**
- Consumes: helpers `signIn`, `call`, `ok`, `denied`, `enrolAdult`, `sessionInput`, `hour` del mismo fichero; códigos `weekly-limit`, `ineligible`.

- [ ] **Step 1: Escribir el test**

Añadir tras el test de `selfCheckIn`:

```ts
  test("enforces capacity, the weekly class limit and open-mat sites for West Adult @critical", async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const monday = (iso: string) => {
      const day = new Date(iso);
      const offset = (day.getUTCDay() + 6) % 7;
      return new Date(day.getTime() - offset * 24 * hour).toISOString().slice(0, 10);
    };
    const starts = [4, 5, 6, 7, 8].map((hours) => new Date(Date.now() + hours * hour).toISOString());
    test.skip(new Set(starts.map(monday)).size !== 1, "sessions would straddle a week boundary");

    const owner = await signIn(request, process.env.T096_OWNER_EMAIL);
    const adult = await signIn(request, process.env.T096_ADULT_EMAIL);
    const suffix = randomUUID().replace(/-/gu, "").slice(0, 8).toLowerCase();
    const { studentId } = await enrolAdult(request, owner, adult, suffix);

    // Switch the synthetic adult to West Adult (2 classes a week, open mats at Town only).
    const westAdult = {
      planId: "west-adult",
      displayName: "West Adult",
      priceMinor: 6_500,
      currency: "GBP",
      billingPeriod: "monthly",
      eligibleParticipantTypes: ["adult"],
      classSites: ["West"],
      weeklyClassLimit: 2,
      openMatSites: ["Town"],
      openMatFeeMinor: null,
    };
    await ok(request, "savePlan", westAdult, owner);
    const activation = await call(request, "activatePlan", { planId: "west-adult" }, { session: owner });
    expect([200, 400], JSON.stringify(activation.body)).toContain(activation.status);
    const { membershipId } = await ok<{ membershipId: string }>(
      request,
      "createMembership",
      { studentId, planId: "west-adult", status: "active" },
      owner,
    );

    const program = async (name: string, discipline: string) =>
      (
        await ok<{ program: { programId: string } }>(
          request,
          "saveProgram",
          { name: `${name} ${suffix}`, ageBand: "adult", discipline, level: "all-levels" },
          owner,
        )
      ).program.programId;
    const classes = await program("T050 Adults", "bjj");
    const openMat = await program("T050 Open Mat", "open-mat");

    // Capacity is mandatory.
    await denied(
      request,
      "saveSession",
      { ...sessionInput(classes, owner.uid, "west", 4 * hour, `T050 Uncapped ${suffix}`), capacity: null },
      owner,
      400,
      "INVALID_ARGUMENT",
    );

    const save = async (programId: string, site: "town" | "west", offsetHours: number, title: string) =>
      (
        await ok<{ session: { sessionId: string } }>(
          request,
          "saveSession",
          sessionInput(programId, owner.uid, site, offsetHours * hour, `${title} ${suffix}`),
          owner,
        )
      ).session.sessionId;
    const townOpenMat = await save(openMat, "town", 4, "T050 Town open mat");
    const class1 = await save(classes, "west", 5, "T050 West 1");
    const class2 = await save(classes, "west", 6, "T050 West 2");
    const class3 = await save(classes, "west", 7, "T050 West 3");
    const westOpenMat = await save(openMat, "west", 8, "T050 West open mat");

    const book = (sessionId: string) =>
      call(request, "requestBooking", { sessionId, studentId, membershipId }, { session: adult });

    expect((await book(townOpenMat)).status).toBe(200);
    expect((await book(class1)).status).toBe(200);
    expect((await book(class2)).status).toBe(200);
    const limited = await book(class3);
    expect(limited.status).toBe(400);
    expect(limited.body.error?.details?.reason).toBe("weekly-limit");
    const refusedOpenMat = await book(westOpenMat);
    expect(refusedOpenMat.body.error?.details?.reason).toBe("ineligible");
  });
```

(Si el status HTTP de `failed-precondition` en este emulador no es 400, usar el que devuelvan los `denied(... "FAILED_PRECONDITION")` existentes del fichero.)

- [ ] **Step 2: Ejecutar contra emuladores**

Seguir memoria `vps-emulators-docker-sparse`: construir dominio y functions, arrancar emuladores en `bpt-emu:local`, exportar las variables `T096_*` como en la ejecución de T096, luego:

Run: `corepack pnpm --dir qa exec playwright test tests/schedule-auth-emulator.spec.ts --project desktop-chromium`
Expected: 4/4 PASS (los 3 existentes + el nuevo). Guardar la salida para el ledger.

- [ ] **Step 3: Commit**

```bash
git add qa/tests/schedule-auth-emulator.spec.ts
git commit -m "test(e2e): capacity, weekly limit and open-mat sites against the emulators (T050V2)"
```

---

### Task 10: Pasadas de calidad, verificación visual, ledger

**Files:**
- Modify: `tasksv2.md` (nueva fila T050V2 bajo T049V2, sin Prettier)
- Modify: `docs/superpowers/specs/2026-09-16-regyfit-classes-services-clone-design.md` (nota en decisiones 7 y 15)
- Create: capturas `qa/screenshots/t050-*.png`

- [ ] **Step 1: Integrar main** — `git fetch origin && git merge origin/main`; resolver conflictos; `corepack pnpm typecheck && corepack pnpm test` → PASS.

- [ ] **Step 2: `/ponytail-review`** sobre `git diff main...HEAD`. Aplicar solo recortes que no quiten validación, seguridad ni accesibilidad. Re-ejecutar tests afectados.

- [ ] **Step 3: Crítica de UI** con `/impeccable` (modo critique/audit) y `/taste-skill` contra `DESIGN.md` sobre: panel de sesión, lista/calendario de clases, editor de planes, `/account/membership`, calendario del socio (tarjeta locked), landing `#fees`, `/enrol`. Checklist obligatoria: radio 0 (salvo `/account`), sin azul/degradados/emojis/pills/spinners, estado = texto + regla izquierda, foco 3px púrpura visible, objetivos ≥44px, sin scroll horizontal a 360px, `tabular-nums` en precios, `prefers-reduced-motion`. Solo si hay hallazgos de composición usar `/redesign-skill`. Corregir y commitear (`fix(ui): …`).

- [ ] **Step 4: Seguridad** con `/security-best-practices` y `/frontend-security-coder` sobre el diff: autoridad solo en servidor (la reserva relee plan/sesión/uso en transacción), parsers en callables, ningún error crudo al usuario, sin `dangerouslySetInnerHTML`, sin datos personales en la landing. Corregir hallazgos con test.

- [ ] **Step 5: Gate completo**

```bash
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm --filter @bpt-jersey/web build
corepack pnpm test:e2e:smoke
```

`test:rules` y `test:integration` dentro del contenedor `bpt-emu:local` (sin Java en el host). Expected: todo PASS; anotar conteos.

- [ ] **Step 6: Playwright visual** (MCP Playwright o spec) sobre el build estático con `NEXT_PUBLIC_ADMIN_E2E=true`, escritorio 1440px y móvil 390px: capturas `qa/screenshots/t050-home-fees.png`, `t050-enrol-plans.png`, `t050-admin-session-capacity.png`, `t050-admin-plan-drift.png` y sus `-phone`. Verificar a ojo: "£135 per term" visible, `Town Teens` ausente, error de aforo visible con regla roja, banda ámbar "Differs from catalogue".

- [ ] **Step 7: Ledger y nota de spec**

Fila en `tasksv2.md` debajo de T049V2:

```
| T050V2 | Planes y precios reales (11 planes, trimestre, 3x, `town-teens` retirado, `west-teens-payg`), aforo obligatorio en sesiones y copy week, límite semanal solo clases, precios públicos desde el catálogo | T046V2 | revision | Spec `docs/superpowers/specs/2026-09-17-plans-pricing-capacity-design.md`, plan `docs/superpowers/plans/2026-09-17-plans-pricing-capacity.md`, rama `feature/plans-pricing-capacity`. Evidencia: <conteos reales de format/lint/typecheck/test/build/smoke/rules/integration>, `schedule-auth-emulator.spec.ts` <n/n>, guardias desactivadas ⇒ rojo (copy week, open mat en cupo, aforo legado), capturas `qa/screenshots/t050-*`. **Pendiente operador:** revisar en `/admin/memberships` cada plan marcado "Differs from catalogue" y guardar; asignar aforo a sesiones "Set capacity"; desplegar functions + web solo con confirmación. |
```

(sustituir los `<…>` por los números reales obtenidos; no dejar marcadores.)

En `2026-09-16-regyfit-classes-services-clone-design.md`, bajo las decisiones 7 y 15, añadir: `> Nota 2026-09-17 (T050V2): el catálogo real de precios, límites (1/2/3), trimestre, open mats por sede y aforo obligatorio ya están en PLAN_CATALOG y en la reserva; T047V2 debe migrar estas reglas a planes dinámicos, no sustituirlas por los nombres de Regyfit sin revisar.`

- [ ] **Step 8: Commit final**

```bash
git add tasksv2.md docs/superpowers/specs/2026-09-16-regyfit-classes-services-clone-design.md qa/screenshots
git commit -m "docs(tasks): T050V2 evidence and T047V2 migration note"
```

Luego `superpowers:finishing-a-development-branch`. No hacer push ni desplegar sin confirmación del operador.
