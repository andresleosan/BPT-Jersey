# Rango de edad por miembro + pestaña Access — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (elegido por Luis, agente `sdd-opus-medium`). Los pasos usan casillas (`- [ ]`).

**Goal:** owner/admin dan a un miembro un rango de edad de entrenamiento que abre las clases de esa franja (además de las suyas). El owner, desde el mismo bloque, lo pasa a un nivel de la escalera de esa edad. Todo vive en la pestaña **Access** del directorio de miembros.

**Architecture:** el rango se guarda en el documento existente `academies/{a}/studentGroupAccess/{studentId}` (campo `ageRange`). Una regla de dominio (`ageRangeAdmits`) convierte el rango en «tipos extra». Así reutiliza el camino del acceso extra, que ya existe, en la transacción de reserva y en el calendario. El nivel usa el callable existente `setProgressLevel` (solo owner).

**Tech Stack:** pnpm monorepo, TypeScript strict, zod, Firebase Functions v2 (`europe-west9`), Next.js 16 estático.

**Spec:** `docs/superpowers/specs/2026-10-10-member-age-access-design.md` (léela entera antes de tu tarea).

## Global Constraints

- **Sin tests**: no añadas, corras ni esperes tests (unit, rules, e2e, `verify:mvp`). Regla del repo (`AGENTS.md`).
- **Verificación por tarea**: el typecheck del paquete tocado (los comandos van en cada tarea) más la inspección del diff. Nada de lint/format/typecheck de todo el workspace.
- **Git**: trabaja en `main` local. Nunca `git add -A` ni `git add .`: hay otras sesiones en el repo. Añade solo tus archivos, por ruta. Commit con autor `-c user.name="Luis" -c user.email="luismadef45@gmail.com"` y trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. **No hagas push ni deploy**: lo hace el controlador al final.
- `packages/domain` nunca importa Firebase.
- Copy de la UI en inglés; docs en español.
- UI: sigue `DESIGN.md`. Admin con radio 0, tablas con filetes de 1 px, estados = texto + borde izquierdo de color, acciones en línea (nunca kebab), inputs ≥16 px, sin spinners, botones ≥3.15rem. Reutiliza las clases CSS existentes del admin (`admin-panel-card`, `admin-filter-bar`, `admin-filter-control`, `membership-table-button`, `button`, `progress-manage-*`).
- Edades: enteros dentro de `programAgeLimits` (3–99); `maxAge` null = sin tope; `maxAge ≥ minAge`.
- El motivo del rango es obligatorio (1–500); la fecha de fin, opcional (`YYYY-MM-DD`, día de Jersey, inclusive).
- El miembro, el tutor y el coach **nunca** reciben `reason` ni `expiresOn`.
- Rango: owner + administrator. Nivel: solo owner.

## Review Focus

1. **Guardar tipos extra no debe borrar el rango** (y al revés). `saveStudentGroupAccess` hace `transaction.set` completo. Tarea 2 lo cubre conservando `ageRange`.
2. **Rango caducado** (`expiresOn` < hoy en Jersey): no abre clases, no sale en el calendario, ni en la marca del coach ni en la lista de excepciones activas. Tareas 1, 3 y 4 usan siempre `effectiveAgeRange`.
3. **Miembro sin fecha de nacimiento** (cuenta como adulto): el rango sigue abriendo tipos por cruce y el aviso de 16+ no salta (sin edad no se sabe si es menor). Tarea 4.
4. **Revisión concurrente**: dos oficinas guardan a la vez. `revision` distinta → `aborted` con mensaje «Reload». Tareas 2 y 4.
5. **Tipo sin rango de edad** (`ageRange` null = todas las edades): `ageRangeAdmits` devuelve true, pero ya era admitido; no debe cambiar centros ni límite. Tarea 1.

---

## Mapa de archivos

