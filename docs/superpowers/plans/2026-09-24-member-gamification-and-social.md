# Gamificación y capa social del miembro: plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usa `superpowers:subagent-driven-development` (recomendado) o
> `superpowers:executing-plans` para ejecutar este plan tarea a tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que un miembro (o su tutor) vea en `/account` su racha, su próxima promoción, su posición ±2
frente a su cohorte y quién va a su clase; que el tutor gestione su plan, el de sus hijos, las fotos y el
acceso propio de los hijos de 12–17; y que nadie use el calendario sin los términos vigentes aceptados.

**Arquitectura:** capas del repo (domain → functions `*-service.ts` → `*-callables.ts` → `lib/*-client.ts` →
UI). Todo lo que un miembro ve de otro sale de un callable y pasa por `MemberPublicCard`. Los datos nuevos
viven en colecciones solo de servidor (la regla `match /{document=**}` ya las deniega al cliente). Los
rankings se calculan en un snapshot nocturno; la racha propia, en vivo.

**Stack:** Next.js 16 export estático + React 19, Firebase Functions v2 (Node 22, `europe-west9`),
Firestore, Cloudflare R2 (bucket privado), `sharp`, `lottie-web`, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-member-gamification-and-social-design.md` (Q1–Q13) y las
decisiones heredadas D1–D11 / A–H de `docs/superpowers/plans/2026-09-23-member-features-parallel-sessions.md` §3–§4.
Lee las dos antes de empezar.

## Restricciones globales

- Trabajo en `main` local; **un commit por fase**; **sin push** hasta que la fase 9 pase (Q7). Nunca `git add -A`.
- Push a `main` publica la web (Cloudflare). Las functions se despliegan a mano, con OK explícito de Luis y la lista exacta de nombres.
- Tests: se **escriben** en su tarea pero se **ejecutan todos en la fase 9** (Q6). Solo unitarios de funciones puras de dominio, tests de rules y la E2E final. Nada de tests de servicios ni de componentes.
- Verificación por fase: `corepack pnpm --filter @bpt-jersey/domain typecheck`, `... --filter @bpt-jersey/functions typecheck`, `... --filter @bpt-jersey/web typecheck` (solo los paquetes que la fase toca).
- `packages/domain` nunca importa Firebase.
- Diseño (`DESIGN.md` §9): radio `1rem` dentro de `/account`, `0` fuera; BPT Purple `#2F2483` único acento; botones `min-height: 3.15rem`; etiquetas encima del input; esqueletos, nunca spinners; `<dialog>` nativo; sin desbordes a 360 px; copy en inglés UK.
- Toda UI nueva se **oculta sola** ante error / `not-found` / `unimplemented` de su callable. Única excepción: el bloqueo del disclaimer (falla cerrado con «Retry»).
- Los clientes web nunca muestran errores crudos de Firebase: cada `lib/*-client.ts` lanza un texto fijo.
- Franja (`participantBandAt`) ≠ mayoría de edad: el consentimiento sigue en `deriveParticipantType` / edad < 18 (D10, H5).
- Nadie reserva por nadie (ADR-018).
- Fotos: `photoUrl` antiguo del perfil **no** se usa en fichas públicas; solo URL firmada de 15 min de `photoObjectKey` con `photoConsentAt`.
- Callables de miembro: `requireMemberAccountActor` (`apps/functions/src/members/member-access-callables.ts`) + `createFirestoreMemberAccessService().authorise(academyId, userId, studentId)`. Opciones: `browserAdminCallableOptions`.
- Cada callable nuevo se re-exporta en `apps/functions/src/index.ts` (única vía de despliegue).

## Foco de revisión (lo que ningún test de tarea cubre y más puede fallar)

1. **Cuenta teen creada sin `emailVerified: true`** → `requireMemberAccountActor` la rechaza y el hijo no puede entrar. `createTeenAccess` debe crear el usuario con `emailVerified: true` (D8). Lo fija la E2E de la tarea 9.3 (login del teen).
2. **Menor sin fecha de nacimiento** → `participantBandAt` lo manda a `adult` y aparecería en la tabla de adultos. `buildLeaderboards` **excluye** a los alumnos sin `dateOfBirth` válida (tarea 5.2; el unitario `leaderboardEligible` de la tarea 0.2 lo fija).
3. **Imagen hostil** (SVG, GIF animado, PNG de 20.000×20.000, fichero de 2 MB+) → `sharp` con `limitInputPixels` y `animated: false`; solo jpeg/png/webp; se rechaza con texto fijo (tarea 3.2). La E2E sube un `.svg` y espera el error.
4. **Roster de una sesión con un miembro oculto (`showToMembers: false`) o de otra cohorte** → nunca sale su nombre, suma a `hiddenCount` (tarea 6.1). La E2E lo comprueba.
5. **Waiver cuya comprobación falla** (red caída, callable sin desplegar) → hoy `WaiverGate` deja pasar; tras la fase 7 muestra «We couldn't check your terms — Retry» y no el calendario (tarea 7.2). La E2E lo fuerza con `page.route` devolviendo 500.

## Reglas de aceptación (R1..R18)

| # | Regla | Dónde se comprueba |
|---|---|---|
| R1 | `participantBandAt`: 11 → kids, 12 → teens, 15 → teens, 16 → adult, sin fecha → adult; cumpleaños a las 23:30Z cuenta el día de Jersey | unitario 0.1 |
| R2 | Tabla de cohortes: kids <12, teens 12–15, adults 16+; nadie ve otra cohorte | unitario 0.2 + E2E 9.3 |
| R3 | Barras: con 9 asistencias Goal dice «Just x1 missing to get goal!» con tono intenso; con 10, Goal pasa a 20; con 24, Reward «x1 missing» | unitario 0.2 + E2E |
| R4 | Llama con «xN» solo si `streakCount ≥ 2`; con `prefers-reduced-motion` fotograma fijo | E2E |
| R5 | «N h trained since September» = suma de duraciones de sesiones asistidas/tarde desde el 1-sep (Jersey) | unitario (existente) + E2E |
| R6 | Barra de promoción e hito (75 / 90 / 1 clase) dentro de la app; un hito visto no vuelve a salir | unitario 0.2 + E2E |
| R7 | Competitors: 2 arriba, tú, 2 abajo, en Attendance y en Belt; el primero ve 0 arriba; ocultos no salen salvo tú | unitario 0.2 + E2E |
| R8 | Comparador: «They have / You have» = `compareTechniques` | unitario (existente) + E2E |
| R9 | Detalle de sesión solo en sesiones reservadas por el participante; `permission-denied` si no | E2E |
| R10 | Roster: misma cohorte y visible → nombre + foto; resto → «+N members from other age groups» | E2E |
| R11 | Foto: casilla de consentimiento obligatoria; servidor re-codifica a WebP 512 sin metadatos; URL firmada de 15 min; quitar la foto borra el objeto | E2E |
| R12 | Acceso teen: solo para hijos de 12–17; contraseña ≥ 10; revocar desactiva y revoca tokens | unitario 0.3 + E2E |
| R13 | ≥ 18 con cuenta creada por el tutor: bloqueo único «You're 18 — this account is now yours. Set a new password.» | unitario 0.3 + E2E |
| R14 | Disclaimer: participante sin waiver vigente o disclaimer T117 → tarjeta bloqueante; Settings / My plan / logout nunca se bloquean; error → Retry | E2E |
| R15 | `/admin/waivers` → «Acceptances»: filtro «Missing only», búsqueda, CSV; coach sin acceso | E2E |
| R16 | My plan lista «You» (si hay vínculo `self`) + hijos; «Add a child» y «Train yourself» crean solicitudes que aprueba la oficina | E2E |
| R17 | Nombre público «Mia R.»; colisión en cohorte → «Mia Ro.» | unitario 0.2 |
| R18 | `leaderboards/*`, `memberPublicSettings/*`, `teenAccess/*`, `memberPlanRequests/*` inaccesibles desde el cliente | rules 9.2 |

## Datos nuevos (solo servidor; la regla por defecto ya los deniega)

```ts
// academies/{academyId}/memberPublicSettings/{studentId}
type MemberPublicSettingsDoc = {
  academyId: string; studentId: string;
  photoObjectKey: string | null;        // avatars/<studentId>/<uuid>.webp
  photoConsentAt: string | null;        // ISO
  photoConsentBy: string | null;        // uid
  pendingPhotoObjectKey: string | null; // propuesta del teen, pendiente del tutor (B4)
  showToMembers: boolean;               // por defecto true (Q9)
  updatedAt: string;
};
// academies/{academyId}/teenAccess/{studentId}
type TeenAccessDoc = {
  academyId: string; studentId: string; uid: string; email: string;
  createdBy: string; createdAt: string; adultClaimedAt: string | null; revokedAt: string | null;
};
// academies/{academyId}/memberPlanRequests/{requestId}
type MemberPlanRequestDoc = {
  academyId: string; requestId: string; kind: "self" | "child"; requestedBy: string;
  person: { fullName: string; dateOfBirth: string; trainingCenter: string; trainingTimePreferences: string[] };
  status: "pending" | "approved" | "rejected"; createdAt: string;
  decidedAt: string | null; decidedBy: string | null; studentId: string | null;
};
// academies/{academyId}/leaderboards/{cohort}   cohort ∈ kids | teens | adults
type LeaderboardSnapshotDoc = { cohort: LeaderboardCohort; builtAt: string; seasonStart: string; rows: LeaderboardRow[] };
```

> Nota de implementación respecto al spec: los campos de foto/visibilidad del spec (`profile-contracts.ts`)
> se guardan en `memberPublicSettings/{studentId}` en lugar del perfil. Mismo significado, pero el perfil
> tiene un contrato estricto con lista de campos que lee el cliente, y este documento es solo de servidor.
> Igual: `promotionMilestone` vive en `member-engagement-contracts.ts` (no en `levels/promotion-notice.ts`) y
> el ±2 reutiliza el `rankNeighbours` que ya existe en vez de crear `leaderboardNeighbours`. Así no hacen
> falta subpaths nuevos en `package.json` ni en `apps/functions/src/deploy-runtime.ts`.

## Mapa de ficheros

