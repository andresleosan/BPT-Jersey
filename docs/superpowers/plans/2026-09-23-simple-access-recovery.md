# Registro de miembros nuevos + waiver — Plan de implementación

> **Cambio de alcance 2026-09-23:** Fases 2 y 3 (recuperación) CANCELADAS por Luis. Se ejecutan Task 0–3
> (Task 3 sin el matcher: solo waiver D12), la nueva Task 3b (retirar la recuperación de la interfaz),
> Task 11 (regresión R1–R7 + visual) y Task 12 (publicación con OK).

> **Para quien ejecute:** ejecución **nativa en la sesión** (decisión D10: sin subagentes ni agentes
> en shells). Usar `superpowers:executing-plans`. Los pasos usan casillas (`- [ ]`).

**Goal:** Un socio antiguo recupera su cuenta con nombre + fecha de nacimiento, rellena solo lo que
falta (centro, horario, nivel, suscripción o pago, hijos, waiver) y reserva sin esperar; los
miembros nuevos se registran sin verificar el email; nadie reserva sin haber aceptado el waiver.

**Architecture:** La coincidencia es una función pura del dominio (`recovery-matching.ts`) que agrupa
las tres fuentes (Regyfit, directorio legado, `students`) por persona. El servicio de recuperación
existente (`member-recovery-service.ts`) conserva su escritor transaccional `writeLink` pero cambia
sus dos puertas: el ticket guarda la coincidencia automática (sin aprobación previa) y no se exige
email verificado. La suscripción reutiliza `previously-paid` y las solicitudes de plan por
transferencia; el waiver reutiliza `enrolmentWaiverAcceptances`. La web sustituye el formulario
`/login/recover` por un asistente por pasos.

**Tech Stack:** Next.js 16 (export estático) + React 19, Firebase Functions v2 (europe-west9),
Firestore, Firebase Auth, zod, Vitest, Playwright 1.61 contra emuladores (`demo-bpt-jersey`,
JDK 21 en `/tmp/bpt-recovery-jdk21`).

**Spec:** `docs/superpowers/specs/2026-09-23-simple-access-recovery-design.md` (D1–D13).

## Global Constraints

- Interfaz en inglés UK; copias cortas y honestas; sin "Elevate/Seamless" (DESIGN.md §8).
- DESIGN.md: radio 0 fuera de `/account` (1rem dentro), BPT Purple `#2F2483` único acento, estados =
  texto + regla izquierda, botones `min-height 3.15rem`, sin spinners (esqueletos), etiqueta sobre el input.
- `packages/domain` nunca importa Firebase. Nuevas rutas de contrato → `exports` de su `package.json`.
- Todo callable nuevo se reexporta en `apps/functions/src/index.ts` y usa la región global (europe-west9).
- ADR-018: ningún proceso reserva clases por el miembro. Cancelar reservas futuras al rechazar un
  pago (D9) sí está permitido (no crea reservas).
- Pruebas solo contra emuladores `demo-bpt-jersey`, datos sintéticos `@example.test`; nunca producción.
- Commits: locales en `main` al cerrar cada fase con sus reglas en verde; **push y deploy solo con
  el OK explícito de Luis** (CLAUDE.md: nunca desplegar sin confirmación en el chat).
- Deploy de functions: nunca `--only functions` sin filtro; usar
  `corepack pnpm exec firebase deploy --project bptjersey-f5a25 --force --only functions:<nombres>`
  tras hacer push (el guard exige HEAD == origin/main).
- Durante la recuperación nunca se muestra al solicitante un dato del archivo que no haya escrito él,
  salvo el email enmascarado (D7) tras una coincidencia única.

## Review Focus

1. **Una persona en varias fuentes** (archivo Regyfit + legado + `students` migrado) debe contar como
   **una** coincidencia, no como "varias" → si no, casi todos acabarían en la cola del owner. Test en Task 3.
2. **Registro del archivo sin fecha de nacimiento**: no puede coincidir automáticamente; debe ir a la
   cola del owner, nunca a "Register as a new member". Test en Task 3.
3. **Email que ya tiene cuenta** (se registró como nuevo antes): "Sign in to link it" y enlazar esa
   cuenta, sin crear una segunda. Test en Task 9.
