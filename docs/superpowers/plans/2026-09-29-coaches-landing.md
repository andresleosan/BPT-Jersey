# Coaches de la landing desde la base de datos — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** «The coaching team» de bptjersey.com muestra automáticamente los coaches activos que tienen cinturón. Crear, desactivar o borrar un coach en `/admin/staff` se refleja en la landing en ≤ 60 s.

**Architecture:**
- El perfil de staff (`academies/{id}/staff/{staffId}`) gana el campo opcional `belt`.
- Una función HTTP pública, `coachesPublic`, cruza los perfiles activos con Firebase Auth y devuelve solo `{name, belt, beltLabel}`, ya ordenado.
- La landing, que es un export estático, la consulta al cargar.
- El owner gestiona el cinturón y el borrado desde el Team directory, con dos callables nuevos: `setCoachBelt` y `deleteCoachAccount`.

**Tech Stack:** Next.js 16 (static export) + React 19, Firebase Functions v2 (Node 22, región global `europe-west9`), Firestore, Firebase Auth, zod 4, pnpm workspace (`@bpt-jersey/domain`, `@bpt-jersey/functions`, `@bpt-jersey/web`).

**Spec:** `docs/superpowers/specs/2026-09-29-coaches-landing-design.md`. Si una sección contradice D8–D12, mandan D8–D12.

## Global Constraints

- Repo: `/root/BPT-Jersey`. Se trabaja en `main` local. **Sin ramas, worktrees ni PR.**
- Commit con la identidad del repo: `git -c user.name=Luis -c user.email=luismadef45@gmail.com commit …`. El mensaje termina con `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Nunca `git add -A`**: hay trabajo ajeno sin commitear (`qa/.tmp-*`, `docs/reviews/…`). Añade solo los archivos de la tarea.
- **No se añaden ni se ejecutan tests automáticos** (AGENTS.md de BPT-Jersey). La verificación es la de la Tarea 7 (emulador) y la de la Tarea 8 (producción).
- **No hay push ni deploy hasta la Tarea 8**, y esa tarea pide el OK de Luis antes de cualquier escritura en producción.
- Cinturones permitidos, en rango descendente: `red-9, coral-8, coral-7, black-6, black-5, black-4, black-3, black-2, black-1, black, brown, purple, blue`.
- En la landing solo pueden salir `name`, `belt` y `beltLabel`. **Nunca** uid, email, teléfono ni rol.
- Solo el owner puede borrar. Owner y administrator pueden poner el cinturón, porque ambos pueden crear coaches.
- `academyContent.instructors` (`apps/web/src/content/academy.ts`) **no se toca** (D8).
- Textos de interfaz en inglés, como el resto del admin.

## Review Focus

No hay tests unitarios por regla del proyecto, así que cada punto tiene su comprobación en la Tarea 7:

1. **Coach ascendido a administrator u owner** con «Change role»: su perfil de staff sigue activo y con cinturón, pero **no debe salir** en la landing (se filtra por claim de Auth). → Tarea 7, paso 7.
2. **Login deshabilitado o borrado en Auth** con el perfil de staff aún activo: no sale en la landing. → Tarea 7, paso 8.
3. **Endpoint caído o sin configurar**: la landing oculta el bloque, el resto de la página se pinta y no aparece nada roto. → Tarea 7, paso 9.
4. **Borrado reintentado tras un fallo parcial** (Auth ya borrado, el batch de Firestore falló): el segundo intento termina el trabajo. → Tarea 7, paso 10.
5. **Coach asignado solo mediante `instructorIds`** (sesión con varios trainers) o en una clase recurrente activa: **bloquea** el borrado. → Tarea 7, pasos 11–12.

---

### Task 1: Contratos de dominio — cinturones, perfil con `belt` y esquemas nuevos

**Files:**
- Modify: `packages/domain/src/staff/team-access-contracts.ts` (añadir al final; cambiar `teamDirectoryPersonSchema`, líneas 16–21)
- Modify: `packages/domain/src/staff/staff-contracts.ts` (tipo `StaffProfile`, líneas 15–27; `staffProfileFields`, líneas 44–56; `parseStaffProfile`, líneas 161–195)

**Interfaces:**
- Produces, en `@bpt-jersey/domain/staff/team-access`:
  - `coachBelts` (tupla readonly), `coachBeltSchema` (z.enum), `type CoachBelt`, `coachBeltLabels: Record<CoachBelt, string>`
  - `teamDirectoryPersonSchema` con `belt: CoachBelt | null`
  - `setCoachBeltSchema` → `{ userId: string; belt: CoachBelt }`; `setCoachBeltResultSchema` → `{ belt: CoachBelt }`
  - `deleteCoachAccountSchema` → `{ userId: string }`; `deleteCoachAccountResultSchema` → `{ deleted: true }`
  - `publicCoachSchema` → `{ name, belt, beltLabel }`, `type PublicCoach`, `publicCoachesResponseSchema` → `{ coaches: PublicCoach[] }`
- Produces, en `@bpt-jersey/domain/staff`: `StaffProfile.belt?: CoachBelt`. `parseStaffProfile` acepta documentos con o sin `belt`.

- [ ] **Step 1: Añadir los cinturones y los esquemas en `team-access-contracts.ts`**

Justo después de `teamRoleLabels` (línea 11), añade:

```ts
/** Rank order, highest first: the index is the order on the landing page. */
export const coachBelts = [
  "red-9",
  "coral-8",
  "coral-7",
  "black-6",
  "black-5",
  "black-4",
  "black-3",
  "black-2",
  "black-1",
  "black",
  "brown",
  "purple",
  "blue",
] as const;
export const coachBeltSchema = z.enum(coachBelts);
export type CoachBelt = z.infer<typeof coachBeltSchema>;
export const coachBeltLabels: Readonly<Record<CoachBelt, string>> = {
  "red-9": "Red belt, 9th degree",
  "coral-8": "Coral belt, 8th degree",
  "coral-7": "Coral belt, 7th degree",
  "black-6": "6th degree black belt",
  "black-5": "5th degree black belt",
  "black-4": "4th degree black belt",
  "black-3": "3rd degree black belt",
  "black-2": "2nd degree black belt",
  "black-1": "1st degree black belt",
  black: "Black belt",
  brown: "Brown belt",
  purple: "Purple belt",
  blue: "Blue belt",
};
```

Sustituye `teamDirectoryPersonSchema` por:

```ts
export const teamDirectoryPersonSchema = z.strictObject({
  userId: z.string().min(1).max(128),
  name: z.string().max(256),
  email: z.string().max(320).nullable(),
  role: teamRoleSchema,
  belt: coachBeltSchema.nullable(),
});
```

Al final del archivo, añade:

```ts
export const setCoachBeltSchema = z.strictObject({
  userId: z.string().min(1).max(128),
  belt: coachBeltSchema,
});
export const setCoachBeltResultSchema = z.strictObject({ belt: coachBeltSchema });
export const deleteCoachAccountSchema = z.strictObject({ userId: z.string().min(1).max(128) });
export const deleteCoachAccountResultSchema = z.strictObject({ deleted: z.literal(true) });
export const publicCoachSchema = z.strictObject({
  name: z.string().min(1).max(256),
  belt: coachBeltSchema,
  beltLabel: z.string().min(1).max(64),
});
export const publicCoachesResponseSchema = z.strictObject({
  coaches: z.array(publicCoachSchema).max(100),
});
export type PublicCoach = z.infer<typeof publicCoachSchema>;
export type SetCoachBeltInput = z.infer<typeof setCoachBeltSchema>;
export type DeleteCoachAccountInput = z.infer<typeof deleteCoachAccountSchema>;
```

- [ ] **Step 2: Hacer que `parseStaffProfile` acepte `belt` como campo opcional**

Esto es crítico. Hoy `parseStaffProfile` rechaza cualquier campo extra (`hasExactFields`). Sin este paso, un perfil con `belt` rompería `/admin/staff`, los niveles (`level-authorization.ts`, `level-service.ts`) y el login de staff.

En `staff-contracts.ts`, añade el import tras los existentes:

```ts
import { coachBelts, type CoachBelt } from "./team-access-contracts";
```

En el tipo `StaffProfile`, añade tras `role: StaffRole;`:

```ts
  /** Shown on the public landing page when set; absent on legacy profiles. */
  belt?: CoachBelt;
