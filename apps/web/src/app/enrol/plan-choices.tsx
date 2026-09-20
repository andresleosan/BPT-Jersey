import { getEnrolmentPlans } from "@bpt-jersey/domain/members/enrolment-requests";
import type { PlanId, Site } from "@bpt-jersey/domain/memberships";
import { describePlanAccess, formatPlanPrice } from "../../lib/plan-copy";

export function EnrolmentPlanChoices({
  id,
  fullName,
  dateOfBirth,
  trainingCenter,
  effectiveDate,
  selectedPlan,
  disabled,
  onChange,
}: Readonly<{
  id: string;
  fullName: string;
  dateOfBirth: string;
  trainingCenter: Site;
  effectiveDate: string;
  selectedPlan: PlanId | "";
  disabled: boolean;
  onChange: (plan: PlanId) => void;
}>) {
  const plans = getEnrolmentPlans(dateOfBirth, trainingCenter, effectiveDate);
  const recommended =
    plans.find((plan) => plan.classSites.length === 1 && plan.billingPeriod !== "per-session") ??
    plans[0];
  return (
    <fieldset className="enrol-plan-choices" disabled={disabled}>
      <legend>
        {fullName.trim()} · {trainingCenter}
      </legend>
      {plans.length === 0 ? (
        <p role="alert">
          No plans are available for these details. Go back and check the date of birth and training
          centre.
        </p>
      ) : (
        plans.map((plan) => (
          <label className="enrol-plan-option" key={plan.planId}>
            <input
              type="radio"
              name={`enrol-plan-${id}`}
              value={plan.planId}
              checked={selectedPlan === plan.planId}
              onChange={() => onChange(plan.planId)}
              aria-describedby={`enrol-plan-${id}-${plan.planId}-access`}
            />
            <span>
              <strong>{plan.displayName}</strong>
              {plan.planId === recommended?.planId ? (
                <span className="enrol-plan-access">
                  Suggested for your age group and {trainingCenter} training centre
                </span>
              ) : null}
              <span className="enrol-plan-access" id={`enrol-plan-${id}-${plan.planId}-access`}>
                {describePlanAccess(plan)}
              </span>
              <span className="enrol-plan-price">{formatPlanPrice(plan)}</span>
              {plan.billingPeriod === "per-session" ? (
                <span className="enrol-plan-access">
                  No payment or screenshot required at registration. Pay when you attend.
                </span>
              ) : null}
            </span>
          </label>
        ))
      )}
    </fieldset>
  );
}
