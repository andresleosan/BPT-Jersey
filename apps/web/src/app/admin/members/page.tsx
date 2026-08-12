import Link from "next/link";

import { AdminDataTable, AdminSectionHeader, AdminStatusBadge } from "../admin-ui";
import { previewData, type PreviewMember } from "../preview-data";
import { AdminGate } from "../admin-gate";

import "../admin.css";

const memberColumns = [
  {
    key: "membershipNumber",
    label: "Membership number",
    render: (member: PreviewMember) => <strong>{member.membershipNumber}</strong>,
  },
  { key: "fullName", label: "Name", render: (member: PreviewMember) => member.fullName },
  { key: "email", label: "Email", render: (member: PreviewMember) => member.email },
  {
    key: "idCardNumber",
    label: "ID card number",
    render: (member: PreviewMember) => member.idCardNumber,
  },
  { key: "vatNumber", label: "VAT number", render: (member: PreviewMember) => member.vatNumber },
  { key: "birthDate", label: "Birth date", render: (member: PreviewMember) => member.birthDate },
  {
    key: "mobileNumber",
    label: "Mobile number",
    render: (member: PreviewMember) => member.mobileNumber,
  },
  { key: "frequency", label: "Frequency", render: (member: PreviewMember) => member.frequency },
  {
    key: "paymentStatus",
    label: "Payment / status",
    render: (member: PreviewMember) => (
      <span className="admin-member-status-cell">
        <AdminStatusBadge status={member.paymentStatus} />
        <AdminStatusBadge status={member.membershipStatus} />
      </span>
    ),
  },
  { key: "gender", label: "Gender", render: (member: PreviewMember) => member.gender },
  {
    key: "trainingCenter",
    label: "Training center",
    render: (member: PreviewMember) => member.trainingCenter,
  },
] as const;

export function MembersPage() {
  return (
    <section className="admin-module-page" aria-labelledby="members-title">
      <AdminSectionHeader
        actions={
          <div className="admin-section-actions">
            <Link className="admin-auth-button" href="/admin/members/add">
              Add new member
            </Link>
            <Link className="admin-home-link" href="/admin/members/search">
              Search members
            </Link>
          </div>
        }
        description="The member directory preserves the fields and statuses from the replicated academy page. This screen uses synthetic preview records until the connected source is approved."
        eyebrow="Members / Synthetic preview"
        title="Members"
      />
      <section className="admin-panel-card" aria-labelledby="member-directory-title">
        <div className="admin-panel-card-heading">
          <div>
            <p className="admin-eyebrow">Directory</p>
            <h3 id="member-directory-title">Member directory</h3>
          </div>
          <span className="admin-status-badge admin-status-active">Synthetic preview</span>
        </div>
        <AdminDataTable
          caption="Member directory"
          columns={memberColumns}
          rowKey={(member) => member.membershipNumber}
          rows={previewData.members}
        />
      </section>
    </section>
  );
}

export default function MembersRoute() {
  return (
    <AdminGate>
      <MembersPage />
    </AdminGate>
  );
}
