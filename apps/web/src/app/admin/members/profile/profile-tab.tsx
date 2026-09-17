"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import type { FullMemberProfile, MemberProfile } from "@bpt-jersey/domain/members/profile";

import { formatRecordDate } from "./record-format";

type MembershipStatus = "trial" | "active" | "paused" | "overdue";

function membershipStatusLabel(status: MembershipStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * DESIGN.md §2 has three semantic statuses, and a membership status is not binary: `paused` and
 * `overdue` want the office's attention (Attention Amber), while a `trial` is a normal beginning and
 * must never read as a refusal.
 */
const membershipStatusClass: Readonly<Record<MembershipStatus, string>> = {
  trial: "member-record-status-trial",
  active: "member-record-status-active",
  paused: "member-record-status-attention",
  overdue: "member-record-status-attention",
};

function Card({ title, children }: { title: string; children: ReactNode }) {
  const id = `member-record-card-${title.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <section aria-labelledby={id} className="member-record-card">
      <p className="admin-eyebrow">Profile</p>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  );
}

function monthsLabel(months: number): string {
  return months === 1 ? "1 month" : `${months} months`;
}

function OfficeCards({ profile }: { profile: FullMemberProfile }) {
  const { cards, header } = profile;
  return (
    <>
      <Card title="Member">
        <p>
          Member since{" "}
          <span>{`${formatRecordDate(cards.memberSince)} · ${monthsLabel(cards.monthsAsMember)}`}</span>
        </p>
        {cards.profession === undefined ? null : <p>{cards.profession}</p>}
      </Card>
      <Card title="Account manager">
        {cards.accountManagers.length === 0 ? (
          <p>No account manager</p>
        ) : (
          <ul>
            {cards.accountManagers.map((manager) => (
              <li key={`${manager.familyId}-${manager.displayName}`}>{manager.displayName}</li>
            ))}
          </ul>
        )}
        <Link className="member-record-link" href="/admin/families">
          Open Families
        </Link>
      </Card>
      <Card title="Plan">
        {cards.currentMembership === null ? (
          <p>No current membership</p>
        ) : (
          <>
            <p>
              <strong>{cards.currentMembership.planName}</strong>
            </p>
            <p
              className={`member-record-status ${membershipStatusClass[cards.currentMembership.status]}`}
            >
              {membershipStatusLabel(cards.currentMembership.status)}
            </p>
            {cards.currentMembership.validUntil === null ? null : (
              <p>
                Valid until <span>{formatRecordDate(cards.currentMembership.validUntil)}</span>
              </p>
            )}
          </>
        )}
        <Link
          className="member-record-link"
          href={`/admin/memberships?studentId=${encodeURIComponent(header.studentId)}`}
        >
          Open Memberships
        </Link>
      </Card>
    </>
  );
}

/**
 * PROFILE (spec §5.4). `ibjjfCardSlot` is Plan C's insertion point for the JIU-JITSU IBJJF card; it is
 * the only card a coach sees.
 *
 * The slot is tested for truthiness, not for `undefined`: a caller that passes
 * `condition ? <IbjjfCard /> : null` must get the same result as one that passes nothing, or the
 * wrapper renders empty and the coach loses the Levels fallback.
 */
export function ProfileTab({
  profile,
  ibjjfCardSlot,
}: {
  profile: MemberProfile;
  ibjjfCardSlot?: ReactNode;
}) {
  const hasIbjjfCard = Boolean(ibjjfCardSlot);
  return (
    <div className="member-record-cards">
      {hasIbjjfCard ? <div className="member-record-wide">{ibjjfCardSlot}</div> : null}
      {profile.view === "full" ? <OfficeCards profile={profile} /> : null}
      {profile.view === "coach" && !hasIbjjfCard ? (
        <section
          aria-labelledby="record-empty-levels"
          className="member-record-empty member-record-wide"
        >
          <p className="admin-eyebrow">Jiu-jitsu</p>
          <h3 id="record-empty-levels">Belt and progress</h3>
          <p>Levels shows this member&apos;s belt, stripes and next graduation.</p>
          <Link className="member-record-link" href="/admin/levels">
            Open Levels
          </Link>
        </section>
      ) : null}
    </div>
  );
}
