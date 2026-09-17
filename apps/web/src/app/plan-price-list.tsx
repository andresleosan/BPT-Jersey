import type { Site } from "@bpt-jersey/domain/memberships";
import type { ReactElement } from "react";

import { describePlanAccess, formatPlanPrice, publicPlanGroups } from "../lib/plan-copy";

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
    </div>
  );
}
