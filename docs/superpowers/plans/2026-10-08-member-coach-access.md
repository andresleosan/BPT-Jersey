# Acceso de coach para miembros adultos — Plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: `superpowers:subagent-driven-development` (recomendado) o
> `superpowers:executing-plans`, tarea por tarea. Pasos con casillas (`- [ ]`).

**Objetivo:** que la oficina dé acceso de coach a un miembro adulto existente, que usará la misma
cuenta (mismo correo y misma clave o Google), entrando como coach por `/staff/login` y como miembro
por `/login`.

**Arquitectura:** un documento `academies/{a}/coachMemberAccess/{uid}` marca la cuenta como doble y
guarda su rol de miembro. El claim `role` cambia de modo con la callable `switchAccessMode`, que el
formulario de login llama cuando el rol del token no coincide con la página. La ficha `users` de
cliente no cambia; las 3 comprobaciones de coach que exigen `accountType === "staff"` aceptan
también una cuenta doble. Los flujos que hoy borran o vacían el login (Delete coach, Deactivate,
Change role, Delete account) se protegen para no romper al miembro.

**Stack:** Firebase Functions v2 (`onCall`), Firestore, zod, Next.js 16 estático.

**Spec:** `docs/superpowers/specs/2026-10-08-member-coach-access-design.md` (D1–D12).

## Restricciones globales (del repo y la spec)

- Trabajo directo en `main` local; antes de empezar, `git fetch` e integrar `origin/main`.
  **Nunca `git add -A`**: añadir solo los archivos de la tarea.
- **Sin tests automáticos** (AGENTS.md, D12). Cada tarea se verifica con el `typecheck` **del paquete
  tocado** y por inspección. La prueba funcional está en la Tarea 7 (emulador).
- Comandos siempre con `corepack pnpm`. Node `>=22.13 <25`.
- Roles de miembro elegibles: exactamente `adultStudent` y `guardian` (D5). `teenStudent` nunca.
- Textos de UI en inglés y cortos, como el resto del panel. Errores legibles, nunca errores crudos de Firebase.
- `requireUserActor` rechaza claims desconocidos: **solo se escriben `academyId` y `role`**.
  Nunca se añade otro claim.
- Push a `main` publica la web. El deploy de functions es aparte y **solo con confirmación
  explícita de Luis en el chat**.

## Puntos de revisión (no cubiertos por pruebas)

1. **Delete coach sobre una cuenta doble** debe dejar intactos la cuenta Auth y `users/{uid}`. Hoy los
   borra (`coach-account-callables.ts` ~L111-121). Riesgo máximo: el miembro pierde su login.
2. **Deactivate/Activate y Edit role en una cuenta doble en modo miembro**: hoy `applyClaims` fijaría
   `role: "coach"` o lo borraría, y la persona perdería `/account`. Activar no toca el claim;
   desactivar pone `memberRole`.
3. **Login de una cuenta normal (no doble)**: no debe cambiar nada. `switchAccessMode` responde
   `failed-precondition` y el formulario sigue su flujo de siempre, sin mensajes nuevos.
4. **Delete account de un miembro con acceso de coach** se rechaza **antes** de cancelar reservas:
   hoy la cancelación ocurre antes de decidir el borrado del login.
5. **Tutor coach que borra a un hijo**: el borrado del hijo sigue permitido. Solo se bloquea cuando
   también se borraría el login de la cuenta doble (`deleteLogin === true`).

---

### Tarea 1: Contratos de dominio

**Archivos:**
- Modificar: `packages/domain/src/staff/team-access-contracts.ts` (añadir al final, antes de los `export type`)

**Interfaces producidas:**
- `memberCoachRoles`, `memberCoachRoleSchema`, `type MemberCoachRole`
- `coachMemberAccessPath(academyId, userId): string`
- `isCoachAccountType(accountType: unknown, dualAccess: boolean): boolean`
- `grantMemberCoachAccessSchema`, `type GrantMemberCoachAccessInput`
- `coachEligibleMemberSchema`, `coachEligibleMembersResponseSchema`, `listCoachEligibleMembersSchema`
- `switchAccessModeSchema`, `switchAccessModeResultSchema`, `type AccessMode`
- `teamDirectoryPersonSchema` gana `alsoMember: z.boolean().optional()`