| Fichero | Fase | Responsabilidad |
|---|---|---|
| `packages/domain/src/memberships/participant-band.ts` (+`.test.ts`) | 0 | Franja única |
| `packages/domain/src/memberships/plan-contracts.ts` | 0 | Re-export de la franja |
| `packages/domain/src/members/member-engagement-contracts.ts` (+`.test.ts`) | 0 | Cohortes, nombres, metas, hitos, esquemas zod |
| `packages/domain/src/members/member-access-contracts.ts` (+`.test.ts`) | 0, 3 | `needsAdultClaim`, edad mínima 12 |
| `apps/web/src/lib/participant-band.ts` | 1 | Envoltorio de una línea |
| `apps/functions/src/memberships/intro-application-service.ts`, `plan-callables.ts`, `membership-service.ts`, `schedule/member-calendar-week-callables.ts` | 1 | Franja única en servidor |
| `packages/domain/src/schedule/member-calendar-contracts.ts` (`participantTypeOn`) | 1 | Franja única en la copia de dominio |
| `packages/domain/src/members/member-overview-contracts.ts` (+`.test.ts`), `apps/web/src/app/admin/members/member-overview-labels.ts` | 1 | Flag «Plan band differs from age band» |
| `packages/domain/src/members/enrolment-request-contracts.ts`, `apps/functions/src/members/enrolment-approval-service.ts`, `apps/web/src/app/enrol/page.tsx` | 2 | Tutor que también entrena |
| `apps/functions/src/family-plan/family-plan-{service,callables}.ts`, `apps/web/src/lib/family-plan-client.ts`, `apps/web/src/app/account/membership/*`, `apps/web/src/app/admin/members/requests/page.tsx` | 2 | My plan + solicitudes |
| `apps/functions/src/account-settings/{profile-photo,account-settings-service}.ts`, `account-settings-callables.ts`, `apps/functions/src/storage/r2-client.ts`, `apps/web/src/lib/account-settings-client.ts`, `apps/web/src/app/account/settings/*`, `apps/web/src/app/account/adult-claim.tsx`, `docs/adr/ADR-019-teen-access-from-12.md`, `docs/operations/t011-dpia-draft.md` | 3 | Fotos, visibilidad, acceso teen |
| `apps/web/src/app/account/calendar/member-calendar.tsx`, `apps/web/src/app/account/page.tsx` | 4 | `topSlot` por participante + `gate` |
| `apps/functions/src/streak/streak-{service,callables}.ts`, `apps/functions/src/promotion/promotion-callables.ts`, `apps/web/src/lib/streak-client.ts`, `apps/web/src/app/account/streak/*`, `apps/web/src/app/account/promotion/promotion-bar.tsx` | 4 | Racha + promoción |
| `apps/functions/src/competitors/{public-card,leaderboard-build,competitors-callables}.ts`, `apps/web/src/lib/competitors-client.ts`, `apps/web/src/app/account/competitors/*` | 5 | Snapshot + ±2 + comparador |
| `apps/functions/src/session-roster/session-roster-callables.ts`, `apps/web/src/lib/session-roster-client.ts`, `apps/web/src/app/account/session-detail/*`, `apps/web/src/app/account/calendar/session-card.tsx` | 6 | Detalle de sesión |
| `apps/functions/src/disclaimer-status/disclaimer-status-callables.ts`, `apps/web/src/lib/disclaimer-status-client.ts`, `apps/web/src/app/account/waiver-acceptance.tsx`, `apps/web/src/app/admin/waivers/acceptances.tsx` | 7 | Bloqueo + auditoría |
| `qa/rules/default-deny.test.ts`, `qa/scripts/seed-member-engagement-emulator.mjs`, `qa/scripts/run-member-engagement-ui-e2e.mjs`, `qa/tests/member-engagement-auth-emulator.spec.ts`, `qa/fixtures/avatar.png`, `qa/fixtures/evil.svg` | 9 | Verificación |

## Dependencias entre fases

```
0 dominio ──┬─> 1 franjas ──> 2 My plan ──> 3 settings ──┬─> 5 competidores ──> 6 detalle de sesión
            └─> 4 racha (usa slot de 4.1) ───────────────┘                         │
                                                  7 disclaimer (usa `gate` de 4.1) ─┘──> 8 pulido ──> 9 verificación
```

---

## Fase 0 · Dominio

### Tarea 0.1: `participantBandAt`

**Ficheros:**
- Crear: `packages/domain/src/memberships/participant-band.ts`
- Crear: `packages/domain/src/memberships/participant-band.test.ts`
- Modificar: `packages/domain/src/memberships/plan-contracts.ts` (última línea)

**Interfaces:**
- Consume: `memberAgeOn(dateOfBirth, academyDate)` de `../members/member-access-contracts`; tipo `ParticipantType` de `./plan-contracts`.
- Produce: `participantBandAt(input: { dateOfBirth?: string | null; onIso: string }): ParticipantType` exportada desde `@bpt-jersey/domain/memberships`.

- [ ] **Paso 1: test**

```ts
// packages/domain/src/memberships/participant-band.test.ts
import { describe, expect, it } from "vitest";
import { participantBandAt } from "./participant-band";

const on = "2026-09-24T10:00:00.000Z";
describe("participantBandAt", () => {
  it("cuts at 12 and 16 on the Jersey calendar", () => {
    expect(participantBandAt({ dateOfBirth: "2014-09-25", onIso: on })).toBe("kids"); // 11
    expect(participantBandAt({ dateOfBirth: "2014-09-24", onIso: on })).toBe("teens"); // 12
    expect(participantBandAt({ dateOfBirth: "2010-09-25", onIso: on })).toBe("teens"); // 15
    expect(participantBandAt({ dateOfBirth: "2010-09-24", onIso: on })).toBe("adult"); // 16
    expect(participantBandAt({ dateOfBirth: "1990-01-01", onIso: on })).toBe("adult");
  });
  it("uses the Jersey day, not the UTC day", () => {
    // 23 Sept 23:30Z is already 24 Sept in Jersey (BST).
    expect(participantBandAt({ dateOfBirth: "2014-09-24", onIso: "2026-09-23T23:30:00.000Z" })).toBe("teens");
  });
  it("treats a missing or unreadable date of birth as adult", () => {
    expect(participantBandAt({ dateOfBirth: null, onIso: on })).toBe("adult");
    expect(participantBandAt({ dateOfBirth: "not-a-date", onIso: on })).toBe("adult");
  });
});
```

- [ ] **Paso 2: implementación**

```ts
// packages/domain/src/memberships/participant-band.ts
import { memberAgeOn } from "../members/member-access-contracts";
import type { ParticipantType } from "./plan-contracts";

const jerseyDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Jersey", year: "numeric", month: "2-digit", day: "2-digit",
});

/**
 * D6 (Luis, 23-sep): one band for price, tables and bookings in both centres. Under 12 kids,
 * 12–15 teens, 16+ adult. A 16–17 year old is still a minor for consent (D10): never decide
 * consent from this. No date of birth → adult (23-sep rule).
 */
export function bandForAge(age: number | null): ParticipantType {
  if (age === null || age >= 16) return "adult";
  return age >= 12 ? "teens" : "kids";
}
export function participantBandAt(input: Readonly<{ dateOfBirth?: string | null; onIso: string }>): ParticipantType {
  return bandForAge(memberAgeOn(input.dateOfBirth ?? undefined, jerseyDay.format(new Date(input.onIso))));
}
```

(`bandForAge` existe para los sitios que ya tienen la edad calculada sobre una fecha de Jersey, como `participantTypeOn`; tarea 1.1.)

- [ ] **Paso 3:** añadir al final de `plan-contracts.ts`: `export { bandForAge, participantBandAt } from "./participant-band";`

### Tarea 0.2: contratos de engagement

**Ficheros:**
- Modificar: `packages/domain/src/members/member-engagement-contracts.ts`
- Modificar: `packages/domain/src/members/member-engagement-contracts.test.ts` (bloque `leaderboardCohort`, líneas 154–166, y bloques nuevos)

**Interfaces producidas** (todas desde `@bpt-jersey/domain/members/engagement`):

```ts
export type LeaderboardCohort = "kids" | "teens" | "adults";
export function leaderboardCohort(dateOfBirth: string | null, nowIso: string): LeaderboardCohort;
export function leaderboardEligible(dateOfBirth: string | null | undefined): boolean; // fecha válida
export function nextProgressTarget(count: number, base: number): number;
export function publicDisplayNames(people: readonly { studentId: string; fullName: string }[]): ReadonlyMap<string, string>;
export function beltScore(sequence: number, promotionPercent: number | null): number;
export function promotionMilestone(input: { percent: number | null; classesToGo: number | null }): "75" | "90" | "oneLeft" | null;
export type MemberPublicCard = { studentId; displayName; photoUrl: string | null; belt: {name; color} | null;
  stripes; streakCount; attendancesSinceSeasonStart: number; promotionPercent: number | null; skillKeys: readonly string[] };
export type LeaderboardRow = Omit<MemberPublicCard, "photoUrl"> & { photoObjectKey: string | null; hidden: boolean; beltScore: number };
export const memberPublicCardSchema, memberStreakSummarySchema, neighboursSchema, competitorsResponseSchema,
  leaderboardRowSchema, leaderboardSnapshotSchema, sessionDetailResponseSchema, promotionOutlookSchema,
  uploadProfilePhotoInputSchema, teenAccessInputSchema, memberPlanRequestInputSchema;
```

- [ ] **Paso 1: tests** (sustituye el `describe("leaderboardCohort")` y añade los nuevos)

```ts
describe("leaderboardCohort", () => {
  it("follows the payment band in three cohorts", () => {
    const on = "2026-09-24T10:00:00.000Z";
    expect(leaderboardCohort("2014-09-25", on)).toBe("kids");
    expect(leaderboardCohort("2014-09-24", on)).toBe("teens");
    expect(leaderboardCohort("2010-09-24", on)).toBe("adults");
  });
});
describe("leaderboardEligible", () => {
  it("excludes students without a readable date of birth", () => {
    expect(leaderboardEligible("2010-01-01")).toBe(true);
    expect(leaderboardEligible(null)).toBe(false);
    expect(leaderboardEligible("nope")).toBe(false);
  });
});
describe("nextProgressTarget", () => {
  it("moves to the next multiple once a target is reached", () => {
    expect(nextProgressTarget(9, 10)).toBe(10);
    expect(nextProgressTarget(10, 10)).toBe(20);
    expect(nextProgressTarget(24, 25)).toBe(25);
    expect(nextProgressTarget(0, 10)).toBe(10);
  });
});
describe("buildMemberStreakSummary targets", () => {
  const at = (day: string) => ({ occurredAt: `2026-09-${day}T18:00:00.000Z`, durationMinutes: 60 });
  const now = "2026-09-30T20:00:00.000Z";
  it("flags x1 missing on the goal at 9 and rolls to 20 at 10", () => {
    const nine = buildMemberStreakSummary({ attendances: ["02","03","04","05","08","09","10","11","12"].map(at), now });
    expect(nine.goal).toMatchObject({ target: 10, remaining: 1, almost: true });
    const ten = buildMemberStreakSummary({ attendances: ["02","03","04","05","08","09","10","11","12","15"].map(at), now });
    expect(ten.goal).toMatchObject({ target: 20, remaining: 10, almost: false });
  });
});
describe("publicDisplayNames", () => {
  it("uses first name and surname initial, lengthening only on collision", () => {
    const names = publicDisplayNames([
      { studentId: "a", fullName: "Mia Roberts" },
      { studentId: "b", fullName: "Mia Rodriguez" },
      { studentId: "c", fullName: "Leo Smith" },
      { studentId: "d", fullName: "Cher" },
    ]);
    expect(names.get("a")).toBe("Mia Rob.");
    expect(names.get("b")).toBe("Mia Rod.");
    expect(names.get("c")).toBe("Leo S.");
    expect(names.get("d")).toBe("Cher");
  });
});
describe("promotionMilestone", () => {
  it("prefers one class left, then 90, then 75", () => {
    expect(promotionMilestone({ percent: 60, classesToGo: 1 })).toBe("oneLeft");
    expect(promotionMilestone({ percent: 92, classesToGo: 5 })).toBe("90");
    expect(promotionMilestone({ percent: 75, classesToGo: null })).toBe("75");
    expect(promotionMilestone({ percent: 74, classesToGo: 3 })).toBeNull();
    expect(promotionMilestone({ percent: null, classesToGo: null })).toBeNull();
  });
});
describe("beltScore", () => {
  it("orders by ladder position first, then promotion percent", () => {
    expect(beltScore(5, 90)).toBeLessThan(beltScore(6, 0));
    expect(beltScore(5, 10)).toBeLessThan(beltScore(5, 20));
  });
});
```

