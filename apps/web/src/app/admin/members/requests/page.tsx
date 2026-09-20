"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { PLAN_CATALOG, type PlanId } from "@bpt-jersey/domain/memberships";
import { getLevelCatalog } from "../../../../lib/levels-client";
import type { LevelCatalogProjection } from "@bpt-jersey/domain/levels";
import { addSubscriptionMonth } from "@bpt-jersey/domain/memberships/admin";
import { formatPlanPrice } from "../../../../lib/plan-copy";

import {
  isReturnableEnrolmentRequest,
  type EnrolmentApprovalSetup,
  enrolmentNeedsPayment,
  type EnrolmentRequestDetail,
  type EnrolmentRequestRow,
} from "@bpt-jersey/domain/members/enrolment-requests";
import {
  approveEnrolmentRequest,
  getEnrolmentRequestDetail,
  listEnrolmentRequests,
  returnEnrolmentRequest,
} from "../../../../lib/enrolment-client";
import { useAdminOrStaffSession } from "../../admin-gate";
import { AdminSectionHeader, AdminStatusBadge } from "../../admin-ui";

import "../../admin.css";
import "./requests.css";

const MemberRecoveryQueue = dynamic(
  () => import("../recovery/recovery-queue").then((module) => module.MemberRecoveryQueue),
  {
    loading: () => (
      <div className="enrolment-loading" role="status">
        Loading access requests...
      </div>
    ),
  },
);

type QueueState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; requests: readonly EnrolmentRequestRow[]; truncated: boolean }>
  | Readonly<{ status: "error" }>;

type Notice = Readonly<{ tone: "error" | "success"; text: string }>;

const statusLabels = {
  submitted: "Waiting",
  returned: "Returned",
  approving: "Approving",
  "approval-failed": "Approval stopped",
  approved: "Approved",
  withdrawn: "Withdrawn",
} as const;

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB");
}

function PlanPreference({ planId }: Readonly<{ planId: PlanId | undefined }>) {
  const plan = PLAN_CATALOG.find((item) => item.planId === planId);
  return (
    <p className="admin-request-meta">
      <strong>Requested plan:</strong>{" "}
      {plan ? `${plan.displayName} · ${formatPlanPrice(plan)}` : "Not recorded on this request"}
    </p>
  );
}

