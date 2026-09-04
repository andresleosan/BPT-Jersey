"use client";

import Link from "next/link";
import { startTransition, useEffect, useState, type FormEvent } from "react";

import type { AdminDirectoryRow } from "@bpt-jersey/domain/members/directory";

import { listMembers, type MemberDirectoryPage } from "../../../lib/members-client";
import { getHealthAdminProfile, saveHealthProfile } from "../../../lib/health-client";
import { AdminSectionHeader, AdminStatusBadge } from "../admin-ui";
import { AdminDataTable } from "../admin-data-table";

import "../admin.css";

type MembersState =
  { status: "loading" } | { status: "ready"; result: MemberDirectoryPage } | { status: "error" };

const memberPageSize = 50;

function memberValue(value: string | undefined): string {
  return value ?? "—";
}

const memberColumns = [
  {
    key: "membershipReference",
    label: "Membership reference",
    render: (member: AdminDirectoryRow) => (
      <strong>{memberValue(member.membershipReference)}</strong>
    ),
  },
  {
    key: "fullName",
    label: "Name",
    render: (member: AdminDirectoryRow) => member.fullName,
  },
  {
    key: "trainingCenter",
    label: "Training center",
    render: (member: AdminDirectoryRow) => member.trainingCenter,
  },
  {
    key: "participantType",
    label: "Participant type",
    render: (member: AdminDirectoryRow) => member.participantType,
  },
  {
    key: "active",
    label: "Active",
    render: (member: AdminDirectoryRow) => (member.active ? "Yes" : "No"),
  },
  {
    key: "status",
    label: "Status",
    render: (member: AdminDirectoryRow) => <AdminStatusBadge status={member.status} />,
  },
] as const;

function MembersDirectory({
  result,
  onNextPage,
}: {
  result: MemberDirectoryPage;
  onNextPage: () => void;
}) {
  return (
    <>
      {result.rows.length === 0 ? (
        <p aria-live="polite" className="admin-no-results" role="status">
          No members available.
        </p>
      ) : (
        <AdminDataTable
          caption="Member directory"
          columns={memberColumns}
          rowKey={(member) => member.studentId}
          rows={result.rows}
        />
      )}
      {result.nextCursor ? (
        <div className="admin-filter-bar">
          <button className="admin-auth-button" onClick={onNextPage} type="button">
            Next page
          </button>
        </div>
      ) : null}
    </>
  );
}

export function MembersPage() {
  const [state, setState] = useState<MembersState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    void listMembers(memberPageSize)
      .then((result) => {
        if (active) startTransition(() => setState({ status: "ready", result }));
      })
      .catch(() => {
        if (active) startTransition(() => setState({ status: "error" }));
      });

    return () => {
      active = false;
    };
  }, []);

  function handleNextPage(): void {
    if (state.status !== "ready" || !state.result.nextCursor) return;

    const cursor = state.result.nextCursor;
    startTransition(() => setState({ status: "loading" }));
    void listMembers(memberPageSize, cursor)
      .then((result) => startTransition(() => setState({ status: "ready", result })))
      .catch(() => startTransition(() => setState({ status: "error" })));
  }

  return (
    <section className="admin-module-page" aria-labelledby="members-title">
      <AdminSectionHeader
        actions={
          <>
            <Link className="admin-auth-button" href="/admin/members/add">
              Add new member
            </Link>
            <Link className="admin-home-link" href="/admin/members/search">
              Search members
            </Link>
          </>
        }
        description="The member directory shows only the minimum operational fields for each student."
        eyebrow="Members / Canonical directory"
        title="Members"
      />
      <section className="admin-panel-card" aria-labelledby="member-directory-title">
        <div className="admin-panel-card-heading">
          <div>
            <p className="admin-eyebrow">Directory</p>
            <h3 id="member-directory-title">Member directory</h3>
          </div>
        </div>
        {state.status === "loading" ? (
          <p aria-live="polite" className="admin-no-results" role="status">
            Loading members...
          </p>
        ) : state.status === "error" ? (
          <p aria-live="assertive" className="admin-no-results" role="alert">
            Unable to load members. Please try again.
          </p>
        ) : (
          <MembersDirectory result={state.result} onNextPage={handleNextPage} />
        )}
      </section>
      <MedicalReviewSection />
    </section>
  );
}