- [ ] **Paso 1: Añadir el campo opcional a la fila del directorio**

En `teamDirectoryPersonSchema` añade, tras `coach`:

```ts
  /** Set when the account is also a member (coachMemberAccess); optional so old builds still parse. */
  alsoMember: z.boolean().optional(),
```

- [ ] **Paso 2: Añadir contratos y reglas compartidas**

```ts
/** Adult member roles that may also hold coach access (spec D5). Teens never. */
export const memberCoachRoles = ["adultStudent", "guardian"] as const;
export const memberCoachRoleSchema = z.enum(memberCoachRoles);
export type MemberCoachRole = z.infer<typeof memberCoachRoleSchema>;
/** Marks a member account that also has coach access and remembers which member role to restore. */
export function coachMemberAccessPath(academyId: string, userId: string): string {
  return `academies/${academyId}/coachMemberAccess/${userId}`;
}
/** Coach checks accept a staff profile, or a member profile whose account also has coach access. */
export function isCoachAccountType(accountType: unknown, dualAccess: boolean): boolean {
  return accountType === "staff" || (dualAccess && accountType === "client");
}
export const coachMemberAccessSchema = z.strictObject({
  userId: z.string().min(1).max(128),
  academyId: z.string().min(1).max(128),
  memberRole: memberCoachRoleSchema,
  grantedAt: z.iso.datetime(),
  grantedBy: z.string().min(1).max(128),
  schemaVersion: z.literal("1"),
});
export const grantMemberCoachAccessSchema = z.strictObject({
  userId: z.string().min(1).max(128),
  belt: coachBeltSchema,
});
export const listCoachEligibleMembersSchema = z.strictObject({
  query: z.string().trim().min(2).max(120),
});
export const coachEligibleMemberSchema = z.strictObject({
  userId: z.string().min(1).max(128),
  name: z.string().max(256),
  email: z.string().max(320),
});
export const coachEligibleMembersResponseSchema = z.strictObject({
  members: z.array(coachEligibleMemberSchema).max(20),
});
export const switchAccessModeSchema = z.strictObject({ mode: z.enum(["coach", "member"]) });
export const switchAccessModeResultSchema = z.strictObject({ switched: z.boolean() });
export type AccessMode = z.infer<typeof switchAccessModeSchema>["mode"];
export type GrantMemberCoachAccessInput = z.infer<typeof grantMemberCoachAccessSchema>;
export type CoachEligibleMember = z.infer<typeof coachEligibleMemberSchema>;
```

- [ ] **Paso 3: Verificar**

Run: `corepack pnpm --filter @bpt-jersey/domain typecheck`
Expected: sin errores.

- [ ] **Paso 4: Commit**

```bash
git add packages/domain/src/staff/team-access-contracts.ts
git commit -m "Add member coach access contracts"
```

---

### Tarea 2: Callables nuevas (dar acceso, buscar miembros, cambiar de modo)

**Archivos:**
- Crear: `apps/functions/src/staff/member-coach-access.ts`
- Modificar: `apps/functions/src/index.ts` (junto a `createStaffWithPassword`, ~L309)

**Interfaces:**
- Consume: los contratos de la Tarea 1; `activateCoachProfile`, `coachAudit` de `./coach-account-callables.js`;
  `requireActiveOfficeActor`; `requireUserActor`.
- Produce:
  - `readMemberCoachRole(db: Firestore, academyId: string, userId: string): Promise<MemberCoachRole | null>`,
    usada por las Tareas 3 y 4.
  - Las callables `grantMemberCoachAccess`, `listCoachEligibleMembers` y `switchAccessMode`.

- [ ] **Paso 1: Escribir el módulo**