```

Después de la constante `staffProfileFields`, añade:

```ts
const staffProfileFieldsWithBelt = Object.freeze([...staffProfileFields, "belt"] as const);
```

En `parseStaffProfile`, sustituye la línea

```ts
    if (!hasExactFields(value, staffProfileFields)) issues.push(issue([], "unexpected_property"));
```

por

```ts
    const hasBelt = Object.hasOwn(value, "belt");
    const fields = hasBelt ? staffProfileFieldsWithBelt : staffProfileFields;
    if (!hasExactFields(value, fields)) issues.push(issue([], "unexpected_property"));
    if (hasBelt && !coachBelts.includes(value.belt as CoachBelt)) {
      issues.push(issue(["belt"], "unknown_belt"));
    }
```

- [ ] **Step 3: Revisar el diff**

Ejecuta: `git -C /root/BPT-Jersey diff --stat`
Esperado: solo cambian los dos archivos de `packages/domain/src/staff/`.

- [ ] **Step 4: Commit**

```bash
cd /root/BPT-Jersey
git add packages/domain/src/staff/team-access-contracts.ts packages/domain/src/staff/staff-contracts.ts
git -c user.name=Luis -c user.email=luismadef45@gmail.com commit -m "feat(staff): coach belts in the domain and optional belt on staff profiles

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Functions — crear con cinturón, `setCoachBelt` y cinturón en el Team directory

**Files:**
- Modify: `apps/functions/src/staff/direct-staff-creation.ts` (esquema, línea 10; mensaje, línea 12; `batch.create` del staff, línea 20)
- Create: `apps/functions/src/staff/coach-account-callables.ts`
- Modify: `apps/functions/src/staff/team-access.ts` (`TeamAccessServices`, líneas 23–46; `listTeamDirectoryHandler`, líneas 78–99)
- Modify: `apps/functions/src/staff/team-access-callables.ts` (objeto de `services()`, líneas 25–28)
- Modify: `apps/functions/src/index.ts` (exports)

**Interfaces:**
- Consumes (Tarea 1): `coachBeltSchema`, `setCoachBeltSchema`, `type CoachBelt`
- Produces:
  - callable `setCoachBelt({ userId, belt }) → { belt }`;
  - helper exportado `coachProfiles(db, academyId, userId): Promise<QueryDocumentSnapshot[]>`, que usa la Tarea 3;
  - `listTeamDirectory` devuelve `belt` en cada persona;
  - `createStaffWithPassword` acepta `belt`, obligatorio si `role === "coach"`.

- [ ] **Step 1: El cinturón es obligatorio al crear un coach**