4. **Dos socios con el mismo nombre y la misma fecha** (hermanos gemelos): ambigüedad → cola del owner. Test en Task 3.
5. **Tickets creados antes del despliegue** (formato viejo): siguen apareciendo y aprobándose en la cola. Test en Task 7.

## Reglas de aceptación (D10)

Cada regla es un test que falla antes y pasa después. La fase se cierra solo con todas en verde.
E2E = `qa/tests/recovery-*.spec.ts` / `enrol-*.spec.ts` contra el stack local (Task 0).

| Regla | Qué comprueba | Decisión | Tipo | Task |
|---|---|---|---|---|
| R1 | `/enrol` adulto con plan prepagado: envía transferencia sin verificar email; owner aprueba; el adulto entra a `/account` y reserva. | D8, D13 | E2E | 1, 2 |
| R2 | `/enrol` tutor con **2 hijos** en planes distintos: total correcto, un justificante, owner aprueba, el tutor ve a los dos hijos y reserva para cada uno. | D8, D13 | E2E | 1, 2 |
| R3 | `/enrol` pay-as-you-go y trial: se envía sin justificante; owner aprueba. | D13 | E2E | 1 |
| R4 | `/enrol`: quitar un hijo, volver atrás y cambiar plan no deja importes ni hijos fantasma. | bugs | E2E | 1 |
| R5 | `/enrol` exige marcar el waiver antes de enviar; la aprobación escribe `enrolmentWaiverAcceptances`. | D12 | E2E+unit | 3 |
| R6 | Miembro sin waiver al iniciar sesión → pantalla bloqueante; no ve el calendario hasta marcar la casilla y aceptar. | D12 | E2E | 3 |
| R7 | `requestBooking` del propio miembro sin waiver → `failed-precondition` "Accept the academy terms first"; con waiver → OK; reserva hecha por el owner → OK. | D12 | unit | 3 |
| R8 | Matcher: nombre con tildes/orden/segundo nombre ausente/1–2 errores + fecha exacta = única coincidencia; persona en 3 fuentes = 1; gemelos = ambigua; sin fecha en archivo = revisión; nada parecido = none. | D3 | unit | 3 |
| R9 | Recuperación adulto (coincidencia única, email antiguo + contraseña nueva): entra a `/account` sin verificar email y sin aprobación; ve su historial. | D1, D2, D7, D8 | E2E | 4–9 |
| R10 | Recuperación con **email nuevo** (escrito dos veces; no coinciden → error inline) y con **Google** (emulador) sin contraseña. | D7 | E2E | 9 |
| R11 | Nombre sin parecido → aviso + botón **Register as a new member** que abre `/enrol`. | D3 | E2E | 9 |
| R12 | Fecha distinta o varias coincidencias → "The office will check your details"; aparece en la cola del owner con candidatos; owner aprueba; el socio entra. | D3 | E2E | 7, 9 |
| R13 | Archivo con periodo vigente → suscripción creada sola (`previously-paid`, sin factura) y puede reservar. | D4 | E2E+unit | 5 |
| R14 | "Tengo suscripción" sin respaldo → solicitud "claimed-paid" pendiente; calendario dice que la oficina lo está comprobando; no reserva; owner confirma → reserva. | D4 | E2E | 5, 7 |
| R15 | Sin suscripción → elige plan + transferencia → reserva **al momento** (provisional); owner rechaza → membresía cortada y reservas futuras canceladas. | D4, D9 | E2E+unit | 5, 7 |
| R16 | Nivel del archivo preseleccionado; si el socio lo cambia, el owner ve "Archive said X, declared Y". | D6 | E2E | 6, 7 |
| R17 | Owner: **Recovered – to confirm** lista nombre, cinturón/progreso, email; **Confirm** lo quita de la lista; **Undo** retira el acceso (el socio vuelve a ver la recuperación al iniciar sesión). | D2 | E2E | 7 |
| R18 | La recuperación exige aceptar el waiver antes de terminar. | D12 | E2E | 9 |
| R19 | Menor de 18 intentando recuperar solo → "Ask your parent or guardian to recover your account". | defecto | E2E | 9 |
| R20 | Tutor "Me and my children": hijo encontrado queda enlazado (aparece en su `/account`); hijo no encontrado → botón a `/enrol` con el tutor precargado. | D5 | E2E | 10 |
| R21 | Tutor "Only my children" sin registro propio → cuenta de tutor, ve y reserva por sus hijos. | D5 | E2E | 10 |
| R22 | Más de 10 intentos por IP en 15 min → "Too many attempts". | defecto | unit | 4 |
| R23 | Cola del owner: **Approve recovery** deshabilitado explica por qué ("Select the member record first") y la búsqueda encuentra por nombre parecido, email o nº de socio. | captura | E2E | 7 |
| R24 | Recorrido visual: capturas desktop + móvil de cada paso sin desbordes ni textos cortados (revisión impeccable/taste). | D11 | E2E | 11 |