```ts
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  coachEligibleMembersResponseSchema, coachMemberAccessPath, coachMemberAccessSchema,
  grantMemberCoachAccessSchema, listCoachEligibleMembersSchema, memberCoachRoleSchema,
  switchAccessModeSchema, type MemberCoachRole,
} from "@bpt-jersey/domain/staff/team-access";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireActiveOfficeActor } from "../auth/office-actor.js";
import { requireUserActor } from "../auth/user-authorization.js";
import { activateCoachProfile, coachAudit, coachProfiles } from "./coach-account-callables.js";

/** The member role to restore, or null when the account is not a member with coach access. */
export async function readMemberCoachRole(db: Firestore, academyId: string, userId: string): Promise<MemberCoachRole | null> {
  const parsed = coachMemberAccessSchema.safeParse((await db.doc(coachMemberAccessPath(academyId, userId)).get()).data());
  return parsed.success && parsed.data.academyId === academyId && parsed.data.userId === userId ? parsed.data.memberRole : null;
}

export const grantMemberCoachAccess = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  const input = grantMemberCoachAccessSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Choose a member and a belt.");
  const { userId, belt } = input.data;
  const db = getFirestore();
  const user = await getAuth().getUser(userId).catch(() => null);
  const memberRole = memberCoachRoleSchema.safeParse(user?.customClaims?.role);
  const profile = (await db.doc(`academies/${actor.academyId}/users/${userId}`).get()).data();
  if (
    !user || user.disabled || user.customClaims?.academyId !== actor.academyId || !memberRole.success ||
    profile?.accountType !== "client" || profile.active !== true || profile.status !== "active"
  ) throw new HttpsError("failed-precondition", "Only an active adult member can get coach access.");
  if ((await coachProfiles(db, actor.academyId, userId)).length > 0)
    throw new HttpsError("failed-precondition", "This account already has a coach profile.");
  const { batch, now } = await activateCoachProfile(db, actor.academyId, actor.userId, userId, belt);
  // create() makes a second, simultaneous grant fail instead of overwriting the first.
  batch.create(db.doc(coachMemberAccessPath(actor.academyId, userId)), {
    userId, academyId: actor.academyId, memberRole: memberRole.data, grantedAt: now, grantedBy: actor.userId, schemaVersion: "1",
  });
  batch.create(db.collection(`academies/${actor.academyId}/auditEvents`).doc(),
    coachAudit(actor.academyId, actor.userId, userId, "staff.member_coach_access_granted", "member coach access", now));
  await batch.commit().catch(() => { throw new HttpsError("failed-precondition", "Coach access could not be given. Refresh and try again."); });
  // The claim is untouched: the person stays a member until they sign in from /staff/login.
  return { granted: true as const };
});

export const listCoachEligibleMembers = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  const input = listCoachEligibleMembersSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Type at least two letters.");
  const needle = input.data.query.toLowerCase();
  const db = getFirestore();
  const staff = new Set((await db.collection(`academies/${actor.academyId}/staff`).get()).docs.map((doc) => String(doc.data().userId)));
  const members: { userId: string; name: string; email: string }[] = [];
  // ponytail: scans Auth like listTeamDirectory (no index); fine for a few thousand accounts.
  let pageToken: string | undefined;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    for (const user of page.users) {
      if (members.length >= 20) break;
      const name = user.displayName?.trim() ?? "";
      if (
        user.disabled || !user.email || user.customClaims?.academyId !== actor.academyId ||
        !memberCoachRoleSchema.safeParse(user.customClaims?.role).success || staff.has(user.uid) ||
        !(name.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle))
      ) continue;
      members.push({ userId: user.uid, name, email: user.email });
    }
    pageToken = page.pageToken;
  } while (pageToken && members.length < 20);
  return coachEligibleMembersResponseSchema.parse({ members });
});

export const switchAccessMode = onCall(browserAdminCallableOptions, async (request) => {
  const actor = requireUserActor(request);
  const input = switchAccessModeSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid access mode.");
  const db = getFirestore();
  const memberRole = await readMemberCoachRole(db, actor.academyId, actor.userId);
  if (!memberRole) throw new HttpsError("failed-precondition", "This account has one access mode.");
  if (input.data.mode === "coach") {
    const active = (await coachProfiles(db, actor.academyId, actor.userId)).some((doc) => doc.data().active === true);
    if (!active) throw new HttpsError("failed-precondition", "Coach access is not active.");
  }
  const role = input.data.mode === "coach" ? "coach" : memberRole;
  const user = await getAuth().getUser(actor.userId);
  if (user.customClaims?.role === role) return { switched: false };
  // Only academyId and role: requireUserActor rejects any other custom claim.
  await getAuth().setCustomUserClaims(actor.userId, { academyId: actor.academyId, role });
  return { switched: true };
});
```