| Archivo | Cambio | Tarea |
|---|---|---|
| `packages/domain/src/schedule/student-group-access-contracts.ts` | esquema `ageRange` + helpers | 1 |
| `packages/domain/src/schedule/pre-class-contracts.ts` | `ageRange?` en `PreClassAttendee` | 1 |
| `packages/domain/src/levels/level-contracts.ts` | `trainingRange` en `evaluateAgeBand` + resumen + candidatos | 1 |
| `apps/functions/src/schedule/student-group-access-callables.ts` | leer/conservar `ageRange`, `saveStudentAgeRange`, `listStudentAccessExceptions` | 2 |
| `apps/functions/src/index.ts` | exportar los 2 callables nuevos | 2 |
| `apps/functions/src/schedule/booking-transaction-service.ts` | `additionalAccess` también por rango | 3 |
| `apps/functions/src/schedule/member-calendar-week-callables.ts` | tipos del rango + `ageRange` al miembro | 3 |
| `apps/functions/src/schedule/pre-class-service.ts` | `ageRange` en asistentes reservados | 3 |
| `apps/functions/src/levels/level-service.ts` | pasar `trainingRange` (resumen y candidatos) | 3 |
| `apps/web/src/lib/student-group-access-client.ts` | `saveStudentAgeRange`, `listStudentAccessExceptions` | 4 |
| `apps/web/src/app/admin/members/access-tab.tsx` (nuevo) | pestaña Access | 4 |
| `apps/web/src/app/admin/members/members-workspace.tsx` | vista `access` | 4 |
| `apps/web/src/app/admin/admin.css` | estilos `access-*` | 4 |
| `apps/web/src/app/account/calendar/member-calendar.tsx` | línea «You can also book…» | 5 |
| `apps/web/src/app/coach/page.tsx` | marca «Age range» | 5 |
| `PRODUCT.md` | sección nueva + corrección :135 | 6 |

---

### Task 1: Dominio — rango, cruce y aviso de edad

**Files:**
- Modify: `packages/domain/src/schedule/student-group-access-contracts.ts`
- Modify: `packages/domain/src/schedule/pre-class-contracts.ts:32-42`
- Modify: `packages/domain/src/levels/level-contracts.ts:961-981` (y llamadas internas en 1091 y en `generateRecognitionCandidates`)

**Interfaces — Produces:**
- `memberAgeRangeSchema`, `type MemberAgeRange = { minAge: number; maxAge: number | null; reason?: string; expiresOn?: string | null }`
- `studentGroupAccessSchema` con `ageRange?: MemberAgeRange | null`
- `saveStudentGroupAccessSchema` (ya sin `ageRange`)
- `saveStudentAgeRangeSchema` / `type SaveStudentAgeRange = { studentId; revision; ageRange: { minAge; maxAge; reason; expiresOn } | null; confirmAdult?: boolean }`
- `effectiveAgeRange(access, todayKey): { minAge: number; maxAge: number | null } | null`
- `ageRangeAdmits(programAgeRange: {minAge; maxAge|null} | null | undefined, range: {minAge; maxAge|null}): boolean`
- `rangeExtraProgramIds(access, programs: readonly {programId: string; ageRange?: … | null}[], todayKey): string[]`
- `ageRangeLabel(range): string` → `"8–10"` / `"8+"`
- `PreClassAttendee.ageRange?: { minAge: number; maxAge: number | null }`
- `evaluateAgeBand({ criteria, dateOfBirth, now, trainingRange? })`

- [ ] **Step 1: contrato del rango.** En `student-group-access-contracts.ts`, añade el import y el código siguiente debajo de `grantContext`:

```ts
import { programAgeLimits } from "./classes-services-contracts";

const age = z.number().int().min(programAgeLimits.min).max(programAgeLimits.max);
const ageBounds = { minAge: age, maxAge: age.nullable() };
const ordered = (range: { minAge: number; maxAge: number | null }) =>
  range.maxAge === null || range.maxAge >= range.minAge;
/** The office's training age range. Members only ever receive minAge/maxAge. */
export const memberAgeRangeSchema = z
  .strictObject({ ...ageBounds, ...grantContext })
  .refine(ordered, "The upper age must not be below the lower age.");
export type MemberAgeRange = z.infer<typeof memberAgeRangeSchema>;
```

  En `studentGroupAccessSchema`, añade el campo `ageRange: memberAgeRangeSchema.nullable().optional(),`. Cambia `saveStudentGroupAccessSchema` a `studentGroupAccessSchema.omit({ dateOfBirth: true, ageRange: true })`. Añade:

