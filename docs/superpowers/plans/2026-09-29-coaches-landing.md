# Coaches de la landing + directorio único de staff — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- «The coaching team» de bptjersey.com muestra solo a los coaches activos con cinturón y a los owners que el owner marque con «Teaches».
- `/admin/staff` pasa a tener **un único directorio** (Team directory): se puede cambiar el rol también a Coach, un panel «Manage» por persona reúne sus ajustes, y la **única** forma de crear staff es «Create staff with initial password».

**Architecture:**
- El perfil de coach (`academies/{id}/staff/{staffId}`) gana el campo opcional `belt`.
- «Aparece en la landing» = perfil de coach activo + cinturón + rol de Auth `coach`/`headCoach`/`owner`. Un administrator nunca aparece.
- Una función HTTP pública, `coachesPublic`, devuelve solo `{name, belt, beltLabel}` ya ordenado, y la landing (export estático) la consulta al cargar.
- El Team directory recibe de `listTeamDirectory` el perfil de coach de cada persona (`coach: {staffKey, active, belt} | null`).
- Callables nuevos: `setCoachBelt`, `setOwnerTeaches`, `deleteCoachAccount` y el cambio de rol a coach dentro de `changeTeamRole`.

**Tech Stack:** Next.js 16 (static export) + React 19, Firebase Functions v2 (Node 22, región global `europe-west9` en `apps/functions/src/global-options.ts`), Firestore, Firebase Auth, zod 4, pnpm workspace (`@bpt-jersey/domain`, `@bpt-jersey/functions`, `@bpt-jersey/web`).

**Spec:** `docs/superpowers/specs/2026-09-29-coaches-landing-design.md`. Mandan las decisiones **D8–D18** sobre el texto de las secciones.

## Global Constraints

- Repo: `/root/BPT-Jersey`. Se trabaja en `main` local. **Sin ramas, worktrees ni PR.**
- Commit con la identidad del repo: `git -c user.name=Luis -c user.email=luismadef45@gmail.com commit …`. El mensaje termina con `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Nunca `git add -A`**: hay trabajo ajeno sin commitear (`qa/.tmp-*`, `docs/reviews/…`). Añade solo los archivos de cada tarea.
- **No se añaden ni se ejecutan tests automáticos** (AGENTS.md). La verificación es la de la Tarea 10 (emulador) y la de la Tarea 11 (producción). Los builds de despliegue excluyen los `*.test.*` (`apps/functions/tsconfig.deploy.json`, `apps/web/tsconfig.build.json`), así que los fixtures de test que queden desfasados no bloquean.
- **Ni push ni deploy hasta la Tarea 11**, y esa tarea pide el OK de Luis antes de desplegar y antes de escribir en producción.
- Cinturones, en rango descendente: `red-9, coral-8, coral-7, black-6, black-5, black-4, black-3, black-2, black-1, black, brown, purple, blue`.
- En la landing solo pueden salir `name`, `belt` y `beltLabel`. **Nunca** uid, email, teléfono ni rol.
- Permisos:
  - **owner**: cambiar roles, «Teaches» de un owner, borrar coaches;
  - **owner y administrator**: cinturón de un coach, Deactivate/Activate, disponibilidad, asignaciones y crear staff (el administrator solo coaches, como hoy).
- `academyContent.instructors` (`apps/web/src/content/academy.ts`) **no se toca** (D8).
- Textos de interfaz en inglés, como el resto del admin.

## Review Focus

No hay tests unitarios por regla del proyecto, así que cada punto tiene su comprobación en la Tarea 10:

1. **Administrator con perfil de coach activo** (por ejemplo, un coach ascendido a administrator): **no** sale en la landing. → Tarea 10, paso 8.
2. **Owner sin «Teaches»** (Andres, el owner sin nombre): no sale. **Owner con «Teaches»**: sale, y al desactivarlo desaparece. → Tarea 10, paso 7.
3. **Bajar a coach a un owner o administrator**: pierde el acceso de oficina en su siguiente inicio de sesión, gana un perfil de coach activo y un owner no puede bajarse a sí mismo. → Tarea 10, paso 9.
4. **Endpoint caído o sin configurar**: la landing oculta el bloque y el resto se ve bien. → Tarea 10, paso 11.
5. **Borrar a un coach asignado solo mediante `instructorIds`** (sesión con varios trainers) o a una clase recurrente activa: **se bloquea**. → Tarea 10, pasos 13–14.

---

### Task 1: Contratos de dominio

**Files:**
- Modify: `packages/domain/src/staff/team-access-contracts.ts`
- Modify: `packages/domain/src/staff/staff-contracts.ts` (tipo `StaffProfile`, líneas 15–27; tras `staffProfileFields`, líneas 44–56; `parseStaffProfile`, líneas 161–195)

**Interfaces (produce), en `@bpt-jersey/domain/staff/team-access`:**
- `coachBelts`, `coachBeltSchema`, `type CoachBelt`, `coachBeltLabels: Readonly<Record<CoachBelt, string>>`
- `teamCoachProfileSchema` → `{ staffKey: string; active: boolean; belt: CoachBelt | null }` y `type TeamCoachProfile`
- `teamDirectoryPersonSchema` con el campo nuevo `coach: TeamCoachProfile | null`
- `changeTeamRoleSchema.role` ahora es `"coach" | "administrator" | "owner"`
- `setCoachBeltSchema` `{userId, belt}` → `setCoachBeltResultSchema` `{belt}`
- `setOwnerTeachesSchema` `{userId, teaches: boolean, belt?: CoachBelt}` → `setOwnerTeachesResultSchema` `{teaches: boolean}`
- `deleteCoachAccountSchema` `{userId}` → `deleteCoachAccountResultSchema` `{deleted: true}`
- `publicCoachSchema` `{name, belt, beltLabel}`, `type PublicCoach`, `publicCoachesResponseSchema` `{coaches: PublicCoach[]}`
- tipos `SetCoachBeltInput`, `SetOwnerTeachesInput`, `DeleteCoachAccountInput`

**Y en `@bpt-jersey/domain/staff`:** `StaffProfile.belt?: CoachBelt`. `parseStaffProfile` acepta documentos con o sin `belt`.

- [ ] **Step 1: Cinturones.** En `team-access-contracts.ts`, justo después de `teamRoleLabels` (línea 11), añade:

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
export const teamCoachProfileSchema = z.strictObject({
  staffKey: z.string().min(1).max(128),
  active: z.boolean(),
  belt: coachBeltSchema.nullable(),
});
export type TeamCoachProfile = z.infer<typeof teamCoachProfileSchema>;
```

- [ ] **Step 2: Persona del directorio y cambio de rol.** Sustituye `teamDirectoryPersonSchema` y `changeTeamRoleSchema` por:

```ts
export const teamDirectoryPersonSchema = z.strictObject({
  userId: z.string().min(1).max(128),
  name: z.string().max(256),
  email: z.string().max(320).nullable(),
  role: teamRoleSchema,
  coach: teamCoachProfileSchema.nullable(),
});
```

```ts
export const changeTeamRoleSchema = z.strictObject({
  userId: z.string().min(1).max(128),
  email: teamEmailSchema.nullable(),
  role: assignableTeamRoleSchema,
});
```

- [ ] **Step 3: Esquemas de los callables y del endpoint.** Al final del archivo, añade:

```ts
export const setCoachBeltSchema = z.strictObject({
  userId: z.string().min(1).max(128),
  belt: coachBeltSchema,
});
export const setCoachBeltResultSchema = z.strictObject({ belt: coachBeltSchema });
export const setOwnerTeachesSchema = z
  .strictObject({
    userId: z.string().min(1).max(128),
    teaches: z.boolean(),
    belt: coachBeltSchema.optional(),
  })
  .refine((value) => !value.teaches || value.belt !== undefined, { message: "belt_required" });
export const setOwnerTeachesResultSchema = z.strictObject({ teaches: z.boolean() });
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
export type SetOwnerTeachesInput = z.infer<typeof setOwnerTeachesSchema>;
export type DeleteCoachAccountInput = z.infer<typeof deleteCoachAccountSchema>;
```

- [ ] **Step 4: `parseStaffProfile` acepta `belt`.** Es crítico: hoy rechaza cualquier campo extra (`hasExactFields`). Sin este paso, un perfil con `belt` rompería `/admin/staff`, los niveles y el login de staff.

En `staff-contracts.ts`, añade el import tras los existentes:

```ts
import { coachBelts, type CoachBelt } from "./team-access-contracts";
```

En `StaffProfile`, tras `role: StaffRole;`, añade:

```ts
  /** Shown on the public landing page when set; absent on legacy profiles. */
  belt?: CoachBelt;
```

Después de `staffProfileFields`, añade:

```ts
const staffProfileFieldsWithBelt = Object.freeze([...staffProfileFields, "belt"] as const);
```

En `parseStaffProfile`, sustituye

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

- [ ] **Step 5: Commit**

```bash
cd /root/BPT-Jersey
git add packages/domain/src/staff/team-access-contracts.ts packages/domain/src/staff/staff-contracts.ts
git -c user.name=Luis -c user.email=luismadef45@gmail.com commit -m "feat(staff): coach belts, coach profile in the team directory contract, optional belt on staff profiles

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Functions — crear con cinturón, directorio con perfil de coach, sin invitaciones nuevas, `setCoachBelt`

**Files:**
- Modify: `apps/functions/src/staff/direct-staff-creation.ts` (línea 10: esquema; línea 12: mensaje; línea 20: `batch.create` del staff)
- Create: `apps/functions/src/staff/coach-account-callables.ts`
- Modify: `apps/functions/src/staff/team-access.ts` (`TeamAccessServices`, líneas 23–46; `listTeamDirectoryHandler`, líneas 78–99; `createStaffInvitationHandler`, líneas 116–138)
- Modify: `apps/functions/src/staff/team-access-callables.ts` (objeto de `services()`)
- Modify: `apps/functions/src/index.ts`

**Interfaces:**
- Consumes: la Tarea 1
- Produces:
  - `coachProfiles(db, academyId, userId): Promise<QueryDocumentSnapshot[]>`, que usan las Tareas 3 y 4;
  - `TeamAccessServices.coachProfilesByUser(academyId): Promise<ReadonlyMap<string, TeamCoachProfile>>`;
  - callable `setCoachBelt({userId, belt}) → {belt}`.

- [ ] **Step 1: El cinturón es obligatorio al crear un coach.** En `direct-staff-creation.ts`, añade el import:

```ts
import { coachBeltSchema } from "@bpt-jersey/domain/staff/team-access";
```

Sustituye `directStaffInputSchema` (línea 10) por:

```ts
export const directStaffInputSchema = z
  .strictObject({ displayName: z.string().trim().min(2).max(160), email: z.email().trim().toLowerCase().max(320), password: z.string().min(12).max(128), role: z.enum(["coach","administrator","owner"]), belt: coachBeltSchema.optional() })
  .refine((value) => (value.role === "coach") === (value.belt !== undefined));
```

En la línea 12, el mensaje pasa a ser `"Enter a name, email, role, a belt for coaches, and a password of 12 to 128 characters."`.

En la línea 20, en el `batch.create` de `staff`, cambia `role: "coach", active: true,` por `role: "coach", belt: input.data.belt, active: true,`.

- [ ] **Step 2: Crear `coach-account-callables.ts` con `coachProfiles` y `setCoachBelt`.**

```ts
import { randomUUID } from "node:crypto";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { setCoachBeltSchema } from "@bpt-jersey/domain/staff/team-access";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireActiveOfficeActor } from "../auth/office-actor.js";

/** Coach profiles of one login. Direct accounts use staffId === uid; invited ones do not. */
export async function coachProfiles(db: Firestore, academyId: string, userId: string) {
  return (await db.collection(`academies/${academyId}/staff`).where("userId", "==", userId).get()).docs;
}

export function coachAudit(academyId: string, actorId: string, userId: string, action: string, purpose: string, now: string) {
  return { eventId: randomUUID(), academyId, actorId, action, targetRef: `academies/${academyId}/users/${userId}`, purpose, correlationId: userId, occurredAt: now, schemaVersion: "1" };
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
  batch.create(db.collection(`academies/${actor.academyId}/auditEvents`).doc(), coachAudit(actor.academyId, actor.userId, input.data.userId, "staff.coach_belt_set", "coach belt shown on the website", now));
  await batch.commit();
  return { belt: input.data.belt };
});
```

- [ ] **Step 3: El directorio trae el perfil de coach.** En `team-access.ts`, añade `type TeamCoachProfile` al import de `@bpt-jersey/domain/staff/team-access`. En `TeamAccessServices`, antes de `now(): Date;`, añade:

```ts
  /** userId → coach profile (the active one wins when a login has several). */
  coachProfilesByUser(academyId: string): Promise<ReadonlyMap<string, TeamCoachProfile>>;
```

En `listTeamDirectoryHandler`, justo tras `const page = await services.auth.listUsers(...)`, añade:

```ts
  const coaches = await services.coachProfilesByUser(actor.academyId);
```

y en el `.map((user) => ({ ... }))`, tras `role: user.customClaims!.role,`, añade:

```ts
      coach: coaches.get(user.uid) ?? null,