(Nota: «Mia R.» colisiona entre Roberts y Rodriguez, así que ambos alargan hasta distinguirse: «Rob.» / «Rod.». R17.)

- [ ] **Paso 2: implementación** (añadir; sustituir `LeaderboardCohort`/`leaderboardCohort` y ampliar `MemberPublicCard`; `buildMemberStreakSummary` usa `nextProgressTarget`)

```ts
import { z } from "zod";
import { participantBandAt } from "../memberships/participant-band";

export type LeaderboardCohort = "kids" | "teens" | "adults";
/** D6: the table is the band the member pays in. Callers drop students without a date first. */
export function leaderboardCohort(dateOfBirth: string | null, nowIso: string): LeaderboardCohort {
  const band = participantBandAt({ dateOfBirth, onIso: nowIso });
  return band === "adult" ? "adults" : band;
}
/** Review focus 2: a child with no date of birth must not land in the adult table. */
export function leaderboardEligible(dateOfBirth: string | null | undefined): boolean {
  return typeof dateOfBirth === "string" && z.iso.date().safeParse(dateOfBirth).success;
}
export function nextProgressTarget(count: number, base: number): number {
  return (Math.floor(Math.max(0, count) / base) + 1) * base;
}
// in buildMemberStreakSummary:
//   const goalBase = input.goal ?? defaultGoal; const rewardBase = input.reward ?? defaultReward;
//   goal: progressBar({ ...goalBase, target: nextProgressTarget(thisSeason.length, goalBase.target) }, thisSeason.length),
//   reward: progressBar({ ...rewardBase, target: nextProgressTarget(thisSeason.length, rewardBase.target) }, thisSeason.length),

export function publicDisplayNames(
  people: readonly Readonly<{ studentId: string; fullName: string }>[],
): ReadonlyMap<string, string> {
  const parts = people.map((p) => {
    const [first = "", ...rest] = p.fullName.trim().split(/\s+/u);
    return { studentId: p.studentId, first, last: rest.at(-1) ?? "" };
  });
  const label = (p: (typeof parts)[number], n: number) => (p.last ? `${p.first} ${p.last.slice(0, n)}.` : p.first);
  const result = new Map<string, string>();
  for (const p of parts) {
    let n = 1;
    // ponytail: O(n²) over one cohort (hundreds of rows), fine for a nightly job.
    while (p.last.length > n && parts.some((o) => o !== p && o.first === p.first && label(o, n) === label(p, n))) n += 1;
    result.set(p.studentId, label(p, n));
  }
  return result;
}
export function beltScore(sequence: number, promotionPercent: number | null): number {
  return sequence * 1000 + (promotionPercent ?? 0);
}
export function promotionMilestone(input: Readonly<{ percent: number | null; classesToGo: number | null }>): "75" | "90" | "oneLeft" | null {
  if (input.classesToGo === 1) return "oneLeft";
  if (input.percent === null) return null;
  if (input.percent >= 90) return "90";
  return input.percent >= 75 ? "75" : null;
}

const id = z.string().min(1).max(128);
export const memberPublicCardSchema = z.strictObject({
  studentId: id, displayName: z.string().min(1).max(80), photoUrl: z.url().nullable(),
  belt: z.strictObject({ name: z.string().max(80), color: z.string().max(32) }).nullable(),
  stripes: z.number().int().min(0).max(10), streakCount: z.number().int().min(0),
  attendancesSinceSeasonStart: z.number().int().min(0), promotionPercent: z.number().min(0).max(100).nullable(),
  skillKeys: z.array(z.string().max(128)).max(500),
});
const bar = z.strictObject({ label: z.string(), target: z.number().int(), progress: z.number().int(), remaining: z.number().int(), almost: z.boolean(), complete: z.boolean() });
export const memberStreakSummarySchema = z.strictObject({
  streakCount: z.number().int().min(0), seasonStart: z.iso.date(), attendancesSinceSeasonStart: z.number().int().min(0),
  hoursSinceSeasonStart: z.number().min(0), goal: bar, reward: bar,
});
export const neighboursSchema = z.strictObject({ above: z.array(memberPublicCardSchema).max(2), current: memberPublicCardSchema, below: z.array(memberPublicCardSchema).max(2) });
export const competitorsResponseSchema = z.strictObject({
  cohort: z.enum(["kids", "teens", "adults"]), builtAt: z.iso.datetime().nullable(),
  attendance: neighboursSchema.nullable(), belt: neighboursSchema.nullable(),
});
export const leaderboardRowSchema = memberPublicCardSchema.omit({ photoUrl: true }).extend({
  photoObjectKey: z.string().max(200).nullable(), hidden: z.boolean(), beltScore: z.number(),
});
export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>;
export const leaderboardSnapshotSchema = z.strictObject({
  cohort: z.enum(["kids", "teens", "adults"]), builtAt: z.iso.datetime(), seasonStart: z.iso.date(),
  rows: z.array(leaderboardRowSchema).max(1500),
});
export const sessionDetailResponseSchema = z.strictObject({
  curriculum: z.strictObject({ title: z.string(), techniques: z.array(z.string()), details: z.string() }).nullable(),
  roster: z.array(z.strictObject({ card: memberPublicCardSchema, isYou: z.boolean() })).max(200),
  hiddenCount: z.number().int().min(0),
});
export const promotionOutlookSchema = z.strictObject({
  nextName: z.string().max(80), percent: z.number().min(0).max(100), classesToGo: z.number().int().min(0).nullable(),
  milestone: z.enum(["75", "90", "oneLeft"]).nullable(), levelKey: z.string().max(128),
}).nullable();
export const uploadProfilePhotoInputSchema = z.strictObject({
  studentId: id, base64: z.string().min(4).max(4 * Math.ceil((2 * 1024 * 1024) / 3)),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]), consent: z.literal(true),
});
export const teenAccessInputSchema = z.strictObject({ studentId: id, email: z.email().max(254), password: z.string().min(10).max(128) });
export const memberPlanRequestInputSchema = z.strictObject({
  kind: z.enum(["self", "child"]), fullName: z.string().trim().min(2).max(160), dateOfBirth: z.iso.date(),
  ...enrolmentTrainingFields, // same centre enum and time slots as /enrol
});
```

`enrolmentTrainingFields` se añade en `packages/domain/src/members/enrolment-request-contracts.ts` junto a `applicantShape` (línea 41), que hoy no se exporta:

```ts
export const enrolmentTrainingFields = Object.freeze({
  trainingCenter: applicantShape.trainingCenter,
  trainingTimePreferences: applicantShape.trainingTimePreferences,
});
```

e importa con `import { enrolmentTrainingFields } from "./enrolment-request-contracts";` (añade ese fichero al `git add` de la fase 0).

Nota: `MemberPublicCard` pasa a ser `z.infer<typeof memberPublicCardSchema>` (un solo origen del tipo).

### Tarea 0.3: `needsAdultClaim`

**Ficheros:** Modificar `packages/domain/src/members/member-access-contracts.ts` y su `.test.ts`.

**Produce:** `needsAdultClaim(input: { age: number | null; via: "self" | "guardian"; createdByGuardian: boolean; adultClaimedAt: string | null }): boolean`.

- [ ] **Paso 1: test**

```ts
describe("needsAdultClaim", () => {
  const base = { via: "self" as const, createdByGuardian: true, adultClaimedAt: null };
  it("asks once, at 18, only for guardian-created own accounts", () => {
    expect(needsAdultClaim({ ...base, age: 17 })).toBe(false);
    expect(needsAdultClaim({ ...base, age: 18 })).toBe(true);
    expect(needsAdultClaim({ ...base, age: 18, adultClaimedAt: "2026-09-24T10:00:00.000Z" })).toBe(false);
    expect(needsAdultClaim({ ...base, age: 18, createdByGuardian: false })).toBe(false);
    expect(needsAdultClaim({ ...base, age: 18, via: "guardian" })).toBe(false);
    expect(needsAdultClaim({ ...base, age: null })).toBe(false);
  });
});
```

- [ ] **Paso 2: implementación**

```ts
/** Q4: credentials never expire; the first own sign-in at 18 hands the account over once. */
export function needsAdultClaim(input: Readonly<{ age: number | null; via: "self" | "guardian"; createdByGuardian: boolean; adultClaimedAt: string | null }>): boolean {
  return input.via === "self" && input.createdByGuardian && input.adultClaimedAt === null && input.age !== null && input.age >= 18;
}
```

- [ ] **Paso 4 (fase): verificar y commit**

Run: `corepack pnpm --filter @bpt-jersey/domain typecheck` → sin errores.

```bash
git add packages/domain/src/memberships/participant-band.ts packages/domain/src/memberships/participant-band.test.ts packages/domain/src/memberships/plan-contracts.ts packages/domain/src/members/enrolment-request-contracts.ts packages/domain/src/members/member-engagement-contracts.ts packages/domain/src/members/member-engagement-contracts.test.ts packages/domain/src/members/member-access-contracts.ts packages/domain/src/members/member-access-contracts.test.ts
git commit -m "Add the shared domain contracts for member gamification and social features"
```

---

## Fase 1 · Franja única en servidor y web (H)

### Tarea 1.1: sustituir las copias de la franja