---

## Fase 0 — Banco de pruebas local

### Task 0: Stack local completo para Playwright

**Files:**
- Create: `qa/scripts/run-recovery-stack.mjs` (arranca emuladores + siembra + `next dev`)
- Create: `qa/scripts/seed-recovery-emulator.mjs` (owner, directorio vacío, niveles, catálogo de
  planes, waiver actual, 6 registros Regyfit sintéticos, 1 alumno migrado, cuentas de prueba)
- Create: `qa/tests/recovery-fixture.ts` (inyecta `X-Firebase-AppCheck` sin firmar vía `page.route`
  hacia `127.0.0.1:5001`; helpers `signInAs`, `ownerPage`)
- Create: `qa/tests/recovery-stack-smoke.spec.ts`

**Interfaces:**
- Produces: `startRecoveryStack(): Promise<{ baseURL: string; stop(): Promise<void> }>`; fixture
  `test` extendido con `owner` (Page con sesión de owner) y `seed` (ids sintéticos: `archive.adultActive`,
  `archive.adultNoDob`, `archive.twinA/twinB`, `archive.child`, `student.migrated`).

- [ ] **Step 1:** Escribir `recovery-stack-smoke.spec.ts`: abre `/`, `/enrol`, `/login/recover`;
  el owner inicia sesión y ve `/admin/members/requests`.
- [ ] **Step 2:** Ejecutar y ver que falla (no hay stack):
  `node qa/scripts/run-recovery-stack.mjs -- corepack pnpm --dir qa exec playwright test tests/recovery-stack-smoke.spec.ts --project=desktop-chromium --workers=1`