```

En `team-access-callables.ts`, añade el import:

```ts
import { coachBeltSchema, type TeamCoachProfile } from "@bpt-jersey/domain/staff/team-access";
```

y en el objeto de `services()`, tras `now: () => new Date(),`:

```ts
    async coachProfilesByUser(academyId) {
      const snapshot = await firestore.collection(`academies/${academyId}/staff`).get();
      const profiles = new Map<string, TeamCoachProfile>();
      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (typeof data.userId !== "string") continue;
        const belt = coachBeltSchema.safeParse(data.belt);
        const profile = { staffKey: doc.id, active: data.active === true, belt: belt.success ? belt.data : null };
        if (!profiles.get(data.userId)?.active) profiles.set(data.userId, profile);
      }
      return profiles;
    },
```

- [ ] **Step 4: No se crean invitaciones nuevas (D15).** En `team-access.ts`, sustituye el cuerpo de `createStaffInvitationHandler` por:

```ts
export async function createStaffInvitationHandler(
  request: CallableRequest,
  services: TeamAccessServices,
): Promise<StaffInvitation> {
  await currentActor(request, services);
  throw new HttpsError(
    "failed-precondition",
    "Create staff with an initial password in the team directory instead.",
  );
}
```

Tras el cambio, quita de los imports de ese archivo lo que quede sin uso (`staffInvitationInputSchema` y, si ya no se usa en ningún otro sitio del archivo, `randomUUID`). Compruébalo con:

```bash
grep -n "randomUUID\|staffInvitationInputSchema" apps/functions/src/staff/team-access.ts
```

- [ ] **Step 5: Exportar.** En `apps/functions/src/index.ts`, debajo de `export { createStaffWithPassword } from "./staff/direct-staff-creation.js";` (línea 297), añade:

```ts
export { setCoachBelt } from "./staff/coach-account-callables.js";
```

- [ ] **Step 6: Commit**

```bash
cd /root/BPT-Jersey
git add apps/functions/src/staff/direct-staff-creation.ts apps/functions/src/staff/coach-account-callables.ts apps/functions/src/staff/team-access.ts apps/functions/src/staff/team-access-callables.ts apps/functions/src/index.ts
git -c user.name=Luis -c user.email=luismadef45@gmail.com commit -m "feat(staff): coach profile in the team directory, belt on creation, no new email invitations

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Functions — `deleteCoachAccount` (solo owner, bloqueado si tiene clases futuras)

**Files:**
- Modify: `apps/functions/src/staff/coach-account-callables.ts`
- Modify: `apps/functions/src/index.ts`

**Interfaces:**
- Consumes: `coachProfiles`, `coachAudit` (Tarea 2) y `deleteCoachAccountSchema` (Tarea 1)
- Produces: `deleteCoachAccount({userId}) → {deleted: true}`. Si hay bloqueos, lanza `failed-precondition` con un mensaje legible que el cliente muestra tal cual (Tarea 7).

**Orden deliberado:**
1. Comprobar los bloqueos.
2. **Borrar el login de Auth.** Desde ahí `coachesPublic` ya no lo muestra.
3. Ejecutar el batch de Firestore.

Si el paso 3 falla, un reintento sigue adelante, porque `user === null` con perfiles presentes no se considera error.

- [ ] **Step 1: Añadir el callable.** Amplía los imports de `coach-account-callables.ts`:

```ts
import { getAuth } from "firebase-admin/auth";
import { deleteCoachAccountSchema, setCoachBeltSchema } from "@bpt-jersey/domain/staff/team-access";
```

Al final del archivo:

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
    throw new HttpsError("failed-precondition", "Only coach accounts can be deleted. Change the role to Coach first.");
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
  batch.create(base.collection("auditEvents").doc(), coachAudit(actor.academyId, actor.userId, userId, "staff.coach_deleted", "coach account deletion", now));
  await batch.commit();
  return { deleted: true as const };
});
```

`where("staffId", "in", ids)` admite hasta 30 valores; `ids` siempre tiene 1 o 2.

- [ ] **Step 2: Exportar.** Cambia la línea de la Tarea 2 en `index.ts` por:

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

### Task 4: Functions — cambiar rol a Coach y «Teaches» de un owner

**Files:**
- Modify: `apps/functions/src/staff/coach-account-callables.ts`
- Modify: `apps/functions/src/staff/team-access.ts` (`TeamAccessServices` y `changeTeamRoleHandler`, líneas 100–115)
- Modify: `apps/functions/src/staff/team-access-callables.ts`
- Modify: `apps/functions/src/index.ts`

**Interfaces:**
- Consumes: `coachProfiles`, `coachAudit` (Tarea 2); `setOwnerTeachesSchema` (Tarea 1); `withSharedRoleLock(firestore, academyId, actorId, uid, operation)` y `type SyntheticFirestore` de `../auth/admin-provisioning.js` (`admin-provisioning.ts:322`)
- Produces:
  - `activateCoachProfile(db, academyId, actorId, userId, belt?)`: crea o reactiva el perfil de coach;
  - `TeamAccessServices.demoteToCoach(actor, uid): Promise<void>`;
  - `changeTeamRole({userId, email, role: "coach"})` funciona;
  - callable `setOwnerTeaches({userId, teaches, belt?}) → {teaches}`.

- [ ] **Step 1: Helper para crear o reactivar el perfil y el callable `setOwnerTeaches`.** En `coach-account-callables.ts`, amplía el import de dominio con `setOwnerTeachesSchema` y `type CoachBelt`. Al final del archivo, añade:

```ts
/** Creates the coach profile (staffId = uid) or reactivates the existing ones. Idempotent. */
export async function activateCoachProfile(db: Firestore, academyId: string, actorId: string, userId: string, belt?: CoachBelt) {
  const profiles = await coachProfiles(db, academyId, userId);
  const now = new Date().toISOString();
  const batch = db.batch();
  if (profiles.length === 0) {
    batch.create(db.doc(`academies/${academyId}/staff/${userId}`), { staffId: userId, academyId, userId, role: "coach", ...(belt ? { belt } : {}), active: true, status: "active", schemaVersion: "1", createdAt: now, createdBy: actorId, updatedAt: now, updatedBy: actorId });
  } else {
    for (const profile of profiles) batch.update(profile.ref, { active: true, status: "active", ...(belt ? { belt } : {}), updatedAt: now, updatedBy: actorId });
  }
  return { batch, now };
}