**Ficheros (modificar):**
- `packages/domain/src/schedule/member-calendar-contracts.ts:333` — `participantTypeOn` (corte hoy a 18) pasa a `return bandForAge(ageOnDate(dateOfBirth, dateKey));`. Es la copia de dominio que usan `member-overview-contracts.ts`, `intro-booking-service.ts` y `group-access-editor.tsx`, así que los arregla a la vez.
- `apps/web/src/lib/participant-band.ts`
- `apps/functions/src/memberships/intro-application-service.ts:194` (corte `<13` → usa la función)
- `apps/functions/src/memberships/intro-conversion-service.ts:249` — `planId: age >= ADULT_AGE ? "payg" : "west-teens-payg"` pasa a `participantBandAt({ dateOfBirth, onIso: now }) === "adult" ? "payg" : "west-teens-payg"`. **No** tocar `ADULT_AGE` en las líneas 155/166/194: allí decide tutor legal (18).
- `packages/domain/src/members/enrolment-request-contracts.test.ts:500-509` — las expectativas de planes elegibles por edad pasan a D6: 17 → `["bpt-jersey-adult", "town-adult"]`; 16 en West → `["payg", "bpt-jersey-adult", "west-adult"]` (antes 17 → town-kids/teens). Ajusta al valor real que produzca el código con la franja nueva y compruébalo leyendo la función.
- `apps/functions/src/memberships/plan-callables.ts`, `apps/functions/src/memberships/membership-service.ts`, `apps/functions/src/schedule/member-calendar-week-callables.ts`, `apps/functions/src/schedule/booking-transaction-service.ts`, `apps/web/src/lib/calendar/firebase-calendar-repository.ts` — solo donde se calcula la franja de un alumno a partir de su edad.

**Consume:** `participantBandAt` (0.1).

- [ ] **Paso 1:** localizar cada cálculo local de franja:

Run: `grep -rnE "participantBand\(|age >= 1[2-8]|age < 1[2-8]|\"teens\"|'teens'" apps/functions/src/memberships apps/functions/src/schedule apps/web/src/lib --include='*.ts' | grep -v test`

- [ ] **Paso 2:** web — el envoltorio queda en una línea:

```ts
import { participantBandAt, type ParticipantType } from "@bpt-jersey/domain/memberships";

/** D6: one band everywhere. Kept as a wrapper so existing callers do not change. */
export function participantBand(dateOfBirth: string, today = new Date()): ParticipantType {
  return participantBandAt({ dateOfBirth, onIso: today.toISOString() });
}
```

Nota: antes devolvía `adult` solo a los 18; ahora a los 16 (D6). Es el cambio pedido. Actualiza las
expectativas de 16–17 en `apps/web/src/lib/participant-band.test.ts` (pasan de `teens` a `adult`).

- [ ] **Paso 3:** servidor — cada sitio de la lista del paso 1 que derive `kids|teens|adult` de una fecha de nacimiento llama a `participantBandAt({ dateOfBirth, onIso: now })`. **No** tocar `deriveParticipantType` ni nada que decida consentimiento (H5), ni `programAdmits` (H4). No cambiar suscripciones vivas (H3).

### Tarea 1.2: filtro «Plan band differs from age band» en `/admin/members`

**Ficheros:**
- Modificar: `packages/domain/src/members/member-overview-contracts.ts` (`memberReviewFlags`, `buildMemberOverview`) y su `.test.ts`
- Modificar: el llamador de `buildMemberOverview` en `apps/functions/src/members/` (`grep -rn "buildMemberOverview(" apps/functions/src`) para pasar `planBands`
- Modificar: `apps/web/src/app/admin/members/member-overview-labels.ts` (etiqueta del flag nuevo)

La fila ya trae `ageBand` y la vista ya filtra por flags (contador «Review» + `DataReview`); basta con un flag nuevo.

- [ ] **Paso 1: test**

```ts
it("flags a live plan whose band differs from the age band (H3)", () => {
  const overview = buildMemberOverview({
    ...baseInput, // el fixture existente del fichero, con un alumno nacido el 2010-01-01 y plan "teens-monthly" vivo
    planBands: new Map([["teens-monthly", ["teens"] as const]]),
    now: "2026-09-24T10:00:00.000Z",
  });
  expect(overview.rows[0]?.flags).toContain("plan-band-differs");
});
```

- [ ] **Paso 2: implementación.** Añadir `"plan-band-differs"` a `memberReviewFlags`; `buildMemberOverview` recibe `planBands: ReadonlyMap<string, readonly ParticipantType[]>` (de `eligibleParticipantTypes` de cada plan) y, dentro del `map`:

```ts
const ageBand = age === undefined ? undefined : participantTypeOn(student.dateOfBirth as string, today);
const eligible = membership ? input.planBands.get(membership.planId) : undefined;
if (covering && ageBand && eligible && !eligible.includes(ageBand)) flags.push("plan-band-differs");
```

(y reutilizar `ageBand` en el `return` en lugar de recalcularlo). Etiqueta: «Plan band differs from age band». No se cambia ninguna suscripción (H3).

- [ ] **Paso 3 (fase): verificar y commit**

Run: `corepack pnpm --filter @bpt-jersey/domain typecheck && corepack pnpm --filter @bpt-jersey/functions typecheck && corepack pnpm --filter @bpt-jersey/web typecheck`

```bash
git add packages/domain/src/schedule/member-calendar-contracts.ts packages/domain/src/members/enrolment-request-contracts.test.ts packages/domain/src/members/member-overview-contracts.ts packages/domain/src/members/member-overview-contracts.test.ts apps/web/src/lib/participant-band.ts apps/web/src/app/admin/members/member-overview-labels.ts apps/functions/src/memberships apps/functions/src/schedule apps/functions/src/members apps/web/src/lib/calendar/firebase-calendar-repository.ts
git commit -m "Apply one age band to plans, bookings and the member directory"
```

---

## Fase 2 · El tutor también entrena + My plan (A, Q11, Q12)

### Tarea 2.1: alta con tutor-alumno (`/enrol`)

**Ficheros:**
- Modificar: `packages/domain/src/members/enrolment-request-contracts.ts:441-560`
- Modificar: `apps/functions/src/members/enrolment-approval-service.ts` (`approve`, líneas 312–400)
- Modificar: `apps/web/src/app/enrol/page.tsx`

- [ ] **Paso 1: contrato.** Quitar el rechazo de `applicantIsStudent && minors.length > 0` (línea 448). Revisar las ramas que asumen exclusión (línea 521: `planSelections.applicant` debe existir si `applicantIsStudent`, con o sin menores; opciones de prueba igual).
- [ ] **Paso 2: aprobación.** Cuando `applicantIsStudent && minors.length > 0`: ejecutar `approveAdult` **y** `approveGuardian` en ese orden; `studentIds = [adultId, ...childIds]`; rol final `guardian` (`targetRoleFor` devuelve `"guardian"` si hay menores). La cuenta conserva su vínculo `self` porque `createAdminAdultForAccount` escribe `userId` en el alumno.

```ts
function targetRoleFor(record: EnrolmentRequestRecord): "adultStudent" | "guardian" {
  return record.minors.length > 0 ? "guardian" : "adultStudent";
}
// in approve():
studentIds = role === "adultStudent"
  ? await approveAdult(input, record, approvalRequestId, account)
  : [
      ...(record.applicantIsStudent ? await approveAdult(input, record, approvalRequestId, account) : []),
      ...(await approveGuardian(input, record, approvalRequestId, account)),
    ];
```

El orden importa: `approveAdult` **primero** (crea `users/{uid}`) y luego `approveGuardian`, cuyo `saveGuardianProfile` hace upsert de ese mismo documento (`guardian-profile-service.ts` ~349-386). No se omite.

- [ ] **Paso 3: web.** En `/enrol`, con «I am a parent or guardian enrolling a child» elegido, mostrar la casilla «I also want to train (my own membership)». Marcada: se muestra el mismo bloque de datos de alumno que usa la rama adulta (reutiliza el componente o JSX existente; no copiarlo) y se envía `applicantIsStudent: true` junto con `minors`.

### Tarea 2.2: solicitudes «Add a child» / «Train yourself»

**Ficheros:**
- Crear: `apps/functions/src/family-plan/family-plan-service.ts`
- Crear: `apps/functions/src/family-plan/family-plan-callables.ts`
- Modificar: `apps/functions/src/index.ts` (+ `export * from "./family-plan/family-plan-callables.js";`)

**Interfaces:**
- Consume: `memberPlanRequestInputSchema` (0.2), `requireMemberAccountActor`, `createFirestoreMemberAccessService().listProfiles`, `createCanonicalMemberDirectoryService(...).createAdminAdultForAccount`, `FamilyStore.createFamily` / `updateFamily({ operation: { kind: "addStudent" } })`, `getGuardianFamily`.
- Produce callables:
  - `requestMemberPlanPerson(input: MemberPlanRequestInput) → { requestId: string }` (miembro; `guardian` o `adultStudent`, nunca `teenStudent`).
  - `listMemberPlanRequests({ status?: "pending" }) → { requests: MemberPlanRequestDoc[] }` (owner/administrator).
  - `decideMemberPlanRequest({ requestId, decision: "approve" | "reject" }) → { studentId: string | null }` (owner/administrator).

(El spec los llama `requestAddChild` / `approveAddChildRequest`; se unifican en estos tres nombres porque `kind` cubre los dos casos.)

- [ ] **Paso 1: reglas del servicio**
  - `kind: "self"`: rechazar (`failed-precondition`) si `listProfiles` ya tiene un perfil `via: "self"`. `fullName` se ignora y se toma del perfil de la cuenta.
  - `kind: "child"`: la persona debe tener < 18 el día de la solicitud (`memberAgeOn`), si no `invalid-argument` «Children must be under 18» (Q11).
  - Máximo 5 solicitudes `pending` por cuenta.
  - Documento `memberPlanRequests/{uuid}` con `status: "pending"`.
- [ ] **Paso 2: aprobación** (plantilla existente: `apps/functions/src/courses/course-participants.ts:135-160`, que ya hace «adulto para una cuenta» y «añadir alumno a familia»):
  - `self` → `createAdminAdultForAccount({ actor, value: { requestId, fullName, dateOfBirth, phoneNumber, trainingCenter, trainingTimePreferences }, account: { userId, displayName, email }, existingClientAccount: true, now })`. `phoneNumber` es obligatorio (~929-933): se toma del `users/{uid}` del tutor. **Cambio necesario en `apps/functions/src/members/canonical-member-directory-service.ts`:** hoy, si `users/{uid}` existe y no hay `courseEnrolmentId`, lanza conflict «This account already holds a member record» (~1255) y además hace `transaction.create` del documento de usuario (~1404). Añadir al comando `existingClientAccount?: true`: con ella, un `users/{uid}` existente de tipo cliente no es conflicto y el documento se actualiza (no `create`). Sigue siendo conflicto si la cuenta ya tiene un alumno propio (`students where userId == uid`).
  - `child` → si `getGuardianFamily(academyId, uid)` existe: `updateFamily({ operation: { kind: "addStudent", requestId, student } })`; si no: `createFamily({ tutorUserId: uid, students: [student], ... })` y, si el rol era `adultStudent`, promover el claim a `guardian` (mismo patrón que `promoteClaim` de `enrolment-approval-service.ts`).
  - Guarda `status`, `decidedAt`, `decidedBy`, `studentId`. Idempotente: si ya está `approved`, devuelve el `studentId` guardado.

### Tarea 2.3: My plan con «You + hijos»

**Ficheros:**
- Crear: `apps/web/src/lib/family-plan-client.ts`
- Modificar: `apps/web/src/app/account/membership/page.tsx` (líneas 62–110: sustituir la rama por rol)
- Modificar: `apps/web/src/app/admin/members/requests/page.tsx` (sección «Plan requests»)