- [ ] **Step 3:** Implementar el runner: `JAVA_HOME=/tmp/bpt-recovery-jdk21`,
  `FUNCTIONS_DISCOVERY_TIMEOUT=300000`, `node apps/functions/scripts/build-deploy-artifact.mjs`,
  escribir `.firebase-functions/.secret.local` con secretos sintéticos (base64url 32 B distintos),
  `firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions`, dentro:
  sembrar y lanzar `next dev -p 3100 -H 127.0.0.1` con `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true`,
  `NEXT_PUBLIC_FIREBASE_ENV=local`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-bpt-jersey`.
- [ ] **Step 4:** Implementar el fixture: token App Check = JWT `alg:none` con
  `{ sub: <appId>, aud: ["projects/demo-bpt-jersey"], exp: now+3600 }` añadido como cabecera en cada
  petición a `:5001` (el emulador decodifica sin verificar, ver `docs/development/firebase-emulators.md`).
- [ ] **Step 5:** Re-ejecutar → PASS. Guardar el comando exacto en `qa/README.md` (sección nueva
  "Recovery stack").

## Fase 1 — Registro y waiver (se publica sola)

### Task 1: Caza de bugs en `/enrol` (R1–R4)

**Files:**
- Create: `qa/tests/enrol-flows.spec.ts`
- Modify (según fallos): `apps/web/src/app/enrol/page.tsx`, `plan-choices.tsx`,
  `apps/functions/src/members/enrolment-request-service.ts`, `enrolment-approval-service.ts`

- [ ] **Step 1:** Escribir R1–R4 como specs. Cada spec recorre **todos** los botones del paso
  (Add a child, Remove child N, Back to plans, Continue, subir justificante PNG, Send request) y
  después la aprobación del owner en `/admin/members/requests`, y termina con una reserva en `/account`.
- [ ] **Step 2:** Ejecutar; anotar cada fallo en `docs/reviews/2026-09-23-enrol-bugs.md` (síntoma,
  paso, causa).
- [ ] **Step 3:** Por cada fallo: test unitario mínimo que lo reproduce junto al código → arreglo →
  test verde → re-ejecutar la spec.
- [ ] **Step 4:** R1–R4 en verde (R1/R2 dependen de Task 2 para la parte de email; hasta entonces
  la spec usa el botón de oficina "verify account email" y se marca `test.fixme` esa línea).

### Task 2: Sin verificación de email en `/enrol` (D8)

**Files:**
- Modify: `apps/functions/src/members/enrolment-request-callables.ts` (al enviar la solicitud:
  `auth.updateUser(uid, { emailVerified: true })` para cuentas de cliente con rol `shopper|guardian|adultStudent`)
- Modify: `apps/functions/src/members/enrolment-approval-service.ts:185` (quitar el precondition
  `applicant_email_unverified`)
- Modify: `apps/web/src/app/enrol/page.tsx` (quitar el bloqueo `emailVerified !== true` de la línea
  ~546 y el aviso de la línea ~728; campo **Confirm email** que debe coincidir)
- Test: `apps/functions/src/members/enrolment-approval-service.test.ts`, `apps/web/src/app/enrol/page.test.tsx`

- [ ] **Step 1:** Unit: aprobar una solicitud cuya cuenta tiene `emailVerified:false` → aprobada.
- [ ] **Step 2:** Unit web: "Confirm email" distinto → "The email addresses do not match."; sin paso de verificación.
- [ ] **Step 3:** Implementar; tests verdes; retirar el `fixme` de R1/R2 y dejarlas en verde.

### Task 3: Waiver obligatorio (D12) + matcher del dominio (R5–R8)

**Files:**
- Create: `apps/functions/src/consents/enrolment-waiver-acceptance.ts` —
  `hasAcceptedEnrolmentWaiver(tx, db, academyId, studentId): Promise<boolean>` (lee
  `enrolmentWaiverAcceptances/{studentId}__{version}`)
- Modify: `apps/functions/src/members/enrolment-approval-service.ts` (al aprobar, crear los
  documentos de aceptación de cada alumno con la versión/hash de la solicitud)
- Modify: `apps/functions/src/schedule/booking-transaction-service.ts` (en `executeBookingInTransaction`,
  si el actor es el miembro/tutor y no hay aceptación → `invalid("ineligible", "Accept the academy terms first")`)
- Create: `qa/scripts/backfill-enrolment-waiver-acceptances.mjs` (dry-run por defecto; para las
  solicitudes ya aprobadas con versión vigente — lo ejecuta Luis en producción)
- Modify: `apps/web/src/app/account/waiver-acceptance.tsx` → pantalla bloqueante: si `pending` no
  está vacío, el layout de `/account` muestra solo el waiver, la casilla
  "I have read and accept the terms" y **Accept and continue**
- Create: `packages/domain/src/members/recovery-matching.ts` (+ export `@bpt-jersey/domain/members/recovery-matching`)
- Test: `packages/domain/src/members/recovery-matching.test.ts`, `booking-transaction-service.test.ts`,
  `qa/tests/waiver-gate.spec.ts`

**Interfaces (Produces):**
```ts
export type RecoveryPersonSource = Readonly<{
  personId: string;          // studentId canónico si existe; si no `archive:<recordId>` / `legacy:<memberId>`
  fullName: string; birthDate?: string; email?: string;
}>;
export type RecoveryMatch =
  | { kind: "unique"; personId: string }
  | { kind: "review"; personIds: readonly string[] }   // varias, fecha distinta, sin fecha o email
  | { kind: "none" };
export function namesLookAlike(a: string, b: string): boolean;
export function matchRecoveryPerson(
  input: Readonly<{ fullName: string; dateOfBirth: string; email?: string }>,
  sources: readonly RecoveryPersonSource[],
): RecoveryMatch;
```

- [ ] **Step 1: tests del matcher (R8)**
```ts
import { describe, expect, it } from "vitest";
import { matchRecoveryPerson, namesLookAlike } from "./recovery-matching";

const s = (personId: string, fullName: string, birthDate?: string, email?: string) =>
  ({ personId, fullName, ...(birthDate ? { birthDate } : {}), ...(email ? { email } : {}) });