`coachProfiles` (`coach-account-callables.ts:12`) devuelve los `QueryDocumentSnapshot[]` de
`staff` con ese `userId`. Por eso funciona `.some((doc) => doc.data().active === true)`.

- [ ] **Paso 2: Exportar en `apps/functions/src/index.ts`**

Tras la línea de `createStaffWithPassword`:

```ts
export { grantMemberCoachAccess, listCoachEligibleMembers, switchAccessMode } from "./staff/member-coach-access.js";
```

- [ ] **Paso 3: Verificar**

Run: `corepack pnpm --filter @bpt-jersey/functions typecheck`
Expected: sin errores.

- [ ] **Paso 4: Commit**

```bash
git add apps/functions/src/staff/member-coach-access.ts apps/functions/src/index.ts
git commit -m "Let the office give coach access to an adult member"
```

---

### Tarea 3: Las comprobaciones de coach aceptan una cuenta doble

**Archivos:**
- Modificar: `apps/functions/src/staff/staff-service.ts` (`assertUserIdentity` ~L325, `assertUser` ~L346 y sus 3 llamadas ~L645, ~L703, ~L745)
- Modificar: `apps/functions/src/levels/level-service.ts` (~L738)
- Modificar: `apps/functions/src/levels/level-authorization.ts` (`activeStaffUser` ~L98, llamada ~L184)

**Interfaces:** consume `coachMemberAccessPath` e `isCoachAccountType` (Tarea 1). No usa
`readMemberCoachRole`: aquí basta con saber si existe el documento, leído en la misma
transacción o con el mismo lector.

- [ ] **Paso 1: `staff-service.ts`**

Dale a `assertUserIdentity` y a `assertUser` un parámetro final `dualAccess: boolean` y cambia la condición:

```ts
  if (!isCoachAccountType(data.accountType, dualAccess)) {
    throw new StaffStoreError("precondition", "Canonical user is not eligible");
  }
```

En cada transacción que los llama (`createStaffProfile`, `updateStaffProfile`, `setStaffActive`),
lee el documento en la misma transacción y pásalo:

```ts
const dualAccess = documentSnapshot(
  await transaction.get(dependencies.firestore.doc(coachMemberAccessPath(academyId, userId /* o current.userId */))),
).exists;
```

Firestore exige todas las lecturas antes de la primera escritura: pon esta lectura junto a la de `userReference`.

- [ ] **Paso 2: `level-service.ts` ~L738**

Antes de la condición, lee en la misma transacción:

```ts
const dualAccess = (await transaction.get(firestore.doc(coachMemberAccessPath(input.academyId, input.actorId)))).exists;
```

y sustituye `userData.accountType !== "staff"` por `!isCoachAccountType(userData.accountType, dualAccess)`.

- [ ] **Paso 3: `level-authorization.ts`**

Añade la tercera lectura al `Promise.all` de la rama `staffRoles` (~L183):

```ts
const [user, staffDocuments, dualDocument] = await Promise.all([
  dependencies.getDocument(`academies/${actor.academyId}/users/${actor.userId}`),
  dependencies.queryDocuments(`academies/${actor.academyId}/staff`, "userId", actor.userId, 2),
  dependencies.getDocument(coachMemberAccessPath(actor.academyId, actor.userId)),
]).catch(() => unavailable());
if (!activeStaffUser(user, actor.academyId, actor.userId, dualDocument.exists) || staffDocuments.length !== 1) {
```

