import {
  parseMembershipRecord,
  type MembershipRecord,
  type MembershipStatus,
} from "@bpt-jersey/domain/memberships/lifecycle";
import {
  evaluateFinancialAccess,
  type FinancialAccessDecision,
} from "@bpt-jersey/domain/finance/access";

import type { MembershipStore } from "../memberships/membership-service.js";
import type { FinancialAccountView, FinanceStore } from "./finance-service.js";

export type FinancialAccessServiceInput = Readonly<{
  academyId: string;
  membershipId: string;
}>;

export type FinancialAccessView = Readonly<{
  academyId: string;
  membershipId: string;
  studentId: string;
  membershipStatus: MembershipStatus;
  paygDebtMinor: number;
  decision: FinancialAccessDecision;
}>;

export type FinancialAccessServiceDependencies = Readonly<{
  getMembership: MembershipStore["getMembership"];
  listFinancialAccount: FinanceStore["listFinancialAccount"];
}>;

export type FinancialAccessService = Readonly<{
  getAccessDecision: (input: FinancialAccessServiceInput) => Promise<FinancialAccessView>;
}>;

export class FinancialAccessServiceError extends Error {
  public readonly code: "invalid" | "not-found" | "tenant" | "transaction";

  public constructor(code: "invalid" | "not-found" | "tenant" | "transaction", message: string) {
    super(message);
    this.name = "FinancialAccessServiceError";
    this.code = code;
  }
}

const safePathSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const invalidRequestMessage = "Financial access request is invalid";
const unavailableMessage = "Financial access is not available";
const invalidDataMessage = "Financial access data is invalid";
const transactionMessage = "Financial access could not be evaluated";

function pathSegment(value: unknown): string {
  if (typeof value !== "string" || !safePathSegmentPattern.test(value)) {
    throw new FinancialAccessServiceError("invalid", invalidRequestMessage);
  }
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function storedMembership(value: unknown): MembershipRecord {
  const parsed = parseMembershipRecord(value);
  if (!parsed.ok) throw new FinancialAccessServiceError("invalid", invalidDataMessage);
  return parsed.value;
}

function financialAccount(value: unknown): FinancialAccountView {
  if (!isPlainRecord(value)) {
    throw new FinancialAccessServiceError("invalid", invalidDataMessage);
  }

  const fields = ["invoices", "balanceMinor", "paygDebtMinor"] as const;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor =
      typeof key === "string" ? Object.getOwnPropertyDescriptor(value, key) : undefined;
    if (
      typeof key !== "string" ||
      !fields.includes(key as (typeof fields)[number]) ||
      descriptor?.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value")
    ) {
      throw new FinancialAccessServiceError("invalid", invalidDataMessage);
    }
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (
      descriptor?.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value")
    ) {
      throw new FinancialAccessServiceError("invalid", invalidDataMessage);
    }
  }

  const invoices = value.invoices;
  const balanceMinor = value.balanceMinor;
  const paygDebtMinor = value.paygDebtMinor;
  if (
    !Array.isArray(invoices) ||
    typeof balanceMinor !== "number" ||
    !Number.isSafeInteger(balanceMinor) ||
    balanceMinor < 0 ||
    typeof paygDebtMinor !== "number" ||
    !Number.isSafeInteger(paygDebtMinor) ||
    paygDebtMinor < 0
  ) {
    throw new FinancialAccessServiceError("invalid", invalidDataMessage);
  }

  return value as FinancialAccountView;
}

function knownServiceError(error: unknown): error is FinancialAccessServiceError {
  return error instanceof FinancialAccessServiceError;
}

export function createFinancialAccessService(
  dependencies: FinancialAccessServiceDependencies,
): FinancialAccessService {
  async function getAccessDecision(
    input: FinancialAccessServiceInput,
  ): Promise<FinancialAccessView> {
    try {
      const academyId = pathSegment(input?.academyId);
      const membershipId = pathSegment(input?.membershipId);
      const membership = await dependencies.getMembership(
        { academyId, membershipIds: [membershipId] },
        membershipId,
      );
      if (membership === undefined) {
        throw new FinancialAccessServiceError("not-found", unavailableMessage);
      }

      const stored = storedMembership(membership);
      if (stored.academyId !== academyId || stored.membershipId !== membershipId) {
        throw new FinancialAccessServiceError("tenant", unavailableMessage);
      }

      const account = financialAccount(
        await dependencies.listFinancialAccount({
          academyId,
          familyIds: [stored.familyId],
          studentIds: [stored.studentId],
        }),
      );
      const decision = evaluateFinancialAccess({
        membershipStatus: stored.status,
        paygDebtMinor: account.paygDebtMinor,
      });
      if (decision.code === "INVALID_INPUT") {
        throw new FinancialAccessServiceError("invalid", invalidDataMessage);
      }

      return Object.freeze({
        academyId,
        membershipId,
        studentId: stored.studentId,
        membershipStatus: stored.status,
        paygDebtMinor: account.paygDebtMinor,
        decision,
      });
    } catch (error) {
      if (knownServiceError(error)) throw error;
      throw new FinancialAccessServiceError("transaction", transactionMessage);
    }
  }

  return Object.freeze({ getAccessDecision });
}