```ts
export const saveStudentAgeRangeSchema = z.strictObject({
  studentId: id,
  revision: z.number().int().nonnegative(),
  ageRange: z
    .strictObject({
      ...ageBounds,
      reason: z.string().trim().min(1).max(500),
      expiresOn: dateKey.nullable(),
    })
    .refine(ordered, "The upper age must not be below the lower age.")
    .nullable(),
});
export type SaveStudentAgeRange = z.infer<typeof saveStudentAgeRangeSchema>;

type Bounds = Readonly<{ minAge: number; maxAge: number | null }>;

/** The range still in force today (Jersey day, inclusive), without the office-only context. */
export function effectiveAgeRange(
  access: Pick<StudentGroupAccess, "ageRange">,
  todayKey: string,
): Bounds | null {
  const range = access.ageRange;
  if (!range || (range.expiresOn && range.expiresOn < todayKey)) return null;
  return { minAge: range.minAge, maxAge: range.maxAge };
}

/** A class type opens through the range when both age ranges overlap. No type range = all ages. */
export function ageRangeAdmits(program: Bounds | null | undefined, range: Bounds): boolean {
  if (!program) return true;
  const programTop = program.maxAge ?? Number.POSITIVE_INFINITY;
  const rangeTop = range.maxAge ?? Number.POSITIVE_INFINITY;
  return program.minAge <= rangeTop && range.minAge <= programTop;
}

/** Class types the range opens today; callers add them to the extra groups (same waivers). */
export function rangeExtraProgramIds(
  access: Pick<StudentGroupAccess, "ageRange">,
  programs: readonly Readonly<{ programId: string; ageRange?: Bounds | null }>[],
  todayKey: string,
): string[] {
  const range = effectiveAgeRange(access, todayKey);
  if (!range) return [];
  // ponytail: an all-ages type already admits everyone, so the range adds nothing for it.
  return programs.filter((p) => p.ageRange && ageRangeAdmits(p.ageRange, range)).map((p) => p.programId);
}

export function ageRangeLabel(range: Bounds): string {
  return range.maxAge === null ? `${range.minAge}+` : `${range.minAge}–${range.maxAge}`;
}
```

- [ ] **Step 2: asistente del coach.** En `pre-class-contracts.ts`, añade a `PreClassAttendee` el campo (no lo rellena el constructor puro; lo añade el servicio en la Tarea 3):

```ts
  /** Office-granted training age range in force today; never the reason or end date. */
  ageRange?: Readonly<{ minAge: number; maxAge: number | null }>;
```

- [ ] **Step 3: aviso de edad.** En `level-contracts.ts`, `evaluateAgeBand` recibe `trainingRange?: Readonly<{ minAge: number; maxAge: number | null }> | null`. Justo antes de `const met = …` (rama con `ageYears !== null`) y también en la rama `ageYears === null`, se considera cumplido si el rango cruza la franja del nivel:

```ts
  const range = input.trainingRange ?? null;
  const rangeFits =
    range !== null &&
    (requiredMaxAge === null || range.minAge <= requiredMaxAge) &&
    (requiredMinAge === null || (range.maxAge ?? Number.POSITIVE_INFINITY) >= requiredMinAge);
  if (ageYears === null) {
    return Object.freeze({ requiredMinAge, requiredMaxAge, ageYears: null, met: rangeFits });
  }
  const met =
    rangeFits ||
    ((requiredMinAge === null || ageYears >= requiredMinAge) &&
      (requiredMaxAge === null || ageYears <= requiredMaxAge));
```

  No uses `ageRangeAdmits` aquí: el módulo de niveles no debe importar `schedule`. `buildStudentProgressSummary` acepta la opción `trainingRange?: … | null` y la pasa a `evaluateAgeBand` (línea ~1091). El tipo de cada estudiante de `generateRecognitionCandidates` (`students: readonly {…}` en ~1359) acepta `trainingRange?: … | null`, y su llamada a `evaluateAgeBand` le pasa `student.trainingRange ?? null`.

- [ ] **Step 4: verificar.**

Run: `corepack pnpm --filter @bpt-jersey/domain typecheck`
Expected: sin errores. Si falla en archivos que no tocaste, informa del error sin arreglarlo.

- [ ] **Step 5: commit.**