function DetailPanel({ detail }: Readonly<{ detail: EnrolmentRequestDetail }>) {
  const { applicant } = detail;
  return (
    <div className="admin-request-detail">
      <h4>Applicant details</h4>
      <dl className="enrolment-facts">
        <div>
          <dt>Full name</dt>
          <dd>{applicant.fullName}</dd>
        </div>
        <div>
          <dt>Date of birth</dt>
          <dd>{applicant.dateOfBirth}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{applicant.email || "Not provided"}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{applicant.phoneNumber}</dd>
        </div>
        <div>
          <dt>Gender</dt>
          <dd>{applicant.gender ?? "Not provided"}</dd>
        </div>
        <div>
          <dt>Centre</dt>
          <dd>{applicant.trainingCenter}</dd>
        </div>
        <div>
          <dt>Training times</dt>
          <dd>{applicant.trainingTimePreferences.join(", ") || "Not training"}</dd>
        </div>
        {applicant.frequencyNote ? (
          <div>
            <dt>Training frequency</dt>
            <dd>{applicant.frequencyNote}</dd>
          </div>
        ) : null}
        {applicant.postalAddress ? (
          <div>
            <dt>Address</dt>
            <dd>
              {applicant.postalAddress.line}, {applicant.postalAddress.postCode}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Emergency contact</dt>
          <dd>
            {applicant.emergencyContact
              ? `${applicant.emergencyContact.fullName} (${applicant.emergencyContact.relationship}), ${applicant.emergencyContact.phoneNumber}`
              : "Not provided"}
          </dd>
        </div>
      </dl>
      {detail.applicantIsStudent ? (
        <PlanPreference planId={detail.planSelections?.applicant} />
      ) : null}
      {detail.minors.length > 0 ? (
        <ul className="admin-request-minors" aria-label="Children in their care">
          {detail.minors.map((minor, index) => (
            <li key={`${minor.fullName}-${minor.dateOfBirth}`}>
              {minor.fullName} · born {minor.dateOfBirth} · {minor.trainingCenter}
              {minor.frequencyNote ? ` · ${minor.frequencyNote}` : ""}
              <p>
                Gender: {minor.gender ?? "Not provided"} · Training times:{" "}
                {minor.trainingTimePreferences.join(", ")}
              </p>
              {minor.emergencyContact ? (
                <p>
                  Emergency contact: {minor.emergencyContact.fullName} (
                  {minor.emergencyContact.relationship}) {minor.emergencyContact.phoneNumber}
                </p>
              ) : null}
              <PlanPreference planId={detail.planSelections?.minors[index]} />
            </li>
          ))}
        </ul>
      ) : null}
      <p>
        Waiver:{" "}
        {detail.waiverAcceptance
          ? `accepted on ${detail.waiverAcceptance.acceptedAt.slice(0, 10)}, version ${detail.waiverAcceptance.version}`
          : "Not recorded on this older request"}
      </p>
      {detail.payment ? (
        <section aria-label="Payment evidence">
          <h4>Transfer evidence</h4>
          <p>
            £{(detail.payment.amountMinor / 100).toFixed(2)} · {detail.payment.paidOn} · Reference:{" "}
            {detail.payment.reference}
          </p>
          {detail.paymentProofUrl ? (
            <a
              className="staff-secondary-button"
              href={detail.paymentProofUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open payment screenshot
            </a>
          ) : (
            <p role="alert">Payment screenshot unavailable. Reload the full request.</p>
          )}
        </section>
      ) : (
        <p>
          No transfer screenshot supplied. Pay-as-you-go plans do not require payment at
          registration.
        </p>
      )}
      {detail.approvalFailureCode ? (
        <p className="admin-request-meta">
          <strong>An earlier approval stopped:</strong> {detail.approvalFailureCode}
        </p>
      ) : null}
    </div>
  );
}

export default function EnrolmentRequestQueuePage() {
  const session = useAdminOrStaffSession();
  return (
    <EnrolmentRequestQueueContent key={`${session.uid}:${session.academyId}:${session.role}`} />
  );
}
function EnrolmentRequestQueueContent() {
  const session = useAdminOrStaffSession();
  const office = session.role === "owner" || session.role === "administrator";
  const [state, setState] = useState<QueueState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<"new" | "recovery">("new");
  const [recoveryLoaded, setRecoveryLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const syncHash = () => {
      const recovery = office && window.location.hash === "#member-recovery";
      setView(recovery ? "recovery" : "new");
      if (recovery) setRecoveryLoaded(true);
    };
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [office]);

  function changeView(next: "new" | "recovery") {
    setView(next);
    if (next === "recovery") setRecoveryLoaded(true);
    window.history.replaceState(
      null,
      "",
      next === "recovery" ? "#member-recovery" : "#new-enrolments",
    );
  }
  const [notes, setNotes] = useState<Readonly<Record<string, string>>>({});
  const [busyId, setBusyId] = useState<string>();
  const [notice, setNotice] = useState<Notice>();
  // Read details are cached per request, because every fetch is audited and spends from the same
  // per-actor budget as reading a member record. Reopening a panel must not cost a second read.
  const [details, setDetails] = useState<Readonly<Record<string, EnrolmentRequestDetail>>>({});
  const [openDetailId, setOpenDetailId] = useState<string>();
  const [catalog, setCatalog] = useState<LevelCatalogProjection>();
  const [setups, setSetups] = useState<Record<string, EnrolmentApprovalSetup["students"]>>({});
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [paymentVerified, setPaymentVerified] = useState<Record<string, boolean>>({});
  const inFlight = useRef(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setRefreshing(true);
    void listEnrolmentRequests()
      .then((queue) => {
        if (active)
          setState({ status: "ready", requests: queue.requests, truncated: queue.truncated });
      })
      .catch(() => {
        if (active) {
          setState((current) => (current.status === "ready" ? current : { status: "error" }));
          setNotice({
            tone: "error",
            text: "Unable to refresh requests. Please try again; any visible requests may be out of date.",
          });
        }
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  useEffect(() => {
    if (openDetailId) reviewHeading.current?.focus();
  }, [openDetailId]);

  async function openDetail(request: EnrolmentRequestRow, refresh = false): Promise<void> {
    if (!refresh && openDetailId === request.enrolmentRequestId) {
      setOpenDetailId(undefined);
      return;
    }
    if (!refresh && details[request.enrolmentRequestId]) {
      setOpenDetailId(request.enrolmentRequestId);
      return;
    }
    setBusyId(request.enrolmentRequestId);
    setNotice(undefined);
    try {
      const [detail, loadedCatalog] = await Promise.all([
        getEnrolmentRequestDetail(request.enrolmentRequestId),
        catalog ? Promise.resolve(catalog) : getLevelCatalog(),
      ]);
      if (!mounted.current) return;
      setCatalog(loadedCatalog);
      const today = new Date().toISOString().slice(0, 10);
      setSetups((current) => ({
        ...current,
        [request.enrolmentRequestId]:
          detail.approvalSetup?.students ??
          (detail.applicantIsStudent
            ? [detail.planSelections?.applicant]
            : detail.minors.map((_, index) => detail.planSelections?.minors[index])
          ).map((planId) => ({
            planId: planId ?? "town-adult",
            definitionKey: "",
            startsOn: today,
            endsOn:
              PLAN_CATALOG.find((plan) => plan.planId === planId)?.billingPeriod === "monthly"
                ? addSubscriptionMonth(`${today}T00:00:00.000Z`).slice(0, 10)
                : null,
          })),
      }));
      setDetails((current) => ({ ...current, [request.enrolmentRequestId]: detail }));
      if (refresh) {
        setVerified((current) => ({ ...current, [request.enrolmentRequestId]: false }));
        setPaymentVerified((current) => ({ ...current, [request.enrolmentRequestId]: false }));
      }
      setOpenDetailId(request.enrolmentRequestId);
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Unable to open this request.",
      });
    } finally {
      setBusyId(undefined);
    }
  }

  async function approve(request: EnrolmentRequestRow): Promise<void> {
    if (inFlight.current) return;
    const students = setups[request.enrolmentRequestId];
    if (
      !students ||
      students.some(
        (student) =>
          !student.definitionKey ||
          !student.startsOn ||
          (enrolmentNeedsPayment(student.planId) && !student.endsOn),
      ) ||
      !verified[request.enrolmentRequestId] ||
      (students.some((student) => enrolmentNeedsPayment(student.planId)) &&
        !paymentVerified[request.enrolmentRequestId])
    ) {
      setNotice({
        tone: "error",
        text: "Choose every student's level and subscription dates, then confirm the details and payment review.",
      });
      return;
    }
    inFlight.current = true;
    setBusyId(request.enrolmentRequestId);
    setNotice(undefined);
    try {
      const outcome = await approveEnrolmentRequest(request.enrolmentRequestId, {
        students,
        detailsVerified: true,
        paymentVerified: true,
      });
      if (!mounted.current) return;
      setNotice({
        tone: "success",
        text: outcome.alreadyApproved
          ? `${request.applicantName} was already enrolled. Nothing changed.`
          : outcome.role === "guardian"
            ? `${request.applicantName} can now sign in, and ${outcome.studentIds.length} ${
                outcome.studentIds.length === 1 ? "child is" : "children are"
              } enrolled.`
            : `${request.applicantName} is enrolled and can now sign in.`,
      });
      setOpenDetailId(undefined);
      // The approval touches the request, the directory and the account. Re-reading the queue is
      // the only way to show what actually happened rather than what was asked for.
      setReloadToken((token) => token + 1);
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Unable to approve this request.",
      });
    } finally {
      inFlight.current = false;
      setBusyId(undefined);
    }
  }

  async function sendBack(request: EnrolmentRequestRow): Promise<void> {
    const note = (notes[request.enrolmentRequestId] ?? "").trim();
    if (note.length === 0) {
      setNotice({ tone: "error", text: "Write what the applicant needs to change." });
      return;
    }
    setBusyId(request.enrolmentRequestId);
    setNotice(undefined);
    try {
      const updated = await returnEnrolmentRequest(request.enrolmentRequestId, note);
      setState((current) =>
        current.status === "ready"
          ? {
              status: "ready",
              truncated: current.truncated,
              requests: current.requests.map((item) =>
                item.enrolmentRequestId === updated.enrolmentRequestId ? updated : item,
              ),
            }
          : current,
      );
      setNotes((current) => ({ ...current, [request.enrolmentRequestId]: "" }));
      setNotice({ tone: "success", text: `Sent back to ${request.applicantName}.` });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Unable to update the request.",
      });
    } finally {
      setBusyId(undefined);
    }
  }

  const visibleRequests =
    state.status === "ready"
      ? state.requests.filter(
          (request) =>
            (filter === "all" ||
              (filter === "action"
                ? isReturnableEnrolmentRequest(request.status)
                : request.status === filter)) &&
            `${request.applicantName} ${request.trainingCenter}`
              .toLowerCase()
              .includes(search.trim().toLowerCase()),
        )
      : [];

  return (
    <section className="admin-module-page enrolment-admin-page" aria-label="Enrolment requests">
      <AdminSectionHeader
        description="Review applications, enrol new students and restore existing member access."
        eyebrow="People"
        title="Enrolment requests"
      />
      {office ? (
        <nav className="enrolment-views" aria-label="Request type">
          <button
            type="button"
            aria-pressed={view === "new"}
            aria-controls="new-enrolments"
            onClick={() => changeView("new")}
          >
            New enrolments
          </button>
          <button
            type="button"
            aria-pressed={view === "recovery"}
            aria-controls="member-recovery"
            onClick={() => changeView("recovery")}
          >
            Member access recovery
          </button>
        </nav>
      ) : null}
      {office ? (
        <section
          id="member-recovery"
          hidden={view !== "recovery"}
          aria-label="Member recovery requests"
        >
          {recoveryLoaded ? <MemberRecoveryQueue embedded /> : null}
        </section>
      ) : null}
      <section id="new-enrolments" hidden={view !== "new"} aria-label="New enrolment requests">
        <div className="enrolment-queue-heading">
          <div>
            <h3>New enrolments</h3>
            <p>
              Open a request to review the details, set the initial level and confirm enrolment.
            </p>
          </div>
          <button
            className="staff-secondary-button"
            type="button"
            disabled={refreshing || busyId !== undefined}
            onClick={() => {
              setNotice(undefined);
              setReloadToken((value) => value + 1);
            }}
          >
            {refreshing ? "Refreshing..." : "Refresh requests"}
          </button>
        </div>
        <div className="enrolment-toolbar">
          <label className="shop-admin-field">
            Search requests
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name or centre"
            />
          </label>
          <label className="shop-admin-field">
            Status
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">All requests</option>
              <option value="action">Needs review</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p role="status">
            {state.status === "ready"
              ? `${visibleRequests.length}${state.truncated ? "+" : ""} requests shown`
              : state.status === "error"
                ? "Requests unavailable"
                : "Loading requests..."}
          </p>
        </div>
        {!office ? (
          <p>
            Full details and enrolment are available to the office. You can send a request back with
            a note.
          </p>
        ) : null}
        {notice ? (
          <p
            className={`admin-panel-card shop-admin-notice shop-admin-notice-${notice.tone}`}
            role={notice.tone === "error" ? "alert" : "status"}
            ref={noticeRef}
            tabIndex={-1}
          >
            {notice.text}
          </p>
        ) : null}

        {state.status === "loading" ? (
          <section className="enrolment-loading" aria-live="polite" role="status">
            Loading enrolment requests...
          </section>
        ) : null}

        {state.status === "error" ? (
          <section className="admin-panel-card" aria-live="assertive" role="alert">
            <p>Unable to load enrolment requests.</p>
            <button
              className="staff-secondary-button"
              disabled={refreshing}
              onClick={() => {
                setNotice(undefined);
                setReloadToken((value) => value + 1);
              }}
              type="button"
            >
              Retry
            </button>
          </section>
        ) : null}

        {state.status === "ready" && state.requests.length === 0 ? (
          <section className="admin-panel-card">
            No enrolment requests yet. They appear here as soon as somebody applies from the site.
          </section>
        ) : null}

        {state.status === "ready" && state.truncated ? (
          <p className="admin-panel-card" role="status">
            This page is full, so older requests are not shown. Resolve what is here before assuming
            the queue is empty.
          </p>
        ) : null}

        {state.status === "ready" && state.requests.length > 0 && visibleRequests.length === 0 ? (
          <div className="enrolment-empty">
            <h3>No matching requests</h3>
            <p>Try another name or status.</p>
            <button
              className="staff-secondary-button"
              type="button"
              onClick={() => {
                setSearch("");
                setFilter("all");
              }}
            >
              Clear filters
            </button>
          </div>
        ) : null}
        {state.status === "ready" && visibleRequests.length > 0 ? (
          <ul className="admin-request-list" aria-label="Enrolment requests">
            {visibleRequests.map((request) => {
              // An approval that stopped is handed back the same way, and it has to be: it is the
              // only way out for an applicant whose enrolment failed for a reason only they can fix.
              const open = isReturnableEnrolmentRequest(request.status);
              const noteId = `enrolment-note-${request.enrolmentRequestId}`;
              return (
                <li
                  className="admin-request-card"
                  key={request.enrolmentRequestId}
                  aria-busy={busyId === request.enrolmentRequestId}
                >
                  <div className="admin-request-head">
                    <strong>{request.applicantName}</strong>
                    <AdminStatusBadge status={statusLabels[request.status]} />
                  </div>
                  <p className="admin-request-meta">
                    {request.applicantIsStudent ? "Adult student" : "Parent or guardian"}
                    {request.minorCount > 0
                      ? ` · ${request.minorCount} ${request.minorCount === 1 ? "child" : "children"}`
                      : ""}
                    {` · ${request.trainingCenter} · sent ${formatDate(request.submittedAt)}`}
                  </p>
                  {open ? (
                    <div className="admin-request-actions">
                      {office ? (
                        <button
                          className={
                            openDetailId === request.enrolmentRequestId
                              ? "staff-secondary-button"
                              : "staff-primary-button"
                          }
                          disabled={busyId !== undefined}
                          onClick={() => void openDetail(request)}
                          aria-controls={`enrolment-review-${request.enrolmentRequestId}`}
                          aria-expanded={openDetailId === request.enrolmentRequestId}
                          type="button"
                        >
                          {busyId === request.enrolmentRequestId
                            ? "Please wait..."
                            : openDetailId === request.enrolmentRequestId
                              ? "Close review"
                              : "Review and enrol"}
                        </button>
                      ) : null}
                      <details className="enrolment-return">
                        <summary>Request changes</summary>
                        <div className="enrolment-return-fields">
                          <label className="shop-admin-field" htmlFor={noteId}>
                            What needs to change
                            <textarea
                              id={noteId}
                              rows={3}
                              maxLength={500}
                              onChange={(event) =>
                                setNotes((current) => ({
                                  ...current,
                                  [request.enrolmentRequestId]: event.target.value,
                                }))
                              }
                              value={notes[request.enrolmentRequestId] ?? ""}
                            />
                          </label>
                          <p>
                            The applicant will see this note and can send their corrected request
                            again.
                          </p>
                          <button
                            className="staff-secondary-button"
                            disabled={busyId !== undefined}
                            onClick={() => void sendBack(request)}
                            type="button"
                          >
                            Send back to applicant
                          </button>
                        </div>
                      </details>
                    </div>
                  ) : null}
                  {office &&
                  openDetailId === request.enrolmentRequestId &&
                  details[request.enrolmentRequestId] ? (
                    <div
                      className="enrolment-review"
                      id={`enrolment-review-${request.enrolmentRequestId}`}
                    >
                      <h3 ref={reviewHeading} tabIndex={-1}>
                        Review and confirm enrolment
                      </h3>
                      <DetailPanel
                        detail={details[request.enrolmentRequestId] as EnrolmentRequestDetail}
                      />
                      <button
                        className="staff-secondary-button"
                        type="button"
                        disabled={busyId !== undefined}
                        onClick={() => void openDetail(request, true)}
                      >
                        Reload full request
                      </button>
                      <fieldset className="enrolment-setup" disabled={busyId !== undefined}>
                        <legend>Subscription and initial level</legend>
                        {(setups[request.enrolmentRequestId] ?? []).map((student, index) => {
                          const change = (patch: Partial<typeof student>) =>
                            setSetups((current) => ({
                              ...current,
                              [request.enrolmentRequestId]: current[
                                request.enrolmentRequestId
                              ]!.map((item, position) =>
                                position === index ? { ...item, ...patch } : item,
                              ),
                            }));
                          const fixed = !!details[request.enrolmentRequestId]?.approvalSetup;
                          return (
                            <fieldset
                              className="enrolment-student-setup"
                              key={index}
                              disabled={fixed}
                            >
                              <legend>
                                {details[request.enrolmentRequestId]?.applicantIsStudent
                                  ? request.applicantName
                                  : details[request.enrolmentRequestId]?.minors[index]?.fullName}
                              </legend>
                              {details[request.enrolmentRequestId]?.planSelections ? (
                                <p>
                                  Plan:{" "}
                                  {
                                    PLAN_CATALOG.find((plan) => plan.planId === student.planId)
                                      ?.displayName
                                  }
                                </p>
                              ) : (
                                <label className="shop-admin-field">
                                  Subscription plan
                                  <select
                                    value={student.planId}
                                    onChange={(event) =>
                                      change({ planId: event.target.value as PlanId })
                                    }
                                  >
                                    {PLAN_CATALOG.map((plan) => (
                                      <option key={plan.planId} value={plan.planId}>
                                        {plan.displayName}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}
                              <label className="shop-admin-field">
                                Initial level
                                <select
                                  value={student.definitionKey}
                                  onChange={(event) =>
                                    change({ definitionKey: event.target.value })
                                  }
                                >
                                  <option value="">Choose a level</option>
                                  {[...(catalog?.definitions ?? [])]
                                    .sort((a, b) => a.sequence - b.sequence)
                                    .map((level) => (
                                      <option key={level.definitionKey} value={level.definitionKey}>
                                        {level.name}
                                      </option>
                                    ))}
                                </select>
                              </label>
                              {student.definitionKey ? (
                                <p className="enrol-selected-level">
                                  Selected level:{" "}
                                  {
                                    catalog?.definitions.find(
                                      (level) => level.definitionKey === student.definitionKey,
                                    )?.name
                                  }
                                </p>
                              ) : null}
                              <label className="shop-admin-field">
                                Subscription start
                                <input
                                  type="date"
                                  max={new Date().toISOString().slice(0, 10)}
                                  value={student.startsOn}
                                  onChange={(event) => change({ startsOn: event.target.value })}
                                />
                              </label>
                              {enrolmentNeedsPayment(student.planId) ? (
                                <label className="shop-admin-field">
                                  Paid period ends
                                  <input
                                    type="date"
                                    value={student.endsOn ?? ""}
                                    min={student.startsOn}
                                    onChange={(event) =>
                                      change({ endsOn: event.target.value || null })
                                    }
                                  />
                                </label>
                              ) : (
                                <p>Pay per class. No initial payment or expiry required.</p>
                              )}
                            </fieldset>
                          );
                        })}
                        <label className="enrol-review-check">
                          <input
                            type="checkbox"
                            checked={verified[request.enrolmentRequestId] ?? false}
                            onChange={(event) =>
                              setVerified((current) => ({
                                ...current,
                                [request.enrolmentRequestId]: event.target.checked,
                              }))
                            }
                          />
                          I have verified the registration details and selected levels.
                        </label>
                        {setups[request.enrolmentRequestId]?.some((student) =>
                          enrolmentNeedsPayment(student.planId),
                        ) ? (
                          <label className="enrol-review-check">
                            <input
                              type="checkbox"
                              checked={paymentVerified[request.enrolmentRequestId] ?? false}
                              onChange={(event) =>
                                setPaymentVerified((current) => ({
                                  ...current,
                                  [request.enrolmentRequestId]: event.target.checked,
                                }))
                              }
                            />
                            I have checked the transfer against the screenshot for the prepaid
                            plans.
                          </label>
                        ) : (
                          <p>No payment review is required for Pay as you go.</p>
                        )}
                        {open ? (
                          <button
                            className="staff-primary-button"
                            type="button"
                            disabled={busyId !== undefined}
                            onClick={() => void approve(request)}
                          >
                            {busyId === request.enrolmentRequestId
                              ? "Enrolling..."
                              : "Confirm enrolment"}
                          </button>
                        ) : null}
                      </fieldset>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </section>
  );
}