En `activeStaffUser`, añade el parámetro `dualAccess: boolean` y usa
`isCoachAccountType(value.accountType, dualAccess)` en lugar de `value.accountType === "staff"`.

- [ ] **Paso 4: Verificar**

Run: `corepack pnpm --filter @bpt-jersey/functions typecheck`
Expected: sin errores.

Luego revisa con `git diff` que **ninguna** comprobación de `owner`/`administrator`
(`matchesProvisionedMemberDirectoryActor`) haya cambiado.

- [ ] **Paso 5: Commit**

```bash
git add apps/functions/src/staff/staff-service.ts apps/functions/src/levels/level-service.ts apps/functions/src/levels/level-authorization.ts
git commit -m "Accept member accounts with coach access in coach checks"
```

---

### Tarea 4: Proteger al miembro en el ciclo de vida del coach

**Archivos:**
- Modificar: `apps/functions/src/staff/staff-callables.ts` (`StaffCallableServices` ~L31, `applyClaims` ~L284, `staffCallableServices` ~L535)
- Modificar: `apps/functions/src/staff/coach-account-callables.ts` (`deleteCoachAccount` ~L47)
- Modificar: `apps/functions/src/staff/team-access.ts` (`TeamAccessServices`, `listTeamDirectoryHandler` ~L81, `changeTeamRoleHandler` ~L111)
- Modificar: `apps/functions/src/staff/team-access-callables.ts` (`services()`)
- Modificar: `apps/functions/src/members/member-delete-callables.ts` (~L55-L109)

**Interfaces:** consume `readMemberCoachRole` (Tarea 2) y `coachMemberAccessPath` (Tarea 1).

- [ ] **Paso 1: Sincronización de claims (D9)**

En `StaffCallableServices` añade
`memberCoachRole?: (academyId: string, userId: string) => Promise<"adultStudent" | "guardian" | null>;`.
Es opcional para no romper a quienes construyen estos servicios a mano. En `staffCallableServices()`:

```ts
    memberCoachRole: (academyId, userId) => readMemberCoachRole(getFirestore(), academyId, userId),
```

En `applyClaims`, tras `if (hasAdministrativeRole) return;`:

```ts
  const memberRole = (await services.memberCoachRole?.(profile.academyId, userId)) ?? null;
  // A member with coach access: sign-in picks the mode, so activating leaves the claim alone and
  // deactivating returns the account to member mode instead of leaving it without a role.
  if (memberRole) {
    if (profile.active || current.role === memberRole) return;
    await services.auth.setCustomUserClaims(userId, { academyId: profile.academyId, role: memberRole });
    return;
  }
```

- [ ] **Paso 2: `deleteCoachAccount` (D8)**

Tras calcular `profiles`, lee `const memberRole = await readMemberCoachRole(db, actor.academyId, userId);`.
En la comprobación `isCoach`, una cuenta doble cuenta como coach aunque el claim sea de miembro:

```ts
  const isCoach = memberRole !== null || (claimRole === undefined ? profiles.length > 0 : ["coach", "headCoach"].includes(String(claimRole)));
```

Deja igual las comprobaciones de clases futuras y los borrados de ficha, disponibilidad,
asignaciones, permisos, credenciales, web y foto. Cambia solo el final:

```ts
  if (memberRole) batch.delete(db.doc(coachMemberAccessPath(actor.academyId, userId)));
  else batch.set(base.collection("users").doc(userId), { active: false, status: "inactive", deletedAt: now, updatedAt: now, updatedBy: actor.userId }, { merge: true });
  batch.create(/* auditoría actual sin cambios */);
  await batch.commit();
  const photoKey = website.data()?.photoKey;
  if (typeof photoKey === "string") await createPrivateStorageR2Client().deleteObject(photoKey).catch(() => undefined);
  // A member keeps their login: only coach access is removed and the member role comes back.
  if (memberRole) { if (user) await auth.setCustomUserClaims(userId, { academyId: actor.academyId, role: memberRole }); }
  else if (user) await auth.deleteUser(userId).catch(/* igual que hoy */);
```