```bash
git add packages/domain/src/schedule/student-group-access-contracts.ts packages/domain/src/schedule/pre-class-contracts.ts packages/domain/src/levels/level-contracts.ts
git -c user.name="Luis" -c user.email="luismadef45@gmail.com" commit -m "feat(domain): member training age range rules" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Functions — guardar y listar el rango

**Files:**
- Modify: `apps/functions/src/schedule/student-group-access-callables.ts`
- Modify: `apps/functions/src/index.ts` (donde ya se exportan `getStudentGroupAccess`/`saveStudentGroupAccess`)

**Interfaces — Consumes:** Task 1 (`memberAgeRangeSchema`, `saveStudentAgeRangeSchema`, `effectiveAgeRange`). **Produces:** callables `saveStudentAgeRange` y `listStudentAccessExceptions`. Respuesta de lista:
`{ rows: { studentId: string; fullName: string; dateOfBirth: string | null; programIds: string[]; ageRange: { minAge; maxAge; reason?; expiresOn? } | null; expiresOn: string | null }[] }`

- [ ] **Step 1: `readAccess` conserva el rango.** Dentro del `safeParse` añade:
  `...(data?.ageRange ? { ageRange: data.ageRange } : {}),`
- [ ] **Step 2: `memberView` da al miembro solo los límites.** Devuelve además
  `...(effectiveAgeRange(access, today) ? { ageRange: effectiveAgeRange(access, today) } : {})`, con `const today = dateKeyInJersey(new Date())`. Así el miembro no ve motivo ni fecha. Los límites sin motivo siguen validando con `memberAgeRangeSchema` porque `reason` es opcional.
- [ ] **Step 3: `saveStudentGroupAccess` no borra el rango.** En el `transaction.set(accessRef, {…})` añade `ageRange: previous.ageRange ?? null,`.
- [ ] **Step 4: callable `saveStudentAgeRange`** (debajo de `saveStudentGroupAccess`):

```ts
export const saveStudentAgeRange = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  const parsed = saveStudentAgeRangeSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Check the ages, reason and end date.");
  const input = parsed.data;
  const db = getFirestore();
  const base = `academies/${actor.academyId}`;
  const accessRef = db.doc(`${base}/studentGroupAccess/${input.studentId}`);
  const eventRef = db.collection(`${base}/studentGroupAccessEvents`).doc();
  return db.runTransaction(async (transaction) => {
    const [studentSnapshot, accessSnapshot] = await transaction.getAll(
      db.doc(`${base}/students/${input.studentId}`), accessRef,
    );
    const student = readStudent(studentSnapshot!.data(), actor.academyId, input.studentId);
    const previous = readAccess(accessSnapshot!.data(), actor.academyId, input.studentId, student.dateOfBirth);
    if (previous.revision !== input.revision) {
      throw new HttpsError("aborted", "Access changed. Reload before saving.");
    }
    const next = { ...previous, ageRange: input.ageRange, revision: previous.revision + 1 };
    const changedAt = new Date().toISOString();
    // merge: the extra groups, their reason and end date stay exactly as they are.
    transaction.set(accessRef, {
      academyId: actor.academyId, studentId: input.studentId,
      ageRange: input.ageRange, revision: next.revision,
      updatedBy: actor.userId, updatedAt: changedAt,
    }, { merge: true });
    transaction.create(eventRef, {
      academyId: actor.academyId, studentId: input.studentId,
      beforeAgeRange: previous.ageRange ?? null, afterAgeRange: input.ageRange,
      revision: next.revision, actorId: actor.userId, actorRole: actor.role,
      occurredAt: changedAt, action: "member.age-range.updated",
    });
    transaction.create(db.collection(`${base}/auditEvents`).doc(), {
      eventId: eventRef.id, academyId: actor.academyId, actorId: actor.userId,
      action: "member.age-range.updated", targetRef: accessRef.path,
      purpose: "training age range", correlationId: eventRef.id,
      occurredAt: changedAt, schemaVersion: "1",
    });
    return next;
  });
});
```

- [ ] **Step 5: callable `listStudentAccessExceptions`** (solo oficina):

```ts
export const listStudentAccessExceptions = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  const db = getFirestore();
  const base = `academies/${actor.academyId}`;
  const today = dateKeyInJersey(new Date());
  // ponytail: one read of a small collection (one doc per member with an exception), no index.
  const snapshot = await db.collection(`${base}/studentGroupAccess`).limit(1000).get();
  const live = snapshot.docs
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter(({ id, data }) => data.academyId === actor.academyId && data.studentId === id)
    .map(({ id, data }) => {
      const access = studentGroupAccessSchema.safeParse({
        studentId: id, programIds: data.programIds ?? [], revision: data.revision ?? 0,
        dateOfBirth: null, expiresOn: data.expiresOn ?? null,
        ...(data.ageRange ? { ageRange: data.ageRange } : {}),
      });
      return access.success ? access.data : undefined;
    })
    .filter((access) => access !== undefined)
    .filter((access) => effectiveGroupProgramIds(access, today).length > 0 || effectiveAgeRange(access, today) !== null);
  const students = live.length
    ? await db.getAll(...live.map((access) => db.doc(`${base}/students/${access.studentId}`)))
    : [];
  return {
    rows: live.flatMap((access, index) => {
      const student = students[index]?.data();
      if (!student || student.academyId !== actor.academyId) return [];
      return [{
        studentId: access.studentId,
        fullName: typeof student.fullName === "string" ? student.fullName : "",
        dateOfBirth: typeof student.dateOfBirth === "string" ? student.dateOfBirth : null,
        programIds: effectiveGroupProgramIds(access, today),
        ageRange: effectiveAgeRange(access, today) ? access.ageRange ?? null : null,
        expiresOn: access.expiresOn ?? null,
      }];
    }),
  };
});
```

  Importa `effectiveAgeRange` y `saveStudentAgeRangeSchema` desde `@bpt-jersey/domain/schedule/member-calendar`.

- [ ] **Step 6: exportar en `apps/functions/src/index.ts`.** Busca la línea que exporta `saveStudentGroupAccess` y añade `saveStudentAgeRange, listStudentAccessExceptions` en el mismo export.
- [ ] **Step 7: verificar.**

Run: `corepack pnpm --filter @bpt-jersey/domain build:runtime && corepack pnpm --filter @bpt-jersey/functions typecheck`
Expected: sin errores.

- [ ] **Step 8: commit** (solo `student-group-access-callables.ts` e `index.ts`, mismo formato que en la Tarea 1; mensaje `feat(functions): save and list member age ranges`).

---

### Task 3: Functions — aplicar el rango en reservas, calendario, coach y niveles

**Files:**
- Modify: `apps/functions/src/schedule/booking-transaction-service.ts:855-876`
- Modify: `apps/functions/src/schedule/member-calendar-week-callables.ts` (construcción de `groupAccess` ~línea 104 y `additionalProgramIds` ~188)
- Modify: `apps/functions/src/schedule/pre-class-service.ts` (tras `buildPreClassView`)
- Modify: `apps/functions/src/levels/level-service.ts` (~2230 `buildStudentProgressSummary`, ~2468 `generateRecognitionCandidates`)

**Interfaces — Consumes:** Task 1 (`effectiveAgeRange`, `ageRangeAdmits`, `rangeExtraProgramIds`, `trainingRange`).

- [ ] **Step 1: transacción de reserva.** En el `safeParse` de `groupAccess` añade `...(groupData?.ageRange ? { ageRange: groupData.ageRange } : {}),`. Después cambia el cálculo:

```ts
  const today = dateKeyInJersey(new Date());
  const additionalProgramIds = effectiveGroupProgramIds(groupAccess.data, today);
  const trainingRange = effectiveAgeRange(groupAccess.data, today);
  // The office's training age range opens a type exactly like an extra group (same waivers).
  const additionalAccess =
    additionalProgramIds.includes(storedSession.programId) ||
    (trainingRange !== null && storedProgram.ageRange != null &&
      ageRangeAdmits(storedProgram.ageRange, trainingRange));