export const setOwnerTeaches = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  if (actor.role !== "owner") throw new HttpsError("permission-denied", "Only an owner can choose which owners appear on the website.");
  const input = setOwnerTeachesSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Choose a belt before showing this owner on the website.");
  const { userId, teaches, belt } = input.data;
  const user = await getAuth().getUser(userId);
  if (user.customClaims?.academyId !== actor.academyId || user.customClaims?.role !== "owner") {
    throw new HttpsError("failed-precondition", "Only owner accounts use this setting.");
  }
  const db = getFirestore();
  if (teaches) {
    const { batch, now } = await activateCoachProfile(db, actor.academyId, actor.userId, userId, belt);
    batch.create(db.collection(`academies/${actor.academyId}/auditEvents`).doc(), coachAudit(actor.academyId, actor.userId, userId, "staff.owner_teaches_on", "owner shown on the website", now));
    await batch.commit();
  } else {
    const now = new Date().toISOString();
    const batch = db.batch();
    for (const profile of await coachProfiles(db, actor.academyId, userId)) batch.update(profile.ref, { active: false, status: "inactive", updatedAt: now, updatedBy: actor.userId });
    batch.create(db.collection(`academies/${actor.academyId}/auditEvents`).doc(), coachAudit(actor.academyId, actor.userId, userId, "staff.owner_teaches_off", "owner hidden from the website", now));
    await batch.commit();
  }
  return { teaches };
});
```

Las claims de un owner no se tocan: su perfil de coach solo sirve para la landing y como trainer. `setStaffActive` también las deja intactas para roles administrativos (`staff-callables.ts:295–296`).

- [ ] **Step 2: Bajar a coach en el servidor.** En `team-access.ts`, añade a `TeamAccessServices`, antes de `now(): Date;`:

```ts
  /** Owner/administrator → coach: claims, users.adminRole and an active coach profile. */
  demoteToCoach(actor: AdminActor, uid: string): Promise<void>;
```

En `changeTeamRoleHandler`, sustituye la llamada `await services.grant(...)` por:

```ts
  if (input.data.role === "coach") await services.demoteToCoach(actor, input.data.userId);
  else
    await services.grant(
      actor,
      { uid: input.data.userId, email: input.data.email, role: input.data.role },
      "team",
    );
```

La comprobación que ya existe, `input.data.userId === actor.uid → "Ask another owner to change your role."`, sigue antes y cubre «no bajarse a sí mismo». Como el actor es owner y distinto del objetivo, la academia nunca se queda sin owner.

En `team-access-callables.ts`, amplía los imports:

```ts
import { withSharedRoleLock } from "../auth/admin-provisioning.js";
import { activateCoachProfile, coachAudit } from "./coach-account-callables.js";
```

`withSharedRoleLock` se une al import que ya existe de `../auth/admin-provisioning.js`, el que trae `provisionAdminRoleWithServices` y `SyntheticFirestore`.

En el objeto de `services()`, tras `coachProfilesByUser`, añade:

```ts
    async demoteToCoach(actor, uid) {
      await withSharedRoleLock(firestore as unknown as SyntheticFirestore, actor.academyId, actor.uid, uid, async () => {
        const user = await auth.getUser(uid);
        if (user.disabled || user.customClaims?.academyId !== actor.academyId || !["owner", "administrator"].includes(String(user.customClaims?.role))) {
          throw new HttpsError("failed-precondition", "Only an active owner or administrator can be changed to coach here.");
        }
        const { batch, now } = await activateCoachProfile(firestore, actor.academyId, actor.uid, uid);
        batch.set(firestore.doc(`academies/${actor.academyId}/users/${uid}`), { adminRole: null, updatedAt: now, updatedBy: actor.uid }, { merge: true });
        batch.create(firestore.collection(`academies/${actor.academyId}/auditEvents`).doc(), coachAudit(actor.academyId, actor.uid, uid, "admin.role.changed_to_coach", "administrative role management", now));
        await batch.commit();
        await auth.setCustomUserClaims(uid, { ...user.customClaims, academyId: actor.academyId, role: "coach" });
      });
    },
```

Las claims van al final a propósito. Si fallan, Firestore ya tiene el perfil activo y la persona sigue siendo owner o administrator con «Teaches». Reintentar es seguro porque `activateCoachProfile` es idempotente.

- [ ] **Step 3: Exportar.** En `index.ts`:

```ts
export { deleteCoachAccount, setCoachBelt, setOwnerTeaches } from "./staff/coach-account-callables.js";
```

- [ ] **Step 4: Commit**

```bash
cd /root/BPT-Jersey
git add apps/functions/src/staff/coach-account-callables.ts apps/functions/src/staff/team-access.ts apps/functions/src/staff/team-access-callables.ts apps/functions/src/index.ts
git -c user.name=Luis -c user.email=luismadef45@gmail.com commit -m "feat(staff): change a role to coach and choose which owners teach on the website

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Functions — endpoint público `coachesPublic`

**Files:**
- Create: `apps/functions/src/staff/coaches-public-http.ts`
- Modify: `apps/functions/src/index.ts`

**Interfaces:**
- Consumes: `coachBelts`, `coachBeltLabels`, `coachBeltSchema`, `type CoachBelt` (Tarea 1); `coursesAcademyId` (`apps/functions/src/courses/course-public-http.ts:10`; `COURSES_ACADEMY_ID` ya está en `apps/functions/.env`)
- Produces: `GET …/coachesPublic` → `200 {coaches:[{name, belt, beltLabel}]}`, `Cache-Control: public, max-age=60`. Con otro método → 405. Si falla → `500 {error:"unavailable"}`.

- [ ] **Step 1: Crear el endpoint**

```ts
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { coachBeltLabels, coachBelts, coachBeltSchema, type CoachBelt } from "@bpt-jersey/domain/staff/team-access";
import { browserOrigins } from "../auth/callable-options.js";
import { coursesAcademyId } from "../courses/course-public-http.js";

/** Coaches, plus owners who teach (active coach profile). Administrators never appear. */
const websiteRoles = ["coach", "headCoach", "owner"];

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
        .filter((user) => !user.disabled && user.customClaims?.academyId === academyId && websiteRoles.includes(String(user.customClaims?.role)) && user.displayName?.trim())
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

- [ ] **Step 2: Exportar.** En `index.ts`, debajo de `export { coursePublic } from "./courses/course-public-http.js";` (línea 373):

```ts
export { coachesPublic } from "./staff/coaches-public-http.js";
```

- [ ] **Step 3: Commit**

```bash
cd /root/BPT-Jersey
git add apps/functions/src/staff/coaches-public-http.ts apps/functions/src/index.ts
git -c user.name=Luis -c user.email=luismadef45@gmail.com commit -m "feat(staff): public endpoint listing coaches and teaching owners with their belts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Web — cliente y formulario de creación

**Files:**
- Modify: `apps/web/src/lib/team-access-client.ts`
- Modify: `apps/web/src/app/admin/staff/direct-staff-form.tsx`

**Interfaces:**
- Consumes: la Tarea 1
- Produces, en `team-access-client.ts`: `setCoachBelt(input)`, `setOwnerTeaches(input)` y `deleteCoachAccount(input)` (este último conserva el motivo del servidor); `createStaffWithPassword` acepta `belt?: CoachBelt`.

