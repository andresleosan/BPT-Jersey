# Unificación de miembros S1: identidad — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear un `student` canónico por cada miembro legacy adulto mediante decisiones auditadas de una cola de revisión, enlazándolo con su registro del archivo cuando exista.

**Architecture:** Una función de emparejamiento pura en `packages/domain` alimenta a la vez un callable de lectura (la cola, recalculada en cada llamada) y un script de informe. Un callable de decisión llama al alta canónica existente (`createAdult` de `canonical-member-directory-service.ts`), ampliada para escribir, en su misma transacción, el perfil `legacy-member-migration`, la clave de identidad `legacy-member-id` y el documento create-only `memberMigrationDecisions/{memberId}`. La pantalla `/admin/members/migration` muestra la cola y envía decisiones individuales o en lote.

**Tech Stack:** TypeScript estricto, zod, Firebase Functions v2 (`onCall`), Firestore Admin SDK, Next.js 16 static export, React 19, Vitest, `@firebase/rules-unit-testing`, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-19-member-unification-s1-identity-design.md` (decisiones P1-P5 y enmiendas del 2026-09-19).

## Global Constraints

- `migrationId` constante: `member-unification-s1-2026-09`.
- Solo adultos (P5): una fila con `isMinor !== false` no admite `link` ni `create-unlinked`; el código de rechazo es `minor-deferred`.
- Emparejamiento automático solo por número de socio o documento de identidad **idéntico tras `normalizeAdministrativeIdentifier`**; nombre y fecha de nacimiento solo sugieren (ADR-009 regla 9).
- `members` y `regyfitMemberRecords` nunca se escriben.
- El enlace del archivo se escribe en `regyfitOfficeLinks/{recordId}`; un registro ya presente en `regyfitOfficeLinks` o `regyfitMemberLinks` no se puede volver a enlazar (`record-already-linked`).
- Lotes de 1 a 50 decisiones; una transacción por decisión; un rechazo no detiene las demás.
- La cola enmascara número de socio y documento: solo los 3 últimos caracteres, con el prefijo `•••`. Nunca devuelve contacto de emergencia, salud ni dirección.
- `trainingCenter` ∈ `Town`, `West`; `trainingTimePreferences`: 1-3 valores distintos de `morning`, `afternoon`, `evening`.
- Guardas de los callables: las mismas que `registerImportedMemberForOffice` (`browserAdminCallableOptions`, secretos del directorio, `requireCanonicalMemberDirectoryActor`) y solo roles `owner` y `administrator`. El MFA obligatorio (T017) está cancelado: no se exige ni se menciona.
- Nunca deploy, escritura en producción ni push sin confirmación explícita del operador en el chat.
- Comandos siempre `corepack pnpm …` desde la raíz. Antes de `typecheck`/tests de functions: `corepack pnpm --filter @bpt-jersey/domain build:runtime`.
- Commits con la línea final `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

### Decisiones de implementación tomadas al escribir el plan

- `legacyMemberId` en el perfil y en la clave de identidad es `normalizeAdministrativeIdentifier(memberId)`, porque `legacyMigrationStudentProfileSchema` exige `/^[A-Z0-9][A-Z0-9 ./-]{0,63}$/`. El id del documento de decisión es el `memberId` crudo. El informe (Task 7) cuenta los `memberId` que no cumplen el patrón tras normalizar y las colisiones por mayúsculas; si alguno es distinto de 0, se para antes del deploy.
- En `link`, los datos del `student` salen del registro del archivo (nombre, fecha, número de socio y móvil), igual que en `registerImportedMemberForOffice`, que verifica que coinciden. El documento de identidad sale del miembro legacy. El email no se copia: el archivo tiene direcciones mal formadas.
- En `create-unlinked`, los datos salen del miembro legacy (nombre, fecha, número de socio, documento, NIF y móvil).
- Los `students` creados son `active: true`, como cualquier alta de oficina (comportamiento actual de `createAdult`).

---

## Mapa de archivos

| Archivo | Responsabilidad |
| --- | --- |
| `packages/domain/src/members/member-migration-contracts.ts` (nuevo) | Constantes, emparejamiento puro, enmascarado, esquemas zod de entrada, salida y documento de decisión |
| `packages/domain/package.json` | Subpath `./members/migration` |
| `packages/domain/src/audit/audit-event.ts` | Acción `member.migration.skipped` |
| `apps/functions/src/members/canonical-member-directory-service.ts` | `registerLegacyMember` y `skipLegacyMember` sobre `createAdult` |
| `apps/functions/src/members/member-migration-service.ts` (nuevo) | Cola y decisiones; traduce errores a códigos seguros |
| `apps/functions/src/members/member-migration-firestore.ts` (nuevo) | Carga del snapshot de la cola desde Firestore |
| `apps/functions/src/members/member-migration-callables.ts` (nuevo) | `listMemberMigrationQueue`, `decideMemberMigration` |
| `apps/functions/src/index.ts` | Exporta los dos callables |
| `firestore.rules` | `memberMigrationDecisions` deny-all |
| `apps/web/src/lib/member-migration-client.ts` (nuevo) | Cliente de los dos callables |
| `apps/web/src/app/admin/members/migration/page.tsx` + `migration-queue.tsx` (nuevos) | Pantalla de la cola |
| `apps/web/src/app/admin/admin-shell.tsx` | Enlace de menú |
| `qa/scripts/member-unification-s1-report.mjs`, `member-unification-s1-revert.mjs` (nuevos) | Informe y vuelta atrás |
| `qa/rules/member-migration-decisions.test.ts`, `qa/integration/member-migration.test.ts`, `qa/tests/member-migration.spec.ts` (nuevos) | Reglas, integración y E2E |
| `docs/adr/ADR-009-students-canonical-member-directory.md`, `docs/operations/member-unification-s1-runbook.md`, `BACKLOG.md` | Enmienda, runbook y backlog |

---

### Task 1: Dominio — emparejamiento y contratos

**Files:**
- Create: `packages/domain/src/members/member-migration-contracts.ts`
- Create: `packages/domain/src/members/member-migration-contracts.test.ts`
- Modify: `packages/domain/package.json` (bloque `exports`, junto a `"./members/directory"`)

**Interfaces:**
- Produces: `MEMBER_MIGRATION_ID`, `buildMemberMigrationQueue(input: BuildMemberMigrationQueueInput): MemberMigrationQueue`, `maskIdentifier(value?: string): string | undefined`, `toMemberMigrationQueueResponse(queue, members, records): MemberMigrationQueueResponse`, `memberMigrationDecisionInputSchema`, `decideMemberMigrationInputSchema`, `decideMemberMigrationResultSchema`, `memberMigrationQueueResponseSchema`, `memberMigrationDecisionRecordSchema`, `memberMigrationRejectionCodes`, tipos `LegacyMemberInput`, `ArchiveRecordInput`, `MemberMigrationRow`, `MemberMigrationDecisionInput`, `MemberMigrationDecisionRecord`, `MemberMigrationRejectionCode`. Subpath: `@bpt-jersey/domain/members/migration`.

- [ ] **Step 1: Escribir los tests del emparejamiento**

`packages/domain/src/members/member-migration-contracts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildMemberMigrationQueue,
  decideMemberMigrationInputSchema,
  maskIdentifier,
  type ArchiveRecordInput,
  type LegacyMemberInput,
} from "./member-migration-contracts";

const today = "2026-09-19";
const member = (over: Partial<LegacyMemberInput> & { memberId: string }): LegacyMemberInput => ({
  fullName: "Ana Silva",
  birthDate: "1990-05-01",
  ...over,
});
const record = (over: Partial<ArchiveRecordInput> & { recordId: string }): ArchiveRecordInput => ({
  fullName: "Ana Silva",
  birthDate: "1990-05-01",
  ...over,
});
const build = (
  members: LegacyMemberInput[],
  records: ArchiveRecordInput[],
  decided: string[] = [],
  linked: string[] = [],
) =>
  buildMemberMigrationQueue({
    members,
    records,
    decidedMemberIds: new Set(decided),
    linkedRecordIds: new Set(linked),
    today,
  });

describe("buildMemberMigrationQueue", () => {
  it("is strong on an identical member number after normalisation", () => {
    const queue = build([member({ memberId: "m1", membershipNumber: " 0042 " })], [
      record({ recordId: "10", memberNumber: "0042", fullName: "Other Name" }),
    ]);
    expect(queue.rows[0]).toMatchObject({
      legacyMemberId: "m1",
      category: "strong",
      candidates: [{ recordId: "10", reason: "member-number" }],
      isMinor: false,
    });
  });

  it("is strong on an identical ID card", () => {
    const queue = build([member({ memberId: "m1", idCardNumber: "a123" })], [
      record({ recordId: "10", idCardNumber: "A123" }),
    ]);
    expect(queue.rows[0]?.category).toBe("strong");
    expect(queue.rows[0]?.candidates[0]?.reason).toBe("id-card");
  });

  it("is ambiguous when two members share the matching number", () => {
    const queue = build(
      [
        member({ memberId: "m1", membershipNumber: "7" }),
        member({ memberId: "m2", membershipNumber: "7", fullName: "Bea" }),
      ],
      [record({ recordId: "10", memberNumber: "7" })],
    );
    expect(queue.rows.map((row) => row.category)).toEqual(["ambiguous", "ambiguous"]);
  });

  it("is ambiguous when number and ID card point at different records", () => {
    const queue = build([member({ memberId: "m1", membershipNumber: "7", idCardNumber: "X1" })], [
      record({ recordId: "10", memberNumber: "7" }),
      record({ recordId: "11", idCardNumber: "X1", fullName: "Other" }),
    ]);
    expect(queue.rows[0]?.category).toBe("ambiguous");
    expect(queue.rows[0]?.candidates.map((candidate) => candidate.recordId)).toEqual(["10", "11"]);
  });

  it("only suggests on the same name and date of birth", () => {
    const queue = build([member({ memberId: "m1", fullName: "  ÁNA   silva " })], [
      record({ recordId: "10" }),
    ]);
    expect(queue.rows[0]).toMatchObject({
      category: "suggested",
      candidates: [{ recordId: "10", reason: "name-and-birth-date" }],
    });
  });

  it("is none without candidates and lists the unmatched record as archive-only", () => {
    const queue = build([member({ memberId: "m1", fullName: "Nobody" })], [record({ recordId: "10" })]);
    expect(queue.rows[0]?.category).toBe("none");
    expect(queue.archiveOnly).toEqual(["10"]);
  });

  it("skips decided members and never offers an already linked record", () => {
    const queue = build(
      [member({ memberId: "m1", membershipNumber: "7" }), member({ memberId: "m2", fullName: "Z" })],
      [record({ recordId: "10", memberNumber: "7" })],
      ["m2"],
      ["10"],
    );
    expect(queue.rows).toHaveLength(1);
    expect(queue.rows[0]?.category).toBe("none");
    expect(queue.archiveOnly).toEqual([]);
  });

  it("marks minors on the day before the 18th birthday and adults on the day", () => {
    const [minor, adult] = build(
      [
        member({ memberId: "m1", birthDate: "2008-09-20" }),
        member({ memberId: "m2", birthDate: "2008-09-19", fullName: "B" }),
      ],
      [],
    ).rows;
    expect(minor?.isMinor).toBe(true);
    expect(adult?.isMinor).toBe(false);
  });

  it("marks a member with no date of birth as unknown", () => {
    const queue = build([member({ memberId: "m1", birthDate: undefined })], []);
    expect(queue.rows[0]?.isMinor).toBe("unknown");
  });
});

describe("maskIdentifier", () => {
  it("keeps only the last three characters", () => {
    expect(maskIdentifier("AB12345")).toBe("•••345");
    expect(maskIdentifier("12")).toBe("•••12");
    expect(maskIdentifier(undefined)).toBeUndefined();
  });
});

describe("decideMemberMigrationInputSchema", () => {
  const training = { trainingCenter: "Town", trainingTimePreferences: ["evening"] };
  it("accepts link, create-unlinked and skip", () => {
    const parsed = decideMemberMigrationInputSchema.safeParse({
      decisions: [
        { kind: "link", legacyMemberId: "m1", recordId: "10", requestId: crypto.randomUUID(), ...training },
        { kind: "create-unlinked", legacyMemberId: "m2", requestId: crypto.randomUUID(), ...training },
        { kind: "skip", legacyMemberId: "m3", reason: "Duplicate row" },
      ],
    });
    expect(parsed.success).toBe(true);
  });
  it("rejects a skip without a reason, a link without a record, and 51 decisions", () => {
    expect(
      decideMemberMigrationInputSchema.safeParse({ decisions: [{ kind: "skip", legacyMemberId: "m" }] })
        .success,
    ).toBe(false);
    expect(
      decideMemberMigrationInputSchema.safeParse({
        decisions: [{ kind: "link", legacyMemberId: "m", requestId: crypto.randomUUID(), ...training }],
      }).success,
    ).toBe(false);
    const many = Array.from({ length: 51 }, (_, index) => ({
      kind: "skip",
      legacyMemberId: `m${index}`,
      reason: "Duplicate row",
    }));
    expect(decideMemberMigrationInputSchema.safeParse({ decisions: many }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Comprobar que falla**

Run: `corepack pnpm vitest run --project node packages/domain/src/members/member-migration-contracts.test.ts`
Expected: FAIL, "Failed to resolve import ./member-migration-contracts".

- [ ] **Step 3: Implementar el módulo**

`packages/domain/src/members/member-migration-contracts.ts`:

```ts
import { z } from "zod";
import { deriveParticipantType } from "../profiles/profile-contracts";
import { normalizeAdministrativeIdentifier } from "./member-directory-contracts";