```

  Comprueba que `storedProgram` ya está leído en ese punto. Si se lee después, mueve solo el cálculo de `additionalAccess` justo después de su lectura y antes de su primer uso (la comprobación `programAdmits` ~932). No cambies nada más de la transacción.

- [ ] **Step 2: calendario.** Tras `const groupAccess = memberView(readAccess(…))`, calcula
  `const rangeIds = rangeExtraProgramIds(readAccess(…same args…), programs, dateKeyInJersey(new Date()));`
  Reutiliza el valor que devuelve `readAccess` guardándolo en una constante: no lo leas dos veces. Después:
  - `additionalProgramIds: [...new Set([...groupAccess.programIds, ...rangeIds])],`
  - en la respuesta, el `groupAccess` que se devuelve lleva `programIds` con esa misma unión, para que el cliente (que recalcula con `groupAccess.programIds`, `member-calendar.tsx:354`) vea lo mismo que el servidor.

- [ ] **Step 3: marca del coach.** En `pre-class-service.ts`, guarda el resultado de `buildPreClassView(...)` en `view`. Luego:

```ts
      const bookedIds = view.attendees.filter((a) => a.source === "booked").map((a) => a.studentId);
      const accessDocs = bookedIds.length
        ? await options.firestore.getAll(
            ...bookedIds.map((id) => options.firestore.doc(`academies/${academyId}/studentGroupAccess/${id}`)),
          )
        : [];
      const today = dateKeyInJersey(new Date());
      const ranges = new Map(accessDocs.flatMap((doc) => {
        const data = doc.data();
        if (!data || data.academyId !== academyId || !data.ageRange) return [];
        const range = effectiveAgeRange({ ageRange: data.ageRange }, today);
        return range ? [[doc.id, range] as const] : [];
      }));
      return Object.freeze({
        ...view,
        attendees: view.attendees.map((a) => (ranges.has(a.studentId) ? { ...a, ageRange: ranges.get(a.studentId)! } : a)),
      });
