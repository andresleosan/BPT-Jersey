import { administrativePlanIds, parsePlanDraft, type PlanDraft } from "@bpt-jersey/domain/memberships";
import { httpsCallable } from "./callable";

import { listMemberships, type AdminMembership } from "./membership-admin-client";
import { getFirebaseFunctions } from "./firebase-client";

export type ClientMembership = AdminMembership;
export type AvailableMembershipPlan = PlanDraft;

const loadPlansError = "Unable to load membership plans. Please try again.";

export async function listAvailableMembershipPlans(
  options: Readonly<{ includeAdministrative?: boolean }> = {},
): Promise<readonly AvailableMembershipPlan[]> {
  try {
    const callable = httpsCallable<null, unknown>(getFirebaseFunctions(), "listPlans");
    const response = await callable(null);
    if (!Array.isArray(response.data)) throw new Error(loadPlansError);
    return Object.freeze(
      response.data
        .map((value) => {
          const parsed = parsePlanDraft(value);
          if (!parsed.ok) throw new Error(loadPlansError);
          return parsed.value;
        })
        .filter(
          (plan) =>
            options.includeAdministrative || !administrativePlanIds.includes(plan.planId),
        ),
    );
  } catch {
    throw new Error(loadPlansError);
  }
}

export async function listClientMemberships(): Promise<readonly ClientMembership[]> {
  return listMemberships();
}