export const MEMBER_MIGRATION_ID = "member-unification-s1-2026-09";

export type LegacyMemberInput = Readonly<{
  memberId: string;
  fullName: string;
  birthDate?: string;
  membershipNumber?: string;
  idCardNumber?: string;
}>;

export type ArchiveRecordInput = Readonly<{
  recordId: string;
  fullName: string;
  birthDate?: string;
  memberNumber?: string;
  idCardNumber?: string;
}>;

export type MemberMigrationCategory = "strong" | "suggested" | "ambiguous" | "none";
export type MemberMigrationCandidateReason = "member-number" | "id-card" | "name-and-birth-date";
export type MinorFlag = boolean | "unknown";

export type MemberMigrationRow = Readonly<{
  legacyMemberId: string;
  category: MemberMigrationCategory;
  candidates: readonly Readonly<{ recordId: string; reason: MemberMigrationCandidateReason }>[];
  isMinor: MinorFlag;
}>;

export type MemberMigrationQueue = Readonly<{
  rows: readonly MemberMigrationRow[];
  archiveOnly: readonly string[];
}>;

export type BuildMemberMigrationQueueInput = Readonly<{
  members: readonly LegacyMemberInput[];
  records: readonly ArchiveRecordInput[];
  decidedMemberIds: ReadonlySet<string>;
  linkedRecordIds: ReadonlySet<string>;
  today: string;
}>;

function strongKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const key = normalizeAdministrativeIdentifier(value);
  return key.length === 0 ? undefined : key;
}

// ponytail: exact normalised equality only; fuzzy matching would be an automatic name match (rule 9).
export function normalizeMemberName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function countBy(values: readonly (string | undefined)[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function indexBy(
  records: readonly ArchiveRecordInput[],
  key: (record: ArchiveRecordInput) => string | undefined,
): Map<string, ArchiveRecordInput[]> {
  const index = new Map<string, ArchiveRecordInput[]>();
  for (const record of records) {
    const value = key(record);
    if (value === undefined) continue;
    index.set(value, [...(index.get(value) ?? []), record]);
  }
  return index;
}

function minorFlag(birthDate: string | undefined, today: string): MinorFlag {
  if (birthDate === undefined) return "unknown";
  try {
    return deriveParticipantType(birthDate, today) === "minor";
  } catch {
    return "unknown";
  }
}

export function buildMemberMigrationQueue(input: BuildMemberMigrationQueueInput): MemberMigrationQueue {
  const open = input.records.filter((record) => !input.linkedRecordIds.has(record.recordId));
  const byNumber = indexBy(open, (record) => strongKey(record.memberNumber));
  const byIdCard = indexBy(open, (record) => strongKey(record.idCardNumber));
  const memberNumbers = countBy(input.members.map((member) => strongKey(member.membershipNumber)));
  const memberIdCards = countBy(input.members.map((member) => strongKey(member.idCardNumber)));
  const offered = new Set<string>();

  const rows = input.members
    .filter((member) => !input.decidedMemberIds.has(member.memberId))
    .map((member): MemberMigrationRow => {
      const number = strongKey(member.membershipNumber);
      const idCard = strongKey(member.idCardNumber);
      const strong = new Map<string, MemberMigrationCandidateReason>();
      for (const record of number === undefined ? [] : (byNumber.get(number) ?? [])) {
        strong.set(record.recordId, "member-number");
      }
      for (const record of idCard === undefined ? [] : (byIdCard.get(idCard) ?? [])) {
        if (!strong.has(record.recordId)) strong.set(record.recordId, "id-card");
      }
      const shared =
        (number !== undefined && (memberNumbers.get(number) ?? 0) > 1) ||
        (idCard !== undefined && (memberIdCards.get(idCard) ?? 0) > 1);

      let category: MemberMigrationCategory;
      let candidates: MemberMigrationRow["candidates"];
      if (strong.size > 0) {
        category = strong.size === 1 && !shared ? "strong" : "ambiguous";
        candidates = [...strong].map(([recordId, reason]) => ({ recordId, reason }));
      } else {
        const name = normalizeMemberName(member.fullName);
        candidates = open
          .filter(
            (record) =>
              member.birthDate !== undefined &&
              record.birthDate === member.birthDate &&
              normalizeMemberName(record.fullName) === name,
          )
          .map((record) => ({ recordId: record.recordId, reason: "name-and-birth-date" as const }));
        category = candidates.length > 0 ? "suggested" : "none";
      }
      candidates.forEach((candidate) => offered.add(candidate.recordId));
      const matchedBirthDate =
        category === "strong"
          ? open.find((record) => record.recordId === candidates[0]?.recordId)?.birthDate
          : undefined;
      return Object.freeze({
        legacyMemberId: member.memberId,
        category,
        candidates: Object.freeze(candidates.map((candidate) => Object.freeze(candidate))),
        isMinor: minorFlag(member.birthDate ?? matchedBirthDate, input.today),
      });
    });

  return Object.freeze({
    rows: Object.freeze(rows),
    archiveOnly: Object.freeze(
      open.map((record) => record.recordId).filter((recordId) => !offered.has(recordId)),
    ),
  });
}

export function maskIdentifier(value: string | undefined): string | undefined {
  return value === undefined ? undefined : `•••${value.slice(-3)}`;
}

const legacyMemberIdSchema = z.string().min(1).max(128).regex(/^[^/]+$/u);
const recordIdSchema = z.string().regex(/^[0-9]{1,12}$/u);
const trainingFields = {
  trainingCenter: z.enum(["Town", "West"]),
  trainingTimePreferences: z
    .array(z.enum(["morning", "afternoon", "evening"]))
    .min(1)
    .max(3)
    .refine((values) => new Set(values).size === values.length),
};

export const memberMigrationDecisionInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("link"),
    legacyMemberId: legacyMemberIdSchema,
    recordId: recordIdSchema,
    requestId: z.uuid(),
    ...trainingFields,
  }),
  z.strictObject({
    kind: z.literal("create-unlinked"),
    legacyMemberId: legacyMemberIdSchema,
    requestId: z.uuid(),
    ...trainingFields,
  }),
  z.strictObject({
    kind: z.literal("skip"),
    legacyMemberId: legacyMemberIdSchema,
    reason: z.string().trim().min(3).max(200),
  }),
]);
export type MemberMigrationDecisionInput = z.infer<typeof memberMigrationDecisionInputSchema>;

export const decideMemberMigrationInputSchema = z.strictObject({
  decisions: z.array(memberMigrationDecisionInputSchema).min(1).max(50),
});

export const memberMigrationRejectionCodes = [
  "unknown-member",
  "already-decided",
  "not-a-candidate",
  "minor-deferred",
  "record-already-linked",
  "identifier-reserved",
  "identity-changed",
  "write-failed",
] as const;
export type MemberMigrationRejectionCode = (typeof memberMigrationRejectionCodes)[number];

export const decideMemberMigrationResultSchema = z.strictObject({
  results: z.array(
    z.discriminatedUnion("status", [
      z.strictObject({
        legacyMemberId: legacyMemberIdSchema,
        status: z.literal("applied"),
        studentId: z.string().min(1).optional(),
      }),
      z.strictObject({
        legacyMemberId: legacyMemberIdSchema,
        status: z.literal("rejected"),
        code: z.enum(memberMigrationRejectionCodes),
      }),
    ]),
  ),
});
export type DecideMemberMigrationResult = z.infer<typeof decideMemberMigrationResultSchema>;

export const memberMigrationDecisionRecordSchema = z.strictObject({
  legacyMemberId: legacyMemberIdSchema,
  academyId: z.string().min(1),
  migrationId: z.literal(MEMBER_MIGRATION_ID),
  kind: z.enum(["link", "create-unlinked", "skip"]),
  recordId: recordIdSchema.optional(),
  studentId: z.string().min(1).optional(),
  reason: z.string().min(3).max(200).optional(),
  trainingCenter: z.enum(["Town", "West"]).optional(),
  trainingTimePreferences: z.array(z.enum(["morning", "afternoon", "evening"])).optional(),
  decidedAt: z.string().min(1),
  decidedBy: z.string().min(1),
  schemaVersion: z.literal("1"),
});
export type MemberMigrationDecisionRecord = z.infer<typeof memberMigrationDecisionRecordSchema>;

