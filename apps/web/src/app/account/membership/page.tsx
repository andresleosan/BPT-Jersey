"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { PLAN_CATALOG, type ParticipantType, type PlanId } from "@bpt-jersey/domain/memberships";
import type { MembershipApplication } from "@bpt-jersey/domain/memberships/intro-conversion";

import { ClientAuthGate, ClientAuthProvider, useClientSession } from "../../../lib/client-auth";
import { getFamily } from "../../../lib/family-client";
import {
  listAvailableMembershipPlans,
  listClientMemberships,
  type AvailableMembershipPlan,
  type ClientMembership,
} from "../../../lib/membership-client";
import { participantBand } from "../../../lib/participant-band";
import { getTrialAccess } from "../../../lib/schedule-client";
import {
  getIntroMembershipContext,
  submitIntroMembershipApplication,
  uploadIntroMembershipProof,
  type IntroMembershipContext,
} from "../../../lib/intro-conversion-client";
import type { TrialAccessView } from "@bpt-jersey/domain/memberships/trial-access";
import { describePlanAccess, formatPlanPrice } from "../../../lib/plan-copy";
import { getClientProfile } from "../../../lib/profile-client";
import { EnrolmentBankDetails } from "../../enrol/payment-instructions";

import "./membership.css";

type Subject = Readonly<{
  studentId: string;
  displayName: string;
  trainingCenter: "Town" | "West";
  participantType: ParticipantType;
}>;

type Workspace = Readonly<{
  plans: readonly AvailableMembershipPlan[];
  memberships: readonly ClientMembership[];
  subjects: readonly Subject[];
  context: IntroMembershipContext;
}>;

const statusLabels: Readonly<Record<ClientMembership["status"], string>> = {
  trial: "Trial",
  active: "Active",
  paused: "Paused",
  overdue: "Payment due",
  cancelled: "Ended",
};

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB");
const planName = (planId: PlanId) =>
  PLAN_CATALOG.find((plan) => plan.planId === planId)?.displayName ?? planId;

/**
 * Choose, change or renew a plan. Payment is the registration's own: a bank transfer with its
 * reference and screenshot, which the academy checks before the plan starts. Pay as you go needs
 * no transfer. The server re-checks eligibility, one open request per member, and the evidence.
 */