- [ ] **Paso 1: cliente**

```ts
// apps/web/src/lib/family-plan-client.ts
import { z } from "zod";
import { accountMemberProfileSchema } from "@bpt-jersey/domain/members/access";
import { memberPlanRequestInputSchema } from "@bpt-jersey/domain/members/engagement";
import { httpsCallable } from "./callable";
import { getFirebaseFunctions } from "./firebase-client";

const safe = "We couldn't load your plan right now. Try again.";
async function call<T>(name: string, data: unknown, schema: z.ZodType<T>, error = safe): Promise<T> {
  try {
    const response = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), name)(data);
    const parsed = schema.safeParse(response.data);
    if (parsed.success) return parsed.data;
  } catch { /* fixed message below */ }
  throw new Error(error);
}
export const listMyProfiles = () =>
  call("listMyMemberProfiles", {}, z.object({ profiles: z.array(accountMemberProfileSchema) })).then((r) => r.profiles);
export const requestMemberPlanPerson = (input: z.input<typeof memberPlanRequestInputSchema>) =>
  call("requestMemberPlanPerson", memberPlanRequestInputSchema.parse(input), z.object({ requestId: z.string() }),
    "We couldn't send your request. Check the details and try again.");
```

- [ ] **Paso 2: My plan.** La lista «para quién» sale de `listMyProfiles()` (A3). Cada perfil es una fila seleccionable; el de `via: "self"` se etiqueta «You». Debajo, dos tarjetas-botón: «Add a child» (siempre para `guardian`/`adultStudent`) y «Train yourself» (solo si ningún perfil tiene `via: "self"`). Ambas abren el mismo formulario (etiquetas encima: Full name — oculto en «Train yourself» —, Date of birth `<input type="date">`, Centre, Training times) y muestran al enviar: «Request sent. The office will confirm it shortly.»
- [ ] **Paso 2b: el teen no ve My plan ni pagos (B3).** Hoy **sí** los ve: `ClientAuthGate` permite `teenStudent` por defecto. Pasar `allow={["guardian", "adultStudent"]}` al `ClientAuthGate` de `apps/web/src/app/account/membership/page.tsx` (~469) y de `apps/web/src/app/account/billing/page.tsx` (~216), y ocultar el enlace «My plan» (y el de pagos, si está) para `teenStudent` en `apps/web/src/app/account/calendar/calendar-header.tsx`.
- [ ] **Paso 3: admin.** En `/admin/members/requests`, sección «Plan requests» con las pendientes (`listMemberPlanRequests`), botón «Approve» / «Reject» (`decideMemberPlanRequest`). Oculta si el callable da `not-found`.

- [ ] **Paso 4 (fase): verificar y commit**

Run: typecheck de domain, functions y web.

```bash
git add packages/domain/src/members/enrolment-request-contracts.ts apps/functions/src/members/enrolment-approval-service.ts apps/web/src/app/enrol/page.tsx apps/functions/src/family-plan apps/functions/src/index.ts apps/web/src/lib/family-plan-client.ts apps/web/src/app/account/membership apps/web/src/app/account/billing/page.tsx apps/web/src/app/account/calendar/calendar-header.tsx apps/functions/src/members/canonical-member-directory-service.ts apps/web/src/app/admin/members/requests/page.tsx
git commit -m "Let guardians train and add children or themselves from My plan"
```

---

## Fase 3 · Settings: fotos, visibilidad, acceso teen (B, Q2–Q4, Q9)

### Tarea 3.1: edad mínima 12 + ADR-019 + DPIA

**Ficheros:** `packages/domain/src/members/member-access-contracts.ts:4` y su test; crear `docs/adr/ADR-019-teen-access-from-12.md`; modificar `docs/operations/t011-dpia-draft.md`.

- [ ] **Paso 1:** `export const teenAccountMinimumAge = 12;` y test:

```ts
it("gives own access from 12 and guardian access until 18", () => {
  const base = { actorActive: true, academyMatches: true, memberAccessible: true, guardianLinkCurrent: false };
  expect(decideMemberAccess({ ...base, confirmedAge: 11, ownLinkApproved: true })).toEqual({ allowed: false });
  expect(decideMemberAccess({ ...base, confirmedAge: 12, ownLinkApproved: true })).toEqual({ allowed: true, via: "self" });
  expect(decideMemberAccess({ ...base, confirmedAge: 17, ownLinkApproved: false, guardianLinkCurrent: true })).toEqual({ allowed: true, via: "guardian" });
  expect(decideMemberAccess({ ...base, confirmedAge: 18, ownLinkApproved: false, guardianLinkCurrent: true })).toEqual({ allowed: false });
});
```

- [ ] **Paso 2:** ADR-019 (formato de ADR-018): contexto (Luis 23-sep, D5), decisión (acceso propio desde 12, creado y revocable por el tutor, sin verificación de email, bloqueo único a los 18 — Q4), consecuencias (datos de menores 12–15 con credencial propia; el tutor mantiene el control hasta los 18). En la DPIA, una fila nueva en el registro de tratamientos: «Teen own access (12–17)», base legal consentimiento del tutor, datos: email + hash de contraseña en Firebase Auth.

### Tarea 3.2: foto de perfil (R2 + `sharp`)

**Ficheros:**
- Modificar: `apps/functions/src/storage/r2-client.ts`, en el cliente real (~233-245) **y** en el del emulador (~383-405), porque hoy R2 rechazaría los avatares por tres lados:
  a) `assertObjectKey` exige el prefijo `academies/`: la clave es `academies/{academyId}/avatars/{studentId}/{uuid}.webp`.
  b) `putObject` solo admite png/jpeg bajo `/enrolment-proofs/`, `/course-proofs/`, `/membership-application-proofs/`: añadir `/avatars/` con `image/webp` y ≤ 2 MB.
  c) `createPrivateImageUrl` solo firma bajo `/course-proofs/` o `/membership-application-proofs/`, exige `expiresInSeconds === 60` y el cliente real firma con `{ expiresIn: 60 }` fijo: permitir `/avatars/` con `image/webp` y 900 s, y pasar `input.expiresInSeconds` al firmante (manteniendo 60 s obligatorio para los justificantes). El tipo de `contentType` (línea 38) pasa a `"image/jpeg" | "image/png" | "image/webp"`.
- Crear: `apps/functions/src/account-settings/profile-photo.ts`
- Crear: `apps/functions/src/account-settings/account-settings-service.ts`
- Modificar: `apps/functions/src/account-settings/account-settings-callables.ts`

**Interfaces:**
- Produce: `sanitiseAvatar(bytes: Buffer, mime: "image/jpeg" | "image/png" | "image/webp"): Promise<Buffer>`;
  `signPhotoUrl(r2: R2Client, objectKey: string | null, consentAt: string | null): Promise<string | null>` (la usan las fases 5 y 6);
  `readPublicSettings(db, academyId, studentId): Promise<MemberPublicSettingsDoc>` (con valores por defecto `showToMembers: true` y nulls).
- Callables: `uploadProfilePhoto(uploadProfilePhotoInput) → { photoUrl: string | null; pending: boolean }`, `removeProfilePhoto({ studentId }) → {}`, `approveProposedPhoto({ studentId }) → { photoUrl }`, `getMySettings({ studentId }) → { photoUrl, pendingPhotoUrl, showToMembers, canManage: boolean, teenAccess: { email, active } | null }`, `setMemberVisibility({ studentId, showToMembers }) → {}`.

- [ ] **Paso 1: saneado**

```ts
// apps/functions/src/account-settings/profile-photo.ts
import sharp from "sharp";
import type { R2Client } from "../storage/r2-client.js";

const maxBytes = 2 * 1024 * 1024;
const signatures: Record<string, (b: Buffer) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
};

export class PhotoRejected extends Error {}

/** Q3: size first, magic bytes, one decoded frame, then a fresh 512×512 WebP without metadata. */
export async function sanitiseAvatar(bytes: Buffer, mime: keyof typeof signatures): Promise<Buffer> {
  if (bytes.length === 0 || bytes.length > maxBytes || !signatures[mime]?.(bytes)) throw new PhotoRejected();
  try {
    const image = sharp(bytes, { limitInputPixels: 20_000_000, failOn: "warning", animated: false });
    const meta = await image.metadata();
    if ((meta.pages ?? 1) !== 1 || !meta.width || !meta.height) throw new PhotoRejected();
    return await image.rotate().resize(512, 512, { fit: "cover" }).webp({ quality: 82 }).toBuffer(); // sharp drops metadata unless withMetadata()
  } catch {
    throw new PhotoRejected();
  }
}

export async function signPhotoUrl(r2: R2Client, objectKey: string | null, consentAt: string | null): Promise<string | null> {
  if (!objectKey || !consentAt || !r2.createPrivateImageUrl) return null;
  return r2.createPrivateImageUrl({ objectKey, expiresInSeconds: 900, contentType: "image/webp" });
}
```

- [ ] **Paso 2: permisos (servicio).** Con `authorise(academyId, uid, studentId)`:
  - `via: "guardian"` → gestiona foto, visibilidad y acceso teen del hijo.
  - `via: "self"` y edad ≥ 18 → gestiona lo suyo.
  - `via: "self"` y edad < 18 (teen) → solo `uploadProfilePhoto`, que guarda en `pendingPhotoObjectKey` (B4); lo demás `permission-denied`.
  - Subida: `putObject(\`academies/${academyId}/avatars/${studentId}/${randomUUID()}.webp\`, webp, "image/webp")`, luego transacción que escribe `photoObjectKey`, `photoConsentAt = now`, `photoConsentBy = uid`; después `deleteObject` de la clave anterior (si falla, se registra y se sigue: huérfano inofensivo en bucket privado).
  - `removeProfilePhoto` pone todo a null y borra el objeto (Q2).
  - `PhotoRejected` → `invalid-argument` «Choose a single JPEG, PNG or WebP image under 2 MB.»
- [ ] **Paso 3: callables** con `secrets: enrolmentStorageSecrets` y `createPrivateStorageR2Client()` (patrón `course-callables.ts:53`). Exportarlos desde `account-settings-callables.ts` (ya re-exportado en `index.ts`).

### Tarea 3.3: acceso teen y bloqueo de los 18

**Ficheros:** `account-settings-service.ts`, `account-settings-callables.ts`; crear `apps/web/src/app/account/adult-claim.tsx`.

**Callables:** `createTeenAccess(teenAccessInput) → { email }`, `revokeTeenAccess({ studentId }) → {}`, `getAdultClaimStatus() → { required: boolean; studentId: string | null }`, `claimAdultAccount({ studentId }) → {}`.