const sideSchema = z.strictObject({
  fullName: z.string(),
  birthDate: z.string().optional(),
  memberNumberMasked: z.string().optional(),
  idCardMasked: z.string().optional(),
});
export const memberMigrationQueueResponseSchema = z.strictObject({
  rows: z.array(
    z.strictObject({
      legacyMemberId: legacyMemberIdSchema,
      category: z.enum(["strong", "suggested", "ambiguous", "none"]),
      isMinor: z.union([z.boolean(), z.literal("unknown")]),
      member: sideSchema,
      candidates: z.array(
        z.strictObject({
          recordId: recordIdSchema,
          reason: z.enum(["member-number", "id-card", "name-and-birth-date"]),
          record: sideSchema,
        }),
      ),
    }),
  ),
  archiveOnly: z.number().int().min(0),
  decided: z.number().int().min(0),
});
export type MemberMigrationQueueResponse = z.infer<typeof memberMigrationQueueResponseSchema>;

export function toMemberMigrationQueueResponse(
  queue: MemberMigrationQueue,
  members: readonly LegacyMemberInput[],
  records: readonly ArchiveRecordInput[],
  decided: number,
): MemberMigrationQueueResponse {
  const memberById = new Map(members.map((member) => [member.memberId, member]));
  const recordById = new Map(records.map((record) => [record.recordId, record]));
  const side = (value: LegacyMemberInput | ArchiveRecordInput) => ({
    fullName: value.fullName,
    ...(value.birthDate === undefined ? {} : { birthDate: value.birthDate }),
    ...("membershipNumber" in value && value.membershipNumber !== undefined
      ? { memberNumberMasked: maskIdentifier(value.membershipNumber) }
      : {}),
    ...("memberNumber" in value && value.memberNumber !== undefined
      ? { memberNumberMasked: maskIdentifier(value.memberNumber) }
      : {}),
    ...(value.idCardNumber === undefined ? {} : { idCardMasked: maskIdentifier(value.idCardNumber) }),
  });
  return {
    rows: queue.rows.flatMap((row) => {
      const member = memberById.get(row.legacyMemberId);
      if (member === undefined) return [];
      return [
        {
          legacyMemberId: row.legacyMemberId,
          category: row.category,
          isMinor: row.isMinor,
          member: side(member),
          candidates: row.candidates.flatMap((candidate) => {
            const record = recordById.get(candidate.recordId);
            return record === undefined
              ? []
              : [{ recordId: candidate.recordId, reason: candidate.reason, record: side(record) }];
          }),
        },
      ];
    }),
    archiveOnly: queue.archiveOnly.length,
    decided,
  };
}
```

- [ ] **Step 4: Registrar el subpath**

En `packages/domain/package.json`, dentro de `"exports"` y justo después del bloque `"./members/directory"`:

```json
    "./members/migration": {
      "types": "./src/members/member-migration-contracts.ts",
      "import": "./src/members/member-migration-contracts.ts",
      "default": "./lib/members/member-migration-contracts.js"
    },
```

- [ ] **Step 5: Comprobar que pasa**

Run: `corepack pnpm vitest run --project node packages/domain/src/members/member-migration-contracts.test.ts && corepack pnpm --filter @bpt-jersey/domain build:runtime && corepack pnpm typecheck`
Expected: todos los tests en verde; `build:runtime` y `typecheck` terminan con exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/members/member-migration-contracts.ts packages/domain/src/members/member-migration-contracts.test.ts packages/domain/package.json
git commit -m "feat(domain): member migration queue — strong-only auto match, masked response, decision contracts (S1)"
```

---

### Task 2: Dominio — acción de auditoría `member.migration.skipped`

**Files:**
- Modify: `packages/domain/src/audit/audit-event.ts` (array `auditActions`; mapa `fieldsByAction`; validación por acción junto al bloque `if (parsedAction === "member.created" || parsedAction === "member.updated")`)
- Test: el `.test.ts` de `audit-event.ts` que ya existe en `packages/domain/src/audit/`

**Interfaces:**
- Produces: la acción `"member.migration.skipped"`. Borrador válido: `{ academyId, actorId, action: "member.migration.skipped", targetRef: "academies/{academyId}/memberMigrationDecisions/{memberId}", purpose: "member-record-maintenance" }`. Cualquier otro `targetRef` o `purpose` produce el issue `AUDIT_MEMBER_MIGRATION_SCOPE_INVALID`.

- [ ] **Step 1: Test que falla**

Añadir al test existente de `audit-event` (mismo `describe` de `parseAuditEventDraft`, mismos helpers de importación que ya usa el archivo):

```ts
it("accepts a member migration skip scoped to its decision document", () => {
  const draft = {
    academyId: "academy-1",
    actorId: "user-1",
    action: "member.migration.skipped",
    targetRef: "academies/academy-1/memberMigrationDecisions/m1",
    purpose: "member-record-maintenance",
  };
  expect(parseAuditEventDraft(draft).ok).toBe(true);
  const wrong = parseAuditEventDraft({ ...draft, targetRef: "academies/academy-2/memberMigrationDecisions/m1" });
  expect(wrong.ok).toBe(false);
});
```

Run: `corepack pnpm vitest run --project node packages/domain/src/audit`
Expected: FAIL (acción desconocida).

- [ ] **Step 2: Implementar**

1. En `auditActions`, añadir `"member.migration.skipped",` justo después de `"class.history.read",`.
2. En `fieldsByAction`, añadir `"member.migration.skipped": commonFields,`.
3. Junto al bloque de `member.created`/`member.updated`, añadir:

```ts
    if (parsedAction === "member.migration.skipped") {
      const prefix = `academies/${snapshot.academyId as string}/memberMigrationDecisions/`;
      const memberId =
        typeof snapshot.targetRef === "string" && snapshot.targetRef.startsWith(prefix)
          ? snapshot.targetRef.slice(prefix.length)
          : "";
      if (
        memberId.length === 0 ||
        memberId.includes("/") ||
        snapshot.purpose !== "member-record-maintenance"
      ) {
        issues.push(issue([], "AUDIT_MEMBER_MIGRATION_SCOPE_INVALID"));
      }
    }
```

Si `typecheck` señala otros `Record<AuditAction, …>` exhaustivos, añadir la acción allí con el mismo valor que tenga `"member.created"`.

- [ ] **Step 3: Verde y commit**

Run: `corepack pnpm vitest run --project node packages/domain/src/audit && corepack pnpm --filter @bpt-jersey/domain build:runtime && corepack pnpm typecheck`
Expected: PASS y exit 0.

```bash
git add packages/domain/src/audit
git commit -m "feat(audit): member.migration.skipped scoped to its decision document (S1)"
```

---

### Task 3: Alta canónica — `registerLegacyMember` y `skipLegacyMember`

**Files:**
- Modify: `apps/functions/src/members/canonical-member-directory-service.ts` (`createAdult`, `buildAdminProfile`, `buildKeys`, tipo `OfficeMemberDirectoryService`, el objeto devuelto por `createCanonicalMemberDirectoryService`)
- Test: `apps/functions/src/members/canonical-member-directory-service.test.ts` (reutiliza `fakeFirestore`, `controlPlaneSeed`, `actor()` y `service(firestore)`)

**Interfaces:**
- Consumes: `MEMBER_MIGRATION_ID`, `memberMigrationDecisionRecordSchema` (Task 1).
- Produces, en `OfficeMemberDirectoryService`:

```ts
export type LegacyMemberRegistrationCommand = CreateAdminAdultCommand &
  Readonly<{
    legacyMemberId: string; // memberId crudo; id del documento de decisión
    recordId?: string; // presente = link
    trainingCenter: "Town" | "West";
    trainingTimePreferences: readonly ("morning" | "afternoon" | "evening")[];
  }>;
export type LegacyMemberSkipCommand = Readonly<{
  actor: CanonicalMemberDirectoryActor;
  legacyMemberId: string;
  reason: string;
  now: string;
}>;
export const legacyMigrationErrorMessages = Object.freeze({
  alreadyDecided: "Legacy member already decided",
  recordLinked: "Imported record is already linked",
  adultsOnly: "Legacy migration is for adults only",
} as const);
// registerLegacyMember(command): Promise<CreateAdminAdultResult>
// skipLegacyMember(command): Promise<void>
```

- [ ] **Step 1: Tests que fallan**

En `canonical-member-directory-service.test.ts`, un `describe("legacy member migration")` con estos casos. Reutiliza `fakeFirestore(controlPlaneSeed())`, `actor()` e `input()`: `input()` ya produce un adulto válido con `trainingCenter` y preferencias. La lectura de documentos del harness es la que ya usan los tests existentes (por ejemplo `harness.documents.get(path)`; usar el acceso que exponga `fakeFirestore`).

```ts
describe("legacy member migration", () => {
  const legacy = { legacyMemberId: "legacyAbc1", trainingCenter: "Town" as const, trainingTimePreferences: ["evening" as const] };

  it("creates the student with a legacy-member-migration profile, a legacy key and the decision", async () => {
    const harness = fakeFirestore(controlPlaneSeed());
    const result = await service(harness.firestore).registerLegacyMember({
      actor: actor(), value: input(), now: "2026-09-19T10:00:00.000Z", ...legacy,
    });
    const profile = harness.read(`academies/academy-1/studentAdminProfiles/${result.studentId}`);
    expect(profile).toMatchObject({
      source: "legacy-member-migration",
      migrationId: "member-unification-s1-2026-09",
      legacyMemberId: "LEGACYABC1",
    });
    expect(harness.read("academies/academy-1/memberMigrationDecisions/legacyAbc1")).toMatchObject({
      kind: "create-unlinked", studentId: result.studentId, migrationId: "member-unification-s1-2026-09",
    });
    expect(harness.paths().filter((path) => path.includes("/studentIdentityKeys/legacy-member-id:"))).toHaveLength(1);
  });

  it("refuses a second decision for the same legacy member", async () => {
    const harness = fakeFirestore(controlPlaneSeed());
    await service(harness.firestore).registerLegacyMember({ actor: actor(), value: input("request-1"), now: "2026-09-19T10:00:00.000Z", ...legacy });
    await expect(
      service(harness.firestore).skipLegacyMember({ actor: actor(), legacyMemberId: "legacyAbc1", reason: "Duplicate", now: "2026-09-19T10:01:00.000Z" }),
    ).rejects.toThrow("Legacy member already decided");
  });

  it("refuses a minor", async () => {
    const harness = fakeFirestore(controlPlaneSeed());
    await expect(
      service(harness.firestore).registerLegacyMember({
        actor: actor(), value: { ...input(), dateOfBirth: "2012-01-01" }, now: "2026-09-19T10:00:00.000Z", ...legacy,
      }),
    ).rejects.toThrow();
    expect(harness.read("academies/academy-1/memberMigrationDecisions/legacyAbc1")).toBeUndefined();
  });

  it("skips with a decision and an audit event, and writes no student", async () => {
    const harness = fakeFirestore(controlPlaneSeed());
    await service(harness.firestore).skipLegacyMember({ actor: actor(), legacyMemberId: "legacyAbc1", reason: "Left in 2024", now: "2026-09-19T10:00:00.000Z" });
    expect(harness.read("academies/academy-1/memberMigrationDecisions/legacyAbc1")).toMatchObject({ kind: "skip", reason: "Left in 2024" });
    expect(harness.paths().some((path) => path.includes("/students/"))).toBe(false);
  });
});
```

