"use client";

import Link from "next/link";
import type { MemberOverviewRow } from "@bpt-jersey/domain/members/overview";
import { recordHref } from "./profile/member-record";

/** One card per guardian: only the minors that account (or office contact) looks after. */
export function FamiliesView({ rows }: { rows: readonly MemberOverviewRow[] }) {
  const families = new Map<string, { online: boolean; members: MemberOverviewRow[] }>();
  // Adults (including a self-registered member who is their own contact) are not children here.
  const children = rows.filter(
    (row) => row.guardian && (row.ageBand === "kids" || row.ageBand === "teens"),
  );
  for (const row of children) {
    if (!row.guardian) continue;
    const key = row.guardian.fullName;
    const family = families.get(key) ?? { online: row.guardian.online, members: [] };
    family.members.push(row);
    families.set(key, family);
  }
  const list = [...families.entries()].sort(([a], [b]) => a.localeCompare(b, "en-GB"));
  if (list.length === 0) {
    return (
      <p aria-live="polite" className="admin-no-results" role="status">
        No guardians with registered children yet. Assign a guardian from Data review or approve a
        family request in Enrolment requests.
      </p>
    );
  }
  return (
    <section className="admin-panel-card" aria-label="Families">
      <p className="members-count" role="status">
        {list.length} guardians · {children.length} children. Family operations live in{" "}
        <Link href="/admin/families">Families and minors</Link>.
      </p>
      <ul className="members-family-list">
        {list.map(([guardian, family]) => (
          <li key={guardian} className="members-family">
            <div className="members-cell">
              <strong>{guardian}</strong>
              <span className="members-cell-detail">
                {family.online ? "Online access" : "Office contact only"} · {family.members.length}{" "}
                profiles
              </span>
            </div>
            <ul className="members-family-members">
              {family.members.map((row) => (
                <li key={row.studentId}>
                  <Link className="member-record-link" href={recordHref(row.studentId)}>
                    {row.fullName}
                  </Link>
                  <span className="members-cell-detail">
                    {row.age === undefined ? "Age unknown" : `${row.age} years`} ·{" "}
                    {row.trainingCenter} ·{" "}
                    {row.planState === "current" || row.planState === "expiring"
                      ? "Current plan"
                      : row.planState === "trial"
                        ? "Free Trial"
                        : row.planState === "trial-ended"
                          ? "Trial ended"
                          : "Needs Plan Renovation"}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