- [ ] **Paso 1: `createTeenAccess`** (solo `via: "guardian"`; edad 12–17 con `memberAgeOn`; si no, `failed-precondition` «Own access is available from 12 to 17.»):
  1. `getAuth().createUser({ email, password, emailVerified: true, disabled: false })` (foco de revisión 1).
  2. `setCustomUserClaims(uid, { academyId, role: "teenStudent" })`.
  3. Escribir `users/{uid}` que valide `parseUserProfile` (`profile-contracts.ts` ~258-270): `accountType: "client"`, `active: true`, `status: "active"` y `phoneNumber` **no vacío** — el del alumno o, si no tiene, el del `users/{uid}` del tutor. No copiar la forma de `direct-staff-creation.ts` (escribe `phoneNumber: ""` y `accountType` de staff: el documento no validaría y `member-access-service` rechazaría al teen).
  4. `students/{studentId}.userId = uid` con el escritor canónico del directorio, no con un `set` directo, porque el documento lleva MAC de integridad. **Antes de escribir código**, comprueba en `canonical-member-directory-service.ts` si `updateAdminMember` permite fijar **y** quitar `userId`. Si no lo permite, añade un comando mínimo `setStudentAccountLink({ actor, studentId, userId: string | null, now })` en ese servicio que recalcule el MAC con el mismo código que usa `updateAdminMember`, y úsalo aquí y en el revocado.
  5. `teenAccess/{studentId}` con `createdBy`, `adultClaimedAt: null`, `revokedAt: null`.
  Si un paso falla tras crear el usuario, `deleteUser(uid)` y `unavailable`.
- [ ] **Paso 2: `revokeTeenAccess`** (solo tutor, solo si `adultClaimedAt === null`): `updateUser(uid, { disabled: true })`, `revokeRefreshTokens(uid)`, `users/{uid}.active = false`, quitar `userId` del alumno (mismo escritor canónico), `revokedAt = now`.
- [ ] **Paso 3: `getAdultClaimStatus`**: perfil `via: "self"` de la cuenta → `teenAccess/{studentId}` → `needsAdultClaim({ age, via: "self", createdByGuardian: doc exists && doc.uid === uid, adultClaimedAt })`.
- [ ] **Paso 4: `claimAdultAccount`**: exige `auth_time` de los últimos 5 min (el cliente reautentica antes), comprueba `needsAdultClaim`, escribe `adultClaimedAt = now` y `revokeRefreshTokens(uid)`. El cliente ya habrá llamado a `updatePassword`.
- [ ] **Paso 5: `adult-claim.tsx`**: si `getAdultClaimStatus().required`, sustituye `/account` por una tarjeta: título «You're 18 — this account is now yours.», texto «Set a new password to keep using it.», campos (etiquetas encima) «Current password», «New password» (≥ 10). Al enviar: `reauthenticateWithCredential` → `updatePassword` → `claimAdultAccount` → `signOut` y volver a `/login` con «Sign in with your new password». Errores con texto fijo. Montarlo en `apps/web/src/app/account/page.tsx` envolviendo `WaiverGate`.

### Tarea 3.4: pantalla Settings

**Ficheros:** crear `apps/web/src/lib/account-settings-client.ts`; reescribir `apps/web/src/app/account/settings/page.tsx`; crear `apps/web/src/app/account/settings/avatar-cropper.tsx`.

- [ ] **Paso 1: cliente** con el mismo `call()` que `family-plan-client.ts` (copiar la función de 8 líneas; no crear un módulo compartido para dos usos). Funciones: `getMySettings`, `uploadProfilePhoto`, `removeProfilePhoto`, `approveProposedPhoto`, `setMemberVisibility`, `createTeenAccess`, `revokeTeenAccess`.
- [ ] **Paso 2: recorte** con `<canvas>` nativo (Q3), sin librerías:

```tsx
// avatar-cropper.tsx — square centre crop to a 512×512 WebP data URL
export async function cropToSquareWebp(file: File): Promise<{ base64: string; mime: "image/webp" }> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 512, 512);
  const blob = await new Promise<Blob>((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error("crop"))), "image/webp", 0.85));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { base64: btoa(String.fromCharCode(...bytes)), mime: "image/webp" };
}
```

(ponytail: recorte centrado fijo; arrastrar para encuadrar solo si Luis lo pide.) Un fichero que el navegador no decodifica (p. ej. SVG) → `createImageBitmap` falla → «Choose a JPEG, PNG or WebP photo.»; el servidor vuelve a validar igualmente.

- [ ] **Paso 3: página.** Selector de persona (`listMyProfiles`). Por persona, secciones con `<h2>`:
  - **Photo**: avatar 96 px redondo (o iniciales), `<input type="file" accept="image/jpeg,image/png,image/webp">`, casilla obligatoria con el texto de B5 «I agree that this photo will be shown to other BPT Jersey members in the academy's internal leaderboard and class lists», botón «Upload photo» desactivado sin casilla, «Remove photo». Teen: botón «Suggest photo» y el texto «Your parent or guardian will approve it.». Tutor con propuesta pendiente: vista previa + «Approve photo».
  - **Visibility**: interruptor `<input type="checkbox" role="switch">` «Show me to other members» con ayuda «When off, you don't appear in other members' leaderboards or class lists. You still see your own position.»
  - **Own access** (solo tutor, solo hijos 12–17): sin acceso → email + contraseña (≥ 10) + «Create access»; con acceso → email + «Revoke access» (confirmación con `<dialog>`).
  - Cargando: esqueletos de la forma de cada sección. Error de carga: la sección no se muestra.

- [ ] **Paso 4 (fase): verificar y commit**

```bash
git add packages/domain/src/members/member-access-contracts.ts packages/domain/src/members/member-access-contracts.test.ts docs/adr/ADR-019-teen-access-from-12.md docs/operations/t011-dpia-draft.md apps/functions/src/storage/r2-client.ts apps/functions/src/members/canonical-member-directory-service.ts apps/functions/src/account-settings apps/web/src/lib/account-settings-client.ts apps/web/src/app/account/settings apps/web/src/app/account/adult-claim.tsx apps/web/src/app/account/page.tsx
git commit -m "Add member photos, visibility and teen own access to account settings"
```

---

## Fase 4 · Racha + próxima promoción (C, D)

### Tarea 4.1: el calendario pasa el participante seleccionado a sus huecos

**Ficheros:** `apps/web/src/app/account/calendar/member-calendar.tsx` (prop `topSlot`, línea 66/144; estado `selectedStudentId`, línea 151); `apps/web/src/app/account/page.tsx:48`.

**Produce:**
- `topSlot?: ReactNode | ((studentId: string) => ReactNode)`
- `gate?: (studentId: string) => ReactNode | null` — si devuelve algo, se pinta **en lugar de** la semana (lo usa la fase 7).

- [ ] **Paso 1:** en `MemberCalendar`, `const top = typeof topSlot === "function" ? (selectedStudentId ? topSlot(selectedStudentId) : null) : topSlot;` y `const blocked = selectedStudentId ? gate?.(selectedStudentId) ?? null : null;` → si `blocked`, renderizarlo donde va la rejilla de la semana (el selector de participantes sigue visible).
- [ ] **Paso 2:** en `page.tsx`: `topSlot={(studentId) => <><IntroNotices /><StreakPanel studentId={studentId} /></>}`.

### Tarea 4.2: `getMemberStreak` y `getPromotionOutlook`

**Ficheros:**
- Crear: `apps/functions/src/streak/streak-service.ts`; modificar `apps/functions/src/streak/streak-callables.ts`.
- Crear: `apps/functions/src/promotion/promotion-callables.ts`; modificar `apps/functions/src/index.ts`.

**Interfaces:**
- Produce: `readAttendedSessions(db, academyId, studentId, sinceIso): Promise<AttendedSession[]>` (la reutiliza la fase 5).
- Callables: `getMemberStreak({ studentId }) → MemberStreakSummary`, `getPromotionOutlook({ studentId }) → PromotionOutlook | null`.

- [ ] **Paso 1: asistencia.** Misma definición que `countedAttendance` (`apps/functions/src/levels/level-service.ts:1232`): estados `attended`/`late`, `correctionOf === null`, sin `courseId`, identidades del alumno (alias). Exporta `countedAttendance` desde `level-service.ts` en lugar de copiarla. Consulta: `attendance` `where("studentId", "in", identityIds)` y `where("occurredAt", ">=", sinceIso)`; si pide índice compuesto, añadirlo a `firestore.indexes.json`. Duración: `getAll` de `sessions/{sessionId}` de los registros → `(Date.parse(endAt) - Date.parse(startAt)) / 60000`; sesión que falta → 60 min (ponytail: valor por defecto, se registra en log).
- [ ] **Paso 2: racha.** `getMemberStreak`: `requireMemberAccountActor` → `authorise` → `readAttendedSessions(db, a, s, <inicio de la racha: now − 400 días>)` → `buildMemberStreakSummary({ attendances, now })` → `memberStreakSummarySchema.parse`.
- [ ] **Paso 3: promoción.** `getPromotionOutlook`: `authorise` → `getStudentProgressSummary(academyId, studentId)` (el store de `level-service.ts`) → si `state !== "initialized"` o `targetDefinition === null` o `progressPercent === null` → `null`. Si no:

```ts
const { required, completed } = summary.criteria.classes; // ProgressCriteriaSummary, level-contracts.ts:668
const classesToGo = required === null ? null : Math.max(0, required - completed);
return promotionOutlookSchema.parse({
  nextName: summary.targetDefinition.name, percent: summary.progressPercent, classesToGo,
  milestone: promotionMilestone({ percent: summary.progressPercent, classesToGo }),
  levelKey: summary.currentDefinition.definitionKey,
});
```

### Tarea 4.3: panel de racha y barra de promoción

**Ficheros:** crear `apps/web/src/lib/streak-client.ts` (`getMemberStreak`, `getPromotionOutlook` con el `call()` de 8 líneas); reescribir `apps/web/src/app/account/streak/streak-panel.tsx`; crear `apps/web/src/app/account/streak/streak-flame.tsx`, `apps/web/src/app/account/promotion/promotion-bar.tsx`; estilos en `apps/web/src/app/account/account.css`.

- [ ] **Paso 1: llama** (C5):

```tsx
"use client";
import { useEffect, useRef } from "react";

export function StreakFlame({ count }: Readonly<{ count: number }>) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    let dispose = () => {};
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches || count < 2;
    void import("lottie-web/build/player/lottie_light").then(({ default: lottie }) => {
      const anim = lottie.loadAnimation({ container: node, renderer: "svg", loop: !still, autoplay: !still, path: "/animations/streak-flame.json" });
      if (still) anim.addEventListener("DOMLoaded", () => anim.goToAndStop(0, true));
      dispose = () => anim.destroy();
    });
    return () => dispose();
  }, [count]);
  return (
    <div className="streak-flame">
      <div ref={box} className="streak-flame-art" aria-hidden="true" data-testid="streak-flame" />
      {count >= 2 ? <span className="streak-multiplier" aria-label={`${count} session streak`}>x{count}</span> : null}
    </div>
  );
}
```