Las rutas usan el `academyId` que devuelve `actor()` en ese archivo (en el ejemplo, `academy-1`; ajustar si es otro). Si `fakeFirestore` no expone `read`/`paths`, añadir esos dos helpers al harness del propio archivo de test: `read(path)` devuelve los datos del documento o `undefined`, y `paths()` la lista de rutas. Es un cambio solo del test. Un caso de `link` con archivo sembrado va en el test de integración (Task 8), porque necesita un registro del archivo válido.

Run: `corepack pnpm vitest run --project node apps/functions/src/members/canonical-member-directory-service.test.ts -t "legacy member migration"`
Expected: FAIL (`registerLegacyMember is not a function`).

- [ ] **Step 2: Implementar**

1. Importar `MEMBER_MIGRATION_ID` y `memberMigrationDecisionRecordSchema` desde `@bpt-jersey/domain/members/migration`, y `deriveParticipantType` desde `@bpt-jersey/domain/profiles` si el archivo no lo importa ya. Exportar `legacyMigrationErrorMessages` y los dos tipos de comando de la sección Interfaces.
2. `buildAdminProfile` recibe un sexto parámetro opcional `legacy?: Readonly<{ legacyMemberId: string }>`. Cuando está presente, en lugar de `source: "admin"` escribe:

```ts
    ...(legacy === undefined
      ? { source: "admin" }
      : {
          source: "legacy-member-migration",
          migrationId: MEMBER_MIGRATION_ID,
          legacyMemberId: normalizeAdministrativeIdentifier(legacy.legacyMemberId),
        }),
```

3. En `buildKeys`, añadir al array `values`:

```ts
    [
      "legacy-member-id",
      profile.source === "legacy-member-migration" ? profile.legacyMemberId : undefined,
    ],
```

4. `createAdult` recibe un cuarto parámetro opcional `legacy?: Readonly<{ legacyMemberId: string; trainingCenter: string; trainingTimePreferences: readonly string[] }>`. Cambios, en orden:
   - Tras resolver `parsedInput.ok`, si `legacy` está presente:

```ts
      if (deriveParticipantType(parsedInput.value.dateOfBirth, now.slice(0, 10)) !== "adult") {
        throw new CanonicalMemberDirectoryError("invalid", legacyMigrationErrorMessages.adultsOnly);
      }
```

   - Dentro de la transacción, antes del bloque `if (officeLinkRef)`:

```ts
      const decisionRef = legacy
        ? dependencies.firestore.doc(
            `academies/${academyId}/memberMigrationDecisions/${legacy.legacyMemberId}`,
          )
        : undefined;
      if (decisionRef && (await transaction.get(decisionRef)).exists) {
        throw new CanonicalMemberDirectoryError("conflict", legacyMigrationErrorMessages.alreadyDecided);
      }
```

   - En el bloque `if (officeLinkRef)`, justo antes de `const linked = …`, añadir: si `legacy` está presente y `linkSnapshot.exists || recoveredSnapshot.exists`, lanzar `new CanonicalMemberDirectoryError("conflict", legacyMigrationErrorMessages.recordLinked)`. Una migración nunca reutiliza un `student` ya enlazado.
   - `buildAdminProfile(parsedInput.value, academyId, studentId, actorId, now, legacy)`.
   - Junto a los demás `transaction.create`, si `decisionRef` existe:

```ts
        const decision = memberMigrationDecisionRecordSchema.parse({
          legacyMemberId: legacy.legacyMemberId,
          academyId,
          migrationId: MEMBER_MIGRATION_ID,
          kind: sourceRecordId ? "link" : "create-unlinked",
          ...(sourceRecordId ? { recordId: sourceRecordId } : {}),
          studentId,
          trainingCenter: legacy.trainingCenter,
          trainingTimePreferences: [...legacy.trainingTimePreferences],
          decidedAt: now,
          decidedBy: actorId,
          schemaVersion: "1",
        });
        transaction.create(decisionRef, decision);
```

5. En el objeto del servicio, junto a `registerImportedMember`:

```ts
    async registerLegacyMember(command: LegacyMemberRegistrationCommand) {
      if (command.recordId !== undefined && !/^[0-9]{1,12}$/u.test(command.recordId))
        throw new CanonicalMemberDirectoryError("invalid", "Invalid imported record ID");
      return createAdult(command, undefined, command.recordId, {
        legacyMemberId: command.legacyMemberId,
        trainingCenter: command.trainingCenter,
        trainingTimePreferences: command.trainingTimePreferences,
      });
    },
    async skipLegacyMember(command: LegacyMemberSkipCommand) {
      requireAuthorizedActor(command.actor);
      const now = requiredTimestamp(command.now);
      const academyId = command.actor.academyId;
      const decisionRef = dependencies.firestore.doc(
        `academies/${academyId}/memberMigrationDecisions/${command.legacyMemberId}`,
      );
      const auditRef = dependencies.firestore.doc(auditPath(academyId, requiredIdentifier(generateAuditId(), "generated audit ID")));
      await dependencies.firestore.runTransaction(async (transaction) => {
        await assertProvisionedActor(transaction, dependencies, command.actor);
        if ((await transaction.get(decisionRef)).exists)
          throw new CanonicalMemberDirectoryError("conflict", legacyMigrationErrorMessages.alreadyDecided);
        transaction.create(
          decisionRef,
          memberMigrationDecisionRecordSchema.parse({
            legacyMemberId: command.legacyMemberId,
            academyId,
            migrationId: MEMBER_MIGRATION_ID,
            kind: "skip",
            reason: command.reason.trim(),
            decidedAt: now,
            decidedBy: command.actor.actorId,
            schemaVersion: "1",
          }),
        );
        appendAuditEventInTransaction(transaction, auditRef, {
          academyId,
          actorId: command.actor.actorId,
          action: "member.migration.skipped",
          targetRef: decisionRef.path,
          purpose: "member-record-maintenance",
        } as unknown as AuditEventDraft);
      });
    },
```

   Y ampliar el tipo `OfficeMemberDirectoryService` con los dos métodos.

- [ ] **Step 3: Verde, suite del archivo y commit**

Run: `corepack pnpm vitest run --project node apps/functions/src/members/canonical-member-directory-service.test.ts && corepack pnpm typecheck && corepack pnpm lint`
Expected: el archivo completo en verde (los tests previos no cambian) y exit 0.

```bash
git add apps/functions/src/members/canonical-member-directory-service.ts apps/functions/src/members/canonical-member-directory-service.test.ts
git commit -m "feat(members): registerLegacyMember and skipLegacyMember on the canonical adult path (S1)"
```

---

### Task 4: Servicio de migración y su adaptador Firestore

**Files:**
- Create: `apps/functions/src/members/member-migration-service.ts`
- Create: `apps/functions/src/members/member-migration-service.test.ts`
- Create: `apps/functions/src/members/member-migration-firestore.ts`

**Interfaces:**
- Consumes: Task 1 (`buildMemberMigrationQueue`, `toMemberMigrationQueueResponse`, esquemas y tipos) y Task 3 (`registerLegacyMember`, `skipLegacyMember`, `legacyMigrationErrorMessages`, `CanonicalMemberDirectoryError`).
- Produces:

```ts
export type MemberMigrationSnapshot = Readonly<{
  members: readonly MemberRecord[];
  records: readonly RegyfitMemberRecord[];
  decidedMemberIds: ReadonlySet<string>;
  linkedRecordIds: ReadonlySet<string>;
}>;
export type MemberMigrationStore = Readonly<{ load(academyId: string): Promise<MemberMigrationSnapshot> }>;
export type MemberMigrationWriter = Pick<OfficeMemberDirectoryService, "registerLegacyMember" | "skipLegacyMember">;
export function createMemberMigrationService(deps: Readonly<{ store: MemberMigrationStore; writer: MemberMigrationWriter; now: () => string }>): {
  listQueue(actor: CanonicalMemberDirectoryActor): Promise<MemberMigrationQueueResponse>;
  decide(actor: CanonicalMemberDirectoryActor, input: unknown): Promise<DecideMemberMigrationResult>;
};
export function createFirestoreMemberMigrationStore(firestore: Firestore): MemberMigrationStore;
```

- [ ] **Step 1: Tests con fakes**

`member-migration-service.test.ts`: construye `MemberRecord` y `RegyfitMemberRecord` mínimos como objetos literales tipados con `as MemberRecord` / `as RegyfitMemberRecord`, con los campos que usa el servicio. Un `writer` fake registra las llamadas y lanza errores configurables.

