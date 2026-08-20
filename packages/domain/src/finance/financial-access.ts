import { membershipStatuses, type MembershipStatus } from "../memberships/membership-contracts";

export type FinancialAccessInput = Readonly<{
  membershipStatus: MembershipStatus;
  paygDebtMinor: number;
}>;

export type FinancialAccessDenialCode =
  "INVALID_INPUT" | "PAYG_DEBT_OUTSTANDING" | "MEMBERSHIP_NOT_ACCESSIBLE";

export type FinancialAccessDecision =
  | Readonly<{
      allowed: true;
      code: "ALLOWED";
      membershipStatus: MembershipStatus;
      paygDebtMinor: number;
    }>
  | Readonly<{
      allowed: false;
      code: FinancialAccessDenialCode;
      membershipStatus: MembershipStatus | null;
      paygDebtMinor: number;
    }>;

const policyFields = Object.freeze(["membershipStatus", "paygDebtMinor"] as const);
const accessibleMembershipStatuses = Object.freeze(["trial", "active"] as const);

function invalidDecision(): FinancialAccessDecision {
  return Object.freeze({
    allowed: false,
    code: "INVALID_INPUT",
    membershipStatus: null,
    paygDebtMinor: 0,
  });
}

function readExactFields(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const fields = new Map<string, PropertyDescriptor>();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor =
      typeof key === "string" ? Object.getOwnPropertyDescriptor(value, key) : undefined;
    if (
      typeof key !== "string" ||
      !policyFields.includes(key as (typeof policyFields)[number]) ||
      descriptor?.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value")
    ) {
      return undefined;
    }
    fields.set(key, descriptor);
  }

  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of policyFields) {
    const descriptor = fields.get(field);
    if (descriptor === undefined) return undefined;
    snapshot[field] = descriptor.value;
  }
  return snapshot;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function evaluateFinancialAccess(input: unknown): FinancialAccessDecision {
  try {
    if (!isPlainRecord(input)) return invalidDecision();
    const fields = readExactFields(input);
    if (fields === undefined) return invalidDecision();

    const membershipStatus = fields.membershipStatus;
    const paygDebtMinor = fields.paygDebtMinor;
    if (
      !membershipStatuses.includes(membershipStatus as MembershipStatus) ||
      typeof paygDebtMinor !== "number" ||
      !Number.isSafeInteger(paygDebtMinor) ||
      paygDebtMinor < 0
    ) {
      return invalidDecision();
    }

    const validMembershipStatus = membershipStatus as MembershipStatus;
    const validDebt = paygDebtMinor;
    if (!accessibleMembershipStatuses.includes(validMembershipStatus as never)) {
      return Object.freeze({
        allowed: false,
        code: "MEMBERSHIP_NOT_ACCESSIBLE",
        membershipStatus: validMembershipStatus,
        paygDebtMinor: validDebt,
      });
    }
    if (validDebt > 0) {
      return Object.freeze({
        allowed: false,
        code: "PAYG_DEBT_OUTSTANDING",
        membershipStatus: validMembershipStatus,
        paygDebtMinor: validDebt,
      });
    }
    return Object.freeze({
      allowed: true,
      code: "ALLOWED",
      membershipStatus: validMembershipStatus,
      paygDebtMinor: validDebt,
    });
  } catch {
    return invalidDecision();
  }
}