En `direct-staff-creation.ts`, añade al import de dominio (arriba):

```ts
import { coachBeltSchema } from "@bpt-jersey/domain/staff/team-access";
```

Sustituye `directStaffInputSchema` (línea 10) por:

```ts
export const directStaffInputSchema = z
  .strictObject({ displayName: z.string().trim().min(2).max(160), email: z.email().trim().toLowerCase().max(320), password: z.string().min(12).max(128), role: z.enum(["coach","administrator","owner"]), belt: coachBeltSchema.optional() })
  .refine((value) => (value.role === "coach") === (value.belt !== undefined));
```

En la línea 12, cambia el mensaje por:

```ts
"Enter a name, email, role, a belt for coaches, and a password of 12 to 128 characters."
```

En la línea 20 (el `batch.create` de `staff`), sustituye `role: "coach", active: true,` por:

```ts
role: "coach", belt: input.data.belt, active: true,
```

- [ ] **Step 2: Crear `coach-account-callables.ts` con `coachProfiles` y `setCoachBelt`**

```ts
import { randomUUID } from "node:crypto";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { setCoachBeltSchema } from "@bpt-jersey/domain/staff/team-access";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireActiveOfficeActor } from "../auth/office-actor.js";

/** Staff profiles of one login. Direct accounts use staffId === uid; invited ones do not. */
export async function coachProfiles(db: Firestore, academyId: string, userId: string) {
  return (await db.collection(`academies/${academyId}/staff`).where("userId", "==", userId).get()).docs;
}

export const setCoachBelt = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  const input = setCoachBeltSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Choose a belt from the list.");
  const db = getFirestore();
  const profiles = await coachProfiles(db, actor.academyId, input.data.userId);
  if (profiles.length === 0) throw new HttpsError("failed-precondition", "This account has no coach profile.");
  const now = new Date().toISOString();
  const batch = db.batch();
  for (const profile of profiles) batch.update(profile.ref, { belt: input.data.belt, updatedAt: now, updatedBy: actor.userId });
  batch.create(db.collection(`academies/${actor.academyId}/auditEvents`).doc(), { eventId: randomUUID(), academyId: actor.academyId, actorId: actor.userId, action: "staff.coach_belt_set", targetRef: `academies/${actor.academyId}/users/${input.data.userId}`, purpose: "coach belt shown on the website", correlationId: input.data.userId, occurredAt: now, schemaVersion: "1" });
  await batch.commit();
  return { belt: input.data.belt };
});
```

- [ ] **Step 3: El Team directory devuelve el cinturón**

En `team-access.ts`, añade `type CoachBelt` al import de `@bpt-jersey/domain/staff/team-access`. Dentro de `TeamAccessServices`, antes de `now(): Date;`, añade:

```ts
  /** userId → belt of the active or inactive coach profile. Optional so older fakes keep compiling. */
  coachBelts?(academyId: string): Promise<ReadonlyMap<string, CoachBelt>>;
```

En `listTeamDirectoryHandler`, justo después de `const page = await services.auth.listUsers(...)`, añade:

```ts
  const belts = (await services.coachBelts?.(actor.academyId)) ?? new Map<string, CoachBelt>();
```

En el `.map((user) => ({ ... }))`, añade tras `role: user.customClaims!.role,`:

```ts
      belt: belts.get(user.uid) ?? null,
```

En `team-access-callables.ts`, añade este import:

```ts
import { coachBeltSchema, type CoachBelt } from "@bpt-jersey/domain/staff/team-access";
```

En el objeto que devuelve `services()`, añade después de `now: () => new Date(),`:

```ts
    async coachBelts(academyId) {
      const snapshot = await firestore.collection(`academies/${academyId}/staff`).get();
      const belts = new Map<string, CoachBelt>();
      for (const doc of snapshot.docs) {
        const belt = coachBeltSchema.safeParse(doc.data().belt);
        if (belt.success && typeof doc.data().userId === "string") belts.set(doc.data().userId, belt.data);
      }
      return belts;
    },
```

- [ ] **Step 4: Exportar el callable**

En `apps/functions/src/index.ts`, debajo de `export { createStaffWithPassword } from "./staff/direct-staff-creation.js";` (línea 297), añade:

```ts
export { setCoachBelt } from "./staff/coach-account-callables.js";
```

- [ ] **Step 5: Commit**

```bash
cd /root/BPT-Jersey
git add apps/functions/src/staff/direct-staff-creation.ts apps/functions/src/staff/coach-account-callables.ts apps/functions/src/staff/team-access.ts apps/functions/src/staff/team-access-callables.ts apps/functions/src/index.ts
git -c user.name=Luis -c user.email=luismadef45@gmail.com commit -m "feat(staff): set a coach's website belt and require it when creating a coach

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Functions — `deleteCoachAccount` (solo owner, bloqueado si tiene clases futuras)

**Files:**
- Modify: `apps/functions/src/staff/coach-account-callables.ts`
- Modify: `apps/functions/src/index.ts`

**Interfaces:**
- Consumes: `coachProfiles` (Tarea 2) y `deleteCoachAccountSchema` (Tarea 1)
- Produces: callable `deleteCoachAccount({ userId }) → { deleted: true }`. Si hay bloqueos, lanza `failed-precondition` con un mensaje legible que el cliente muestra tal cual (Tarea 5).

**Orden deliberado (hace seguro el reintento, Review Focus 4):**
1. Comprobar los bloqueos.
2. **Borrar el login de Auth.** Desde ese momento `coachesPublic` ya no lo muestra, porque exige el usuario en Auth.
3. Ejecutar el batch de Firestore.

Si el paso 3 falla, reintentar funciona: `user` llega como `null` y quedan perfiles, así que continúa.

- [ ] **Step 1: Añadir el callable**

En `coach-account-callables.ts`, amplía los imports:

```ts
import { getAuth } from "firebase-admin/auth";
import { deleteCoachAccountSchema, setCoachBeltSchema } from "@bpt-jersey/domain/staff/team-access";
```

Al final del archivo, añade:

```ts
function upcomingLabel(title: unknown, startAt: string): string {
  return `${typeof title === "string" && title ? title : "Session"} on ${startAt.slice(0, 16).replace("T", " ")}`;
}