function MedicalReviewSection() {
  const [studentId, setStudentId] = useState("");
  const [referenceLabel, setReferenceLabel] = useState("");
  const [conditionSummary, setConditionSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleLoad(e: FormEvent) {
    e.preventDefault();
    const id = studentId.trim();
    if (!id) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const profile = await getHealthAdminProfile(id);
      if (profile) {
        setReferenceLabel(profile.staffReferenceLabel ?? "");
        setConditionSummary(profile.conditionSummary ?? "");
        setSuccess(`Loaded medical record for student ${id}.`);
      } else {
        setReferenceLabel("");
        setConditionSummary("");
        setSuccess(`No existing medical profile for student ${id}. You may assign one below.`);
      }
    } catch {
      setError("Unable to load student health record. Check student ID.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    const id = studentId.trim();
    if (!id) return;
    const label = referenceLabel.trim();
    if (label.length > 25) {
      setError("Staff reference label must be 25 characters or fewer.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await saveHealthProfile({
        studentId: id,
        minimumOperationalSupport: ["none"],
        conditionSummary: conditionSummary.trim() || null,
        staffReferenceLabel: label || null,
        expiresAt: null,
      });
      setSuccess(`Staff reference label updated for student ${id}.`);
    } catch {
      setError("Unable to save staff reference. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="admin-panel-card"
      aria-labelledby="medical-review-title"
      style={{ marginTop: "2rem" }}
    >
      <div className="admin-panel-card-heading">
        <div>
          <p className="admin-eyebrow">Safeguarding & Support</p>
          <h3 id="medical-review-title">Medical Conditions & Staff Reference Review</h3>
        </div>
      </div>
      <p style={{ fontSize: "0.9rem", color: "#4b5563", marginBottom: "1rem" }}>
        Review declared medical conditions for students and assign a short staff reference label
        (max 25 characters) for mat coaches.
      </p>

      {error && (
        <p aria-live="assertive" className="login-message login-message-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p aria-live="polite" className="login-message" role="status">
          {success}
        </p>
      )}

      <form
        onSubmit={handleLoad}
        style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", alignItems: "flex-end" }}
      >
        <div style={{ flex: 1 }}>
          <label
            htmlFor="medical-student-id"
            style={{
              display: "block",
              fontSize: "0.85rem",
              fontWeight: 600,
              marginBottom: "0.25rem",
            }}
          >
            Student ID
          </label>
          <input
            id="medical-student-id"
            type="text"
            className="admin-input"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            placeholder="e.g. stu_12345"
            required
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "6px",
              border: "1px solid #d1d5db",
            }}
          />
        </div>
        <button type="submit" className="admin-auth-button" disabled={loading || !studentId.trim()}>
          {loading ? "Checking..." : "Look up Medical Record"}
        </button>
      </form>

      <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <label
            htmlFor="medical-ref-label"
            style={{
              display: "block",
              fontSize: "0.85rem",
              fontWeight: 600,
              marginBottom: "0.25rem",
            }}
          >
            Staff Reference Label (max 25 characters)
          </label>
          <input
            id="medical-ref-label"
            type="text"
            maxLength={25}
            value={referenceLabel}
            onChange={(e) => setReferenceLabel(e.target.value)}
            placeholder="e.g. ASTHMA-INHALER, KNEE-BRACE"
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "6px",
              border: "1px solid #d1d5db",
            }}
          />
          <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
            {referenceLabel.length} / 25 characters
          </span>
        </div>

        <div>
          <label
            htmlFor="medical-summary"
            style={{
              display: "block",
              fontSize: "0.85rem",
              fontWeight: 600,
              marginBottom: "0.25rem",
            }}
          >
            Condition Summary (max 1000 characters)
          </label>
          <textarea
            id="medical-summary"
            rows={3}
            maxLength={1000}
            value={conditionSummary}
            onChange={(e) => setConditionSummary(e.target.value)}
            placeholder="Operational notes regarding member medical conditions or emergency precautions."
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "6px",
              border: "1px solid #d1d5db",
            }}
          />
        </div>

        <div>
          <button
            type="submit"
            className="button button-primary text-sm"
            disabled={saving || !studentId.trim()}
          >
            {saving ? "Saving..." : "Save Staff Reference Label"}
          </button>
        </div>
      </form>
    </section>
  );
}

export default function MembersRoute() {
  return <MembersPage />;
}