- [ ] **Step 1: Cliente.** En `team-access-client.ts`, amplía el import de `@bpt-jersey/domain/staff/team-access` con:

```ts
setCoachBeltSchema, setCoachBeltResultSchema, setOwnerTeachesSchema, setOwnerTeachesResultSchema,
deleteCoachAccountSchema, deleteCoachAccountResultSchema,
type CoachBelt, type SetCoachBeltInput, type SetOwnerTeachesInput, type DeleteCoachAccountInput,
```

Cambia la firma de `createStaffWithPassword` a `input: { displayName: string; email: string; password: string; role: "coach"|"administrator"|"owner"; belt?: CoachBelt }` y añade al final:

```ts
export function setCoachBelt(input: SetCoachBeltInput) {
  return call("setCoachBelt", setCoachBeltSchema.parse(input), setCoachBeltResultSchema, "Unable to save this belt. Refresh the team directory and try again.");
}
export function setOwnerTeaches(input: SetOwnerTeachesInput) {
  return call("setOwnerTeaches", setOwnerTeachesSchema.parse(input), setOwnerTeachesResultSchema, "Unable to update this owner. Choose a belt and try again.");
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

- [ ] **Step 2: Formulario de creación con cinturón y ayuda para miembros (D16).** En `direct-staff-form.tsx`:
- import: `import { coachBelts, coachBeltLabels, type CoachBelt } from "@bpt-jersey/domain/staff/team-access";`
- tras `const [role,setRole]=…;` añade `const [belt,setBelt]=useState<CoachBelt|"">("");`
- en `submit`, la llamada pasa a ser `createStaffWithPassword({displayName:name.trim(),email:email.trim().toLowerCase(),password,role,...(role==="coach"&&belt?{belt}:{})});` y tras `setEmail("");` añade `setBelt("");`
- sustituye el texto de `<p className="staff-hint">…</p>` por:

```tsx
<p className="staff-hint">This is the only way to create staff. For coaches and assistants choose Coach / assistant. A member who becomes a coach gets a separate staff account: their name can match their member record, but use an email different from their member login. Office roles can only be created by an owner. The initial password must be replaced, or the person can link Google.</p>
```

- tras el `<label>` de «Direct staff role», dentro de `staff-form-grid`, añade:

```tsx
{role==="coach"?<label className="staff-field">Belt shown on the website<select value={belt} onChange={(e)=>setBelt(e.target.value as CoachBelt)} required><option value="" disabled>Choose a belt</option>{coachBelts.map((value)=><option key={value} value={value}>{coachBeltLabels[value]}</option>)}</select></label>:null}
```

- [ ] **Step 3: Commit**

```bash
cd /root/BPT-Jersey
git add apps/web/src/lib/team-access-client.ts apps/web/src/app/admin/staff/direct-staff-form.tsx
git -c user.name=Luis -c user.email=luismadef45@gmail.com commit -m "feat(admin): belt when creating a coach; staff creation is the only way in

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Web — Team directory: rol Coach, columna Website, Manage y fuera las invitaciones

**Files:**
- Create: `apps/web/src/app/admin/staff/coach-website-controls.tsx`
- Modify: `apps/web/src/app/admin/staff/team-directory.tsx`

**Interfaces:**
- Consumes: la Tarea 1 y la Tarea 6
- Produces:
  - `TeamDirectory` acepta las props `{ onManage?: (person: TeamDirectoryPerson) => void; refreshKey?: number }`;
  - `CoachWebsiteControls({ person, owner, onChanged })`, que usa el panel de la Tarea 8.

- [ ] **Step 1: Crear `coach-website-controls.tsx`.**

```tsx
"use client";
import { useState } from "react";
import { coachBeltLabels, coachBelts, type CoachBelt, type TeamDirectoryPerson } from "@bpt-jersey/domain/staff/team-access";
import { deleteCoachAccount, setCoachBelt, setOwnerTeaches } from "../../../lib/team-access-client";

/** Website settings of one person: belt, «Teaches» for owners, delete for coaches. */
export function CoachWebsiteControls({ person, owner, onChanged }: { person: TeamDirectoryPerson; owner: boolean; onChanged: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [pendingBelt, setPendingBelt] = useState<CoachBelt | "">(person.coach?.belt ?? "");
  const name = person.name || person.email || "this person";
  const isCoach = person.role === "coach" || person.role === "headCoach";
  const isOwner = person.role === "owner";
  const teaches = isOwner && person.coach?.active === true;

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      setConfirming(false);
      setTyped("");
      onChanged(done);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update this person.");
    } finally {
      setBusy(false);
    }
  }

  function chooseBelt(belt: CoachBelt) {
    setPendingBelt(belt);
    if (person.coach) void run(() => setCoachBelt({ userId: person.userId, belt }), `Belt saved for ${name}.`);
  }

  if (!isCoach && !isOwner) return <p className="staff-hint">Administrators do not appear on the website.</p>;
  return (
    <div className="coach-website-controls">
      <label className="staff-field">
        <span>Belt on website</span>
        <select value={pendingBelt} disabled={busy} onChange={(event) => chooseBelt(event.target.value as CoachBelt)}>
          {pendingBelt ? null : <option value="">Choose a belt</option>}
          {coachBelts.map((belt) => <option key={belt} value={belt}>{coachBeltLabels[belt]}</option>)}
        </select>
      </label>
      {isOwner && owner && (
        <label className="staff-field">
          <input
            type="checkbox"
            checked={teaches}
            disabled={busy || (!teaches && !pendingBelt)}
            onChange={(event) => void run(
              () => setOwnerTeaches({ userId: person.userId, teaches: event.target.checked, ...(pendingBelt ? { belt: pendingBelt } : {}) }),
              event.target.checked ? `${name} now appears on the website.` : `${name} no longer appears on the website.`,
            )}
          />
          <span>Teaches — show on website</span>
        </label>
      )}
      {isCoach && owner && !confirming && (
        <button className="staff-secondary-button" type="button" disabled={busy} onClick={() => setConfirming(true)}>
          Delete coach
        </button>
      )}
      {isCoach && owner && confirming && (
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

- [ ] **Step 2: Quitar las invitaciones de `team-directory.tsx` (D15).** Borra:
- los imports `createStaffInvitation`, `listStaffInvitations`, `cancelStaffInvitation` y el tipo `StaffInvitation`;
- los tipos `InvitationRole` y la variante `{ kind: "invitation"; … }` de `Review`, que queda como `type Review = { person: TeamDirectoryPerson; role: TeamRole }` con `type TeamRole = "coach" | "administrator" | "owner";` (sustituye a `AdministrativeRole`);
- los estados `invitations`, `invitationsCheckedAt`, `invitationsError`, `invitationsLoading`, `email` e `invitedRole`, y la ref `inviteEmail`;
- las funciones `loadInvitations`, `cancel` y `reviewInvitation`, y la llamada `void loadInvitations();` del `useEffect` inicial;
- en `confirm()`, la rama `else { await createStaffInvitation … }`: el cuerpo pasa a usar `review.person` y `review.role` sin comprobar `kind`, y se quita `inviteEmail.current?.focus();`;
- el formulario completo «Create staff profile» (`{(owner || session.role === "administrator") && (<form … onSubmit={reviewInvitation}> … </form>)}`);
- la sección completa «Pending access» (`{owner && (<section className="staff-pending-invitations" …> … </section>)}`);
- en la tarjeta «Confirm staff access», las ramas `review.kind === "invitation"`. Queda `{review.person.name || review.person.email || review.person.userId}` y la frase «… role immediately.»; el bloque `{review.kind === "role" && (…)}` pasa a mostrarse siempre.

Después, comprueba que no queda ningún resto:

```bash
grep -nE "nvitation|inviteEmail|invitedRole|kind" /root/BPT-Jersey/apps/web/src/app/admin/staff/team-directory.tsx
```

Esperado: ninguna línea.

- [ ] **Step 3: «Change role» con Coach (D14).** En el `<select>` de «New role», sustituye las dos opciones por:

```tsx
              <option value="coach">Coach</option>
              <option value="administrator">Administrator</option>
              <option value="owner">Owner</option>