export const deleteCoachAccount = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  if (actor.role !== "owner") throw new HttpsError("permission-denied", "Only an owner can delete a coach.");
  const input = deleteCoachAccountSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Choose a coach to delete.");
  const { userId } = input.data;
  const auth = getAuth();
  const db = getFirestore();
  const base = db.doc(`academies/${actor.academyId}`);
  const user = await auth.getUser(userId).catch((error: { code?: string }) => {
    if (error.code === "auth/user-not-found") return null;
    throw error;
  });
  if (user && (user.customClaims?.academyId !== actor.academyId || !["coach", "headCoach"].includes(String(user.customClaims?.role)))) {
    throw new HttpsError("failed-precondition", "Only coach accounts can be deleted here.");
  }
  const profiles = await coachProfiles(db, actor.academyId, userId);
  if (!user && profiles.length === 0) throw new HttpsError("not-found", "This coach no longer exists.");

  // Sessions and classes store the staffId; direct accounts use the uid as staffId.
  const ids = [...new Set([userId, ...profiles.map((profile) => profile.id)])];
  const now = new Date().toISOString();
  const blockers = new Set<string>();
  for (const id of ids) {
    // ponytail: reads every session this coach ever taught and filters in memory (no composite
    // index). Fine for a few hundred per coach; add an instructorId+startAt index if it grows.
    const [classes, single, multi] = await Promise.all([
      base.collection("classes").where("instructorIds", "array-contains", id).get(),
      base.collection("sessions").where("instructorId", "==", id).get(),
      base.collection("sessions").where("instructorIds", "array-contains", id).get(),
    ]);
    for (const doc of classes.docs) if (doc.data().active === true) blockers.add(`class ${String(doc.data().name ?? doc.id)}`);
    for (const doc of [...single.docs, ...multi.docs]) {
      const session = doc.data();
      if (typeof session.startAt === "string" && session.startAt >= now && session.status !== "cancelled") blockers.add(upcomingLabel(session.title, session.startAt));
    }
  }
  if (blockers.size > 0) {
    const list = [...blockers];
    const more = list.length > 10 ? ` and ${list.length - 10} more` : "";
    throw new HttpsError("failed-precondition", `Reassign these to another coach first: ${list.slice(0, 10).join("; ")}${more}.`);
  }

  if (user) await auth.deleteUser(userId).catch((error: { code?: string }) => { if (error.code !== "auth/user-not-found") throw error; });

  const batch = db.batch();
  for (const profile of profiles) batch.delete(profile.ref);
  for (const collection of ["staffAvailability", "staffAssignments"]) {
    for (const doc of (await base.collection(collection).where("staffId", "in", ids).get()).docs) batch.delete(doc.ref);
  }
  for (const doc of (await base.collection("staffPermissionGrants").where("subjectUserId", "==", userId).get()).docs) batch.delete(doc.ref);
  for (const doc of (await db.collection("staffLoginCredentials").where("userId", "==", userId).get()).docs) batch.delete(doc.ref);
  batch.set(base.collection("users").doc(userId), { active: false, status: "inactive", deletedAt: now, updatedAt: now, updatedBy: actor.userId }, { merge: true });
  batch.create(base.collection("auditEvents").doc(), { eventId: randomUUID(), academyId: actor.academyId, actorId: actor.userId, action: "staff.coach_deleted", targetRef: `academies/${actor.academyId}/users/${userId}`, purpose: "coach account deletion", correlationId: userId, occurredAt: now, schemaVersion: "1" });
  await batch.commit();
  return { deleted: true as const };
});
```

Nota: `where("staffId", "in", ids)` admite hasta 30 valores; `ids` siempre tiene 1 o 2.

- [ ] **Step 2: Exportar el callable**

En `apps/functions/src/index.ts`, cambia la línea de la Tarea 2 por:

```ts
export { deleteCoachAccount, setCoachBelt } from "./staff/coach-account-callables.js";
```

- [ ] **Step 3: Commit**

```bash
cd /root/BPT-Jersey
git add apps/functions/src/staff/coach-account-callables.ts apps/functions/src/index.ts
git -c user.name=Luis -c user.email=luismadef45@gmail.com commit -m "feat(staff): owner can delete a coach unless they still teach upcoming classes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Functions — endpoint público `coachesPublic`

**Files:**
- Create: `apps/functions/src/staff/coaches-public-http.ts`
- Modify: `apps/functions/src/index.ts`

