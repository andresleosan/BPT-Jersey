import { createHash } from "node:crypto";

import {
  canonicaliseMembershipNumber,
  membershipNumberPlanPayloadSchema,
  membershipNumberPlanSchema,
  nextMonotonicMembershipNumber,
  type MembershipNumberPlan,
  type MembershipNumberPlanRow,
  type MembershipNumberSourceKind,
} from "@bpt-jersey/domain/members/membership-number";
import { z } from "zod";

const opaqueIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const sourceRowSchema = z
  .strictObject({
    recordRef: z
      .string()
      .regex(/^(?:studentAdminProfiles|members)\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u, {
        message: "Invalid record reference",
      }),
    sourceKind: z.enum(["canonical", "legacy"]),
    ownerId: opaqueIdSchema,
    sourceVersion: z
      .string()
      .min(1)
      .max(128)
      .refine((value) => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value)),
    membershipNumber: z.string().max(64),
  })
  .readonly();

const inputSchema = z
  .strictObject({
    academyId: opaqueIdSchema,
    generatedAt: z.string(),
    rows: z.array(sourceRowSchema).max(100_000).readonly(),
  })
  .readonly();

export type MembershipNumberSourceRow = Readonly<z.infer<typeof sourceRowSchema>>;
export type BuildMembershipNumberReconciliationPlanInput = Readonly<z.infer<typeof inputSchema>>;

type PreparedRow = Readonly<{
  row: MembershipNumberSourceRow;
  canonical: string | null;
}>;

function maskCanonical(value: string): string {
  return `****${value.padStart(4, "*").slice(-4)}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Plan payload contains an unsafe number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("Plan payload contains unsupported data");
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function winnerOrder(left: PreparedRow, right: PreparedRow): number {
  const leftAlreadyCanonical = left.canonical === left.row.membershipNumber;
  const rightAlreadyCanonical = right.canonical === right.row.membershipNumber;
  if (leftAlreadyCanonical !== rightAlreadyCanonical) return leftAlreadyCanonical ? -1 : 1;
  if (left.row.sourceKind !== right.row.sourceKind) {
    return left.row.sourceKind === "canonical" ? -1 : 1;
  }
  return compareText(left.row.recordRef, right.row.recordRef);
}

function comparePlanRows(left: MembershipNumberPlanRow, right: MembershipNumberPlanRow): number {
  if (left.proposed !== undefined && right.proposed !== undefined) {
    const numberOrder = Number(left.proposed) - Number(right.proposed);
    if (numberOrder !== 0) return numberOrder;
  } else if (left.proposed !== undefined) {
    return -1;
  } else if (right.proposed !== undefined) {
    return 1;
  }
  return compareText(left.recordRef, right.recordRef);
}

export function buildMembershipNumberReconciliationPlan(
  input: BuildMembershipNumberReconciliationPlanInput,
): MembershipNumberPlan {
  const parsed = inputSchema.parse(input);
  const rows = [...parsed.rows].sort((left, right) => compareText(left.recordRef, right.recordRef));
  const recordRefs = new Set<string>();
  const ownerIds = new Set<string>();
  for (const row of rows) {
    if (recordRefs.has(row.recordRef)) throw new Error("Duplicate record reference");
    if (ownerIds.has(row.ownerId)) throw new Error("Duplicate owner ID");
    recordRefs.add(row.recordRef);
    ownerIds.add(row.ownerId);
  }

  const prepared: PreparedRow[] = rows.map((row) => {
    const result = canonicaliseMembershipNumber(row.membershipNumber);
    return { row, canonical: result.ok ? result.value : null };
  });
  const groups = new Map<string, PreparedRow[]>();
  for (const current of prepared) {
    if (current.canonical === null) continue;
    const group = groups.get(current.canonical) ?? [];
    group.push(current);
    groups.set(current.canonical, group);
  }

  let nextAvailable: number | undefined;
  const allocate = (): string => {
    if (nextAvailable === undefined) {
      nextAvailable = Number(
        nextMonotonicMembershipNumber(prepared.map(({ row }) => row.membershipNumber)),
      );
    }
    if (nextAvailable > 999_999_999) {
      throw new RangeError("Membership number sequence is exhausted");
    }
    const allocated = String(nextAvailable);
    nextAvailable += 1;
    return allocated;
  };

  const plannedRows: MembershipNumberPlanRow[] = [];
  for (const [canonical, group] of [...groups.entries()].sort(
    ([left], [right]) => Number(left) - Number(right),
  )) {
    const ordered = [...group].sort(winnerOrder);
    ordered.forEach((current, index) => {
      const proposed = index === 0 ? canonical : allocate();
      plannedRows.push({
        recordRef: current.row.recordRef,
        sourceKind: current.row.sourceKind as MembershipNumberSourceKind,
        ownerId: current.row.ownerId,
        sourceVersion: current.row.sourceVersion,
        currentMasked: maskCanonical(canonical),
        action:
          index > 0
            ? "reassign"
            : current.row.membershipNumber === canonical
              ? "already_canonical"
              : "canonicalise",
        proposed,
      });
    });
  }
  for (const current of prepared) {
    if (current.canonical !== null) continue;
    plannedRows.push({
      recordRef: current.row.recordRef,
      sourceKind: current.row.sourceKind as MembershipNumberSourceKind,
      ownerId: current.row.ownerId,
      sourceVersion: current.row.sourceVersion,
      currentMasked: "****",
      action: "manual_review",
    });
  }

  const payload = membershipNumberPlanPayloadSchema.parse({
    academyId: parsed.academyId,
    generatedAt: parsed.generatedAt,
    rows: plannedRows.sort(comparePlanRows),
    schemaVersion: "1",
  });
  const contentHash = createHash("sha256").update(canonicalJson(payload)).digest("hex");
  const plan = membershipNumberPlanSchema.parse({ ...payload, contentHash });
  return Object.freeze({
    ...plan,
    rows: Object.freeze(plan.rows.map((row) => Object.freeze(row))),
  });
}