describe("namesLookAlike", () => {
  it.each([
    ["José Pérez", "jose perez"],
    ["Perez Jose", "José Pérez"],
    ["Maria Gonzalez", "María José González Ruiz"],
    ["Jonathan Smith", "Jonathon Smith"],
    ["Jon Smyth", "John Smith"],
  ])("%s ~ %s", (a, b) => expect(namesLookAlike(a, b)).toBe(true));
  it.each([
    ["Anna", "Anna Smith"],          // un solo nombre no basta
    ["John Smith", "Joan Smithers"],
    ["Ana Lopez", "Luis Martinez"],
  ])("%s !~ %s", (a, b) => expect(namesLookAlike(a, b)).toBe(false));
});

describe("matchRecoveryPerson", () => {
  const input = { fullName: "Jose Perez", dateOfBirth: "1991-05-14" };
  it("groups one person found in three sources", () => {
    expect(matchRecoveryPerson(input, [
      s("stu-1", "José Pérez", "1991-05-14"), s("stu-1", "Jose Perez Ruiz", "1991-05-14"),
      s("stu-1", "JOSE PEREZ", "1991-05-14"),
    ])).toEqual({ kind: "unique", personId: "stu-1" });
  });
  it("sends twins to review", () => {
    expect(matchRecoveryPerson(input, [s("a", "Jose Perez", "1991-05-14"), s("b", "José Pérez", "1991-05-14")]))
      .toEqual({ kind: "review", personIds: ["a", "b"] });
  });
  it("sends a similar name with another or missing birth date to review", () => {
    expect(matchRecoveryPerson(input, [s("a", "Jose Perez", "1990-01-01"), s("b", "Jose Perez")]))
      .toEqual({ kind: "review", personIds: ["a", "b"] });
  });
  it("sends an email-only match to review", () => {
    expect(matchRecoveryPerson({ ...input, email: "OLD@x.test" }, [s("a", "Someone Else", "1980-01-01", "old@x.test")]))
      .toEqual({ kind: "review", personIds: ["a"] });
  });
  it("returns none when nothing looks alike", () => {
    expect(matchRecoveryPerson(input, [s("a", "Ana Lopez", "1991-05-14")])).toEqual({ kind: "none" });
  });
});
```
- [ ] **Step 2:** `corepack pnpm vitest run --project node packages/domain/src/members/recovery-matching.test.ts` → FAIL.
- [ ] **Step 3: implementación**
```ts
const tokens = (value: string) =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z\s]/gu, " ").split(/\s+/u).filter(Boolean);

function distance(a: string, b: string): number {   // Damerau-Levenshtein (transposición adyacente)
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  return d[a.length]![b.length]!;
}

// ponytail: comparación por tokens O(n·m) sobre nombres cortos; suficiente para <1000 fuentes.
export function namesLookAlike(a: string, b: string): boolean {
  const [short, long] = [tokens(a), tokens(b)].sort((x, y) => x.length - y.length) as [string[], string[]];
  if (short.length < 2) return false;
  const used = new Set<number>();
  let typos = 0;
  for (const word of short) {
    let best = -1, bestCost = Infinity;
    long.forEach((candidate, index) => {
      if (used.has(index)) return;
      const cost = distance(word, candidate);
      if (cost < bestCost) [best, bestCost] = [index, cost];
    });
    if (best < 0 || bestCost > (word.length >= 5 ? 2 : 1)) return false;
    used.add(best);
    typos += bestCost;
  }
  return typos <= 2;
}