**Interfaces:**
- Consumes: `coachBelts`, `coachBeltLabels`, `coachBeltSchema`, `type CoachBelt` (Tarea 1); `coursesAcademyId` (exportado ya en `apps/functions/src/courses/course-public-http.ts:10`; su parámetro `COURSES_ACADEMY_ID` está definido en `apps/functions/.env`)
- Produces: `GET …/coachesPublic` → `200 { coaches: [{ name, belt, beltLabel }] }`, `Cache-Control: public, max-age=60`. Con cualquier otro método → 405. Si falla → `500 { error: "unavailable" }`.

- [ ] **Step 1: Crear el endpoint**

```ts
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { coachBeltLabels, coachBelts, coachBeltSchema, type CoachBelt } from "@bpt-jersey/domain/staff/team-access";
import { browserOrigins } from "../auth/callable-options.js";
import { coursesAcademyId } from "../courses/course-public-http.js";

export function sortPublicCoaches<T extends { name: string; belt: CoachBelt }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => coachBelts.indexOf(a.belt) - coachBelts.indexOf(b.belt) || a.name.localeCompare(b.name, "en"));
}

export const coachesPublic = onRequest({ cors: browserOrigins, invoker: "public", timeoutSeconds: 15, memory: "256MiB" }, async (request, response) => {
  response.set("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET") { response.set("Allow", "GET"); response.status(405).json({ error: "method_not_allowed" }); return; }
  const academyId = coursesAcademyId.value();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(academyId)) { response.set("Cache-Control", "no-store"); response.status(500).json({ error: "unavailable" }); return; }
  try {
    const staff = await getFirestore().collection(`academies/${academyId}/staff`).where("active", "==", true).get();
    const belts = new Map<string, CoachBelt>();
    for (const doc of staff.docs) {
      const belt = coachBeltSchema.safeParse(doc.data().belt);
      if (belt.success && typeof doc.data().userId === "string") belts.set(doc.data().userId, belt.data);
    }
    // ponytail: getUsers takes at most 100 identifiers; chunk if the team ever passes 100 coaches.
    const users = belts.size === 0 ? [] : (await getAuth().getUsers([...belts.keys()].slice(0, 100).map((uid) => ({ uid })))).users;
    const coaches = sortPublicCoaches(
      users
        .filter((user) => !user.disabled && user.customClaims?.academyId === academyId && ["coach", "headCoach"].includes(String(user.customClaims?.role)) && user.displayName?.trim())
        .map((user) => ({ name: user.displayName!.trim(), belt: belts.get(user.uid)! })),
    ).map((coach) => ({ ...coach, beltLabel: coachBeltLabels[coach.belt] }));
    response.set("Cache-Control", "public, max-age=60");
    response.status(200).json({ coaches });
  } catch {
    response.set("Cache-Control", "no-store");
    response.status(500).json({ error: "unavailable" });
  }
});
```

- [ ] **Step 2: Exportar**

En `apps/functions/src/index.ts`, debajo de `export { coursePublic } from "./courses/course-public-http.js";` (línea 373), añade:

```ts
export { coachesPublic } from "./staff/coaches-public-http.js";
```

- [ ] **Step 3: Commit**

```bash
cd /root/BPT-Jersey
git add apps/functions/src/staff/coaches-public-http.ts apps/functions/src/index.ts
git -c user.name=Luis -c user.email=luismadef45@gmail.com commit -m "feat(staff): public endpoint listing active coaches with their belts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Web admin — cinturón al crear, cinturón y borrado en el Team directory

**Files:**
- Modify: `apps/web/src/lib/team-access-client.ts`
- Modify: `apps/web/src/app/admin/staff/direct-staff-form.tsx`
- Create: `apps/web/src/app/admin/staff/coach-website-controls.tsx`
- Modify: `apps/web/src/app/admin/staff/team-directory.tsx` (columnas, líneas 222–255)

**Interfaces:**
- Consumes: `setCoachBeltSchema`, `setCoachBeltResultSchema`, `deleteCoachAccountSchema`, `deleteCoachAccountResultSchema`, `coachBelts`, `coachBeltLabels`, `type CoachBelt`, `type TeamDirectoryPerson`, `type SetCoachBeltInput`, `type DeleteCoachAccountInput` (Tarea 1); callables de las Tareas 2 y 3
- Produces: `setCoachBelt(input)` y `deleteCoachAccount(input)` en `team-access-client.ts`; componente `CoachWebsiteControls`.

- [ ] **Step 1: Funciones de cliente**

En `team-access-client.ts`, amplía el import de `@bpt-jersey/domain/staff/team-access` con `setCoachBeltSchema, setCoachBeltResultSchema, deleteCoachAccountSchema, deleteCoachAccountResultSchema, type CoachBelt, type SetCoachBeltInput, type DeleteCoachAccountInput`. Después, al final del archivo:

- cambia la firma de `createStaffWithPassword` a `input: { displayName: string; email: string; password: string; role: "coach"|"administrator"|"owner"; belt?: CoachBelt }`;
- añade:

```ts
export function setCoachBelt(input: SetCoachBeltInput) {
  return call("setCoachBelt", setCoachBeltSchema.parse(input), setCoachBeltResultSchema, "Unable to save this belt. Refresh the team directory and try again.");
}
/** Unlike call(), keeps the server's reason when a coach still has classes to reassign. */
export async function deleteCoachAccount(input: DeleteCoachAccountInput) {
  try {
    return deleteCoachAccountResultSchema.parse((await httpsCallable<unknown, unknown>(getFirebaseFunctions(), "deleteCoachAccount")(deleteCoachAccountSchema.parse(input))).data);
  } catch (error) {
    const reason = (error as { code?: string }).code === "functions/failed-precondition" && error instanceof Error ? error.message : "";
    throw new Error(reason || "Unable to delete this coach. Refresh the team directory and try again.");
  }
}
```

- [ ] **Step 2: Desplegable de cinturón al crear un coach**

En `direct-staff-form.tsx`:
- añade `import { coachBelts, coachBeltLabels, type CoachBelt } from "@bpt-jersey/domain/staff/team-access";`
- tras `const [role,setRole]=…;` añade `const [belt,setBelt]=useState<CoachBelt|"">("");`
- en `submit`, cambia la llamada a `createStaffWithPassword({displayName:name.trim(),email:email.trim().toLowerCase(),password,role,...(role==="coach"&&belt?{belt}:{})});` y, tras `setEmail("");`, añade `setBelt("");`
- dentro de `<div className="staff-form-grid">`, tras el `<label>` de «Direct staff role», añade:

```tsx
{role==="coach"?<label className="staff-field">Belt shown on the website<select value={belt} onChange={(e)=>setBelt(e.target.value as CoachBelt)} required><option value="" disabled>Choose a belt</option>{coachBelts.map((value)=><option key={value} value={value}>{coachBeltLabels[value]}</option>)}</select></label>:null}
```

- [ ] **Step 3: Crear `coach-website-controls.tsx`**

```tsx
"use client";
import { useState } from "react";
import { coachBeltLabels, coachBelts, type CoachBelt, type TeamDirectoryPerson } from "@bpt-jersey/domain/staff/team-access";
import { deleteCoachAccount, setCoachBelt } from "../../../lib/team-access-client";

