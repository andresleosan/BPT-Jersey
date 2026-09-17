"use client";

import Link from "next/link";

import type { MemberRecordTab } from "@bpt-jersey/domain/members/profile";

export type RecordEmptyTabKey = Exclude<MemberRecordTab, "profile" | "details">;

type LinkedEmptyTab = Readonly<{
  eyebrow: string;
  headline: string;
  sentence: string;
  action: string;
  href: (studentId: string) => string;
}>;

const linkedTabs: Readonly<Record<Exclude<RecordEmptyTabKey, "notes">, LinkedEmptyTab>> = {
  plan: {
    eyebrow: "Plan",
    headline: "Plan history is on its way",
    sentence: "Until then, Memberships shows this member's current plan and lets you change it.",
    action: "Open Memberships",
    href: (studentId) => `/admin/memberships?studentId=${encodeURIComponent(studentId)}`,
  },
  documents: {
    eyebrow: "Documents",
    headline: "Documents are on their way",
    sentence: "Signed waivers are managed in Waivers for now.",
    action: "Open Waivers",
    href: () => "/admin/waivers",
  },
  payments: {
    eyebrow: "Payments",
    headline: "Payments are on their way",
    sentence: "Invoices and payments for this member are in Billing for now.",
    action: "Open Billing",
    href: () => "/admin/billing",
  },
  classes: {
    eyebrow: "Classes",
    headline: "Class history is on its way",
    sentence: "Attendance shows who trained in each session for now.",
    action: "Open Attendance",
    href: () => "/admin/attendance",
  },
  communication: {
    eyebrow: "Communication",
    headline: "Communication log is on its way",
    sentence: "Follow-ups and contact history are kept in CRM for now.",
    action: "Open CRM",
    href: () => "/admin/crm",
  },
};

/** DESIGN.md empty state: eyebrow + headline + one sentence + one button. */
export function RecordEmptyTab({
  tab,
  studentId,
  canOpenDetails,
  onOpenDetails,
}: {
  tab: RecordEmptyTabKey;
  studentId: string;
  canOpenDetails: boolean;
  onOpenDetails: () => void;
}) {
  if (tab === "notes") {
    return (
      <section className="member-record-empty" aria-labelledby="record-empty-notes">
        <p className="admin-eyebrow">Notes</p>
        <h3 id="record-empty-notes">Internal notes live in Details</h3>
        <p>Office notes are part of the member&apos;s details and are never shown to the member.</p>
        {canOpenDetails ? (
          <button className="member-record-button" onClick={onOpenDetails} type="button">
            Open Details
          </button>
        ) : (
          /* Never a dead end (DESIGN.md §4): a viewer without DETAILS still gets one way out. */
          <Link className="member-record-link" href="/admin/members">
            Open Members
          </Link>
        )}
      </section>
    );
  }
  const content = linkedTabs[tab];
  return (
    <section className="member-record-empty" aria-labelledby={`record-empty-${tab}`}>
      <p className="admin-eyebrow">{content.eyebrow}</p>
      <h3 id={`record-empty-${tab}`}>{content.headline}</h3>
      <p>{content.sentence}</p>
      <Link className="member-record-link" href={content.href(studentId)}>
        {content.action}
      </Link>
    </section>
  );
}