- [ ] **Paso 3: Team directory y Change role (D10)**

En `TeamAccessServices` añade `memberCoachUsers(academyId: string): Promise<ReadonlySet<string>>`.
Impleméntalo en `team-access-callables.ts`:

```ts
    async memberCoachUsers(academyId) {
      return new Set((await firestore.collection(`academies/${academyId}/coachMemberAccess`).get()).docs.map((doc) => doc.id));
    },
```

En `listTeamDirectoryHandler`, carga `const members = await services.memberCoachUsers(actor.academyId);`.
Amplía el filtro con `|| members.has(user.uid)` y mapea:

```ts
      role: members.has(user.uid) ? "coach" : (user.customClaims!.role ?? "coach"),
      coach: coaches.get(user.uid) ?? null,
      ...(members.has(user.uid) ? { alsoMember: true } : {}),
```

En `changeTeamRoleHandler`, tras validar el input:

```ts
  if ((await services.memberCoachUsers(actor.academyId)).has(input.data.userId))
    throw new HttpsError("failed-precondition", "This coach is also a member. Remove coach access before giving office access.");
```

- [ ] **Paso 4: Delete account del miembro (D11)**

En `deleteMemberAccountHandler`, **mueve** el bloque que calcula `deleteLogin` (hoy ~L98-L109,
solo lecturas) a justo después de `loginId` (~L55), antes de cancelar reservas. La línea
`refs.push(...users/${loginId})` se queda donde está: añádela tras construir `refs`, condicionada a
`deleteLogin`. Después:

```ts
  if (deleteLogin && loginId && (await firestore.doc(coachMemberAccessPath(actor.academyId, loginId)).get()).exists)
    throw new HttpsError("failed-precondition", "This member is also a coach. Remove coach access first in Staff.");
```

- [ ] **Paso 5: Verificar**

Run: `corepack pnpm --filter @bpt-jersey/functions typecheck`
Expected: sin errores.

Revisa el diff: en cuenta doble, `deleteCoachAccount` no llama a `deleteUser` ni marca `users` como
inactivo, y `applyClaims` nunca escribe `role: "coach"`.

- [ ] **Paso 6: Commit**

```bash
git add apps/functions/src/staff/staff-callables.ts apps/functions/src/staff/coach-account-callables.ts apps/functions/src/staff/team-access.ts apps/functions/src/staff/team-access-callables.ts apps/functions/src/members/member-delete-callables.ts
git commit -m "Keep the member account intact when coach access changes"
```

---

### Tarea 5: Panel `/admin/staff` — «Give coach access to a member»

**Archivos:**
- Modificar: `apps/web/src/lib/team-access-client.ts`
- Crear: `apps/web/src/app/admin/staff/member-coach-access-form.tsx`
- Modificar: `apps/web/src/app/admin/staff/team-directory.tsx` (~L285, columna Role ~L174, botón Change role ~L209)
- Modificar: `apps/web/src/app/admin/staff/direct-staff-form.tsx` (texto de ayuda)

**Interfaces:**
- Consume los esquemas de la Tarea 1.
- Produce:
  - `grantMemberCoachAccess(input: GrantMemberCoachAccessInput): Promise<{ granted: true }>`
  - `listCoachEligibleMembers(query: string): Promise<CoachEligibleMember[]>`
  - `switchAccessMode(mode: AccessMode): Promise<boolean>`, usado en la Tarea 6.

Antes de escribir la UI, aplica `frontend-design`/`impeccable` y `accessibility` (Fase 4 de
`nueva-funcion`). Reutiliza `staff-card`, `staff-form-grid`, `staff-field`, `staff-hint` y
`staff-message`; no añadas CSS nuevo salvo que sea imprescindible.

- [ ] **Paso 1: Cliente**

En `team-access-client.ts`, importa los nuevos esquemas y tipos de la Tarea 1 y añade:

