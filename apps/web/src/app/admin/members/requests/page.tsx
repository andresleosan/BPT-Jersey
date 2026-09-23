"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { PLAN_CATALOG, type PlanId } from "@bpt-jersey/domain/memberships";
import { getLevelCatalog } from "../../../../lib/levels-client";
import type { LevelCatalogProjection, LevelDefinitionRecord } from "@bpt-jersey/domain/levels";
import { addSubscriptionMonth } from "@bpt-jersey/domain/memberships/admin";
import { formatPlanPrice } from "../../../../lib/plan-copy";
import { ageOnDate } from "@bpt-jersey/domain/schedule/member-calendar";
import { defaultWhiteBelt, stripesForBelt } from "../../../enrol/level-declaration";

import {
  isReturnableEnrolmentRequest,
  type EnrolmentApprovalSetup,
  type EnrolmentLevelDeclaration,
  type EnrolmentPlanChoice,
  enrolmentNeedsPayment,
  enrolmentStudents,
  enrolmentTrialAllowance,
  trialPlanChoice,
  type EnrolmentRequestRow,
} from "@bpt-jersey/domain/members/enrolment-requests";
import {
  approveEnrolmentRequest,
  getEnrolmentRequestDetail,
  listEnrolmentRequests,
  returnEnrolmentRequest,
  type EnrolmentRequestOfficeDetail,
} from "../../../../lib/enrolment-client";
import { useAdminOrStaffSession } from "../../admin-gate";
import { AdminSectionHeader, AdminStatusBadge } from "../../admin-ui";
import { PlanRequestsPanel } from "./plan-requests-panel";

import "../../admin.css";
import "./requests.css";