```ts
import { describe, expect, it, vi } from "vitest";
import type { MemberRecord } from "@bpt-jersey/domain/members";
import type { RegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";
import { CanonicalMemberDirectoryError, legacyMigrationErrorMessages } from "./canonical-member-directory-service.js";
import { createMemberMigrationService } from "./member-migration-service.js";

const actor = { actorId: "owner-1", academyId: "academy-1", role: "owner" as const, active: true, appCheckVerified: true };
const adult = { memberId: "m1", fullName: "Ana Silva", birthDate: "1990-05-01", membershipNumber: "42", mobileNumber: "07700 900000", gender: "female" } as unknown as MemberRecord;
const archive = { recordId: "10", fullName: "Ana Silva", birthDate: "1990-05-01", memberNumber: "42", gender: "female", mobile: "07700 900000" } as unknown as RegyfitMemberRecord;
const training = { trainingCenter: "Town", trainingTimePreferences: ["evening"] };

function harness(overrides: Partial<{ members: MemberRecord[]; records: RegyfitMemberRecord[]; decided: string[] }> = {}) {
  const writer = {
    registerLegacyMember: vi.fn(async () => ({ memberId: "s1", studentId: "s1" })),
    skipLegacyMember: vi.fn(async () => undefined),
  };
  const service = createMemberMigrationService({
    store: {
      load: async () => ({
        members: overrides.members ?? [adult],
        records: overrides.records ?? [archive],
        decidedMemberIds: new Set(overrides.decided ?? []),
        linkedRecordIds: new Set(),
      }),
    },
    writer,
    now: () => "2026-09-19T10:00:00.000Z",
  });
  return { service, writer };
}

describe("member migration service", () => {
  it("lists a strong row with masked identifiers", async () => {
    const queue = await harness().service.listQueue(actor);
    expect(queue.rows[0]).toMatchObject({ legacyMemberId: "m1", category: "strong", member: { memberNumberMasked: "•••42" } });
  });

  it("links with the archive identity, the member ID card and the chosen training", async () => {
    const { service, writer } = harness();
    const result = await service.decide(actor, {
      decisions: [{ kind: "link", legacyMemberId: "m1", recordId: "10", requestId: crypto.randomUUID(), ...training }],
    });
    expect(result.results).toEqual([{ legacyMemberId: "m1", status: "applied", studentId: "s1" }]);
    expect(writer.registerLegacyMember).toHaveBeenCalledWith(
      expect.objectContaining({
        legacyMemberId: "m1",
        recordId: "10",
        value: expect.objectContaining({ fullName: "Ana Silva", dateOfBirth: "1990-05-01", membershipNumber: "42", trainingCenter: "Town" }),
      }),
    );
  });

  it("rejects a link to a record that is not a candidate", async () => {
    const other = { ...archive, recordId: "11", memberNumber: "99", fullName: "Zed" } as unknown as RegyfitMemberRecord;
    const { service, writer } = harness({ records: [archive, other] });
    const result = await service.decide(actor, {
      decisions: [{ kind: "link", legacyMemberId: "m1", recordId: "11", requestId: crypto.randomUUID(), ...training }],
    });
    expect(result.results[0]).toEqual({ legacyMemberId: "m1", status: "rejected", code: "not-a-candidate" });
    expect(writer.registerLegacyMember).not.toHaveBeenCalled();
  });

  it("defers minors and members without a date of birth", async () => {
    const minor = { ...adult, memberId: "m2", birthDate: "2012-01-01", membershipNumber: undefined } as unknown as MemberRecord;
    const undated = { ...adult, memberId: "m3", birthDate: undefined, membershipNumber: undefined } as unknown as MemberRecord;
    const { service } = harness({ members: [minor, undated], records: [] });
    const result = await service.decide(actor, {
      decisions: [
        { kind: "create-unlinked", legacyMemberId: "m2", requestId: crypto.randomUUID(), ...training },
        { kind: "create-unlinked", legacyMemberId: "m3", requestId: crypto.randomUUID(), ...training },
      ],
    });
    expect(result.results.map((entry) => entry.status === "rejected" && entry.code)).toEqual(["minor-deferred", "minor-deferred"]);
  });

  it("keeps going after a rejected decision and maps writer errors to safe codes", async () => {
    const second = { ...adult, memberId: "m2", fullName: "Bea", membershipNumber: undefined } as unknown as MemberRecord;
    const { service, writer } = harness({ members: [adult, second] });
    writer.registerLegacyMember.mockRejectedValueOnce(
      new CanonicalMemberDirectoryError("conflict", legacyMigrationErrorMessages.recordLinked),
    );
    const result = await service.decide(actor, {
      decisions: [
        { kind: "link", legacyMemberId: "m1", recordId: "10", requestId: crypto.randomUUID(), ...training },
        { kind: "skip", legacyMemberId: "m2", reason: "Duplicate row" },
      ],
    });
    expect(result.results).toEqual([
      { legacyMemberId: "m1", status: "rejected", code: "record-already-linked" },
      { legacyMemberId: "m2", status: "applied" },
    ]);
  });

  it("rejects an unknown or already decided member without writing", async () => {
    const { service, writer } = harness({ decided: ["m1"] });
    const result = await service.decide(actor, {
      decisions: [
        { kind: "skip", legacyMemberId: "m1", reason: "Duplicate row" },
        { kind: "skip", legacyMemberId: "ghost", reason: "Duplicate row" },
      ],
    });
    expect(result.results.map((entry) => entry.status === "rejected" && entry.code)).toEqual(["already-decided", "unknown-member"]);
    expect(writer.skipLegacyMember).not.toHaveBeenCalled();
  });
});
```