export function CoachWebsiteControls({ person, owner, onChanged }: { person: TeamDirectoryPerson; owner: boolean; onChanged: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const name = person.name || person.email || "this coach";

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      setConfirming(false);
      setTyped("");
      onChanged(done);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update this coach.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="coach-website-controls">
      <label className="staff-field">
        <span>Belt on website</span>
        <select
          value={person.belt ?? ""}
          disabled={busy}
          onChange={(event) => void run(() => setCoachBelt({ userId: person.userId, belt: event.target.value as CoachBelt }), `Belt saved for ${name}.`)}
        >
          {person.belt ? null : <option value="">Not shown on the website</option>}
          {coachBelts.map((belt) => <option key={belt} value={belt}>{coachBeltLabels[belt]}</option>)}
        </select>
      </label>
      {owner && !confirming && (
        <button className="staff-secondary-button" type="button" disabled={busy} onClick={() => setConfirming(true)}>
          Delete coach
        </button>
      )}
      {owner && confirming && (
        <div role="group" aria-label={`Delete ${name}`}>
          <p>This deletes {name}&apos;s login and removes them from the website. It cannot be undone. Type the coach&apos;s name to confirm.</p>
          <input aria-label="Coach name" value={typed} onChange={(event) => setTyped(event.target.value)} />
          <button
            className="staff-primary-button"
            type="button"
            disabled={busy || !person.name || typed.trim() !== person.name.trim()}
            onClick={() => void run(() => deleteCoachAccount({ userId: person.userId }), `${name} was deleted.`)}
          >
            Delete permanently
          </button>
          <button className="staff-secondary-button" type="button" disabled={busy} onClick={() => { setConfirming(false); setTyped(""); }}>
            Cancel
          </button>
        </div>
      )}
      {error && <p className="staff-message staff-message-error" role="alert">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Columna «Website» en el Team directory**

En `team-directory.tsx`, añade `import { CoachWebsiteControls } from "./coach-website-controls";`. En el array `columns`, justo después de la columna `role` (línea 229) y antes de `...(owner ? [...] : [])`, añade:

```tsx
            {
              key: "website",
              label: "Website",
              render: (person: TeamDirectoryPerson) =>
                person.role === "coach" || person.role === "headCoach" ? (
                  <CoachWebsiteControls
                    person={person}
                    owner={owner}
                    onChanged={(message) => {
                      setStatus(message);
                      void loadDirectory();
                    }}
                  />
                ) : (
                  "—"
                ),
            },
```

- [ ] **Step 5: Commit**

```bash
cd /root/BPT-Jersey
git add apps/web/src/lib/team-access-client.ts apps/web/src/app/admin/staff/direct-staff-form.tsx apps/web/src/app/admin/staff/coach-website-controls.tsx apps/web/src/app/admin/staff/team-directory.tsx
git -c user.name=Luis -c user.email=luismadef45@gmail.com commit -m "feat(admin): choose a coach's website belt and delete coaches from the team directory

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Landing — «The coaching team» sale de la base de datos

**Files:**
- Create: `apps/web/src/app/coaching-team.tsx`
- Modify: `apps/web/src/app/page.tsx` (bloque de las líneas 131–143; import)

**Interfaces:**
- Consumes: `publicCoachesResponseSchema`, `type PublicCoach` (Tarea 1); endpoint `coachesPublic` (Tarea 4)
- Produces: componente cliente `CoachingTeam`, sin props.

- [ ] **Step 1: Crear el componente**

```tsx
"use client";
import { useEffect, useState } from "react";
import { publicCoachesResponseSchema, type PublicCoach } from "@bpt-jersey/domain/staff/team-access";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const emulatorPort = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_PORT;
const endpoint =
  process.env.NEXT_PUBLIC_COACHES_API_URL ??
  (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" && projectId && emulatorPort
    ? `http://127.0.0.1:${emulatorPort}/${projectId}/europe-west9/coachesPublic`
    : projectId
      ? `https://europe-west9-${projectId}.cloudfunctions.net/coachesPublic`
      : "");

/** undefined = loading, null = hide the block (error, not configured or no coaches). */
export function CoachingTeam() {
  const [coaches, setCoaches] = useState<readonly PublicCoach[] | null | undefined>(endpoint ? undefined : null);

  useEffect(() => {
    if (!endpoint) return;
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("unavailable"))))
      .then((body) => {
        const { coaches: rows } = publicCoachesResponseSchema.parse(body);
        setCoaches(rows.length > 0 ? rows : null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCoaches(null);
      });
    return () => controller.abort();
  }, []);

  if (coaches === null) return null;
  return (
    <div className="instructors-block" aria-busy={coaches === undefined}>
      <div className="section-heading">
        <h3>The coaching team</h3>
      </div>
      <ul className="instructor-list">
        {coaches === undefined
          ? [0, 1, 2].map((index) => (
              <li className="instructor-card" key={index} aria-hidden="true">
                <strong>&nbsp;</strong>
                <span>&nbsp;</span>
              </li>
            ))
          : coaches.map((coach) => (
              <li className="instructor-card" key={`${coach.belt}:${coach.name}`}>
                <strong>{coach.name}</strong>
                <span>{coach.beltLabel}</span>
              </li>
            ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Usarlo en la landing**

En `apps/web/src/app/page.tsx`, añade `import { CoachingTeam } from "./coaching-team";` junto a los imports. Sustituye todo el bloque `<div className="instructors-block"> … </div>` (líneas 131–143) por:

```tsx
          <CoachingTeam />
```

No toques `academyContent` ni su import: el resto de la página lo sigue usando.

- [ ] **Step 3: Commit**

```bash
cd /root/BPT-Jersey
git add apps/web/src/app/coaching-team.tsx apps/web/src/app/page.tsx
git -c user.name=Luis -c user.email=luismadef45@gmail.com commit -m "feat(landing): coaching team comes from active coach accounts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Verificación local con el emulador (proyecto demo, nunca producción)

**Files:** ninguno se commitea. `apps/functions/.env.local` es temporal y está en `.gitignore`.

- [ ] **Step 1: Compilar lo que exige el despliegue**

```bash
cd /root/BPT-Jersey && node qa/scripts/run-recovery-stack.mjs build
```

Esperado: termina sin errores de `tsc`. Así se compilan el dominio y las funciones igual que en el predeploy. Si hay errores de tipo, corrígelos en la tarea que los introdujo y repite.

- [ ] **Step 2: Compilar la web**

```bash
cd /root/BPT-Jersey && corepack pnpm --filter @bpt-jersey/web build
```

Esperado: `next build` termina sin errores. Es lo mismo que hará Cloudflare Pages.

- [ ] **Step 3: Apuntar el endpoint a la academia demo**

```bash
cd /root/BPT-Jersey && printf 'COURSES_ACADEMY_ID=demo-academy\n' > apps/functions/.env.local
```

El emulador carga `.env.local` por encima de `.env`, que trae el id de producción.

- [ ] **Step 4: Arrancar el stack**

```bash
cd /root/BPT-Jersey && node qa/scripts/run-recovery-stack.mjs start
```

Esperado: `Recovery stack ready: http://127.0.0.1:3100`. El owner sembrado es `recovery-owner@example.test`; su contraseña sintética es `AUTH_EMULATOR_E2E_PASSWORD` en el archivo de secretos que genera `secrets()` en `qa/scripts/run-recovery-stack.mjs`.

- [ ] **Step 5: Crear dos coaches y comprobar el orden**

Entra como owner en `http://127.0.0.1:3100/admin/staff`. Con «Create staff with initial password», crea «Zed Brown» (`brown`) y «Ana Black» (`black-2`). Después ejecuta:

```bash
curl -s http://127.0.0.1:5011/demo-bpt-jersey/europe-west9/coachesPublic
```

Esperado: `{"coaches":[{"name":"Ana Black","belt":"black-2","beltLabel":"2nd degree black belt"},{"name":"Zed Brown","belt":"brown","beltLabel":"Brown belt"}]}`. Sin uid ni email. En `http://127.0.0.1:3100/`, «The coaching team» muestra los dos en ese orden.

- [ ] **Step 6: Cambiar el cinturón y desactivar**

En el Team directory, cambia a Zed a `black-6` → en el curl, Zed sale primero. En la sección de perfiles de staff, desactiva a Zed → el curl ya no lo incluye. Reactívalo → vuelve.

- [ ] **Step 7: Review Focus 1 — ascenso a administrator**

Con «Change role», haz administrator a Zed → el curl **no** lo incluye.

- [ ] **Step 8: Review Focus 2 — Auth deshabilitado**

```bash
curl -s -X POST "http://127.0.0.1:9109/identitytoolkit.googleapis.com/v1/accounts:update" -H "Authorization: Bearer owner" -H "Content-Type: application/json" -d '{"localId":"<UID_DE_ANA>","disableUser":true,"targetProjectId":"demo-bpt-jersey"}'
```

`<UID_DE_ANA>` es el uid de Ana en la UI del emulador de Auth. Esperado: el curl de `coachesPublic` ya no incluye a Ana. Vuelve a habilitarla con `"disableUser":false`.

- [ ] **Step 9: Review Focus 3 — endpoint caído**

Para el emulador de funciones (Ctrl-C en el stack). Recarga `http://127.0.0.1:3100/` → el bloque «The coaching team» desaparece y el resto de la landing se ve bien. Vuelve a arrancar con el Step 4.

- [ ] **Step 10: Borrar y reintentar (Review Focus 4)**

En el Team directory, «Delete coach» sobre Ana, escribe «Ana Black» y pulsa «Delete permanently» → el mensaje dice «Ana Black was deleted.». Ana desaparece del directorio y del curl. En la UI del emulador de Firestore, `users/<uid>` tiene `status: "inactive"` y `deletedAt`, y existe el evento `staff.coach_deleted`.

Reintento: crea «Bea Blue» (`blue`) y borra solo su login desde la UI del emulador de Auth. Así se simula que falló el batch después de borrar el login. Esperado: el curl de `coachesPublic` ya **no** incluye a Bea, aunque su perfil de staff siga en Firestore. Que un segundo `deleteCoachAccount` termine el trabajo se verifica **leyendo el código**: con `user === null` y perfiles presentes, no lanza `not-found`, se salta `deleteUser` y ejecuta el batch. Una vez borrado el login, el Team directory ya no lista a Bea, así que desde la UI no se puede reintentar. Díselo a Luis en el informe.

- [ ] **Step 11: Review Focus 5 — bloqueo por sesión futura con varios trainers**

En `/admin/classes-services/classes`, crea una sesión futura con dos trainers, uno de ellos Zed (déjalo otra vez como coach). Intenta borrar a Zed → aparece el error «Reassign these to another coach first: <título> on <fecha>» y Zed sigue en la lista.

- [ ] **Step 12: Bloqueo por clase recurrente activa**

Asigna a Zed como trainer de una clase recurrente activa → intentar borrarlo muestra «class <nombre>».

- [ ] **Step 13: Un administrator no puede borrar**

Crea un administrator de prueba y entra con él → en el Team directory no aparece «Delete coach», aunque sí el desplegable de cinturón.

- [ ] **Step 14: Limpiar**

Para el stack y borra el archivo temporal:

```bash
rm /root/BPT-Jersey/apps/functions/.env.local
```

Esperado: `git -C /root/BPT-Jersey status --short` no muestra archivos nuevos de esta tarea.

---

### Task 8: Transición en producción y entrega

⚠️ Esta tarea escribe en **producción** (proyecto `bptjersey-f5a25`). **Pide el OK explícito de Luis antes del Step 4 (deploy) y otra vez antes del Step 5 (escribir cinturones).** Orden obligatorio: push → deploy → cinturones. Si los cinturones se escribieran antes del deploy, las funciones antiguas rechazarían esos perfiles.

- [ ] **Step 1: Leer el estado real (solo lectura)**

Crea `/root/compartido/coaches-belts-read.mjs` con la misma autenticación que `scripts/provision-landing-coaches.mjs`: `firebase-tools` para el token y `firebase-admin` para Auth, con el academyId sacado de la configuración desplegada. El script solo lista:
- cada documento de `academies/{academyId}/staff` con `staffId`, `userId`, `active` y `belt`;
- para cada `userId`: `displayName`, `disabled` y `customClaims.role` de Auth.

Ejecútalo y enséñale la tabla a Luis. Esperado (D12): existen `coach-miro`, `coach-charlie`, `coach-amone`, `coach-connor` y `coach-catalina`, activos, con rol `coach` y sin `belt`.

- [ ] **Step 2: Informar a Luis**

Dile qué coaches faltan o no tienen rol coach, y qué otros perfiles activos saldrían en la landing al ponerles cinturón.

- [ ] **Step 3: Integrar y subir**

```bash
cd /root/BPT-Jersey && git fetch origin && git rebase origin/main && git push origin main && git rev-parse HEAD origin/main
```

Esperado: los dos SHA coinciden. Cloudflare Pages publica la web en unos 90 s. Hasta que el endpoint exista, el bloque de coaches queda oculto.

- [ ] **Step 4: Desplegar TODAS las funciones** (tras el OK de Luis)

```bash
cd /root/BPT-Jersey && corepack pnpm exec firebase deploy --project bptjersey-f5a25 --only functions
```

Se despliegan todas porque `parseStaffProfile` cambió y lo usan muchos exports: staff, niveles e informes de progreso, que se empaquetan desde el mismo dominio. Un deploy parcial dejaría funciones antiguas que rechazan perfiles con `belt`. Tarda varios minutos. Esperado: `Deploy complete!` sin funciones en error.

- [ ] **Step 5: Poner los cinturones, primero en seco** (tras el OK de Luis; siempre **después** del Step 4)

Crea `/root/compartido/coaches-belts-apply.mjs`, con la misma autenticación que el script del Step 1. Por defecto hace un dry-run, y con `--apply` escribe `belt` y `updatedAt` en los perfiles:
- `coach-miro` → `black-4`
- `coach-charlie`, `coach-amone` y `coach-connor` → `black`
- `coach-catalina` → `brown`

Ejecútalo sin `--apply` y enseña la salida. Ejecútalo con `--apply` solo si Luis confirma.

- [ ] **Step 6: Verificación final en producción**

```bash
curl -s https://europe-west9-bptjersey-f5a25.cloudfunctions.net/coachesPublic
```

Esperado: los 5 coaches, en este orden: Miro (4th degree black belt); después Amoné, Charlie y Connor (Black belt, alfabético); por último Catalina (Brown belt). Abre `https://bptjersey.com` → «The coaching team» muestra esa lista. Abre `/admin/staff` como owner → el Team directory muestra la columna «Website» con los cinturones.
