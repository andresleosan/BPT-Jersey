import type { Site } from "@bpt-jersey/domain/memberships";
import type { ReactElement } from "react";

import {
  describePlanAccess,
  formatPlanPrice,
  privateLessonPriceLabel,
  publicPlanGroups,
} from "../lib/plan-copy";

export function PlanPriceList({ site }: Readonly<{ site?: Site }>): ReactElement {
  return (
    <div className="plan-price-list">
      {publicPlanGroups(site).map((group) => {
        const headingId = `plans-${group.title.replace(/\W+/gu, "-").toLowerCase()}`;
        return (
          <section aria-labelledby={headingId} key={group.title}>
            <h3 id={headingId}>{group.title}</h3>
            <ul>
              {group.plans.map((plan) => (
                <li className="plan-price-row" key={plan.planId}>
                  <div>
                    <strong>{plan.displayName}</strong>
                    <span>{describePlanAccess(plan)}</span>
                  </div>
                  <p className="plan-price-amount">{formatPlanPrice(plan)}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <section aria-labelledby="plans-private-lessons">
        <h3 id="plans-private-lessons">Private lessons</h3>
        <ul>
          <li className="plan-price-row">
            <div>
              <strong>Private lessons</strong>
              <span>One-to-one, ages 16 and over. Arranged with the office.</span>
            </div>
            <p className="plan-price-amount">
              {`${privateLessonPriceLabel("single")} one lesson · ${privateLessonPriceLabel("monthly")} for 4 · ${privateLessonPriceLabel("pack-10")} for 10`}
            </p>
          </li>
        </ul>
      </section>
    </div>
  );
}