```

  Si `options.firestore` no expone `getAll`/`doc` con esos tipos, usa el mismo objeto Firestore con el que el servicio ya hace `.collection(...)`. Mira cómo lo tipa el archivo y sigue ese patrón. Si `data.ageRange` no valida (forma rara), ignóralo: usa `memberAgeRangeSchema.safeParse(data.ageRange)` antes de `effectiveAgeRange`.

- [ ] **Step 4: niveles.** En el método que llama `buildStudentProgressSummary` (~2230), lee también `academies/${academyId}/studentGroupAccess/${studentId}` (en el `Promise.all` de lecturas existente si lo hay). Pasa
  `trainingRange: effectiveAgeRange({ ageRange: parsed ?? null }, jerseyToday)`,
  donde `parsed = memberAgeRangeSchema.safeParse(doc.get("ageRange")).data`. En `generateRecognitionCandidates` (~2468), lee con `getAll` los documentos de acceso de `students` y añade `trainingRange` a cada estudiante. **No toques** las llamadas en ~3699/3780 (stores en memoria).
- [ ] **Step 5: verificar.**

Run: `corepack pnpm --filter @bpt-jersey/domain build:runtime && corepack pnpm --filter @bpt-jersey/functions typecheck`
Expected: sin errores.

- [ ] **Step 6: commit** (los 4 archivos; mensaje `feat(functions): apply member age range to bookings, calendar, coach list and levels`).

---

### Task 4: Web — pestaña Access en el directorio

**Files:**
- Modify: `apps/web/src/lib/student-group-access-client.ts`
- Create: `apps/web/src/app/admin/members/access-tab.tsx`
- Modify: `apps/web/src/app/admin/members/members-workspace.tsx:19-25` (vistas) y el render (~374)
- Modify: `apps/web/src/app/admin/admin.css` (al final, bloque `/* Members → Access */`)

**Interfaces — Consumes:** Tareas 1 y 2; `GroupAccessEditor` (`./profile/group-access-editor`), `getLevelCatalog` (`../../../lib/levels-client`), `getProgressManagement` / `setProgressLevel` (`../../../lib/progress-management-client`), `manualProgressLimits` (`@bpt-jersey/domain/levels`), `getScheduleCatalog` (`../../../lib/schedule-client`), `MemberOverviewRow`.

**Antes de escribir UI:** carga las skills `impeccable` y `taste-skill` (`design-taste-frontend`) y lee `DESIGN.md` §2–§6. Las reglas de `DESIGN.md` mandan sobre los valores por defecto de las skills.

- [ ] **Step 1: cliente.** Añade a `student-group-access-client.ts`:

```ts
export async function saveStudentAgeRange(input: SaveStudentAgeRange) {
  const response = await httpsCallable(getFirebaseFunctions(), "saveStudentAgeRange")(
    saveStudentAgeRangeSchema.parse(input),
  );
  const access = studentGroupAccessSchema.parse(response.data);
  if (access.studentId !== input.studentId) throw new Error("Access is unavailable.");
  return access;
}

const exceptionRowSchema = z.strictObject({
  studentId: z.string(), fullName: z.string(), dateOfBirth: z.string().nullable(),
  programIds: z.array(z.string()), ageRange: memberAgeRangeSchema.nullable(), expiresOn: z.string().nullable(),
});
export type AccessExceptionRow = z.infer<typeof exceptionRowSchema>;