export function matchRecoveryPerson(input, sources): RecoveryMatch {
  const similar = sources.filter((source) => namesLookAlike(input.fullName, source.fullName));
  const exact = new Set(similar.filter((source) => source.birthDate === input.dateOfBirth).map((s) => s.personId));
  if (exact.size === 1) return { kind: "unique", personId: [...exact][0]! };
  const email = input.email?.trim().toLowerCase();
  const review = new Set([
    ...similar.map((s) => s.personId),
    ...(email ? sources.filter((s) => s.email?.trim().toLowerCase() === email).map((s) => s.personId) : []),
  ]);
  return review.size ? { kind: "review", personIds: [...review].sort() } : { kind: "none" };
}
```
- [ ] **Step 4:** Tests del matcher → PASS.
- [ ] **Step 5: waiver (R5–R7).** Unit en `booking-transaction-service.test.ts`: reserva del miembro
  sin aceptación → error "Accept the academy terms first"; con aceptación → confirmada; actor owner
  sin aceptación → confirmada. Unit en `enrolment-approval-service.test.ts`: aprobar crea
  `enrolmentWaiverAcceptances/{id}__{version}` por alumno. E2E `waiver-gate.spec.ts`: miembro
  sembrado sin aceptación → ve solo el waiver; tras aceptar ve el calendario (R6).
- [ ] **Step 6:** Implementar; todo verde.
- [ ] **Step 7:** Cierre de fase 1: R1–R8 verdes → commit local
  `git commit -m "Remove email verification from enrolment and require the waiver before booking"`.

## Fase 2 — Recuperación de adultos (se publica sola)

### Task 4: Inicio de la recuperación v3 (D1, D3, D5, R22)

**Files:**
- Modify: `packages/domain/src/members/member-recovery-contracts.ts` (añadir `startAccessRecoveryInputSchema`
  y `startAccessRecoveryResultSchema`)
- Modify: `apps/functions/src/members/member-recovery-service.ts` (`start()` nuevo; `begin()` se conserva
  para tickets viejos)
- Modify: `apps/functions/src/members/member-recovery-sources.ts` (`loadRecoveryPeople`: añade
  `personId` resolviendo `regyfitMemberLinks`, `regyfitOfficeLinks`, `memberMigrationDecisions`)
- Modify: `apps/functions/src/members/member-recovery-callables.ts`, `apps/functions/src/index.ts` (`startAccessRecovery`)
- Test: `member-recovery-service.test.ts`

**Interfaces:**
```ts
// input
{ fullName: string; dateOfBirth: string; email?: string;
  who: "self" | "self-and-children" | "children-only" }