const IntroApplicationsPanel = dynamic(
  () =>
    import("../../billing/intro-applications-panel").then(
      (module) => module.IntroApplicationsPanel,
    ),
  { loading: () => <p role="status">Loading membership requests...</p> },
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

function PlanPreference({
  planId,
  declaration,
}: Readonly<{
  planId: EnrolmentPlanChoice | undefined;
  declaration: EnrolmentLevelDeclaration | undefined;
}>) {
  if (planId === trialPlanChoice) {
    const allowance = enrolmentTrialAllowance(declaration?.experience ?? "beginner");
    return (
      <p className="admin-request-meta">
        <strong>Requested plan:</strong>{" "}
        {allowance === 2
          ? "Trial (2 free Introduction Classes)"
          : "Trial (1 free Introduction Class)"}
      </p>
    );
  }
  const plan = PLAN_CATALOG.find((item) => item.planId === planId);
  return (
    <p className="admin-request-meta">
      <strong>Requested plan:</strong>{" "}
      {plan ? `${plan.displayName} · ${formatPlanPrice(plan)}` : "Not recorded on this request"}
    </p>
  );
}

/** "BLUE BELT" -> "Blue belt", matched against catalogue belt names read as a sentence. */
function formatBeltName(name: string): string {
  return `${name.charAt(0)}${name.slice(1).toLowerCase()}`;
}

/** `Level: Beginner` or `Level: Blue belt · 2 stripes (declared)`, or undefined with no declaration. */
function levelDeclarationLabel(
  declaration: EnrolmentLevelDeclaration | undefined,
  definitions: readonly LevelDefinitionRecord[],
): string | undefined {
  if (!declaration) return undefined;
  if (declaration.experience === "beginner") return "Beginner";
  const declared = definitions.find((item) => item.definitionKey === declaration.declaredLevelKey);
  if (!declared) return undefined;
  const belt =
    declared.kind === "stripe"
      ? definitions.find((item) => item.definitionKey === declared.parentDefinitionKey)
      : declared;
  const beltLabel = formatBeltName(belt?.name ?? declared.name);
  if (declared.kind !== "stripe" || !belt) return `${beltLabel} (declared)`;
  const stripes = stripesForBelt(definitions, belt.definitionKey).find(
    (item) => item.definitionKey === declared.definitionKey,
  )?.stripes;
  return stripes
    ? `${beltLabel} · ${stripes} stripe${stripes === 1 ? "" : "s"} (declared)`
    : `${beltLabel} (declared)`;
}

function DetailPanel({
  detail,
  definitions,
}: Readonly<{
  detail: EnrolmentRequestOfficeDetail;
  definitions: readonly LevelDefinitionRecord[];
}>) {
  const { applicant } = detail;
  const applicantLevel = levelDeclarationLabel(detail.levelDeclarations?.applicant, definitions);
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
        <>
          <PlanPreference
            planId={detail.planSelections?.applicant}
            declaration={detail.levelDeclarations?.applicant}
          />
          {applicantLevel ? <p className="admin-request-meta">Level: {applicantLevel}</p> : null}
        </>
      ) : null}
      {detail.minors.length > 0 ? (
        <ul className="admin-request-minors" aria-label="Children in their care">
          {detail.minors.map((minor, index) => {
            const minorLevel = levelDeclarationLabel(
              detail.levelDeclarations?.minors[index],
              definitions,
            );
            return (
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
                <PlanPreference
                  planId={detail.planSelections?.minors[index]}
                  declaration={detail.levelDeclarations?.minors[index]}
                />
                {minorLevel ? <p className="admin-request-meta">Level: {minorLevel}</p> : null}
              </li>
            );
          })}
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

/**
 * What the office must know about the applicant's account before approving. Email verification is
 * not one of them (D8, 2026-09-23): the approval itself vouches for the account.
 */
function AccountNotice({ detail }: Readonly<{ detail: EnrolmentRequestOfficeDetail }>) {
  const account = detail.applicantAccount;
  if (!account)
    return (
      <p className="enrolment-email-warning" role="status">
        Account email status is unavailable. Reload this request before approving.
      </p>
    );
  if (account.disabled)
    return (
      <p className="enrolment-email-warning" role="alert">
        The applicant account is disabled. Restore it before approving.
      </p>
    );
  const sameEmail =
    !detail.applicant.email ||
    detail.applicant.email.trim().toLowerCase() === account.email.trim().toLowerCase();
  if (!sameEmail)
    return (
      <p className="enrolment-email-warning" role="alert">
        The account email {account.email} differs from the application. Return the request for
        correction before approving.
      </p>
    );
  return null;
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
  const [membershipRequestsLoaded, setMembershipRequestsLoaded] = useState(false);
  const membershipRequestsRef = useRef<HTMLElement>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    if (!office || membershipRequestsLoaded) return;
    const element = membershipRequestsRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setMembershipRequestsLoaded(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setMembershipRequestsLoaded(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [office, membershipRequestsLoaded]);

  const [notes, setNotes] = useState<Readonly<Record<string, string>>>({});
  // Which trial label the office picked; both grant the same trial and the age decides the classes.
  const [trialKinds, setTrialKinds] = useState<Readonly<Record<string, "adults" | "kids">>>({});
  const [busyId, setBusyId] = useState<string>();
  const [notice, setNotice] = useState<Notice>();
  // Read details are cached per request, because every fetch is audited and spends from the same
  // per-actor budget as reading a member record. Reopening a panel must not cost a second read.
  const [details, setDetails] = useState<Readonly<Record<string, EnrolmentRequestOfficeDetail>>>(
    {},
  );
  const [openDetailId, setOpenDetailId] = useState<string>();
  const [catalog, setCatalog] = useState<LevelCatalogProjection>();
  const [setups, setSetups] = useState<Record<string, EnrolmentApprovalSetup["students"]>>({});
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
          enrolmentStudents(detail).map(({ plan: planId, declaration, person }) => {
            const dateOfBirth = person.dateOfBirth;
            const age = dateOfBirth ? ageOnDate(dateOfBirth, today) : 0;
            // Preselect only for a trial plan. The public enrolment form sends a `beginner`
            // declaration by default for every student, trial or paid, so gating on the
            // declaration's presence would preselect a paid enrolment too; a paid enrolment must
            // still start with an empty level, so the "choose every student's level" guard in
            // `approve()` keeps firing for it.
            return {
              planId: planId ?? "town-adult",
              definitionKey:
                planId === trialPlanChoice
                  ? (declaration?.declaredLevelKey ??
                    defaultWhiteBelt(loadedCatalog.definitions, age) ??
                    "")
                  : "",
              startsOn: today,
              endsOn:
                PLAN_CATALOG.find((plan) => plan.planId === planId)?.billingPeriod === "monthly"
                  ? addSubscriptionMonth(`${today}T00:00:00.000Z`).slice(0, 10)
                  : null,
            };
          }),
      }));
      setDetails((current) => ({ ...current, [request.enrolmentRequestId]: detail }));
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
      )
    ) {
      setNotice({
        tone: "error",
        text: "Choose every student's level and subscription dates before approving.",
      });
      return;
    }
    inFlight.current = true;
    setBusyId(request.enrolmentRequestId);
    setNotice(undefined);
    try {
      // The office's Approve action confirms the submitted setup without separate checkboxes.
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
      // A server-side attempt may have committed part of the work and changed the request to
      // approval-failed. Refresh its badge while keeping the review setup available for retry.
      setReloadToken((token) => token + 1);
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
        description="Review applications and enrol new students."
        eyebrow="People"
        title="Enrolment requests"
      />
      <section id="new-enrolments" aria-label="New enrolment requests">
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
                        detail={details[request.enrolmentRequestId] as EnrolmentRequestOfficeDetail}
                        definitions={catalog?.definitions ?? []}
                      />
                      <AccountNotice
                        detail={details[request.enrolmentRequestId] as EnrolmentRequestOfficeDetail}
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
                                {(() => {
                                  const detail = details[request.enrolmentRequestId];
                                  return detail
                                    ? enrolmentStudents(detail)[index]?.person.fullName
                                    : undefined;
                                })()}
                              </legend>
                              {(() => {
                                const detail = details[request.enrolmentRequestId];
                                const entry = detail ? enrolmentStudents(detail)[index] : undefined;
                                const chosen = entry?.plan;
                                const dateOfBirth = entry?.person.dateOfBirth;
                                const age = dateOfBirth
                                  ? ageOnDate(dateOfBirth, new Date().toISOString().slice(0, 10))
                                  : 16;
                                const kindKey = `${request.enrolmentRequestId}:${index}`;
                                const trialKind = trialKinds[kindKey] ?? (age >= 16 ? "adults" : "kids");
                                // The applicant's own choice stays fixed; the office may still switch it to a trial.
                                const plans =
                                  chosen && chosen !== trialPlanChoice
                                    ? PLAN_CATALOG.filter((plan) => plan.planId === chosen)
                                    : chosen
                                      ? []
                                      : PLAN_CATALOG;
                                return (
                                  <label className="shop-admin-field">
                                    Subscription plan
                                    <select
                                      value={student.planId === trialPlanChoice ? `trial:${trialKind}` : student.planId}
                                      onChange={(event) => {
                                        const value = event.target.value;
                                        if (value.startsWith("trial:")) {
                                          setTrialKinds((current) => ({
                                            ...current,
                                            [kindKey]: value.slice(6) as "adults" | "kids",
                                          }));
                                          change({ planId: trialPlanChoice, endsOn: null });
                                          return;
                                        }
                                        const planId = value as PlanId;
                                        change({
                                          planId,
                                          endsOn:
                                            PLAN_CATALOG.find((plan) => plan.planId === planId)
                                              ?.billingPeriod === "monthly"
                                              ? addSubscriptionMonth(`${student.startsOn}T00:00:00.000Z`).slice(0, 10)
                                              : null,
                                        });
                                      }}
                                    >
                                      {plans.map((plan) => (
                                        <option key={plan.planId} value={plan.planId}>
                                          {plan.displayName}
                                          {chosen === plan.planId ? " (applicant's choice)" : ""}
                                        </option>
                                      ))}
                                      <option value="trial:adults">Trial for adults</option>
                                      <option value="trial:kids">Trial for kids/teens</option>
                                    </select>
                                  </label>
                                );
                              })()}
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
                              {student.planId === trialPlanChoice ? (
                                <p>
                                  Trial — no plan, dates or payment: 2 free classes for a beginner, 1 for
                                  a declared belt, within 30 days. Adults book Introduction Classes only.
                                  Confirm the initial level.
                                </p>
                              ) : (
                                <>
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
                                </>
                              )}
                            </fieldset>
                          );
                        })}
                        <p>
                          Approve enrols the student with the level and subscription dates above.
                        </p>
                        {open ? (
                          <button
                            className="staff-primary-button"
                            type="button"
                            disabled={
                              busyId !== undefined ||
                              !details[request.enrolmentRequestId]?.applicantAccount ||
                              details[request.enrolmentRequestId]?.applicantAccount?.disabled ===
                                true ||
                              (details[request.enrolmentRequestId]?.applicant.email !== undefined &&
                                details[request.enrolmentRequestId]?.applicant.email
                                  ?.trim()
                                  .toLowerCase() !==
                                  details[request.enrolmentRequestId]?.applicantAccount?.email
                                    .trim()
                                    .toLowerCase())
                            }
                            onClick={() => void approve(request)}
                          >
                            {busyId === request.enrolmentRequestId ? "Enrolling..." : "Approve"}
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
      {office ? <PlanRequestsPanel /> : null}
      {office ? (
        <section
          aria-labelledby="membership-requests-title"
          className="admin-panel-card"
          ref={membershipRequestsRef}
        >
          <div className="admin-panel-card-heading">
            <div>
              <h3 id="membership-requests-title">Membership requests</h3>
            </div>
          </div>
          {membershipRequestsLoaded ? (
            <IntroApplicationsPanel />
          ) : (
            <button
              className="staff-secondary-button"
              type="button"
              onClick={() => setMembershipRequestsLoaded(true)}
            >
              Load membership requests
            </button>
          )}
        </section>
      ) : null}
    </section>
  );
}