```

El `onChange` pasa a hacer el cast `as TeamRole`. En el botón «Change role» de la columna `actions`, la línea `setRole(person.role === "administrator" ? "owner" : "administrator");` pasa a:

```tsx
                            setRole(person.role === "coach" || person.role === "headCoach" ? "administrator" : "coach");
```

`useState<AdministrativeRole>("administrator")` pasa a `useState<TeamRole>("coach")`. En `confirm()`, justo después de `setSelected(undefined);`, añade `void loadDirectory();`. Así la columna Website y el perfil de coach de la fila se actualizan tras bajar a alguien a coach. En la tarjeta de confirmación, el texto para `review.role === "coach"` ya existe. Justo debajo, añade el aviso:

```tsx
          {review.role === "coach" && review.person.role !== "coach" && (
            <p>They lose office access at their next sign-in and get an active coach profile. Choose their belt in Manage.</p>
          )}
```

- [ ] **Step 4: Props, columna Website y botón Manage (D17).** Cambia las firmas:

```tsx
type DirectoryProps = { onManage?: (person: TeamDirectoryPerson) => void; refreshKey?: number };
export function TeamDirectory(props: DirectoryProps) {
  const session = useAdminGateSession();
  return (
    <TeamDirectoryContent
      key={`${session.academyId}:${session.uid}:${session.role}`}
      session={session}
      {...props}
    />
  );
}
export function TeamDirectoryContent({ session, onManage, refreshKey = 0 }: { session: AdminSession } & DirectoryProps) {
```

Tras el `useEffect` inicial, añade la recarga cuando el panel cambie algo:

```tsx
  useEffect(() => {
    if (refreshKey > 0) void loadDirectory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);
```

En `columns`, tras la columna `role`, añade:

```tsx
            {
              key: "website",
              label: "Website",
              render: (person: TeamDirectoryPerson) =>
                person.role === "administrator"
                  ? "—"
                  : person.coach?.active && person.coach.belt
                    ? `Shown · ${coachBeltLabels[person.coach.belt]}`
                    : "Hidden",
            },
            {
              key: "manage",
              label: "Coaching",
              render: (person: TeamDirectoryPerson) =>
                person.role === "administrator" || !onManage ? (
                  "—"
                ) : (
                  <button
                    className="staff-row-action"
                    type="button"
                    disabled={busy}
                    aria-label={`Manage ${person.name || person.email || "team member"}`}
                    onClick={() => onManage(person)}
                  >
                    Manage
                  </button>
                ),
            },
```

y añade `coachBeltLabels` al import de `@bpt-jersey/domain/staff/team-access`.

- [ ] **Step 5: Commit**

```bash
cd /root/BPT-Jersey
git add apps/web/src/app/admin/staff/coach-website-controls.tsx apps/web/src/app/admin/staff/team-directory.tsx
git -c user.name=Luis -c user.email=luismadef45@gmail.com commit -m "feat(admin): one team directory with coach role, website column and manage; drop email invitations

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Web — `/admin/staff`: fuera la lista de códigos, panel «Manage» por persona

**Files:**
- Modify: `apps/web/src/app/admin/staff/page.tsx`

**Interfaces:**
- Consumes: `TeamDirectory` con `onManage`/`refreshKey` y `CoachWebsiteControls` (Tarea 7); `useAdminGateSession` (`../admin-gate`); `setStaffActive`, `replaceStaffAvailability` y `replaceStaffAssignments` (sin cambios, `../../../lib/staff-client`)

- [ ] **Step 1: El estado sale de la persona elegida.** En `StaffAdminPage`:
- borra `profiles`/`setProfiles`, `selectedStaffKey`/`setSelectedStaffKey`, `loading`/`setLoading`, `rowActionRefs`, `restoreFocusRef`, el `useEffect` que llama a `listStaffProfiles`, el `useEffect` que restaura el foco (`rowActionRefs.current[staffKey]?.focus()`) y la función `selectProfile`;
- quita `listStaffProfiles` y `type StaffProfileProjection` del import de `staff-client` si quedan sin uso, y también `StaffRole`/`roleLabel`/`statusLabel` si quedan sin uso;
- añade:

```tsx
  const session = useAdminGateSession();
  const [selected, setSelected] = useState<TeamDirectoryPerson>();
  const [refreshKey, setRefreshKey] = useState(0);
  const selectedProfile = selected?.coach ?? undefined;

  function manage(person: TeamDirectoryPerson): void {
    setSelected(person);
    setError("");
    setStatus("");
    setInvalidField(undefined);
  }
```

con los imports `import { useAdminGateSession } from "../admin-gate";`, `import type { TeamDirectoryPerson } from "@bpt-jersey/domain/staff/team-access";` e `import { CoachWebsiteControls } from "./coach-website-controls";`.

- en `runMutation`, borra la línea `if (selectedStaffKey) restoreFocusRef.current = selectedStaffKey;`;
- en `handleActiveUpdate`, sustituye el último argumento (`(profile) => setProfiles(...)`) por:

```tsx
      (profile) => {
        setSelected((current) => (current?.coach ? { ...current, coach: { ...current.coach, active: profile.active } } : current));
        setRefreshKey((key) => key + 1);
      },
```

`handleAvailability` y `handleAssignment` siguen usando `selectedProfile.staffKey`, que ahora es `TeamCoachProfile.staffKey`: no hay que cambiarlos.

- [ ] **Step 2: Render.** Sustituye `<TeamDirectory />` por `<TeamDirectory onManage={manage} refreshKey={refreshKey} />`. Borra entero el bloque `{loading ? (…) : profiles.length === 0 ? (…) : (<AdminDataTable caption="Staff profiles" … />)}`. Sustituye la cabecera del panel, desde `{selectedProfile ? (` hasta el cierre de la primera `staff-card` (el botón Deactivate), por:

```tsx
      {selected ? (
        <section className="staff-selected-panel" aria-labelledby="staff-selected-title">
          <p className="admin-eyebrow">Manage · {teamRoleLabels[selected.role]}</p>
          <h3 id="staff-selected-title">{selected.name || selected.email || "Team member"}</h3>

          <section className="staff-card staff-operation-card">
            <h4>Website</h4>
            <CoachWebsiteControls
              key={`${selected.userId}:${refreshKey}`}
              person={selected}
              owner={session.role === "owner"}
              onChanged={(message) => {
                setStatus(message);
                setRefreshKey((key) => key + 1);
                if (message.endsWith("was deleted.")) setSelected(undefined);
              }}
            />
          </section>

          {selectedProfile ? (
            <>
              <section className="staff-card staff-operation-card">
                <p>Coaching availability and assignments are managed below.</p>
                <button
                  className="staff-secondary-button"
                  disabled={busy}
                  onClick={() => void handleActiveUpdate()}
                  type="button"
                >
                  {selectedProfile.active ? "Deactivate coach profile" : "Activate coach profile"}
                </button>
              </section>
```

Los dos `<form>` de «Availability» y «Assignment» se quedan como están. Cierra el fragmento y el condicional justo después del `</form>` de «Assignment», y cierra el panel con un botón para salir:

```tsx
            </>
          ) : (
            <p className="staff-hint">Turn on «Teaches» to manage availability and assignments.</p>
          )}
          <button className="staff-secondary-button" type="button" onClick={() => setSelected(undefined)}>
            Close
          </button>
        </section>
      ) : null}
```

Importa `teamRoleLabels` desde `@bpt-jersey/domain/staff/team-access`. La sección «Existing permission grants» queda como está.

Nota: tras «Change role», el Team directory actualiza su fila, pero `selected` puede mostrar el rol anterior hasta que se pulse Manage otra vez. Es aceptable: el panel se abre desde la fila ya actualizada.

- [ ] **Step 3: Revisar que no quedan restos**

```bash
grep -nE "profiles|selectedStaffKey|listStaffProfiles|rowActionRefs|restoreFocusRef|Staff key" /root/BPT-Jersey/apps/web/src/app/admin/staff/page.tsx
```

Esperado: ninguna línea.

- [ ] **Step 4: Commit**

```bash
cd /root/BPT-Jersey
git add apps/web/src/app/admin/staff/page.tsx
git -c user.name=Luis -c user.email=luismadef45@gmail.com commit -m "feat(admin): manage coaching from the team directory; remove the staff key list

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Landing — «The coaching team» sale de la base de datos

**Files:**
- Create: `apps/web/src/app/coaching-team.tsx`
- Modify: `apps/web/src/app/page.tsx` (bloque de las líneas 131–143 e import)

**Interfaces:**
- Consumes: `publicCoachesResponseSchema`, `type PublicCoach` (Tarea 1); endpoint (Tarea 5)
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

- [ ] **Step 2: Usarlo en la landing.** En `apps/web/src/app/page.tsx`, añade `import { CoachingTeam } from "./coaching-team";` y sustituye todo el bloque `<div className="instructors-block"> … </div>` (líneas 131–143) por `<CoachingTeam />`. No toques `academyContent` ni su import.

- [ ] **Step 3: Commit**

```bash
cd /root/BPT-Jersey
git add apps/web/src/app/coaching-team.tsx apps/web/src/app/page.tsx
git -c user.name=Luis -c user.email=luismadef45@gmail.com commit -m "feat(landing): coaching team comes from coach accounts and teaching owners

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Verificación local con el emulador (proyecto demo, nunca producción)

**Files:** nada se commitea. `apps/functions/.env.local` es temporal y está en `.gitignore`.

- [ ] **Step 1: Compilar las funciones como en el despliegue**

```bash
cd /root/BPT-Jersey && node qa/scripts/run-recovery-stack.mjs build
```

Esperado: `tsc` sin errores. Si hay errores de tipo, corrígelos en el archivo de la tarea que los introdujo y repite.

- [ ] **Step 2: Compilar la web**

```bash
cd /root/BPT-Jersey && corepack pnpm --filter @bpt-jersey/web build
```

Esperado: `next build` sin errores.

- [ ] **Step 3: Endpoint apuntando a la academia demo**

```bash
cd /root/BPT-Jersey && printf 'COURSES_ACADEMY_ID=demo-academy\n' > apps/functions/.env.local
```

- [ ] **Step 4: Arrancar el stack**

```bash
cd /root/BPT-Jersey && node qa/scripts/run-recovery-stack.mjs start
```

Esperado: `Recovery stack ready: http://127.0.0.1:3100`. El owner es `recovery-owner@example.test`; su contraseña sintética es `AUTH_EMULATOR_E2E_PASSWORD` en el archivo de secretos que genera `secrets()` en `qa/scripts/run-recovery-stack.mjs`.

- [ ] **Step 5: Página única.** Entra como owner en `http://127.0.0.1:3100/admin/staff`. Esperado:
  - **no** aparecen «Create staff profile», «Pending access» ni la tabla «Staff profiles» con códigos;
  - sí aparecen el Team directory (con columnas Website y Coaching), «Create staff with initial password» y «Existing permission grants».

- [ ] **Step 6: Crear coaches y comprobar el orden.** Crea «Zed Brown» (`brown`) y «Ana Black» (`black-2`). Después:

```bash
curl -s http://127.0.0.1:5011/demo-bpt-jersey/europe-west9/coachesPublic
```

Esperado: `{"coaches":[{"name":"Ana Black","belt":"black-2","beltLabel":"2nd degree black belt"},{"name":"Zed Brown","belt":"brown","beltLabel":"Brown belt"}]}`. Sin uid ni email. En `http://127.0.0.1:3100/` se ven los dos en ese orden, y el Team directory muestra «Shown · …».

- [ ] **Step 7: Review Focus 2 — owners con «Teaches».** Crea el owner «Owen Owner». En Website sale «Hidden» y **no** está en el curl. Pulsa Manage → elige `black-1` → marca «Teaches — show on website» → está en el curl entre Ana y Zed. Desmárcalo → desaparece.

- [ ] **Step 8: Review Focus 1 — administrator.** Con «Change role», haz administrator a Zed. La columna Website pasa a «—» y **no** está en el curl.

- [ ] **Step 9: Review Focus 3 — bajar a coach.** «Change role» sobre Zed → Coach → confirma. Zed vuelve al curl con su cinturón `brown`, y la fila muestra el rol Coach. Pulsa «Change role» en tu propia fila: dice «Your account» y no hay botón.

- [ ] **Step 10: Deactivate desde Manage.** Manage sobre Ana → «Deactivate coach profile» → sale del curl y la columna muestra «Hidden». «Activate» → vuelve.

- [ ] **Step 11: Review Focus 4 — endpoint caído.** Para el stack (Ctrl-C) y arranca solo la web:

```bash
cd /root/BPT-Jersey && NEXT_PUBLIC_COACHES_API_URL=http://127.0.0.1:9/none corepack pnpm --filter @bpt-jersey/web dev --port 3101
```

`http://127.0.0.1:3101/` → el bloque «The coaching team» no aparece y el resto de la landing se ve bien. Para y vuelve al Step 4.

- [ ] **Step 12: Borrar.** Manage sobre Ana → «Delete coach» → escribe «Ana Black» → «Delete permanently». Esperado:
  - mensaje «Ana Black was deleted.», el panel se cierra y Ana desaparece del directorio y del curl;
  - en el emulador de Firestore, `users/<uid>` tiene `status: "inactive"` y `deletedAt`, y existe el evento `staff.coach_deleted`.

- [ ] **Step 13: Review Focus 5 — sesión con varios trainers.** En `/admin/classes-services/classes`, crea una sesión futura con dos trainers, uno de ellos Zed. Delete sobre Zed → «Reassign these to another coach first: <título> on <fecha>», y Zed sigue ahí.

- [ ] **Step 14: Clase recurrente activa.** Pon a Zed de trainer en una clase recurrente activa → al intentar borrarlo aparece «class <nombre>».

- [ ] **Step 15: Permisos de administrator.** Crea un administrator de prueba y entra con él. Esperado: sin «Change role», sin «Teaches» y sin «Delete coach». Sí puede cambiar el cinturón de un coach y hacer Deactivate.

- [ ] **Step 16: Limpiar**

```bash
rm /root/BPT-Jersey/apps/functions/.env.local
```

Esperado: `git -C /root/BPT-Jersey status --short` no muestra archivos nuevos de esta tarea.

- [ ] **Step 17: Informar a Luis.** Resume qué pasos pasaron y cuáles no. Menciona que el reintento de un borrado parcial (login borrado y fallo de Firestore) solo se comprobó leyendo el código: tras borrarse el login, esa persona ya no aparece en el directorio para reintentar.

---

### Task 11: Transición en producción y entrega

⚠️ Esta tarea escribe en **producción** (`bptjersey-f5a25`). **Pide el OK explícito de Luis antes del Step 4 (deploy) y otra vez antes del Step 5 (cinturones).** Orden obligatorio: push → deploy → cinturones. Si los cinturones se escribieran antes del deploy, las funciones antiguas rechazarían esos perfiles.

- [ ] **Step 1: Leer el estado (solo lectura).** Crea `/root/compartido/coaches-belts-read.mjs`, con la misma autenticación que `scripts/provision-landing-coaches.mjs` (token de `firebase-tools` + `firebase-admin`). El script lista:
  - las cuentas de Auth con rol de staff: uid, nombre, rol y `disabled`;
  - `academies/{academyId}/staff`: staffId, userId, active y belt;
  - las invitaciones con `status` `pending` o `processing` de la colección que usa `createTeamInvitationStore` (`apps/functions/src/staff/team-invitations-firestore.ts`).

  Estado esperado según la lectura del 2026-09-29:
  - `coach-miro` es owner; `coach-charlie`, `coach-amone`, `coach-connor` y `coach-catalina` son coach;
  - Andres Santiago y el owner sin nombre son owners sin perfil;
  - los 5 perfiles de coach están activos y sin cinturón.

- [ ] **Step 2: Informar a Luis.** Enséñale la tabla y las invitaciones pendientes, y pregúntale si hay que cancelarlas. Desde ahora ya no se pueden crear nuevas, pero las pendientes aún podrían activarse al entrar con Google.

- [ ] **Step 3: Integrar y subir**

```bash
cd /root/BPT-Jersey && git fetch origin && git rebase origin/main && git push origin main && git rev-parse HEAD origin/main
```

Esperado: los dos SHA coinciden. Cloudflare Pages publica la web en unos 90 s. Hasta que exista el endpoint, el bloque de coaches queda oculto.

- [ ] **Step 4: Desplegar TODAS las funciones** (tras el OK de Luis)

```bash
cd /root/BPT-Jersey && corepack pnpm exec firebase deploy --project bptjersey-f5a25 --only functions
```

Se despliegan todas porque `parseStaffProfile` y los contratos del Team directory cambiaron, y los usan muchos exports: staff, niveles, informes de progreso y el login de staff. Tarda varios minutos. Esperado: `Deploy complete!` sin funciones en error.

- [ ] **Step 5: Cinturones, primero en seco** (tras el OK de Luis; siempre después del Step 4). Crea `/root/compartido/coaches-belts-apply.mjs` con la misma autenticación. Por defecto hace un dry-run, y con `--apply` escribe `belt` y `updatedAt`:
  - `coach-miro` → `black-4`
  - `coach-charlie`, `coach-amone` y `coach-connor` → `black`
  - `coach-catalina` → `brown`

  Ejecútalo sin `--apply` y enseña la salida. Ejecútalo con `--apply` solo si Luis confirma.

- [ ] **Step 6: Charlie pasa a owner (lo hace Luis, D18).** Pídele a Luis que, en `https://bptjersey.com/admin/staff`, pulse «Change role» en Charlie Tromans → Owner → «Confirm access». Charlie conserva su perfil de coach, así que su columna Website sigue en «Shown · Black belt».

- [ ] **Step 7: Verificación final**

```bash
curl -s https://europe-west9-bptjersey-f5a25.cloudfunctions.net/coachesPublic
```

Esperado, en este orden:
  - Professor Vladimiro "Miro" Afonso (4th degree black belt);
  - Amoné Mouton, Charlie Tromans y Connor Hoopes (Black belt, alfabético);
  - Catalina Bruma (Brown belt).

  Ni Andres Santiago ni el owner sin nombre. En `https://bptjersey.com` se ve esa lista en «The coaching team». En `/admin/staff` hay un único directorio con las columnas Website y Coaching, y sin «Create staff profile» ni «Pending access».