// result
| { outcome: "matched"; recoveryId: string; maskedEmail?: string }   // "lu•••@gmail.com"
| { outcome: "office-review"; recoveryId: string }
| { outcome: "not-found" }
| { outcome: "minor" }                                                // < 18 y who !== children-only
```
El ticket guarda `autoMatch: { personId, candidateId }` cuando `kind === "unique"`, y
`candidates` (≤ 20) cuando `kind === "review"`. `who === "children-only"` no busca al adulto:
devuelve `matched` con ticket sin persona adulta (Task 10 añade los hijos).

- [ ] **Step 1:** Tests: única → `matched` + `autoMatch`; varias → `office-review`; nada → `not-found`
  sin crear ticket; 17 años → `minor`; 11º intento en 15 min → `resource-exhausted`.
- [ ] **Step 2–4:** FAIL → implementar → PASS.

### Task 5: Suscripción en la recuperación (D4, D9, R13–R15)

**Files:**
- Create: `packages/domain/src/memberships/archive-plan-equivalence.ts` — tabla aprobada
  (`"65.00|adult": "west-adult"`, `"85.00|adult": "town-adult"`, `"125.00|adult": "bpt-jersey-adult"`,
  `"10.00|adult": "payg"`, `"7.50|teens": "west-teens-payg"`, `"95.00|kids": {Town:"town-kids-1x", West:"west-kids-1x"}`,
  `"95.00|teens": "town-kids-1x"`, `"135.00|kids"`/`"135.00|teens": "town-kids-2x"`) y
  `planForArchive(record, centre, today): string | undefined` (misma regla que `planCoverage` de
  `qa/scripts/member-unification-bulk-coverage.mjs`, que pasa a importarla)
- Modify: `apps/functions/src/memberships/manual-subscription-service.ts` — extraer
  `createPreviouslyPaidSubscriptionInTransaction(tx, db, { academyId, studentId, planId, recordId,
  startsAt, endsAt, actorId: "member-recovery", requestId })` usada por la oficina y por la recuperación
- Modify: `apps/functions/src/memberships/intro-application-service.ts` — solicitud de plan desde la
  recuperación: `kind: "claimed-paid"` (sin membresía hasta que el owner confirme) o
  `kind: "bank-transfer"` (crea membresía `active` con `provisional: true` en la misma transacción)
- Modify: `apps/functions/src/memberships/intro-application-admin-service.ts` — rechazar una
  `bank-transfer` provisional: membresía → `cancelled` y cancelación de reservas futuras con motivo
  "Payment not confirmed"
- Test: los `*.test.ts` correspondientes

- [ ] **Step 1:** Tests: periodo vigente → membresía `previously-paid` sin factura y sin
  `provisional`; reclamación sin respaldo → sin membresía; transferencia → membresía provisional
  reservable; rechazo → membresía cancelada y 2 reservas futuras canceladas, 1 pasada intacta.
- [ ] **Step 2–4:** FAIL → implementar → PASS.

### Task 6: Nivel desde el archivo (D6, R16)

**Files:**
- Create: `packages/domain/src/levels/archive-belt.ts` — `levelForArchiveBelt(text, definitions)`:
  `"Blue Belt - 2 stripes"` / `"Azul 2 graus"` → `{ beltKey, stripeKey? }` o `undefined`
- Modify: `member-recovery-service.ts` (el perfil que devuelve `profile-required` incluye
  `level: { suggested?: {beltKey, stripeKey?}, current?: … }`; al completar guarda la declaración y,
  si difiere de la sugerida, `levelDiscrepancy: { archive, declared }` en el ticket)
- Test: `archive-belt.test.ts` con 8 textos reales de forma (sin nombres): blanco sin grados, azul 2,
  morado 4, marrón, negro 1er grado, "Kids Grey/White", texto vacío, texto desconocido.

- [ ] **Step 1–4:** tests → FAIL → implementar → PASS.

### Task 7: Cola del owner — Recovered – to confirm (D2, R12, R14–R17, R23)

**Files:**
- Modify: `apps/functions/src/members/member-recovery-service.ts` — `list()` añade la sección
  `toConfirm` (tickets `linked` con `officeConfirmation: "pending"`); `confirm({requestId})`;
  `undo({requestId})`: borra `regyfitMemberLinks`/`memberRecoverySourceLinks` y la clave
  `auth-user-id`, quita `userId` del alumno, deja la cuenta como `shopper`, revoca sesiones y deja el
  ticket en `pending-review` (el alumno y su historial no se tocan)
- Modify: `apps/web/src/app/admin/members/recovery/recovery-queue.tsx` — dos listas (To confirm /
  Needs review); tarjeta con nombre, cinturón, email, suscripción, discrepancia de nivel; botones
  **Confirm** / **Undo**; en revisión: búsqueda con `namesLookAlike`, texto bajo **Approve recovery**
  deshabilitado: "Select the member record first." / "Tick the identity check first."
- Test: `recovery-queue` unit + `qa/tests/recovery-owner.spec.ts`

- [ ] **Step 1–4:** tests (incluye ticket viejo sembrado con el esquema anterior visible y
  aprobable — Review Focus 5) → FAIL → implementar → PASS.

### Task 8: Completar sin verificación de email (D2, D7, D8)

**Files:**
- Modify: `member-recovery-service.ts` `complete()` — quitar la rama `verify-email`; si el ticket tiene
  `autoMatch`, usarlo como `chosen` (sin `approvedCandidateId`); tras `linked`,
  `auth.updateUser(uid, { emailVerified: true })`; `samePersonByProfile` acepta el `autoMatch` igual
  que una aprobación; guardar `officeConfirmation: "pending"`; el perfil pedido pasa a ser
  `{ trainingCenter, trainingTimePreferences, phoneNumber? , level, subscription }`
- Modify: `apps/functions/src/members/member-recovery-callables.ts` (dependencia `updateUser`)
- Test: `member-recovery-service.test.ts` — cuenta sin verificar + autoMatch → `linked`; cuenta ya
  enlazada a otro alumno → `pending-review`; teléfono inválido del archivo → se pide.

- [ ] **Step 1–4:** tests → FAIL → implementar → PASS.

### Task 9: Asistente web `/login/recover` (D1, D3, D7, D11, D12, R9–R12, R18, R19)

**Files:**
- Modify: `apps/web/src/app/login/recover/recovery-form.tsx` → pasos: **Who** → **Find your membership**
  (Full name, Date of birth, Previous email (optional)) → resultado (matched / office / not found /
  minor) → **Create your sign-in** (email antiguo enmascarado + New password; "Use a different email"
  → Email + Confirm email + New password; **Continue with Google**) → **Your details** (centre,
  times, phone si falta, nivel, suscripción Yes/No → plan + transferencia) → **Terms** (waiver +
  casilla) → `/account`
- Modify: `apps/web/src/lib/member-recovery-client.ts`, `member-recovery-auth.ts` (quitar
  `sendRecoveryVerification`; `email-already-in-use` → modo "Sign in to link it" + Forgot password?)
- Modify: `apps/web/src/app/login/recover/recovery.css` (DESIGN.md)
- Test: `recovery-form.test.tsx` (reescrito) + `qa/tests/recovery-adult.spec.ts`

- [ ] **Step 1:** Specs R9–R12, R18, R19 → FAIL.
- [ ] **Step 2:** Cargar `/impeccable` y `/taste-skill`; implementar el asistente ciñéndose a DESIGN.md.
- [ ] **Step 3:** Specs verdes en `desktop-chromium` y `mobile-chromium`.
- [ ] **Step 4:** Cierre de fase 2: R9–R19, R22, R23 verdes → commit local
  `git commit -m "Let former members recover access with their name and birth date"`.

## Fase 3 — Hijos (D5)

### Task 10: Recuperación de hijos (R20, R21)

**Files:**
- Modify: `member-recovery-service.ts` — `addChildren({recoveryId, children:[{fullName,dateOfBirth}]})`:
  cada hijo con `matchRecoveryPerson`; único → crea `relationships` (tutor actual), reclama la familia de
  oficina (`office-<studentId>`, contactos nulos) para el tutor, rol `guardian` si no es alumno
  (si es `adultStudent` conserva su rol: el acceso a hijos va por `relationships`); no encontrado →
  devuelve `not-found` para ese hijo
- Modify: asistente web — paso **Your children** (añadir/quitar filas; por hijo: encontrado ✓ /
  "Not found — register as a new member" → `/enrol?guardian=prefill`)
- Modify: `apps/web/src/app/enrol/page.tsx` — admitir un tutor ya con sesión (precarga sus datos)
- Test: unit del servicio + `qa/tests/recovery-guardian.spec.ts`

- [ ] **Step 1–4:** tests → FAIL → implementar → PASS.

### Task 3b: Retirar la recuperación de la interfaz

**Files:** Delete `apps/web/src/app/login/recover/` (page, form, css, test), `apps/web/src/lib/member-recovery-auth*.ts`,
`member-recovery-loader.ts` si queda sin uso; Modify `apps/web/src/app/login/login-form.tsx` (quitar el enlace),
`apps/web/src/app/admin/members/requests/page.tsx` (quitar la pestaña), `apps/web/src/app/admin/members/recovery/`
(borrar la ruta antigua). Test: `login-form.test.tsx` — no hay enlace a `/login/recover`; E2E: `/login/recover` → 404.
Mantener `getMemberRecoveryHistory` (Progress → historial) y todos los datos.

### Task 11: Regresión completa y revisión visual (R24)

- [ ] **Step 1:** Ejecutar TODAS las specs de este plan en `desktop-chromium` y `mobile-chromium`.
- [ ] **Step 2:** Capturas de cada paso en `qa/screenshots/2026-09-23-recovery/` y crítica con
  `/impeccable` + `/taste-skill` contra DESIGN.md; cada fallo visual → arreglo → nueva captura.
- [ ] **Step 3:** Unitarias de los paquetes tocados:
  `corepack pnpm vitest run --project node apps/functions/src/members apps/functions/src/memberships packages/domain/src/members`
  y `corepack pnpm vitest run --project web apps/web/src/app/login apps/web/src/app/enrol apps/web/src/app/account apps/web/src/app/admin/members`.
- [ ] **Step 4:** Commit local de la fase 3. Informe a Luis con la tabla R1–R24 y capturas.

### Task 12: Publicación (solo con OK de Luis)

- [ ] **Step 1:** `git fetch && git rebase origin/main` (sin perder trabajo ajeno) → `git push origin main`.
- [ ] **Step 2:** Deploy de las functions tocadas, en una tanda filtrada:
  `corepack pnpm exec firebase deploy --project bptjersey-f5a25 --force --only functions:startAccessRecovery,functions:completeMemberRecovery,functions:listMemberRecoveryRequests,functions:getMemberRecoveryDetail,functions:reviewMemberRecovery,functions:confirmMemberRecovery,functions:undoMemberRecovery,functions:addRecoveryChildren,functions:requestBooking,functions:approveEnrolmentRequest,functions:submitEnrolmentRequest,functions:<solicitudes de plan>`
  (la lista exacta sale de `git diff --stat` al terminar).
- [ ] **Step 3:** Luis ejecuta el backfill de waivers en seco y luego real.
- [ ] **Step 4:** Verificación en producción: Luis crea el socio de prueba
  (`/root/compartido/miembro-prueba-recuperacion.sh crear …`) y recorre R9 a mano.