```ts
export function listCoachEligibleMembers(query: string) {
  return call("listCoachEligibleMembers", listCoachEligibleMembersSchema.parse({ query }), coachEligibleMembersResponseSchema, "Unable to search members. Please try again.").then((result) => result.members);
}
export function grantMemberCoachAccess(input: GrantMemberCoachAccessInput) {
  return call("grantMemberCoachAccess", grantMemberCoachAccessSchema.parse(input), z.strictObject({ granted: z.literal(true) }), "Unable to give coach access. Check that the member is an active adult and not already staff.");
}
/** true when the claim changed; false when nothing to do or the account has a single access mode. */
export async function switchAccessMode(mode: AccessMode): Promise<boolean> {
  try {
    return switchAccessModeResultSchema.parse((await httpsCallable<unknown, unknown>(getFirebaseFunctions(), "switchAccessMode")({ mode })).data).switched;
  } catch {
    return false;
  }
}
```

- [ ] **Paso 2: Formulario**

`member-coach-access-form.tsx`: mismas props que `DirectStaffForm` (`session`, `onCreated`).
Comportamiento:

- Un campo de búsqueda («Member name or email», mínimo 2 caracteres) con botón «Search»; sin
  búsqueda automática al teclear.
- Los resultados se muestran como radios «Name · email». Si no hay ninguno: «No adult members match.
  Members who are already staff are not listed.»
- Un selector de cinturón obligatorio (`coachBelts`/`coachBeltLabels`) y el botón «Give coach access»,
  deshabilitado hasta que haya miembro y cinturón.
- Al terminar bien: «{name} can now sign in at /staff/login with their member email and password,
  or Google.» Después llama a `onCreated()` y limpia el formulario.
- Cabecera: eyebrow «Existing member», h3 «Give coach access to a member». Hint: «Adult members and
  guardians only. They keep their member login and use it for both: /login opens their member
  area, /staff/login opens Coach.»

- [ ] **Paso 3: Directorio y textos**

- `team-directory.tsx`: renderiza `<MemberCoachAccessForm session={session} onCreated={() => void loadDirectory()} />`
  justo antes de `<DirectStaffForm …/>`.
  - En la columna Role: `person.alsoMember ? "Coach · also a member" : teamRoleLabels[person.role]`.
  - En la columna Access, para `person.alsoMember`, muestra el texto «Member account» en vez del
    botón Change role (D10).
- `direct-staff-form.tsx`: sustituye en el hint la frase «A member who becomes a coach gets a
  separate staff account: their name can match their member record, but use an email different
  from their member login.» por «If the coach is already a member, use Give coach access to a
  member instead.»

- [ ] **Paso 4: Verificar**

Run: `corepack pnpm --filter @bpt-jersey/web typecheck`
Expected: sin errores.

- [ ] **Paso 5: Commit**

```bash
git add apps/web/src/lib/team-access-client.ts apps/web/src/app/admin/staff/member-coach-access-form.tsx apps/web/src/app/admin/staff/team-directory.tsx apps/web/src/app/admin/staff/direct-staff-form.tsx
git commit -m "Give coach access to a member from Staff"
```

---

### Tarea 6: Login según la página

**Archivos:**
- Modificar: `apps/web/src/app/login/login-form.tsx` (`completeSignIn` ~L109)

**Interfaces:** consume `switchAccessMode(mode): Promise<boolean>` (Tarea 5).

- [ ] **Paso 1: Cambiar de modo antes de decidir el destino**

Al inicio de `completeSignIn`:

```ts
    // A member with coach access uses one login for both areas: the page picks the mode. Accounts
    // with a single mode get `false` and continue exactly as before.
    // Not forced: the credential was just issued, so its token already carries the current claim.
    const before = await credential.user.getIdTokenResult();
    const memberRoles = ["adultStudent", "guardian"];
    const wrongMode = isStaff
      ? memberRoles.includes(String(before.claims.role))
      : ["coach", "headCoach"].includes(String(before.claims.role));
    if (wrongMode) await switchAccessMode(isStaff ? "coach" : "member");
```

Los `refreshAuthToken` que vienen después ya fuerzan el refresco, así que leen el claim nuevo. No
toques el resto del flujo. Importa `switchAccessMode` desde `../../lib/team-access-client` (ya
importa `acceptStaffInvitation` de ahí).

