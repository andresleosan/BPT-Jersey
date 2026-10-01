import {
  financialDashboardSchema,
  type FinancialDashboard,
} from "@bpt-jersey/domain/finance/dashboard";
import { httpsCallable } from "./callable";

import { parseFinancialAccount, type FinancialAccount } from "./billing-client";
import { getFirebaseFunctions } from "./firebase-client";

const safeFinancialDashboardError =
  "Unable to load the financial dashboard. Please try again.";
const safeFamilyAccountError = "Unable to load this family's account. Please try again.";
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const callableOptions = Object.freeze({ limitedUseAppCheckTokens: true });

export async function getFinancialDashboard(month?: string): Promise<FinancialDashboard> {
  const callable = httpsCallable<{ month: string } | null, { dashboard: unknown }>(
    getFirebaseFunctions(),
    "getFinancialDashboard",
  );

  try {
    const response = await callable(month === undefined ? null : { month });
    const parsed = financialDashboardSchema.safeParse(response.data.dashboard);
    if (!parsed.success) throw new Error(safeFinancialDashboardError);
    return parsed.data;
  } catch {
    throw new Error(safeFinancialDashboardError);
  }
}

export async function getFamilyFinancialAccount(familyId: string): Promise<FinancialAccount> {
  try {
    if (!identifierPattern.test(familyId)) throw new Error(safeFamilyAccountError);
    const callable = httpsCallable<{ familyId: string }, unknown>(
      getFirebaseFunctions(),
      "getFamilyFinancialAccount",
      callableOptions,
    );
    const response = await callable({ familyId });
    return parseFinancialAccount(response.data);
  } catch {
    throw new Error(safeFamilyAccountError);
  }
}