- [ ] **Paso 2: panel** (orden C1): `<PromotionBar studentId>` → `<p class="account-eyebrow">Streak</p>` → `<StreakFlame>` → barra Goal → barra Reward → «{hours} h trained since September». Cada barra:

```tsx
function Bar({ bar, base, noun }: Readonly<{ bar: ProgressBar; base: number; noun: "goal" | "reward" }>) {
  const done = base - bar.remaining;
  return (
    <div className={`streak-bar${bar.almost ? " is-almost" : ""}`}>
      <div className="streak-bar-head"><span>{bar.label}</span><span>{bar.progress}/{bar.target}</span></div>
      <progress max={base} value={done} aria-label={`${bar.label}: ${bar.progress} of ${bar.target}`} />
      {bar.almost ? <p className="streak-bar-hint">Just x1 missing to get {noun}!</p> : null}
    </div>
  );
}
```

`base` = `defaultGoal.target` / `defaultReward.target`. CSS: `progress` con acento `#2F2483` al 70 % de opacidad; `.is-almost` al 100 % + `font-weight: 600` en la pista (Q, «mismo púrpura, más intenso»). Carga: esqueleto de la tarjeta con la misma altura. Error: `return null`.
- [ ] **Paso 3: barra de promoción** (D-1..D-3): «Next belt: {nextName}», `<progress max=100 value=percent>`, «{classesToGo} classes to go» si no es null. Aviso de hito bajo la barra, una vez por `levelKey + milestone`, guardado en `localStorage` con try/catch: «oneLeft» → «1 more class and your coach can assess you for {nextName}.»; «90» → «You're at 90% — your coach can assess you soon.»; «75» → «75% of the way to {nextName}.». `null` → no se renderiza.

- [ ] **Paso 4 (fase): verificar y commit**

```bash
git add apps/web/src/app/account/calendar/member-calendar.tsx apps/web/src/app/account/page.tsx apps/functions/src/streak apps/functions/src/promotion apps/functions/src/levels/level-service.ts apps/functions/src/index.ts apps/web/src/lib/streak-client.ts apps/web/src/app/account/streak apps/web/src/app/account/promotion apps/web/src/app/account/account.css firestore.indexes.json
git commit -m "Show the member streak, weekly targets and next promotion on the calendar"
```

---

## Fase 5 · Competitors (E, Q8–Q10)

### Tarea 5.1: filas públicas

**Ficheros:** crear `apps/functions/src/competitors/public-card.ts`.

**Produce:**
- `buildLeaderboardRows(db, academyId, nowIso): Promise<Map<LeaderboardCohort, LeaderboardRow[]>>`
- `toPublicCard(row: LeaderboardRow, r2: R2Client): Promise<MemberPublicCard>` (firma la foto solo si `photoObjectKey`; el consentimiento se comprueba al construir la fila).

- [ ] **Paso 1:** alumnos `active && status === "active"` con plan vivo (E6: consulta a las membresías activas como hace el directorio) y `leaderboardEligible(dateOfBirth)`.
- [ ] **Paso 1b: coste.** No llamar a `getStudentProgressSummary` alumno por alumno tal cual: cada llamada vuelve a leer el catálogo publicado y las sesiones asistidas (~150 alumnos ≈ 10–15k lecturas/noche). Cargar el catálogo **una vez** y reutilizarlo: si el store de `level-service.ts` no lo permite, añadirle un parámetro opcional con el catálogo ya leído. Objetivo: ≤ ~2 lecturas por alumno + las consultas globales.
- [ ] **Paso 2:** por alumno: asistencia de la temporada con **una** consulta global `attendance where occurredAt >= seasonStart` agrupada en memoria por `studentId` (mismas reglas de `countedAttendance`); `sessionStreak`; `getStudentProgressSummary` (belt = `{ name: currentDefinition.name, color: currentDefinition.visual.colors[0] ?? "#ffffff" }`, `stripes = currentDefinition.stripeNumber ?? 0`, `promotionPercent`, `beltScore(currentDefinition.sequence, progressPercent)`); `skillKeys` = `skillChecklist.filter(i => i.isCompleted).map(i => i.skillKey)`; ajustes de `memberPublicSettings` (`photoObjectKey` solo si `photoConsentAt`, `hidden = !showToMembers`).
- [ ] **Paso 3:** `publicDisplayNames` **por cohorte** (Q8).

### Tarea 5.2: snapshot nocturno + `getCompetitors`

**Ficheros:** crear `apps/functions/src/competitors/leaderboard-build.ts`; modificar `apps/functions/src/competitors/competitors-callables.ts`.

- [ ] **Paso 1: job**

```ts
export const buildLeaderboards = onSchedule(
  { schedule: "30 23 * * *", timeZone: "Europe/Jersey", timeoutSeconds: 540, memory: "512MiB", maxInstances: 1 },
  async () => {
    const academyId = coursesAcademyId.value(); if (!academyId) return;
    const db = getFirestore(); const now = new Date().toISOString();
    const cohorts = await buildLeaderboardRows(db, academyId, now);
    const batch = db.batch();
    for (const cohort of ["kids", "teens", "adults"] as const) {
      // ponytail: one document per cohort, ~1 KB a row → fine below ~800 members per cohort; shard by page past that.
      batch.set(db.doc(`academies/${academyId}/leaderboards/${cohort}`), leaderboardSnapshotSchema.parse({
        cohort, builtAt: now, seasonStart: seasonStartFor(now), rows: cohorts.get(cohort) ?? [],
      }));
    }
    await batch.commit();
  },
);
```

(`coursesAcademyId` de `apps/functions/src/courses/course-public-http.ts:10`.) Se re-exporta desde `competitors-callables.ts`.

- [ ] **Paso 2: `getCompetitors({ studentId })`**: `authorise` → cohorte del alumno (`leaderboardCohort` con su fecha; sin fecha → `{ cohort: "adults", builtAt: null, attendance: null, belt: null }`) → leer `leaderboards/{cohort}` → quitar filas `hidden` salvo la propia → `rankNeighbours({ entries, currentStudentId, score: r => r.attendancesSinceSeasonStart * 1000 + r.streakCount })` y `rankNeighbours({ ..., score: r => r.beltScore })` → `toPublicCard` a cada una de las ≤ 10 filas → `competitorsResponseSchema.parse`. Snapshot inexistente o alumno ausente (alta de hoy) → `attendance: null, belt: null`, y la UI muestra «Your place appears after tonight's update.».

### Tarea 5.3: página Competitors

**Ficheros:** crear `apps/web/src/lib/competitors-client.ts`; reescribir `apps/web/src/app/account/competitors/page.tsx`; crear `apps/web/src/app/account/competitors/member-card-dialog.tsx` (lo reutiliza la fase 6).

- [ ] **Paso 1:** selector de participante (`listMyProfiles`); pestañas «Attendance» / «Belt» (`role="tablist"`). Cada tabla: 5 filas máximo, `<ol>` con la fila propia resaltada (`aria-current="true"`, fondo púrpura al 8 %), cada fila = avatar 40 px o iniciales + nombre + cinturón (muestra de color + «N stripes») + racha «xN» + (Attendance) «N sessions» o (Belt) «N%». Pie: «Updated nightly» + hora de `builtAt`.
- [ ] **Paso 2:** tocar una fila ajena abre `MemberCardDialog` (`<dialog>` nativo, `showModal()`): foto 96 px, nombre, cinturón, racha, sesiones de la temporada, y el comparador: `compareTechniques(mine.skillKeys, theirs.skillKeys)` → dos listas «They have, you don't» / «You have, they don't» (máx. 12 elementos + «+N more»). Las claves se muestran con su `displayLabel` si la página ya tiene el catálogo; si no, la clave legible (`skill-key` → «Skill key»).
- [ ] **Paso 3:** esqueleto de 5 filas; error → la página muestra «Competitors aren't available right now.» (es la página propia, no un hueco de otra).

- [ ] **Paso 4 (fase): verificar y commit**

```bash
git add apps/functions/src/competitors apps/web/src/lib/competitors-client.ts apps/web/src/app/account/competitors
git commit -m "Rank members against their age group with a nightly leaderboard"
```

---

## Fase 6 · Detalle de sesión reservada (F)

### Tarea 6.1: `getSessionDetail`

**Ficheros:** crear `apps/functions/src/session-roster/session-roster-callables.ts`; modificar `apps/functions/src/index.ts`.

**Callable:** `getSessionDetail({ sessionId, studentId }) → SessionDetailResponse`.

- [ ] **Paso 1:** `authorise` → reserva confirmada de `studentId` (o alias) en `sessionId` (mismo lector que `requireConfirmedBooking` de `attendance-transaction-service.ts`); si no, `permission-denied` (R9).
- [ ] **Paso 2:** `curriculum` = `session.curriculum ?? null`.
- [ ] **Paso 3:** roster = reservas confirmadas de la sesión. Cohorte de quien mira = `leaderboardCohort` de `studentId`. Para cada reservado: si es el propio → `{ card, isYou: true }`; si misma cohorte, `leaderboardEligible` y `showToMembers` → fila del snapshot `leaderboards/{cohort}` (si no está en el snapshot: tarjeta mínima con nombre de `publicDisplayNames` sobre el roster, sin progreso) → `toPublicCard`; si no → `hiddenCount += 1` (R10, foco 4).

### Tarea 6.2: diálogo de detalle

**Ficheros:** crear `apps/web/src/lib/session-roster-client.ts`, `apps/web/src/app/account/session-detail/session-detail-dialog.tsx`; modificar `apps/web/src/app/account/calendar/session-card.tsx:96` (rama `status === "booked"`).

