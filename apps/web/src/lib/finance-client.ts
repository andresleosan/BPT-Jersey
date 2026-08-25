import {
  isFinancialDashboard,
  type FinancialDashboard,
} from "@bpt-jersey/domain/finance/dashboard";
import { httpsCallable } from "firebase/functions";

import { getFirebaseFunctions } from "./firebase-client";

const safeFinancialDashboardError =
  "Unable to load the financial dashboard. Please try again.";

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
