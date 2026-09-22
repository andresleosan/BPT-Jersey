import {
  enrolmentTrialAllowance,
  getEnrolmentPlans,
  trialPlanChoice,
  type EnrolmentLevelDeclaration,
  type EnrolmentPlanChoice,
} from "@bpt-jersey/domain/members/enrolment-requests";
import type { Site } from "@bpt-jersey/domain/memberships";
import type { LevelDefinitionRecord } from "@bpt-jersey/domain/levels";
import { describePlanAccess, formatPlanPrice } from "../../lib/plan-copy";
import { LevelDeclaration } from "./level-declaration";

export function EnrolmentPlanChoices({
  id,
  fullName,
  dateOfBirth,
  trainingCenter,
  effectiveDate,
  selectedPlan,
  declaration,
  onDeclarationChange,
  age,
  definitions,
  disabled,
  onChange,
}: Readonly<{
  id: string;
  fullName: string;
  dateOfBirth: string;
  trainingCenter: Site;
  effectiveDate: string;
  selectedPlan: EnrolmentPlanChoice | "";
  declaration: EnrolmentLevelDeclaration;
  onDeclarationChange: (next: EnrolmentLevelDeclaration) => void;
  age: number;
  definitions: readonly LevelDefinitionRecord[];
  disabled: boolean;
  onChange: (plan: EnrolmentPlanChoice) => void;
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
      {/*
        The free trial comes first and is the choice nobody has to make: somebody who has never
        trained finds their own option at the top instead of guessing at a plan. What they declare
        here only decides how many free classes they are offered — the office confirms the level.
      */}
      <label className="enrol-plan-option">
        <input
          type="radio"
          name={`enrol-plan-${id}`}
          value={trialPlanChoice}
          checked={selectedPlan === trialPlanChoice}
          onChange={() => onChange(trialPlanChoice)}
          aria-describedby={`enrol-plan-${id}-trial-access`}
        />
        <span>
          <strong>I am a beginner</strong>
          <span className="enrol-plan-access" id={`enrol-plan-${id}-trial-access`}>
            {enrolmentTrialAllowance(declaration.experience) === 2
              ? "Trial: 2 free Introduction Classes"
              : "Trial: 1 free Introduction Class"}
          </span>
        </span>
      </label>
      <LevelDeclaration
        id={`enrol-plan-${id}-level`}
        age={age}
        definitions={definitions}
        value={declaration}
        disabled={disabled}
        onChange={onDeclarationChange}
      />
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