export async function listStudentAccessExceptions(): Promise<readonly AccessExceptionRow[]> {
  const response = await httpsCallable(getFirebaseFunctions(), "listStudentAccessExceptions")({});
  const parsed = z.strictObject({ rows: z.array(exceptionRowSchema) }).safeParse(response.data);
  if (!parsed.success) throw new Error("Unable to load access exceptions.");
  return parsed.data.rows;
}
```

  `httpsCallable` es el wrapper de `./callable` y ya devuelve errores legibles. Importa `z` de `zod` y los esquemas del dominio.

- [ ] **Step 2: componente `access-tab.tsx`.** `export function AccessTab({ rows, isOwner }: { rows: readonly MemberOverviewRow[]; isOwner: boolean })`. Estructura:
  1. **Cabecera**: eyebrow «MEMBERS / ACCESS», h3 «Access exceptions», una frase: «Let a member book classes for an older age range, or extra class types. Their plan, centres and weekly limit still apply.»
  2. **Lista**: `listStudentAccessExceptions()` al montar y tras cada guardado. Usa `AdminDataTable` (`../admin-data-table`) con las columnas Member (nombre + «N years» calculado con `ageOnDate(dateOfBirth, hoy)` o «Age unknown»), Age range (`ageRangeLabel` o «—»), Extra classes (nombres de los `programIds` con los programas de `getScheduleCatalog()`, o «—»), Ends (fecha más próxima entre `ageRange.expiresOn` y `expiresOn`, o «—») y la acción `Edit` (`membership-table-button`) que abre el bloque de ese miembro. Si está vacía: eyebrow + «No exceptions yet» + «Search a member below to add one.». Mientras carga: un esqueleto (`div` con la clase `access-skeleton`, alto de 3 filas), sin spinner.
  3. **Buscador** igual al de `progress-management.tsx:186-215`: input search, ≥2 letras, máximo 8 coincidencias, botones `membership-table-button`.
  4. **Bloque del miembro** (`<section className="admin-panel-card access-member">`, h3 con nombre + «· N years»). Contiene tres `fieldset` en una grid `access-grid` (2 columnas ≥64rem, 1 columna <48rem):
     - **Age range**: inputs number From / To (`min=3 max=99`, To vacío = sin tope), Reason (textarea, obligatorio, max 500), Ends on (date, opcional). Bajo el rango, el texto vivo «Opens: …» con los nombres de los programas activos donde `ageRangeAdmits(p.ageRange, {minAge, maxAge})`, o «Opens no extra class types». Carga el estado con `getStudentGroupAccess(studentId)` (revision + ageRange).
       - **Aviso 16+**: si el miembro tiene fecha de nacimiento, edad real <16 y (`maxAge === null || maxAge >= 16`), muestra `<div role="alert" className="access-warning">` con la banda roja de DESIGN.md: «Adult classes — This member is under 16 and will be able to book adult (16+) classes.» y una casilla obligatoria «I confirm adult classes are appropriate». Sin la casilla, Save queda deshabilitado.
       - Botones: `Save age range` (`button`) y, si hay rango guardado, `Remove range` (`membership-table-button`, con `window.confirm("Remove the age range for <name>?")`). Llaman a `saveStudentAgeRange({ studentId, revision, ageRange: {...} | null })`.
       - Errores: si el código es `functions/aborted`, «Another administrator changed this access. Reload before saving again.»; si no, el mensaje del cliente. Si sale bien: `role="status"` «Age range saved. The member's calendar updates on its next refresh.» y recarga la lista y el acceso.
     - **Extra classes**: `<GroupAccessEditor studentId={…} key={studentId} />` tal cual.
     - **Level** (solo si `isOwner`): con `getLevelCatalog()` y `getProgressManagement(studentId)`.
       - Si `!data.initialized`: «No level yet. Open their level from their member record first.»
       - Si no, un select con las definiciones ordenadas por `sequence`. Filtra las que tengan `criteria.minAge`/`maxAge` que se cruzan con el rango del formulario (misma condición que `ageRangeAdmits` sobre `{minAge: criteria.minAge ?? 0, maxAge: criteria.maxAge}`). Si no hay rango, o el filtro queda vacío, muestra todas. Incluye siempre la definición actual.
       - Input «Classes done at this level», precargado con `data.classesAtLevel` y con `max = manualProgressLimits(definitions, definitionKey).classes` (si el límite es null, el input queda deshabilitado). Al cambiar de nivel, **no** lo reinicies a 0 (D5 de esta spec): recórtalo al límite.
       - Botón `Save level`: `setProgressLevel({ studentId, definitionKey, startedOn: hoy, ...(limits.classes !== null ? { classes } : {}), reason: "Age range access" })`. Antes, valida con `manualProgressError(limits, { classes })`. Es un guardado independiente del rango.
  5. Todos los textos `aria-live`; labels encima de cada input; `min-height` de los inputs según DESIGN.md.

- [ ] **Step 3: pestaña.** En `members-workspace.tsx`, añade `{ value: "access", label: "Access" }` justo después de la entrada `progress` en `memberViews`. En el filtro de pestañas (~340) `progress` sigue solo para el owner; `access` se muestra a todo el que ve el directorio (owner y administrator). En el render, añade antes de `view === "families"`:

```tsx
      ) : view === "access" ? (
        <AccessTab isOwner={isOwner} rows={state.overview.rows} />
```

  con `import { AccessTab } from "./access-tab";`.

- [ ] **Step 4: CSS.** En `admin.css` añade, al final, un bloque comentado `/* Members → Access (2026-10-10) */` con: `.access-grid` (CSS Grid `minmax(0,1fr)`, 2 columnas desde `64rem`, gap igual a `.progress-manage-grid`), `.access-warning` (fondo `#FFF0F2`, `border-left: 0.35rem solid #8D1C2F`, texto `#721626`, padding `1rem`), `.access-skeleton` (fondo `#E8E7E3`, `min-height: 9rem`) y `.access-opens` (color `#65635D`, `0.9rem`). Sin radios, sin sombras ni gradientes. Reutiliza `.progress-manage-block` para los fieldsets si encaja.

- [ ] **Step 5: verificar.**

Run: `corepack pnpm --filter @bpt-jersey/domain build:runtime && corepack pnpm --filter @bpt-jersey/web typecheck`
Expected: sin errores.

- [ ] **Step 6: commit** (los 4 archivos; mensaje `feat(admin): Access tab for member age ranges`).

---

### Task 5: Web — línea en el calendario del miembro y marca del coach

**Files:**
- Modify: `apps/web/src/app/account/calendar/member-calendar.tsx` (cerca de la cabecera/intro del calendario, dentro de `<main className="member-app">` ~673)
- Modify: `apps/web/src/app/coach/page.tsx:716-728`

- [ ] **Step 1: calendario.** `selectedWeek.groupAccess` ya está parseado con `studentGroupAccessSchema` (`firebase-calendar-repository.ts:223`) y ahora puede traer `ageRange` (solo límites). Bajo el párrafo de introducción del calendario:

```tsx
{selectedWeek?.groupAccess?.ageRange ? (
  <p className="member-calendar-range">
    You can also book classes for ages {ageRangeLabel(selectedWeek.groupAccess.ageRange)}.
  </p>
) : null}
```

  Ubícalo donde el componente ya muestra el texto de introducción o los avisos. Lee el JSX y escoge el sitio sin reordenar nada. Si `selectedWeek` tiene otro nombre en ese ámbito, usa el que exista. Sin CSS nuevo salvo que haga falta separación; en ese caso usa `margin: 0` y la escala de espaciado existente en `globals.css`.

- [ ] **Step 2: coach.** En la lista pre-clase, dentro de `coach-list-meta`, tras el texto actual:

```tsx
{attendee.ageRange ? ` · Age range ${ageRangeLabel(attendee.ageRange)}` : ""}
```

  Importa `ageRangeLabel` desde `@bpt-jersey/domain/schedule/member-calendar`. Comprueba que el tipo de `preClass.view` en `schedule-client.ts` valida los asistentes con zod `strictObject`. Si es así, añade ahí `ageRange: z.strictObject({ minAge: z.number(), maxAge: z.number().nullable() }).optional()`. Si no, no hace falta.

- [ ] **Step 3: verificar.**

Run: `corepack pnpm --filter @bpt-jersey/web typecheck`
Expected: sin errores.

- [ ] **Step 4: commit** (los archivos tocados; mensaje `feat: show member age range to members and coaches`).

---

### Task 6: Documentación de producto

**Files:**
- Modify: `PRODUCT.md:131-145`

- [ ] **Step 1:** En «Additional member group access», sustituye «waives age, site and class allowance/weekly limits for that program; additional-group bookings do not consume the normal weekly allowance while the grant is active.» por «waives the age rules and plan participant type for that program only; the plan's centres and weekly limit still apply.»
- [ ] **Step 2:** Añade la sección después:

```md
## Member training age range (2026-10-10)

Owners and administrators open Members → Access to give any member a training age range ("From X
to Y", no upper limit allowed). Every class type whose age range overlaps it opens in addition to
the member's own-age classes, exactly like an extra group: age and plan participant type are
waived; plan, payment standing, centres, weekly limit, capacity (per-age limits use the real age)
and booking deadlines still apply. A reason is required; an optional end date (Jersey day,
inclusive) stops new bookings after it. Members under 16 given access to 16+ classes need an
explicit office confirmation. Members, guardians and coaches see the range only (never the
reason or end date). In the same tab the owner alone can move the member to a level of that age's
belt ladder, keeping or editing the classes already done; with the range, level progress stops
reporting the age band as unmet. Changes are recorded with actor, revision and before/after range.
```

- [ ] **Step 3: commit** (`PRODUCT.md` y el plan/spec si cambiaron; mensaje `docs: member training age range`).

---

## Cierre (controlador, no subagentes)

1. `/code-review` nivel alto sobre el diff de las tareas 1–6 (toca permisos y datos de menores).
2. Si no hubo cambios en `firestore.rules` ni índices (`studentGroupAccess` solo se lee desde las functions), dilo.
3. `git fetch` + rebase sobre `origin/main`, push y comprobar que el SHA local = el remoto. Comprobar el deploy de Pages del commit en Cloudflare.
4. **Con OK de Luis**: `corepack pnpm --filter @bpt-jersey/domain build:runtime` y deploy en tandas (`--only functions:…`, sin `--force`) de: `saveStudentAgeRange`, `listStudentAccessExceptions`, `getStudentGroupAccess`, `saveStudentGroupAccess`, `getMemberCalendarWeek`, `getPreClassView`, y todas las functions que importan `booking-transaction-service` o `level-service` (lista exacta con `grep -l` de importadores en `apps/functions/src` → nombres exportados en `index.ts`).
5. Memoria `project-bpt-jersey-member-age-access.md` + línea en `MEMORY.md`.