function MembershipContent() {
  const { session } = useClientSession();
  const [workspace, setWorkspace] = useState<Workspace>();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState<PlanId | "">("");
  const [reference, setReference] = useState("");
  const [proof, setProof] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [trial, setTrial] = useState<TrialAccessView>();
  const [notice, setNotice] = useState<Readonly<{ kind: "success" | "error"; text: string }>>();
  const paymentHeading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setState("loading");
    setNotice(undefined);
    try {
      const subjectsPromise: Promise<readonly Subject[]> =
        session.role === "guardian"
          ? getFamily().then((family) =>
              family === undefined
                ? []
                : family.students
                    .filter(
                      (student) =>
                        student.active &&
                        student.status === "active" &&
                        student.dateOfBirth !== undefined,
                    )
                    .map((student) => ({
                      studentId: student.studentId,
                      displayName: student.fullName,
                      trainingCenter: student.trainingCenter,
                      participantType: participantBand(student.dateOfBirth!),
                    })),
            )
          : getClientProfile().then((profile) =>
              profile === undefined
                ? []
                : [
                    {
                      studentId: profile.student.studentId,
                      displayName: profile.student.fullName,
                      trainingCenter: profile.student.trainingCenter,
                      participantType: profile.student.dateOfBirth
                        ? participantBand(profile.student.dateOfBirth)
                        : ("adult" as const),
                    },
                  ],
            );
      const [plans, memberships, subjects, context] = await Promise.all([
        listAvailableMembershipPlans(),
        listClientMemberships(),
        subjectsPromise,
        getIntroMembershipContext(),
      ]);
      const next = Object.freeze({ plans, memberships, subjects, context });
      setWorkspace(next);
      setSelectedStudentId((current) =>
        next.subjects.some((subject) => subject.studentId === current)
          ? current
          : (next.subjects[0]?.studentId ?? ""),
      );
      setState("ready");
    } catch {
      setWorkspace(undefined);
      setState("error");
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const subject = workspace?.subjects.find((item) => item.studentId === selectedStudentId);
  const current = workspace?.memberships.find(
    (membership) => membership.studentId === selectedStudentId && membership.status !== "cancelled",
  );
  const applications: readonly MembershipApplication[] =
    workspace?.context.applications.filter((item) => item.studentId === selectedStudentId) ?? [];
  const pending = applications.find((item) => item.status === "pending_review");
  const returned = applications.find(
    (item) => item.status === "needs_correction" || item.status === "rejected",
  );
  // An attended Intro Class leaves a conversion; applying through it closes the intro funnel too.
  const conversion = workspace?.context.conversions.find(
    (item) => item.studentId === selectedStudentId && item.status === "ready",
  );
  const plans = useMemo(
    () =>
      subject === undefined
        ? []
        : (workspace?.plans.filter((plan) =>
            plan.eligibleParticipantTypes.includes(subject.participantType),
          ) ?? []),
    [subject, workspace?.plans],
  );
  const selectedPlan = plans.find((plan) => plan.planId === selectedPlanId);
  const perSession = selectedPlan?.billingPeriod === "per-session";

  // Only a member without a plan can still be on the free trial.
  useEffect(() => {
    setTrial(undefined);
    if (selectedStudentId === "" || current) return;
    let active = true;
    void getTrialAccess(selectedStudentId)
      .then((value) => {
        if (active && value) setTrial(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [selectedStudentId, current]);

  useEffect(() => {
    setSelectedPlanId("");
    setReference("");
    setProof(undefined);
  }, [selectedStudentId]);

  function choosePlan(planId: PlanId): void {
    setSelectedPlanId(planId);
    setNotice(undefined);
    // Move to the payment step the choice just opened.
    requestAnimationFrame(() => {
      paymentHeading.current?.focus();
      paymentHeading.current?.scrollIntoView({ block: "start" });
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!workspace || !subject || !selectedPlan || busy || pending) return;
    if (!perSession && (!proof || reference.trim().length < 2)) {
      setNotice({
        kind: "error",
        text: "Add the transfer reference and a PNG or JPEG screenshot before sending.",
      });
      return;
    }
    setBusy(true);
    setNotice(undefined);
    try {
      const requestId = crypto.randomUUID();
      const proofId = perSession ? null : await uploadIntroMembershipProof(requestId, proof!);
      const saved = await submitIntroMembershipApplication({
        requestId,
        conversionId: conversion?.conversionId ?? null,
        studentId: subject.studentId,
        site: selectedPlan.classSites.includes(subject.trainingCenter)
          ? subject.trainingCenter
          : selectedPlan.classSites[0]!,
        planId: selectedPlan.planId,
        proofId,
        bankReference: perSession ? null : reference.trim(),
      });
      setWorkspace({
        ...workspace,
        context: {
          ...workspace.context,
          applications: [saved, ...workspace.context.applications],
        },
      });
      setSelectedPlanId("");
      setReference("");
      setProof(undefined);
      setNotice({
        kind: "success",
        text: "Sent. The academy will check it and your plan starts once they confirm.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "The request could not be sent. Check the details and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  const liveRenewal = current !== undefined;
  return (
    <main className="client-destination client-membership-page" aria-labelledby="membership-title">
      <a className="client-membership-back" href="/account">
        <span aria-hidden="true">&larr;</span> Back to calendar
      </a>
      <p className="account-eyebrow">BPT Jersey / Membership</p>
      <h1 id="membership-title">Your plan</h1>
      <p className="client-destination-intro">
        Choose a plan, change it or renew it. Pay by bank transfer and the academy confirms it,
        just like registration.
      </p>

      {state === "loading" ? (
        <div className="client-membership-skeleton" aria-busy="true" aria-label="Loading plans">
          <div />
          <div />
          <div />
        </div>
      ) : null}
      {state === "error" ? (
        <section className="client-membership-state" role="alert">
          <h2>Plans are unavailable</h2>
          <p>We could not load your plan. Please try again.</p>
          <button className="button button-secondary" onClick={() => void load()} type="button">
            Try again
          </button>
        </section>
      ) : null}

      {state === "ready" && workspace ? (
        workspace.subjects.length === 0 ? (
          <section className="client-membership-state">
            <h2>No member on this account</h2>
            <p>Ask the academy to link your account to a member first.</p>
          </section>
        ) : (
          <>
            {workspace.subjects.length > 1 ? (
              <label className="client-membership-subject" htmlFor="membership-student">
                Member
                <select
                  id="membership-student"
                  onChange={(event) => {
                    setSelectedStudentId(event.target.value);
                    setNotice(undefined);
                  }}
                  value={selectedStudentId}
                >
                  {workspace.subjects.map((item) => (
                    <option key={item.studentId} value={item.studentId}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <section className="client-current-membership" aria-labelledby="current-plan-title">
              <h2 id="current-plan-title">
                {current ? planName(current.planId) : "No plan yet"}
              </h2>
              {current ? (
                <p className="client-current-line">
                  <strong>{statusLabels[current.status]}</strong>
                  {current.endsAt
                    ? ` · paid until ${dateLabel(current.endsAt)}`
                    : ` · since ${dateLabel(current.startsAt)}`}
                </p>
              ) : trial ? (
                <p className="client-current-line">
                  {trial.status !== "active"
                    ? "Your free trial has ended. Choose a plan to keep training."
                    : trial.attendedCount > 0
                      ? `You've had your first class. Choose a plan below to keep training after your trial (${Math.max(0, trial.allowance - trial.attendedCount - trial.futureBookings)} free class left · ends ${dateLabel(trial.expiresAt)}).`
                      : trial.allowance - trial.attendedCount - trial.futureBookings > 0
                        ? `Free trial · ${trial.allowance - trial.attendedCount - trial.futureBookings} of ${trial.allowance} classes left · ends ${dateLabel(trial.expiresAt)}`
                        : "Your free classes are booked. Choose a plan to keep training after them."}
                </p>
              ) : (
                <p className="client-current-line">
                  Choose a plan below to book classes beyond the free Intro Class.
                </p>
              )}
              {pending ? (
                <p className="client-plan-band client-plan-band-waiting" role="status">
                  Waiting for the academy: {pending.planName}, sent{" "}
                  {dateLabel(pending.createdAt)}. You can send another request once they reply.
                </p>
              ) : returned && returned.updatedAt > (current?.startsAt ?? "") ? (
                <p className="client-plan-band client-plan-band-returned" role="status">
                  {returned.status === "rejected"
                    ? "The academy did not approve your last request"
                    : "The academy asked you to change your last request"}
                  {returned.decisionReason ? `: ${returned.decisionReason}` : "."}
                </p>
              ) : null}
            </section>

            <section className="client-plan-list" aria-labelledby="available-plans-title">
              <h2 id="available-plans-title">{current ? "Change or renew" : "Choose a plan"}</h2>
              {plans.length === 0 ? (
                <p>No plan is open to this member right now. Please contact the academy.</p>
              ) : (
                <fieldset className="client-plan-grid" disabled={busy || pending !== undefined}>
                  <legend className="visually-hidden">Plans</legend>
                  {plans.map((plan) => {
                    const isCurrent = current?.planId === plan.planId;
                    // Billing opens Pay as you go only as a new subscription.
                    const blocked = plan.billingPeriod === "per-session" && liveRenewal;
                    return (
                      <label
                        className={`client-plan-card${isCurrent ? " client-plan-card-current" : ""}`}
                        key={plan.planId}
                      >
                        <input
                          checked={selectedPlanId === plan.planId}
                          disabled={blocked}
                          name="plan"
                          onChange={() => choosePlan(plan.planId)}
                          type="radio"
                          value={plan.planId}
                        />
                        {isCurrent ? <span className="client-plan-tag">Your plan</span> : null}
                        <span className="client-plan-name">{plan.displayName}</span>
                        <strong className="client-plan-price">{formatPlanPrice(plan)}</strong>
                        <span className="client-plan-access">{describePlanAccess(plan)}</span>
                        {blocked ? (
                          <span className="client-plan-access">
                            Ask the academy to move you to Pay as you go.
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </fieldset>
              )}
            </section>

            {selectedPlan && !pending ? (
              <form
                className="client-trial-form client-plan-payment"
                onSubmit={(event) => void submit(event)}
              >
                <h2 ref={paymentHeading} tabIndex={-1}>
                  {perSession ? "Confirm" : "Pay for"} {selectedPlan.displayName}
                </h2>
                {perSession ? (
                  <p>
                    No payment now. You pay for each class when you book it, online by bank
                    transfer or at the academy.
                  </p>
                ) : (
                  <fieldset className="client-plan-transfer" disabled={busy}>
                    <legend className="visually-hidden">Bank transfer evidence</legend>
                    <EnrolmentBankDetails
                      details={
                        workspace.context.instructions && {
                          ...workspace.context.instructions,
                          acceptsCash: false,
                        }
                      }
                      error={false}
                      onRetry={() => void load()}
                    />
                    <p className="client-plan-total">
                      Transfer total <strong>£{(selectedPlan.priceMinor / 100).toFixed(2)}</strong>
                    </p>
                    <label htmlFor="plan-reference">Transfer reference</label>
                    <input
                      id="plan-reference"
                      maxLength={120}
                      onChange={(event) => setReference(event.target.value)}
                      value={reference}
                    />
                    <label htmlFor="plan-proof">Payment screenshot (PNG or JPEG, up to 2 MB)</label>
                    <input
                      accept="image/png,image/jpeg"
                      id="plan-proof"
                      onChange={(event) => setProof(event.target.files?.[0])}
                      type="file"
                    />
                    <p>
                      Only academy administrators see your screenshot.
                      {current
                        ? " Your new period starts when they confirm the transfer."
                        : " Your plan starts when they confirm the transfer."}
                    </p>
                  </fieldset>
                )}
                <div className="client-trial-actions">
                  <button className="button button-primary" disabled={busy} type="submit">
                    {busy ? "Sending..." : "Send to the academy"}
                  </button>
                  <button
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => setSelectedPlanId("")}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}
          </>
        )
      ) : null}
      {notice ? (
        <p
          className={`client-membership-notice client-membership-notice-${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}
    </main>
  );
}

export default function ClientMembershipPage() {
  return (
    <ClientAuthProvider>
      <ClientAuthGate returnPath="/account/membership">
        <MembershipContent />
      </ClientAuthGate>
    </ClientAuthProvider>
  );
}
