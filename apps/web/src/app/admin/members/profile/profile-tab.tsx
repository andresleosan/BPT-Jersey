import Link from "next/link";
import type { ReactNode } from "react";

import type { FullMemberProfile, MemberProfile } from "@bpt-jersey/domain/members/profile";

import { formatRecordDate } from "./record-format";

function membershipStatusLabel(status: "trial" | "active" | "paused" | "overdue"): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

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
        {cards.accountManagers.length === 0 ? null : (
          <Link className="member-record-link" href="/admin/families">
            Open Families
          </Link>
        )}
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
              className={`member-record-status member-record-status-${
                cards.currentMembership.status === "active" ? "active" : "inactive"
              }`}
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
 */
export function ProfileTab({
  profile,
  ibjjfCardSlot,
}: {
  profile: MemberProfile;
  ibjjfCardSlot?: ReactNode;
}) {
  return (
    <div className="member-record-cards">
      {ibjjfCardSlot === undefined ? null : (
        <div className="member-record-wide">{ibjjfCardSlot}</div>
      )}
      {profile.view === "full" ? <OfficeCards profile={profile} /> : null}
      {profile.view === "coach" && ibjjfCardSlot === undefined ? (
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