Run: `corepack pnpm vitest run --project node apps/functions/src/members/member-migration-service.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 2: Implementar el servicio**

`member-migration-service.ts`:

```ts
import type { MemberRecord } from "@bpt-jersey/domain/members";
import {
  buildMemberMigrationQueue,
  decideMemberMigrationInputSchema,
  toMemberMigrationQueueResponse,
  type ArchiveRecordInput,
  type DecideMemberMigrationResult,
  type LegacyMemberInput,
  type MemberMigrationDecisionInput,
  type MemberMigrationQueueResponse,
  type MemberMigrationRejectionCode,
} from "@bpt-jersey/domain/members/migration";
import { normalizeAdministrativeIdentifier } from "@bpt-jersey/domain/members/directory";
import type { RegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";
import {
  CanonicalMemberDirectoryError,
  legacyMigrationErrorMessages,
  type CanonicalMemberDirectoryActor,
  type OfficeMemberDirectoryService,
} from "./canonical-member-directory-service.js";

export type MemberMigrationSnapshot = Readonly<{
  members: readonly MemberRecord[];
  records: readonly RegyfitMemberRecord[];
  decidedMemberIds: ReadonlySet<string>;
  linkedRecordIds: ReadonlySet<string>;
}>;
export type MemberMigrationStore = Readonly<{ load(academyId: string): Promise<MemberMigrationSnapshot> }>;
export type MemberMigrationWriter = Pick<OfficeMemberDirectoryService, "registerLegacyMember" | "skipLegacyMember">;

export class MemberMigrationInputError extends Error {}

const toMemberInput = (member: MemberRecord): LegacyMemberInput => ({
  memberId: member.memberId,
  fullName: member.fullName,
  ...(member.birthDate === undefined ? {} : { birthDate: member.birthDate }),
  ...(member.membershipNumber === undefined ? {} : { membershipNumber: member.membershipNumber }),
  ...(member.idCardNumber === undefined ? {} : { idCardNumber: member.idCardNumber }),
});
const toRecordInput = (record: RegyfitMemberRecord): ArchiveRecordInput => ({
  recordId: record.recordId,
  fullName: record.fullName,
  ...(record.birthDate === undefined ? {} : { birthDate: record.birthDate }),
  ...(record.memberNumber === undefined ? {} : { memberNumber: record.memberNumber }),
  ...(record.idCardNumber === undefined ? {} : { idCardNumber: record.idCardNumber }),
});

function rejectionFor(error: unknown): MemberMigrationRejectionCode {
  if (!(error instanceof CanonicalMemberDirectoryError)) return "write-failed";
  if (error.message === legacyMigrationErrorMessages.alreadyDecided) return "already-decided";
  if (error.message === legacyMigrationErrorMessages.recordLinked) return "record-already-linked";
  if (error.message === legacyMigrationErrorMessages.adultsOnly) return "minor-deferred";
  if (error.message === "Administrative identifier is already reserved") return "identifier-reserved";
  if (error.message === "Imported identity changed. Refresh before registering.") return "identity-changed";
  return "write-failed";
}

export function createMemberMigrationService(
  deps: Readonly<{ store: MemberMigrationStore; writer: MemberMigrationWriter; now: () => string }>,
) {
  async function queueFor(academyId: string) {
    const snapshot = await deps.store.load(academyId);
    const members = snapshot.members.map(toMemberInput);
    const records = snapshot.records.map(toRecordInput);
    const queue = buildMemberMigrationQueue({
      members,
      records,
      decidedMemberIds: snapshot.decidedMemberIds,
      linkedRecordIds: snapshot.linkedRecordIds,
      today: deps.now().slice(0, 10),
    });
    return { snapshot, members, records, queue };
  }

  return {
    async listQueue(actor: CanonicalMemberDirectoryActor): Promise<MemberMigrationQueueResponse> {
      const { snapshot, members, records, queue } = await queueFor(actor.academyId);
      return toMemberMigrationQueueResponse(queue, members, records, snapshot.decidedMemberIds.size);
    },

    async decide(actor: CanonicalMemberDirectoryActor, input: unknown): Promise<DecideMemberMigrationResult> {
      const parsed = decideMemberMigrationInputSchema.safeParse(input);
      if (!parsed.success) throw new MemberMigrationInputError("Invalid migration decisions");
      const { snapshot, queue } = await queueFor(actor.academyId);
      const members = new Map(snapshot.members.map((member) => [member.memberId, member]));
      const records = new Map(snapshot.records.map((record) => [record.recordId, record]));
      const rows = new Map(queue.rows.map((row) => [row.legacyMemberId, row]));
      const results: DecideMemberMigrationResult["results"] = [];

      for (const decision of parsed.data.decisions) {
        const reject = (code: MemberMigrationRejectionCode) =>
          results.push({ legacyMemberId: decision.legacyMemberId, status: "rejected", code });
        const member = members.get(decision.legacyMemberId);
        if (member === undefined) { reject("unknown-member"); continue; }
        const row = rows.get(decision.legacyMemberId);
        if (row === undefined) { reject("already-decided"); continue; }
        try {
          if (decision.kind === "skip") {
            await deps.writer.skipLegacyMember({ actor, legacyMemberId: member.memberId, reason: decision.reason, now: deps.now() });
            results.push({ legacyMemberId: member.memberId, status: "applied" });
          } else {
            if (row.isMinor !== false) { reject("minor-deferred"); continue; }
            const created = await deps.writer.registerLegacyMember(
              registrationFor(actor, member, decision, row.candidates, records, deps.now()),
            );
            results.push({ legacyMemberId: member.memberId, status: "applied", studentId: created.studentId });
          }
          rows.delete(member.memberId);
        } catch (error) {
          if (error instanceof MemberMigrationInputError) { reject("not-a-candidate"); continue; }
          reject(rejectionFor(error));
        }
      }
      return { results };
    },
  };
}

function registrationFor(
  actor: CanonicalMemberDirectoryActor,
  member: MemberRecord,
  decision: Exclude<MemberMigrationDecisionInput, { kind: "skip" }>,
  candidates: readonly Readonly<{ recordId: string }>[],
  records: ReadonlyMap<string, RegyfitMemberRecord>,
  now: string,
) {
  const training = {
    trainingCenter: decision.trainingCenter,
    trainingTimePreferences: [...decision.trainingTimePreferences],
  };
  if (decision.kind === "link") {
    const record = records.get(decision.recordId);
    if (record === undefined || !candidates.some((candidate) => candidate.recordId === decision.recordId)) {
      throw new MemberMigrationInputError("not-a-candidate");
    }
    const dateOfBirth = record.birthDate ?? member.birthDate;
    return {
      actor,
      now,
      legacyMemberId: member.memberId,
      recordId: record.recordId,
      ...training,
      value: {
        requestId: decision.requestId,
        fullName: record.fullName,
        dateOfBirth,
        ...training,
        ...(record.memberNumber ? { membershipNumber: normalizeAdministrativeIdentifier(record.memberNumber) } : {}),
        ...(member.idCardNumber ? { idCardNumber: member.idCardNumber } : {}),
        ...((record.mobile ?? member.mobileNumber) ? { phoneNumber: record.mobile ?? member.mobileNumber } : {}),
        gender: record.gender,
      },
    };
  }
  return {
    actor,
    now,
    legacyMemberId: member.memberId,
    ...training,
    value: {
      requestId: decision.requestId,
      fullName: member.fullName,
      dateOfBirth: member.birthDate,
      ...training,
      ...(member.membershipNumber ? { membershipNumber: member.membershipNumber } : {}),
      ...(member.idCardNumber ? { idCardNumber: member.idCardNumber } : {}),
      ...(member.vatNumber ? { vatNumber: member.vatNumber } : {}),
      ...(member.mobileNumber ? { phoneNumber: member.mobileNumber } : {}),
      gender: member.gender,
    },
  };
}
```

Si `normalizeAdministrativeIdentifier` o `memberGenders` no coinciden en tipo entre `MemberRecord.gender` y el input canónico, `typecheck` lo dirá. Los dos usan el mismo enum `memberGenders` según `member-contracts.ts` y `member-directory-contracts.ts`, y se corrige en el punto del error.

- [ ] **Step 3: Adaptador Firestore**

`member-migration-firestore.ts`:

```ts
import type { Firestore } from "firebase-admin/firestore";
import { parseMemberRecord } from "@bpt-jersey/domain/members";
import { parseStoredRegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";
import type { MemberMigrationStore } from "./member-migration-service.js";

export function createFirestoreMemberMigrationStore(firestore: Firestore): MemberMigrationStore {
  return {
    async load(academyId) {
      const root = `academies/${academyId}`;
      const [members, records, decisions, officeLinks, memberLinks] = await Promise.all(
        ["members", "regyfitMemberRecords", "memberMigrationDecisions", "regyfitOfficeLinks", "regyfitMemberLinks"].map(
          (name) => firestore.collection(`${root}/${name}`).get(),
        ),
      );
      // Fail loud: a row we cannot parse would silently vanish from the queue.
      const parsedMembers = members!.docs.map((document) => {
        const parsed = parseMemberRecord(document.data());
        if (!parsed.ok) throw new Error(`Legacy member ${document.id} does not parse`);
        return parsed.value;
      });
      const parsedRecords = records!.docs.map((document) => {
        const parsed = parseStoredRegyfitMemberRecord(document.data());
        if (!parsed.ok) throw new Error(`Archive record ${document.id} does not parse`);
        return parsed.value;
      });
      return {
        members: parsedMembers,
        records: parsedRecords,
        decidedMemberIds: new Set(decisions!.docs.map((document) => document.id)),
        linkedRecordIds: new Set([...officeLinks!.docs, ...memberLinks!.docs].map((document) => document.id)),
      };
    },
  };
}
```

- [ ] **Step 4: Verde y commit**

Run: `corepack pnpm vitest run --project node apps/functions/src/members/member-migration-service.test.ts && corepack pnpm typecheck && corepack pnpm lint`
Expected: PASS y exit 0.

```bash
git add apps/functions/src/members/member-migration-service.ts apps/functions/src/members/member-migration-service.test.ts apps/functions/src/members/member-migration-firestore.ts
git commit -m "feat(members): member migration queue and decision service with safe rejection codes (S1)"
```

---

### Task 5: Callables, exportación y reglas

**Files:**
- Create: `apps/functions/src/members/member-migration-callables.ts`
- Create: `apps/functions/src/members/member-migration-callables.test.ts`
- Modify: `apps/functions/src/index.ts` (junto al bloque que exporta desde `./members/member-directory-callables.js`)
- Modify: `firestore.rules` (junto a `match /academies/{academyId}/regyfitMemberLinks/{recordId}`)
- Create: `qa/rules/member-migration-decisions.test.ts`

**Interfaces:**
- Consumes: `createMemberMigrationService`, `createFirestoreMemberMigrationStore`, `MemberMigrationInputError` (Task 4); `defaultMemberDirectoryCallableServices`, `requireCanonicalMemberDirectoryActor` (existentes).
- Produces: callables `listMemberMigrationQueue` (entrada `null`, respuesta `MemberMigrationQueueResponse`) y `decideMemberMigration` (entrada `{ decisions }`, respuesta `DecideMemberMigrationResult`).

- [ ] **Step 1: Test del handler (rol y errores)**

`member-migration-callables.test.ts` prueba los handlers puros exportados (`listMemberMigrationQueueHandler(actor, service)` y `decideMemberMigrationHandler(actor, data, service)`) con un servicio fake:

```ts
import { describe, expect, it } from "vitest";
import { HttpsError } from "firebase-functions/v2/https";
import { decideMemberMigrationHandler, listMemberMigrationQueueHandler } from "./member-migration-callables.js";
import { MemberMigrationInputError } from "./member-migration-service.js";

const base = { actorId: "u1", academyId: "a1", active: true, appCheckVerified: true };
const service = {
  listQueue: async () => ({ rows: [], archiveOnly: 0, decided: 0 }),
  decide: async (_actor: unknown, data: unknown) => {
    if (data === "bad") throw new MemberMigrationInputError("x");
    return { results: [] };
  },
};

describe("member migration callables", () => {
  it("lets owner and administrator in and keeps coaches out", async () => {
    await expect(listMemberMigrationQueueHandler({ ...base, role: "owner" }, service)).resolves.toMatchObject({ rows: [] });
    await expect(listMemberMigrationQueueHandler({ ...base, role: "administrator" }, service)).resolves.toBeDefined();
    await expect(listMemberMigrationQueueHandler({ ...base, role: "headCoach" }, service)).rejects.toBeInstanceOf(HttpsError);
  });
  it("maps invalid input to invalid-argument", async () => {
    await expect(decideMemberMigrationHandler({ ...base, role: "owner" }, "bad", service)).rejects.toMatchObject({ code: "invalid-argument" });
  });
});
```

Run: `corepack pnpm vitest run --project node apps/functions/src/members/member-migration-callables.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 2: Implementar los callables**

`member-migration-callables.ts`:

```ts
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireCanonicalMemberDirectoryActor } from "./canonical-actor.js";
import type { CanonicalMemberDirectoryActor, OfficeMemberDirectoryService } from "./canonical-member-directory-service.js";
import { defaultMemberDirectoryCallableServices } from "./member-directory-callables.js";
import { createFirestoreMemberMigrationStore } from "./member-migration-firestore.js";
import { createMemberMigrationService, MemberMigrationInputError } from "./member-migration-service.js";

const secrets = [
  defineSecret("MEMBER_DIRECTORY_IDENTITY_KEY_SECRET"),
  defineSecret("MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET"),
  defineSecret("MEMBER_DIRECTORY_CURSOR_SECRET"),
];
type Service = Pick<ReturnType<typeof createMemberMigrationService>, "listQueue" | "decide">;

function requireOffice(actor: CanonicalMemberDirectoryActor): void {
  if (actor.role !== "owner" && actor.role !== "administrator") {
    throw new HttpsError("permission-denied", "Only the office can review the member migration.");
  }
}

export async function listMemberMigrationQueueHandler(actor: CanonicalMemberDirectoryActor, service: Service) {
  requireOffice(actor);
  return service.listQueue(actor);
}

export async function decideMemberMigrationHandler(actor: CanonicalMemberDirectoryActor, data: unknown, service: Service) {
  requireOffice(actor);
  try {
    return await service.decide(actor, data);
  } catch (error) {
    if (error instanceof MemberMigrationInputError) {
      throw new HttpsError("invalid-argument", "Check the decisions and try again.");
    }
    throw new HttpsError("internal", "The migration queue is unavailable. Try again.");
  }
}

function productionService() {
  const services = defaultMemberDirectoryCallableServices();
  return {
    services,
    migration: createMemberMigrationService({
      store: createFirestoreMemberMigrationStore(getFirestore()),
      writer: services.writer as OfficeMemberDirectoryService,
      now: () => new Date().toISOString(),
    }),
  };
}

export const listMemberMigrationQueue = onCall({ ...browserAdminCallableOptions, secrets }, async (request) => {
  const { services, migration } = productionService();
  const actor = await requireCanonicalMemberDirectoryActor(request, services.isActorActive);
  try {
    return await listMemberMigrationQueueHandler(actor, migration);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "The migration queue is unavailable. Try again.");
  }
});

export const decideMemberMigration = onCall({ ...browserAdminCallableOptions, secrets }, async (request) => {
  const { services, migration } = productionService();
  const actor = await requireCanonicalMemberDirectoryActor(request, services.isActorActive);
  return decideMemberMigrationHandler(actor, request.data, migration);
});
```

- [ ] **Step 3: Exportar y reglas**

`apps/functions/src/index.ts`, debajo del bloque que exporta de `./members/member-directory-callables.js`:

```ts
export { decideMemberMigration, listMemberMigrationQueue } from "./members/member-migration-callables.js";
```

`firestore.rules`, justo debajo del bloque de `regyfitMemberLinks`:

```
    match /academies/{academyId}/memberMigrationDecisions/{memberId} {
      allow read, write: if false;
    }
```

`qa/rules/member-migration-decisions.test.ts`, con el mismo arranque que `qa/rules/regyfit-access-records.test.ts` (leer `firestore.rules`, `initializeTestEnvironment`, sembrar con `withSecurityRulesDisabled`, contexto por rol con `authenticatedContext`):

```ts
describe("member migration decisions Firestore boundary", () => {
  it("denies every role, including owner and administrator", async () => {
    for (const role of ["owner", "administrator", "headCoach", "coach", "guardian", "adultStudent"]) {
      const firestore = contextFor(role).firestore();
      await assertFails(getDoc(doc(firestore, `academies/${academyId}/memberMigrationDecisions/m1`)));
      await assertFails(setDoc(doc(firestore, `academies/${academyId}/memberMigrationDecisions/m2`), { kind: "skip" }));
    }
  });
});
```

- [ ] **Step 4: Verde, la guardia muerde, y commit**

Run: `corepack pnpm vitest run --project node apps/functions/src/members/member-migration-callables.test.ts && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test:rules`
Expected: PASS. Luego cambiar temporalmente la regla nueva a `allow read, write: if true;`, ejecutar `corepack pnpm test:rules` y ver que el test nuevo FALLA; restaurar con `git checkout -- firestore.rules` y volver a ejecutarlo en verde. Anotar ese rojo en el commit (`LECCIONES.md` §4).

```bash
git add apps/functions/src/members/member-migration-callables.ts apps/functions/src/members/member-migration-callables.test.ts apps/functions/src/index.ts firestore.rules qa/rules/member-migration-decisions.test.ts
git commit -m "feat(members): list/decide member migration callables, office-only; decisions deny-all in rules (S1)"
```

---

### Task 6: Web — cliente, pantalla de la cola y menú

**Files:**
- Create: `apps/web/src/lib/member-migration-client.ts`, `apps/web/src/lib/member-migration-client.test.ts`
- Create: `apps/web/src/app/admin/members/migration/page.tsx`, `apps/web/src/app/admin/members/migration/migration-queue.tsx`, `apps/web/src/app/admin/members/migration/migration-queue.test.tsx`
- Modify: `apps/web/src/app/admin/admin-shell.tsx` (array del menú de Members, después de `{ label: "Member search", href: "/admin/members/search" },`)

**Interfaces:**
- Consumes: esquemas de Task 1 y los nombres de callable de Task 5.
- Produces: `listMemberMigrationQueue(): Promise<MemberMigrationQueueResponse>`, `decideMemberMigration(decisions): Promise<DecideMemberMigrationResult>`, `memberMigrationErrorMessage(code): string`.

- [ ] **Step 1: Cliente con tests**

`member-migration-client.ts`, siguiendo `member-recovery-client.ts`:

```ts
import { httpsCallable } from "firebase/functions";
import type { z } from "zod";
import {
  decideMemberMigrationInputSchema,
  decideMemberMigrationResultSchema,
  memberMigrationQueueResponseSchema,
  type MemberMigrationRejectionCode,
} from "@bpt-jersey/domain/members/migration";
import { getFirebaseFunctions } from "./firebase-client";

async function call<T>(name: string, input: unknown, schema: z.ZodType<T>): Promise<T> {
  const result = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), name)(input);
  return schema.parse(result.data);
}

export const listMemberMigrationQueue = () =>
  call("listMemberMigrationQueue", null, memberMigrationQueueResponseSchema);

export const decideMemberMigration = (decisions: z.input<typeof decideMemberMigrationInputSchema>["decisions"]) =>
  call("decideMemberMigration", decideMemberMigrationInputSchema.parse({ decisions }), decideMemberMigrationResultSchema);

const messages: Readonly<Record<MemberMigrationRejectionCode, string>> = {
  "unknown-member": "This member is no longer in the legacy list. Refresh the queue.",
  "already-decided": "Someone already decided this member. Refresh the queue.",
  "not-a-candidate": "That record is not a match for this member any more. Refresh the queue.",
  "minor-deferred": "Members under 18 or without a date of birth wait for the guardian step.",
  "record-already-linked": "That record already belongs to another member.",
  "identifier-reserved": "Another member already holds this membership or ID number.",
  "identity-changed": "The archive record changed. Refresh before linking.",
  "write-failed": "Could not save this decision. Try again.",
};
export const memberMigrationErrorMessage = (code: MemberMigrationRejectionCode) => messages[code];
```

`member-migration-client.test.ts`: con `vi.mock("firebase/functions")`, comprobar que `decideMemberMigration([])` lanza (el esquema exige de 1 a 50) sin llamar a `httpsCallable`, y que una respuesta con forma incorrecta hace fallar `listMemberMigrationQueue` (zod). Seguir el patrón de mocks de `apps/web/src/lib/member-recovery-client.test.ts` si existe, o de cualquier `*-client.test.ts` hermano.

- [ ] **Step 2: Pantalla**

`page.tsx`:

```tsx
"use client";

import { useAdminOrStaffSession } from "../../admin-gate";
import { MigrationQueue } from "./migration-queue";
import "../../admin.css";

export default function MemberMigrationPage() {
  const session = useAdminOrStaffSession();
  if (session.role !== "owner" && session.role !== "administrator") {
    return <p className="member-record-hint">Only the office can review the member migration.</p>;
  }
  return <MigrationQueue />;
}
```

`migration-queue.tsx` (componente cliente). Comportamiento que el test exige:
- Carga con `listMemberMigrationQueue()`. Mientras carga muestra "Loading the migration queue…"; si falla, muestra un `role="alert"` con "The migration queue is unavailable. Try again." y nunca el error crudo.
- Pestañas (`role="tab"`) con su contador: `Strong`, `Suggested`, `Ambiguous`, `No match`, `Under 18 / no date` (filas con `isMinor !== false`, sin botones de decisión) y una línea "Only in the archive: N". Las filas con `isMinor !== false` solo aparecen en la pestaña de menores, no en las demás.
- Encima de las pestañas, los controles del lote: un `<select>` "Centre" (Town/West, sin valor por defecto) y tres checkboxes "Morning/Afternoon/Evening". Sin centro o sin al menos una preferencia, los botones de alta están deshabilitados y se muestra "Choose centre and training times first."
- Pestaña Strong: botón "Approve all visible (N)", que envía las filas en trozos de 50 como decisiones `link` al único candidato, con `requestId: crypto.randomUUID()`.
- Cada fila: nombre y fecha de nacimiento del miembro frente a los de cada candidato, más los identificadores enmascarados. Botones "Link to this record" (uno por candidato, `link`), "Create without archive record" (`create-unlinked`) y "Skip…", que pide un motivo en un `<dialog>` con un textarea de 3 a 200 caracteres.
- Tras cada envío: resumen "Applied X · Rejected Y". Cada fila rechazada muestra `memberMigrationErrorMessage(code)` junto a su nombre. Después se recarga la cola.
- Reutilizar las clases y componentes del admin existentes (`admin-panel-card`, `AdminDataTableWrap`, `AdminStatusBadge`) como en `members/search/page.tsx`. Sin estilos nuevos salvo los estrictamente necesarios, en `admin.css`.

`migration-queue.test.tsx` (proyecto `web`), con `vi.mock("../../../../lib/member-migration-client")`:

```tsx
it("approves every strong row in one batch with the chosen training", async () => {
  mocks.listMemberMigrationQueue.mockResolvedValue(queueWith([strongRow("m1", "10"), strongRow("m2", "11")]));
  mocks.decideMemberMigration.mockResolvedValue({ results: [
    { legacyMemberId: "m1", status: "applied", studentId: "s1" },
    { legacyMemberId: "m2", status: "rejected", code: "record-already-linked" },
  ] });
  render(<MigrationQueue />);
  await screen.findByRole("tab", { name: /Strong \(2\)/ });
  expect(screen.getByRole("button", { name: /Approve all visible/ })).toBeDisabled();
  await userEvent.selectOptions(screen.getByLabelText("Centre"), "Town");
  await userEvent.click(screen.getByLabelText("Evening"));
  await userEvent.click(screen.getByRole("button", { name: "Approve all visible (2)" }));
  expect(mocks.decideMemberMigration).toHaveBeenCalledWith([
    expect.objectContaining({ kind: "link", legacyMemberId: "m1", recordId: "10", trainingCenter: "Town", trainingTimePreferences: ["evening"] }),
    expect.objectContaining({ kind: "link", legacyMemberId: "m2", recordId: "11" }),
  ]);
  expect(await screen.findByText("Applied 1 · Rejected 1")).toBeVisible();
  expect(screen.getByText("That record already belongs to another member.")).toBeVisible();
});

it("shows minors without decision buttons", async () => {
  mocks.listMemberMigrationQueue.mockResolvedValue(queueWith([{ ...strongRow("m1", "10"), isMinor: true }]));
  render(<MigrationQueue />);
  await userEvent.click(await screen.findByRole("tab", { name: /Under 18/ }));
  expect(screen.queryByRole("button", { name: "Link to this record" })).toBeNull();
});

it("requires a reason to skip", async () => {
  mocks.listMemberMigrationQueue.mockResolvedValue(queueWith([strongRow("m1", "10")]));
  mocks.decideMemberMigration.mockResolvedValue({ results: [{ legacyMemberId: "m1", status: "applied" }] });
  render(<MigrationQueue />);
  await userEvent.click(await screen.findByRole("button", { name: "Skip…" }));
  const dialog = screen.getByRole("dialog", { hidden: true });
  const reason = within(dialog).getByLabelText("Reason");
  const confirm = within(dialog).getByRole("button", { name: "Skip member" });
  await userEvent.type(reason, "ab");
  expect(confirm).toBeDisabled();
  await userEvent.type(reason, "c");
  await userEvent.click(confirm);
  expect(mocks.decideMemberMigration).toHaveBeenCalledWith([{ kind: "skip", legacyMemberId: "m1", reason: "abc" }]);
});

it("shows a safe alert when the queue fails to load", async () => {
  mocks.listMemberMigrationQueue.mockRejectedValue(new Error("raw backend detail"));
  render(<MigrationQueue />);
  expect(await screen.findByRole("alert")).toHaveTextContent("The migration queue is unavailable. Try again.");
  expect(document.body).not.toHaveTextContent("raw backend detail");
});
```

`queueWith(rows)` y `strongRow(id, recordId)` son helpers locales del test que construyen objetos válidos de `MemberMigrationQueueResponse`. El diálogo de "Skip…" usa `<dialog>`, así que el test sustituye `HTMLDialogElement.prototype.showModal`/`close` como hace `member-calendar.test.tsx`.

- [ ] **Step 3: Menú**

En `admin-shell.tsx`, después de `{ label: "Member search", href: "/admin/members/search" },`:

```ts
{ label: "Member migration", href: "/admin/members/migration" },
```

Si el shell filtra enlaces por rol (los coaches ven un subconjunto, T031V2), este enlace es solo para owner/administrator, igual que Memberships. Comprobarlo en el test existente de `admin-shell` y añadir una aserción de que un coach no ve "Member migration".

- [ ] **Step 4: Verde y commit**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/member-migration-client.test.ts apps/web/src/app/admin/members/migration apps/web/src/app/admin/admin-shell && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm exec prettier --check apps/web/src`
Expected: PASS y exit 0. El test de guardia de la 2a (`qa/unit/no-visible-regyfit-copy.test.ts`) sigue en verde: la copia nueva no menciona Regyfit.

```bash
git add apps/web/src/lib/member-migration-client.ts apps/web/src/lib/member-migration-client.test.ts apps/web/src/app/admin/members/migration apps/web/src/app/admin/admin-shell.tsx apps/web/src/app/admin/admin-shell*.test.tsx
git commit -m "feat(admin): member migration queue — tabs, batch approval with chosen training, safe errors (S1)"
```

---

### Task 7: Scripts de informe y de vuelta atrás

**Files:**
- Create: `qa/scripts/member-unification-s1-report.mjs`, `qa/scripts/member-unification-s1-revert.mjs`
- Create: `qa/unit/member-unification-s1-scripts.test.ts`

**Interfaces:**
- Consumes: `buildMemberMigrationQueue` y `MEMBER_MIGRATION_ID`, importados desde el build del dominio: `../../packages/domain/lib/members/member-migration-contracts.js`, que existe tras `build:runtime`.
- Produces: `resolveTarget(env)` exportada en los dos scripts; `revertPlan(docs)` exportada en el de vuelta atrás.

- [ ] **Step 1: Tests de las partes puras**

```ts
import { describe, expect, it } from "vitest";
import { resolveTarget as reportTarget } from "../scripts/member-unification-s1-report.mjs";
import { resolveTarget as revertTarget, revertConfirmation } from "../scripts/member-unification-s1-revert.mjs";

describe("member unification S1 scripts", () => {
  it("only reach production with the exact project id and never with an emulator host set", () => {
    expect(() => reportTarget({ S1_TARGET: "production", GCLOUD_PROJECT: "other" })).toThrow();
    expect(() => reportTarget({ S1_TARGET: "production", GCLOUD_PROJECT: "bptjersey-f5a25", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" })).toThrow();
    expect(reportTarget({ S1_TARGET: "production", GCLOUD_PROJECT: "bptjersey-f5a25" })).toMatchObject({ projectId: "bptjersey-f5a25" });
    expect(() => reportTarget({ S1_TARGET: "emulator", FIRESTORE_EMULATOR_HOST: "10.0.0.5:8080" })).toThrow();
  });
  it("applies a production revert only with the literal confirmation", () => {
    const base = { S1_TARGET: "production", GCLOUD_PROJECT: "bptjersey-f5a25", S1_REVERT_APPLY: "yes" };
    expect(() => revertTarget(base)).toThrow();
    expect(revertTarget({ ...base, MEMBER_UNIFICATION_CONFIRMATION: revertConfirmation })).toMatchObject({ apply: true });
    expect(revertConfirmation).toBe("member-unification-s1-revert-v1");
  });
});
```

Run: `corepack pnpm vitest run --project node qa/unit/member-unification-s1-scripts.test.ts`
Expected: FAIL (scripts inexistentes).

- [ ] **Step 2: Informe**

`member-unification-s1-report.mjs`: cabecera de uso como en `purge-regyfit-record-passwords.mjs`. `resolveTarget(env)` copia la lógica de `resolvePurgeTarget` con `S1_TARGET` y sin rama de apply. `main()`:

1. Lee `S1_ACADEMY_ID` (obligatorio). Inicializa `firebase-admin` desde `apps/functions`, igual que el script de purga.
2. Lee `members`, `regyfitMemberRecords`, `memberMigrationDecisions`, `regyfitOfficeLinks`, `regyfitMemberLinks` y `memberDirectoryStates/current`.
3. Llama a `buildMemberMigrationQueue` con `today` = fecha UTC actual.
4. Imprime **solo contadores**, un `key: value` por línea: `members`, `archiveRecords`, `decided`, `strong`, `suggested`, `ambiguous`, `none`, `minorOrUndated` (filas con `isMinor !== false`), `archiveOnly`, `invalidLegacyIds` (`memberId` cuyo `toUpperCase` normalizado NFKC no cumple `/^[A-Z0-9][A-Z0-9 ./-]{0,63}$/`), `legacyIdCaseCollisions` (normalizados repetidos), `strongWithoutCentre` (filas `strong` cuyo miembro no tiene `trainingCenter` ∈ Town/West; solo informativo, porque el centro se elige en el lote), `readerVersion`, `rollbackEligibleStudentCount`, `rollbackCapacityLimit`.
5. Nunca imprime nombres, fechas ni identificadores.

- [ ] **Step 3: Vuelta atrás**

`member-unification-s1-revert.mjs`: `resolveTarget(env)` como el de purga (`S1_TARGET`, `S1_REVERT_APPLY=yes` y, para aplicar en producción, `MEMBER_UNIFICATION_CONFIRMATION === revertConfirmation`). `export const revertConfirmation = "member-unification-s1-revert-v1";`.

`revertPlan({ decisions, identityKeys, officeLinks })` es una función pura que devuelve la lista de rutas a borrar:
- por cada decisión con `migrationId === "member-unification-s1-2026-09"` y `studentId`: `students/{studentId}`, `studentAdminProfiles/{studentId}`, `families/office-{studentId}`, las claves de `studentIdentityKeys` con `ownerStudentId === studentId` y los `regyfitOfficeLinks` con `studentId === studentId`;
- el propio documento de decisión (también los `skip`).

Añadir un test de `revertPlan` a `qa/unit/member-unification-s1-scripts.test.ts`: una decisión `link` y una `skip` producen exactamente las rutas esperadas; una decisión con otro `migrationId` no produce ninguna.

`main()`: sin apply, imprime el recuento por tipo de ruta. Con apply, borra en lotes de 400 y vuelve a contar. Nunca toca `members`, `regyfitMemberRecords`, `auditEvents` ni `memberDirectoryStates`. La cabecera del script documenta el límite de `rollbackEligibleStudentCount` que describe la spec.

- [ ] **Step 4: Verde y commit**

Run: `corepack pnpm --filter @bpt-jersey/domain build:runtime && corepack pnpm vitest run --project node qa/unit/member-unification-s1-scripts.test.ts && corepack pnpm lint && corepack pnpm format:check`
Expected: PASS y exit 0.

```bash
git add qa/scripts/member-unification-s1-report.mjs qa/scripts/member-unification-s1-revert.mjs qa/unit/member-unification-s1-scripts.test.ts
git commit -m "feat(qa): S1 read-only report and guarded revert scripts"
```

---

### Task 8: Integración con emuladores y E2E

**Files:**
- Create: `qa/integration/member-migration.test.ts`
- Create: `qa/tests/member-migration.spec.ts`

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: Integración**

`qa/integration/member-migration.test.ts`, con el arranque de `qa/integration/member-recovery.test.ts`: `enabled` solo con `BPT_TEST_INTEGRATION=true` y host loopback, `projectId: "demo-bpt-jersey"`, los mismos secretos de prueba y el plano de control sembrado con `buildInitialMemberDirectoryControlPlane` en `canonical-v1`. Semilla sintética:
- tres miembros: `m1`, adulto con número "42"; `m2`, adulto sin coincidencia; `m3`, menor;
- dos registros de archivo: "10" con número "42" y mismo nombre y fecha que `m1`; "11" solo en el archivo;
- un actor owner aprovisionado como en ese test.

Escenario, con el servicio real (`createCanonicalMemberDirectoryService` + `createMemberMigrationService` + `createFirestoreMemberMigrationStore`):
1. `listQueue`: `m1` es `strong` con candidato "10"; `m2` es `none`; `m3` tiene `isMinor: true`; `archiveOnly: 1`.
2. `decide` con `link m1→10` y `create-unlinked m2`: los dos `applied`.
3. Existen `students/{id}` con perfil `legacy-member-migration` y `legacyMemberId` "M1" (normalizado), `regyfitOfficeLinks/10`, `memberMigrationDecisions/m1` y `/m2`, y una clave `legacy-member-id:*` por alumno.
4. Repetir `link m1→10`: `rejected already-decided`. `create-unlinked m3`: `rejected minor-deferred`.
5. `members` y `regyfitMemberRecords` son idénticos byte a byte a la semilla.
6. `revertPlan` sobre lo escrito, aplicado con el SDK: vuelven a existir 0 `students` con el `migrationId` y 0 decisiones.

Run (dentro del contenedor de emuladores, como en `README.md`): `export FUNCTIONS_DISCOVERY_TIMEOUT=300000 && corepack pnpm test:integration -- qa/integration/member-migration.test.ts`
Expected: PASS. Si los emuladores no están disponibles en este entorno, decirlo en el informe de la tarea: no se marca como pasado.

- [ ] **Step 2: E2E**

`qa/tests/member-migration.spec.ts`, etiquetado `@smoke` solo si los demás specs de admin con callables stubbeados lo están. Stubbea `listMemberMigrationQueue` y `decideMemberMigration` como hacen los specs recientes (commit `205820c`, "stub the notification and public catalogue callables"). Escritorio y móvil:
- la ruta `/admin/members/migration` muestra las pestañas con contadores;
- sin centro, "Approve all visible" está deshabilitado;
- con centro y "Evening", el lote envía decisiones `link` y aparece "Applied 2 · Rejected 0";
- "Skip…" exige motivo;
- sin scroll horizontal a 375 px.

Run: `corepack pnpm --filter @bpt-jersey/web build && corepack pnpm test:e2e:smoke -- qa/tests/member-migration.spec.ts`
Expected: PASS en los proyectos de escritorio y móvil.

- [ ] **Step 3: Commit**

```bash
git add qa/integration/member-migration.test.ts qa/tests/member-migration.spec.ts
git commit -m "test(qa): S1 emulator integration (decide, reject, revert) and queue E2E"
```

---

### Task 9: ADR, runbook, backlog y gate completo

**Files:**
- Modify: `docs/adr/ADR-009-students-canonical-member-directory.md` (sección nueva al final, antes de "Consecuencias" si existe como última sección)
- Create: `docs/operations/member-unification-s1-runbook.md`
- Modify: `BACKLOG.md` (fila C1)

- [ ] **Step 1: Enmienda de la ADR**

Sección "## Enmienda 2026-09-19: migración dirigida por decisiones (S1)", con este contenido:
- Para `demo-academy`, los `students` que vienen de `members` se crean por decisiones de la cola de `/admin/members/migration` (callables `listMemberMigrationQueue` y `decideMemberMigration`), sobre el alta canónica `createAdult`, en lugar del forward executor por lotes.
- Las reglas 9 y 10 se mantienen: automático solo con identificador fuerte idéntico, que sigue siendo una decisión explícita del admin; los menores quedan para S1b.
- Cada alta lleva `source: legacy-member-migration`, `migrationId: member-unification-s1-2026-09`, una clave `legacy-member-id` y `memberMigrationDecisions/{memberId}` (create-only).
- Los ejecutores bootstrap y forward ya construidos quedan sin uso y no se borran.
- T108 se cierra como "sustituida por S1" al verificar el conteo final.

- [ ] **Step 2: Runbook**

`docs/operations/member-unification-s1-runbook.md`, en español y con el formato de la regla de oro del operador: resumen, pasos numerados de una sola acción, comando completo copy-paste, **dónde se ejecuta cada comando** (📍 Terminal del VPS · root · `/root/BPT-Jersey`), salida esperada y ⚠️ antes de lo peligroso:
1. Informe de solo lectura en producción. El comando lleva `GOOGLE_APPLICATION_CREDENTIALS="$(ls /root/secrets/*adminsdk*.json)"`, `GCLOUD_PROJECT=bptjersey-f5a25`, `S1_TARGET=production` y `S1_ACADEMY_ID=demo-academy`, en una línea corta. Condiciones para seguir: `invalidLegacyIds: 0`, `legacyIdCaseCollisions: 0`, `readerVersion: canonical-v1` y `rollbackEligibleStudentCount + strong + suggested + none` < `rollbackCapacityLimit`.
2. ⚠️ Deploy selectivo de las dos funciones más la web. El operador lo ejecuta tras confirmar. Nunca un deploy total: `selfCheckIn` sigue sin desplegar a propósito.
3. Uso de la cola.
4. Conteo de verificación.
5. ⚠️ Vuelta atrás: dry-run y apply con la confirmación literal, y su límite.

- [ ] **Step 3: Backlog**

En `BACKLOG.md`, fila C1: estado `en-progreso` y, al final del texto de la tarea, "S1 (identidad, adultos) en `docs/superpowers/specs/2026-09-19-member-unification-s1-identity-design.md`; S1b menores; S2 histórico; S3 ficha viva; S4 retirar visor."

- [ ] **Step 4: Gate completo y commit**

Run: `corepack pnpm --filter @bpt-jersey/domain build:runtime && corepack pnpm format:check && corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test && corepack pnpm test:rules && corepack pnpm --filter @bpt-jersey/web build`
Expected: todo en verde. Anotar el total de tests frente a la línea base (372 archivos / 4.051 tests).

```bash
git add docs/adr/ADR-009-students-canonical-member-directory.md docs/operations/member-unification-s1-runbook.md BACKLOG.md
git commit -m "docs: ADR-009 decision-driven migration amendment, S1 runbook, backlog C1 in progress"
```

---

## Fuera de este plan

Ejecutar el informe en producción, el deploy y las decisiones reales: son pasos del operador, con el runbook de la Task 9 y su confirmación explícita en el chat. S1b (menores), S2, S3 y S4 tienen spec propia.
