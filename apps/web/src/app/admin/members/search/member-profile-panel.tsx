"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type {
  RegyfitAttendanceStatus,
  RegyfitMemberRecord,
} from "@bpt-jersey/domain/members/regyfit-records";

import { AdminStatusBadge } from "../../admin-ui";

const tabs = [
  "Profile",
  "Details",
  "Membership",
  "Payments",
  "Classes",
  "Communication",
  "Notes",
] as const;

type ProfileTab = (typeof tabs)[number];

const attendanceLabels: Readonly<Record<RegyfitAttendanceStatus, string>> = Object.freeze({
  present: "Present",
  absent: "Absent",
  "no-data": "No data",
  unknown: "Unknown",
});

function displayValue(value: string | number | undefined): string {
  if (value === undefined) return "—";
  const text = String(value).trim();
  return text.length === 0 ? "—" : text;
}

function FieldList({ entries }: { entries: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="admin-member-profile-fields">
      {entries.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="admin-member-profile-card">
      <p className="admin-eyebrow">{title}</p>
      {children}
    </article>
  );
}

function EmptySection({ title, message }: { title: string; message: string }) {
  return (
    <div className="admin-member-profile-empty">
      <p className="admin-eyebrow">{title}</p>
      <p>{message}</p>
    </div>
  );
}

function ProfileTabContent({ record }: { record: RegyfitMemberRecord }) {
  const { attendance, appAccess, graduation } = record;
  return (
    <div className="admin-member-profile-grid">
      <Card title="Member">
        <FieldList
          entries={[
            ["Age", displayValue(record.age)],
            ["Attendance (last 30 days)", displayValue(attendance.last30Days)],
            ["Last attendance", displayValue(attendance.lastAttendance)],
            ["Advantage", displayValue(attendance.advantage)],
            [
              "Profile",
              <AdminStatusBadge
                key="state"
                status={record.membershipState === "inactive" ? "inactive profile" : "active"}
              />,
            ],
          ]}
        />
      </Card>
      <Card title="Access to this member's app">
        <FieldList
          entries={[
            ["Login", displayValue(appAccess.login)],
            ["Password", displayValue(appAccess.password)],
            ["Logins", displayValue(appAccess.logins)],
            ["APP - last login", displayValue(appAccess.lastLogin)],
          ]}
        />
      </Card>
      <Card title={graduation.modality ?? "Graduation"}>
        <FieldList
          entries={[
            ["Belt", displayValue(graduation.belt)],
            ["Next graduation", displayValue(graduation.nextGraduationDate)],
            [
              "Progress",
              graduation.progressPercent === undefined ? "—" : `${graduation.progressPercent}%`,
            ],
            ["Classes", displayValue(graduation.classesProgress)],
            ["Days", displayValue(graduation.daysProgress)],
          ]}
        />
      </Card>
      <Card title="Responsible trainer">
        <FieldList
          entries={[
            ["Trainer", displayValue(record.responsibleTrainer)],
            ["Account manager", displayValue(record.accountManager)],
          ]}
        />
      </Card>
    </div>
  );
}

function DetailsTabContent({ record }: { record: RegyfitMemberRecord }) {
  return (
    <div className="admin-member-profile-grid">
      <Card title="Identity">
        <FieldList
          entries={[
            ["Full name", record.fullName],
            ["Nickname", displayValue(record.nickname)],
            ["Member Nº", displayValue(record.memberNumber)],
            ["Gender", record.gender],
            ["Birthdate", displayValue(record.birthDate)],
            ["Registration date", displayValue(record.registrationDate)],
            ["Profession", displayValue(record.profession)],
          ]}
        />
      </Card>
      <Card title="Contact">
        <FieldList
          entries={[
            ["E-mail", displayValue(record.email)],
            ["Mobile Nº", displayValue(record.mobile)],
            ["Emergency contact", displayValue(record.emergencyContact)],
            ["Home address", displayValue(record.address)],
            ["Location", displayValue(record.locality)],
            ["Zip code", displayValue(record.postcode)],
            ["Country", displayValue(record.country)],
          ]}
        />
      </Card>
      <Card title="Documents and numbers">
        <FieldList
          entries={[
            ["ID card Nº", displayValue(record.idCardNumber)],
            ["ID card due date", displayValue(record.idCardDue)],
            ["Health number", displayValue(record.healthNumber)],
            ["VAT number", displayValue(record.vatNumber)],
          ]}
        />
      </Card>
    </div>
  );
}

function MembershipTabContent({ record }: { record: RegyfitMemberRecord }) {
  const { plan } = record;
  return (
    <div className="admin-member-profile-grid">
      <Card title="Membership plan">
        <FieldList
          entries={[
            ["Plan", displayValue(plan.membershipPlan)],
            ["Discount", displayValue(plan.discount)],
            ["State", <AdminStatusBadge key="state" status={record.membershipState} />],
          ]}
        />
      </Card>
      <Card title="Membership payment details">
        <FieldList
          entries={[
            ["Payment", displayValue(plan.paymentMode)],
            ["Amount (£)", displayValue(plan.amount)],
            ["Valid from", displayValue(plan.validFrom)],
            ["Valid until", displayValue(plan.validUntil)],
            ["Frequency", displayValue(plan.frequency)],
          ]}
        />
      </Card>
    </div>
  );
}

function PaymentsTabContent({ record }: { record: RegyfitMemberRecord }) {
  if (record.payments.length === 0) {
    return (
      <EmptySection title="Payments history" message="Regyfit holds no payments for this member." />
    );
  }
  return (
    <div className="admin-data-table-wrap">
      <table className="admin-data-table">
        <caption className="admin-eyebrow">Payments history</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {record.payments.map((payment, index) => (
            <tr key={`${payment.date ?? ""}-${index}`}>
              <td>{displayValue(payment.date)}</td>
              <td>{displayValue(payment.description)}</td>
              <td>{displayValue(payment.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClassesTabContent({ record }: { record: RegyfitMemberRecord }) {
  const { attendance } = record;
  return (
    <>
      <div className="admin-member-profile-grid">
        <Card title="Attendance history">
          <FieldList
            entries={[
              ["Registrations", displayValue(attendance.registrations)],
              ["Attendance", displayValue(attendance.attended)],
              ["Absences", displayValue(attendance.absences)],
              ["This month", displayValue(attendance.thisMonth)],
            ]}
          />
        </Card>
      </div>
      {attendance.records.length === 0 ? (
        <EmptySection
          title="Last records"
          message="Regyfit holds no class registrations for this member."
        />
      ) : (
        <div className="admin-data-table-wrap">
          <table className="admin-data-table">
            <caption className="admin-eyebrow">Last {attendance.records.length} records</caption>
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Class</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {attendance.records.map((entry, index) => (
                <tr key={`${entry.date}-${entry.time ?? ""}-${index}`}>
                  <td>{entry.date}</td>
                  <td>{displayValue(entry.time)}</td>
                  <td>{displayValue(entry.className)}</td>
                  <td>
                    <AdminStatusBadge status={attendanceLabels[entry.status]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function TabContent({ tab, record }: { tab: ProfileTab; record: RegyfitMemberRecord }) {
  if (tab === "Profile") return <ProfileTabContent record={record} />;
  if (tab === "Details") return <DetailsTabContent record={record} />;
  if (tab === "Membership") return <MembershipTabContent record={record} />;
  if (tab === "Payments") return <PaymentsTabContent record={record} />;
  if (tab === "Classes") return <ClassesTabContent record={record} />;
  if (tab === "Notes") {
    return record.notes === undefined ? (
      <EmptySection title="Notes" message="Regyfit holds no notes for this member." />
    ) : (
      <Card title="Notes">
        <p className="admin-member-profile-note">{record.notes}</p>
      </Card>
    );
  }
  return (
    <EmptySection
      title="Communication"
      message="Communication logs are not part of the captured Regyfit record."
    />
  );
}

export function MemberProfilePanel({
  record,
  onClose,
  onCanonicalLookup,
}: {
  record: RegyfitMemberRecord;
  onClose: () => void;
  onCanonicalLookup: (membershipNumber: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<ProfileTab>("Profile");
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setActiveTab("Profile");
    headingRef.current?.focus();
  }, [record.recordId]);

  function moveTab(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = tabs.indexOf(activeTab);
    const offset = event.key === "ArrowRight" ? 1 : tabs.length - 1;
    const next = tabs[(index + offset) % tabs.length];
    if (next !== undefined) setActiveTab(next);
  }

  return (
    <section
      aria-labelledby="member-profile-title"
      className="admin-panel-card admin-member-profile"
    >
      <header className="admin-member-profile-header">
        <div>
          <p className="admin-eyebrow">
            Member Nº: {displayValue(record.memberNumber)} / Mobile Nº:{" "}
            {displayValue(record.mobile)}
          </p>
          <h3 id="member-profile-title" ref={headingRef} tabIndex={-1}>
            {record.fullName}
          </h3>
          <div className="admin-member-profile-badges">
            <AdminStatusBadge status={record.membershipState} />
            {record.plan.paymentMode === undefined ? null : (
              <AdminStatusBadge status={record.plan.paymentMode} />
            )}
            <span className="admin-member-profile-meta">
              Captured {record.capturedAt.slice(0, 10)} from Regyfit
            </span>
          </div>
        </div>
        <div className="admin-member-profile-actions">
          {record.memberNumber === undefined ? null : (
            <button
              className="regyfit-filter-button"
              onClick={() => onCanonicalLookup(record.memberNumber ?? "")}
              type="button"
            >
              Load canonical record
            </button>
          )}
          <button className="admin-auth-button" onClick={onClose} type="button">
            Close profile
          </button>
        </div>
      </header>

      <div
        aria-label="Member profile sections"
        className="admin-member-profile-tabs"
        onKeyDown={moveTab}
        role="tablist"
      >
        {tabs.map((tab) => (
          <button
            aria-controls="member-profile-tabpanel"
            aria-selected={tab === activeTab}
            className={`admin-member-profile-tab${tab === activeTab ? " is-active" : ""}`}
            id={`member-profile-tab-${tab.toLowerCase()}`}
            key={tab}
            onClick={() => setActiveTab(tab)}
            role="tab"
            tabIndex={tab === activeTab ? 0 : -1}
            type="button"
          >
            {tab}
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`member-profile-tab-${activeTab.toLowerCase()}`}
        className="admin-member-profile-panel"
        id="member-profile-tabpanel"
        role="tabpanel"
        tabIndex={0}
      >
        <TabContent record={record} tab={activeTab} />
      </div>
    </section>
  );
}
