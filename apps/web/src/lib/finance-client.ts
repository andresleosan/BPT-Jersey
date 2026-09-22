import {
  isFinancialDashboard,
  type FinancialDashboard,
} from "@bpt-jersey/domain/finance/dashboard";
import { isRecentPaymentRow, type RecentPaymentRow } from "@bpt-jersey/domain/finance";
import { httpsCallable } from "./callable";

import { parseFinancialAccount, type FinancialAccount } from "./billing-client";
import { getFirebaseFunctions } from "./firebase-client";

const safeFinancialDashboardError =
  "Unable to load the financial dashboard. Please try again.";
const safeRecentPaymentsError = "Unable to load recent payments. Please try again.";
const safeFamilyAccountError = "Unable to load this family's account. Please try again.";
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const callableOptions = Object.freeze({ limitedUseAppCheckTokens: true });

export async function getFinancialDashboard(): Promise<FinancialDashboard> {
  const callable = httpsCallable<null, { dashboard: unknown }>(
    getFirebaseFunctions(),
    "getFinancialDashboard",
  );

  try {
    const response = await callable(null);
    if (!isFinancialDashboard(response.data.dashboard)) {
      throw new Error(safeFinancialDashboardError);
    }
    return response.data.dashboard;
  } catch {
    throw new Error(safeFinancialDashboardError);
  }
}

export async function listRecentPayments(): Promise<readonly RecentPaymentRow[]> {
  try {
    const callable = httpsCallable<null, { payments: unknown }>(
      getFirebaseFunctions(),
      "listRecentPayments",
      callableOptions,
    );
    const response = await callable(null);
    const payments = response.data.payments;
    if (!Array.isArray(payments) || !payments.every(isRecentPaymentRow)) {
      throw new Error(safeRecentPaymentsError);
    }
    return Object.freeze([...payments]);
  } catch {
    throw new Error(safeRecentPaymentsError);
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