- [ ] **Paso 2: Verificar**

Run: `corepack pnpm --filter @bpt-jersey/web typecheck`
Expected: sin errores.

Revisa por inspección:
- Una cuenta de coach normal en `/login` llama a `switchAccessMode("member")`, recibe `false` y
  sigue a `/coach` como hoy.
- Una cuenta de miembro normal en `/staff/login` recibe `false` y ve el mensaje actual
  `notStaffAccountMessage`.

- [ ] **Paso 3: Commit**

```bash
git add apps/web/src/app/login/login-form.tsx
git commit -m "Pick coach or member mode from the sign-in page"
```

---

### Tarea 7: Verificación en el emulador (no se commitea)

**Archivos:** script temporal en el scratchpad de la sesión (fuera del repo).

- [ ] **Paso 1: Compilar y arrancar**

```bash
corepack pnpm --filter @bpt-jersey/domain build:runtime
export FUNCTIONS_DISCOVERY_TIMEOUT=300000
corepack pnpm firebase:emulators
```

Usa el proyecto `demo-bpt-jersey`. App Check bloquea las callables en el emulador: sigue el patrón
ya autorizado de un script Node con token sintético (memoria `project-bpt-jersey-coaches-landing`).

- [ ] **Paso 2: Ejecutar las 6 comprobaciones de la spec**

Con un owner sintético y un miembro sintético `adultStudent` (con `users` de cliente activo):

1. `grantMemberCoachAccess` → existen `coachMemberAccess/{uid}` y `staff/{uid}` activo; el claim sigue `adultStudent`.
2. `switchAccessMode {mode:"coach"}` → claim `coach`; `listStaffProfiles` o una callable de coach no da `permission-denied`.
3. `switchAccessMode {mode:"member"}` → claim `adultStudent`; una callable de miembro (p. ej. el perfil propio) responde.
4. `setStaffActive` a `false` estando en modo coach → claim `adultStudent`.
5. `deleteCoachAccount` → la cuenta Auth y `users/{uid}` siguen activos; `coachMemberAccess` y `staff/{uid}` ya no existen.
6. Volver a dar acceso y llamar a `deleteMemberAccount` sobre su alumno → `failed-precondition` y ninguna reserva cancelada.

Además: un miembro `teenStudent` → `grantMemberCoachAccess` da `failed-precondition`.

Expected: las 7 comprobaciones dan lo indicado. Si alguna falla, usa `superpowers:systematic-debugging`
antes de tocar código.

---

### Tarea 8: Revisión y entrega

- [ ] **Paso 1:** `/code-review` en nivel **alto** sobre los commits de las Tareas 1–6: tocan permisos y datos de miembros.
- [ ] **Paso 2:** `git fetch` e integrar `origin/main`; `git push origin main`. Comprueba que `git rev-parse main` = `git rev-parse origin/main`.
- [ ] **Paso 3:** **Solo con confirmación de Luis en el chat.** Hay que desplegar todas las
  functions, no una lista: `level-authorization`/`level-service` los importan 9 archivos de
  callables (niveles, graduaciones, promoción, perfil de miembro, exportes) y todas comparten paquete.

```bash
corepack pnpm --filter @bpt-jersey/domain build:runtime
corepack pnpm exec firebase deploy --only functions
```

Si choca con la cuota de CPU de europe-west9, relanza el mismo comando: se salta las que ya
quedaron. Si aún quedan algunas, despliégalas con `--only functions:<nombre>,…`
(memoria `project-bpt-jersey-coaches-landing`). Comprueba con `functions_list_functions` que las 3
nuevas existen en europe-west9.

- [ ] **Paso 4:** Verificación en producción con la cuenta del owner. `/admin/staff` muestra la
  tarjeta nueva y el buscador responde. **No** se da acceso a un miembro real sin que Luis lo pida.
- [ ] **Paso 5:** Memoria `project-bpt-jersey-member-coach-access.md` + línea en `MEMORY.md`.