- [ ] **Paso 1:** en la rama «booked» (no cursos), el título de la tarjeta pasa a `<button type="button" className="session-card-open">` que abre `<SessionDetailDialog sessionId studentId onClose />`. Las demás tarjetas no cambian.
- [ ] **Paso 2:** el diálogo (`<dialog>` + `showModal()`, cierre con Esc y botón «Close»): sección «Plan for this class» (título, lista de técnicas, detalles; o «The coach hasn't published the plan for this class yet.»); sección «Who's coming» (lista de avatares + nombre; el propio con «You»; «+N members from other age groups» si `hiddenCount > 0`). Tocar a alguien abre `MemberCardDialog` (5.3) con esa tarjeta. Esqueleto mientras carga; error → «We couldn't load this class. Try again.» + «Retry».

- [ ] **Paso 3 (fase): verificar y commit**

```bash
git add apps/functions/src/session-roster apps/functions/src/index.ts apps/web/src/lib/session-roster-client.ts apps/web/src/app/account/session-detail apps/web/src/app/account/calendar/session-card.tsx
git commit -m "Show the class plan and who is coming on a booked session"
```

---

## Fase 7 · Disclaimer: bloqueo + auditoría (G, Q5)

El servidor **ya** rechaza la reserva de un miembro sin waiver (`booking-transaction-service.ts:729-741`, D12). No se toca.

### Tarea 7.1: callables de estado

**Ficheros:** crear `apps/functions/src/disclaimer-status/disclaimer-status-callables.ts`; modificar `apps/functions/src/index.ts`.

- `getMyDisclaimerStatus() → { participants: { studentId, fullName, terms: boolean, disclaimers: boolean }[] }`: para cada perfil de `listProfiles`, `terms` = `hasAcceptedEnrolmentWaiver` (con una transacción de solo lectura) y `disclaimers` = sin disclaimers T117 pendientes (servicio de `apps/functions/src/consents/disclaimer-service.ts`, el que alimenta `DisclaimersPanel`).
- `listDisclaimerAcceptances({ missingOnly: boolean }) → { rows: { studentId, fullName, termsVersion: string | null, termsAcceptedAt: string | null, disclaimers: boolean }[] }`: solo `owner`/`administrator` (nunca coach), alumnos activos.

### Tarea 7.2: bloqueo por participante que falla cerrado

**Ficheros:** crear `apps/web/src/lib/disclaimer-status-client.ts`; modificar `apps/web/src/app/account/waiver-acceptance.tsx` y `apps/web/src/app/account/page.tsx`.

- [ ] **Paso 1:** `WaiverGate` ya no bloquea la cuenta entera. Exporta además `useDisclaimerStatus()` (carga `getMyDisclaimerStatus`, expone `status | "error"` y `retry()`), y `DisclaimerBlock({ studentId })`, que devuelve:
  - `"error"` → tarjeta «We couldn't check your terms.» + botón «Retry» (foco 5; **nunca** el calendario).
  - participante con `terms === false || disclaimers === false` → tarjeta «{fullName} needs to accept the academy terms before booking.» + enlace-botón «Review and accept» → `/account/waiver`.
  - si no → `null`.
- [ ] **Paso 2:** en `page.tsx`: `gate={(studentId) => <DisclaimerBlock studentId={studentId} />}` (el slot de 4.1) y, arriba del calendario, un banner con los **otros** participantes pendientes: «{names} still need to accept the academy terms.» + enlace. Settings, My plan y logout no pasan por aquí (R14). La página `/account/waiver` conserva el formulario de aceptación que hoy vive dentro de `WaiverGate` (mover el JSX, no duplicarlo).

### Tarea 7.3: «Acceptances» en admin

**Ficheros:** crear `apps/web/src/app/admin/waivers/acceptances.tsx`; modificar `apps/web/src/app/admin/waivers/page.tsx` (pestañas).

- [ ] **Paso 1:** tabla: Member · Terms (✓ versión + fecha / ✗ Missing) · Disclaimers (✓ / ✗). Controles: casilla «Missing only», búsqueda por nombre (`<input type="search">`, filtra en cliente), «Download CSV» (Blob + `URL.createObjectURL`, columnas `name,terms_version,terms_accepted_at,disclaimers`; escapar comillas y prefijar con `'` celdas que empiecen por `= + - @` para evitar inyección de fórmulas). Radio 0 (fuera de `/account`).

- [ ] **Paso 2 (fase): verificar y commit**

```bash
git add apps/functions/src/disclaimer-status apps/functions/src/index.ts apps/web/src/lib/disclaimer-status-client.ts apps/web/src/app/account/waiver-acceptance.tsx apps/web/src/app/account/page.tsx apps/web/src/app/admin/waivers
git commit -m "Block each member without current terms and let the office audit acceptances"
```

---

## Fase 8 · Pulido visual

### Tarea 8.1: pasada de diseño sobre todas las pantallas nuevas

**Pantallas:** `/enrol` (casilla nueva), `/account` (racha, promoción, bloqueo, banner, detalle de sesión, bloqueo de 18), `/account/membership`, `/account/settings`, `/account/competitors`, `/admin/members/requests`, `/admin/waivers` → Acceptances.

- [ ] **Paso 1:** arrancar la vista previa aislada: `BPT_ISOLATED_PREVIEW=true corepack pnpm --filter @bpt-jersey/web exec next dev -p 3100 -H 127.0.0.1` y capturar cada pantalla a 360×800 y 1440×900 con Playwright interceptando los callables con datos sintéticos (0, 9, 10 y 24 asistencias; cohorte de 7 adultos; roster con ocultos).
- [ ] **Paso 2:** `/impeccable` (auditoría + pulido), `/taste-skill` y `/redesign-skill` sobre esas capturas, con `DESIGN.md` §9 como contrato. Corregir: desbordes a 360 px, alturas de botón < 3.15rem, radios, contraste AA, foco visible, copy UK.
- [ ] **Paso 3:** commit `Polish the member gamification screens`.

---

## Fase 9 · Verificación

### Tarea 9.1: unitarios de dominio

- [ ] Run: `corepack pnpm vitest run --project node packages/domain/src/memberships/participant-band.test.ts packages/domain/src/members/member-engagement-contracts.test.ts packages/domain/src/members/member-access-contracts.test.ts packages/domain/src/members/member-overview-contracts.test.ts packages/domain/src/schedule`
  y `corepack pnpm vitest run --project web apps/web/src/lib/participant-band.test.ts`
  Esperado: todos PASS (R1, R2, R3, R6, R7, R12, R13, R17). Si un test previo de `schedule` fija el corte de 18 para `participantTypeOn`, se actualiza a 16 (D6), no se revierte el código.
- [ ] Para cada guarda nueva (`leaderboardEligible`, `needsAdultClaim`, corte 12/16): invertirla a mano, comprobar que su test falla y restaurarla (LECCIONES §4).

### Tarea 9.2: rules

**Fichero:** `qa/rules/default-deny.test.ts`.

- [ ] Añadir, para un cliente autenticado miembro, lectura y escritura denegadas en `academies/a/leaderboards/adults`, `academies/a/memberPublicSettings/s1`, `academies/a/teenAccess/s1`, `academies/a/memberPlanRequests/r1` (mismo estilo que los casos existentes del fichero).
- [ ] Run: `corepack pnpm test:rules` → PASS (R18).

### Tarea 9.3: E2E contra emuladores

**Ficheros:** crear `qa/scripts/seed-member-engagement-emulator.mjs`, `qa/scripts/run-member-engagement-ui-e2e.mjs` (copia del patrón de `qa/scripts/run-family-achievement-ui-e2e.mjs`, con flag `MEMBER_ENGAGEMENT_UI_EMULATOR_E2E=true` y `--project=desktop-chromium --project=mobile-chromium`), `qa/tests/member-engagement-auth-emulator.spec.ts`, `qa/fixtures/avatar.png` (PNG 800×600 sintético), `qa/fixtures/evil.svg`.

**Semilla** (`demo-bpt-jersey`, todo sintético): tutor-alumno con hijos de 13 y 9; 7 adultos, 3 teens, 3 kids con asistencias variadas (uno con 9 esta temporada, otro con 24); un adulto oculto; un adulto sin waiver; una sesión reservada con currículum y 6 reservados (2 de otra cohorte, 1 oculto); snapshot generado invocando la lógica de `buildLeaderboards` desde la semilla.

- [ ] **Casos** (cada uno en desktop y mobile; `trackBrowserHealth` como en `family-achievement-auth-emulator.spec.ts`: sin errores de consola ni lecturas directas a Firestore):
  1. **Avatar**: Settings → sin casilla, el botón está desactivado → sube `evil.svg` → mensaje de error → sube `avatar.png` con casilla → la imagen visible tiene `src` firmado de R2/emulador y mide 512×512 (R11).
  2. **Racha**: el alumno con 9 asistencias ve «Just x1 missing to get goal!» y `.is-almost`; `data-testid="streak-flame"` contiene un `<svg>`; «x3» visible; con `page.emulateMedia({ reducedMotion: "reduce" })` la llama no anima (dos capturas del contenedor separadas 500 ms son idénticas) (R3–R5).
  3. **Competitors**: adulto en mitad de tabla ve exactamente 2 arriba y 2 abajo; el primero ve 0 arriba; el oculto no aparece; el teen de 13 no ve adultos; el diálogo muestra «They have, you don't» (R2, R7, R8).
  4. **Detalle de sesión**: tocar la sesión reservada → «Plan for this class» con las técnicas sembradas, 3 nombres + «You», «+3 members from other age groups»; tocar un nombre abre su tarjeta (R9, R10).
  5. **Disclaimer**: el adulto sin waiver ve la tarjeta de bloqueo, no la semana; Settings sí abre; con `page.route("**/getMyDisclaimerStatus", r => r.fulfill({ status: 500 }))` se ve «Retry» y no la semana (R14, foco 5).
  6. **Acceso teen**: el tutor crea acceso para el hijo de 13 → login del teen → ve su calendario sin My plan → el tutor revoca → el login del teen falla (R12, foco 1). El hijo de 9 no tiene la sección «Own access».
  7. **Admin**: owner abre `/admin/waivers` → Acceptances → «Missing only» lista exactamente al adulto sin waiver; un coach no ve la pestaña (R15).
  8. **My plan**: el tutor-alumno ve «You» + 2 hijos; «Add a child» envía y aparece en `/admin/members/requests`; aprobar → el hijo aparece en My plan (R16).
- [ ] Run (📍 VPS, `/root/BPT-Jersey`, emuladores en Docker según la memoria `vps-emulators-docker-sparse`): `FUNCTIONS_DISCOVERY_TIMEOUT=300000 firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions "node qa/scripts/run-member-engagement-ui-e2e.mjs"` → 16 PASS (8 casos × 2 proyectos).

### Tarea 9.4: cierre

- [ ] `superpowers:verification-before-completion` con la salida real de 9.1–9.3.
- [ ] `superpowers:requesting-code-review` sobre `git diff <commit-de-inicio>..HEAD` (seguridad: permisos por participante, fotos, CSV; `/security-best-practices` y `/frontend-security-coder` como lentes).
- [ ] Corregir hallazgos → commit.
- [ ] Pedir a Luis el OK para: (1) push a `origin/main` (publica la web); (2) `firebase deploy --only` de esta lista exacta: `functions:requestMemberPlanPerson,functions:listMemberPlanRequests,functions:decideMemberPlanRequest,functions:approveEnrolmentRequest,functions:submitEnrolmentRequest,functions:uploadProfilePhoto,functions:removeProfilePhoto,functions:approveProposedPhoto,functions:getMySettings,functions:setMemberVisibility,functions:createTeenAccess,functions:revokeTeenAccess,functions:getAdultClaimStatus,functions:claimAdultAccount,functions:getMemberStreak,functions:getPromotionOutlook,functions:buildLeaderboards,functions:getCompetitors,functions:getSessionDetail,functions:getMyDisclaimerStatus,functions:listDisclaimerAcceptances` más las funciones de la fase 1 cuyo código cambió (listar con `git diff --name-only` sobre `apps/functions/src/memberships` y `schedule`). Índices, si 4.2 añadió alguno: `firestore:indexes`.

## Fuera de alcance

Alias elegidos por el miembro; avisos por correo; metas configurables por el owner; ranking en tiempo real;
recorte con arrastre; dependientes ≥ 18 (Q11).
