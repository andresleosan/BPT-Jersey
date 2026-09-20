"use client";
import { useEffect, useRef, useState } from "react";
import type {
  MemberRecoveryDetail,
  MemberRecoveryRequestRow,
  CompleteMemberRecoveryResult,
} from "@bpt-jersey/domain/members/recovery";
import {
  listMemberRecoveryRequests,
  getMemberRecoveryDetail,
  reviewMemberRecovery,
} from "../../../../lib/member-recovery-client";
import { useAdminOrStaffSession } from "../../admin-gate";
import { AdminSectionHeader } from "../../admin-ui";
import "../../admin.css";
import "./recovery.css";
const statuses: Record<CompleteMemberRecoveryResult["status"], string> = {
  "verify-email": "Email verification needed",
  "pending-review": "Awaiting review",
  "profile-required": "Member details needed",
  linked: "Access restored",
  rejected: "Rejected",
};
export function MemberRecoveryQueue({ embedded = false }: { embedded?: boolean }) {
  const session = useAdminOrStaffSession();
  const office = session.role === "owner" || session.role === "administrator";
  const [queue, setQueue] = useState<{
    requests: MemberRecoveryRequestRow[];
    truncated: boolean;
  }>();
  const [detail, setDetail] = useState<MemberRecoveryDetail>();
  const [candidateId, setCandidateId] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [reload, setReload] = useState(0);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!office) return;
    let active = true;
    void listMemberRecoveryRequests()
      .then((result) => {
        if (active) setQueue(result);
      })
      .catch(() => {
        if (active) setError("Unable to load recovery requests. Please try again.");
      });
    return () => {
      active = false;
    };
  }, [office, reload]);
  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
    } catch {
      setError("Unable to update or open this request. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function open(requestId: string) {
    void run(async () => {
      setDetail(undefined);
      setCandidateId(undefined);
      setConfirmed(false);
      setDetail(await getMemberRecoveryDetail(requestId));
    });
  }
  function review(decision: "approve" | "reject") {
    if (!detail || (decision === "approve" && (!candidateId || !confirmed))) return;
    void run(async () => {
      const outcome = await reviewMemberRecovery({
        requestId: detail.request.requestId,
        decision,
        ...(decision === "approve" ? { candidateId, identityConfirmed: true } : {}),
      });
      setNotice(
        outcome.status === "rejected"
          ? "Request rejected."
          : outcome.status === "profile-required"
            ? "Identity approved. The member must return to recovery and complete their details."
            : outcome.status === "linked"
              ? "Access restored. The member can continue from their recovery page."
              : "Identity reviewed. Further office follow-up is required before access can be restored.",
      );
      window.dispatchEvent(new Event("bpt-recovery-reviewed"));
      setDetail(undefined);
      setConfirmed(false);
      setCandidateId(undefined);
      setReload((value) => value + 1);
    });
  }
  if (!office) return <p>Only the office can review member recovery requests.</p>;
  return (
    <section className="admin-module-page" aria-label="Member access recovery">
      {embedded ? (
        <div role="status">
          <h2>Member access recovery</h2>
          <p>
            {queue
              ? `${queue.requests.length}${queue.truncated ? "+" : ""} recovery requests need attention.`
              : "Loading recovery notifications..."}
          </p>
        </div>
      ) : (
        <AdminSectionHeader
          title="Member access recovery"
          eyebrow="Members / Access recovery"
          description="Check requests from existing members whose account details need office review."
          actions={
            <a className="admin-home-link" href="/admin/members/requests">
              Back to enrolment requests
            </a>
          }
        />
      )}
      <div className="admin-panel-card">
        <p>
          Verify identity independently using academy records or a direct conversation. A matching
          name alone does not establish ownership. For children or inactive memberships, follow the
          existing guardian or membership process.
        </p>
      </div>
      {error ? (
        <p role="alert" className="admin-panel-card">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="admin-panel-card">
          {notice}
        </p>
      ) : null}
      <button
        type="button"
        className="button button-secondary"
        disabled={busy}
        onClick={() => {
          setError(undefined);
          setReload((value) => value + 1);
        }}
      >
        Refresh requests
      </button>
      {!queue && !error ? <p>Loading recovery requests...</p> : null}
      {queue?.truncated ? (
        <p>
          Showing the oldest 50 account-bound recovery requests. Resolve requests, then refresh to
          see the next ones.
        </p>
      ) : null}
      {queue?.requests.length === 0 ? <p>No recovery requests awaiting review.</p> : null}
      <ul className="admin-request-list">
        {queue?.requests.map((request) => (
          <li className="admin-panel-card" key={request.requestId}>
            <strong>{request.fullName}</strong>
            <p>
              {statuses[request.status]} · {new Date(request.createdAt).toLocaleDateString("en-GB")}
            </p>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => open(request.requestId)}
            >
              Review request
            </button>
          </li>
        ))}
      </ul>
      {detail ? (
        <section
          className="admin-panel-card recovery-review"
          aria-labelledby="recovery-review-title"
          aria-busy={busy}
        >
          <h2 id="recovery-review-title">Review {detail.request.fullName}</h2>
          <dl>
            <dt>Previous email supplied</dt>
            <dd>{detail.request.previousEmail || "Not supplied"}</dd>
            <dt>Email verified</dt>
            <dd>{detail.request.accountVerified ? "Yes" : "Awaiting email verification"}</dd>
            <dt>Account email</dt>
            <dd>{detail.request.accountEmail ?? "Not available"}</dd>
          </dl>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (search.trim().length < 2) return;
              void run(async () => {
                setCandidateId(undefined);
                setConfirmed(false);
                setDetail(await getMemberRecoveryDetail(detail.request.requestId, search.trim()));
              });
            }}
          >
            <label>
              Search all member records
              <input
                value={search}
                minLength={2}
                maxLength={160}
                required
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, email or membership number"
              />
            </label>
            <button type="submit" className="button button-secondary" disabled={busy}>
              Find member record
            </button>
          </form>
          <fieldset disabled={busy}>
            <legend>Select the member record</legend>
            {detail.candidates.map((candidate) => (
              <label key={candidate.candidateId}>
                <input
                  type="radio"
                  name="candidate"
                  value={candidate.candidateId}
                  checked={candidateId === candidate.candidateId}
                  onChange={() => {
                    setCandidateId(candidate.candidateId);
                    setConfirmed(false);
                  }}
                />{" "}
                <span>
                  {candidate.fullName} ·{" "}
                  {candidate.source === "student"
                    ? "Current member profile"
                    : candidate.source === "member"
                      ? "Legacy member directory"
                      : "Regyfit archive"}{" "}
                  · {candidate.email ?? "No previous email"} ·{" "}
                  {candidate.dateOfBirth ?? "No date of birth"} · {candidate.membershipState}
                </span>
              </label>
            ))}
            {detail.candidates.length === 0 ? (
              <p>
                No candidate records available. Check the academy records and contact the applicant
                before proceeding.
              </p>
            ) : null}
          </fieldset>
          <label>
            <input
              type="checkbox"
              disabled={busy}
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />{" "}
            I have independently verified this person&apos;s identity and their ownership of the
            selected member record.
          </label>
          <div className="admin-request-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={
                busy ||
                !detail.request.accountVerified ||
                !candidateId ||
                !confirmed ||
                detail.request.status === "linked" ||
                detail.request.status === "rejected"
              }
              onClick={() => review("approve")}
            >
              Approve recovery
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={
                busy || detail.request.status === "linked" || detail.request.status === "rejected"
              }
              onClick={() => review("reject")}
            >
              Reject request
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
