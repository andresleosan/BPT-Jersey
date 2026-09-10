"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { ParticipantType, PlanId } from "@bpt-jersey/domain/memberships";

import { ClientAuthGate, ClientAuthProvider, useClientSession } from "../../../lib/client-auth";
import { getFamily } from "../../../lib/family-client";
import {
  listAvailableMembershipPlans,
  listClientMemberships,
  startTrialMembership,
  type AvailableMembershipPlan,
  type ClientMembership,
} from "../../../lib/membership-client";
import { getClientProfile } from "../../../lib/profile-client";

import "./membership.css";

type Subject = Readonly<{
  studentId: string;
  familyId: string;
  displayName: string;
  trainingCenter: "Town" | "West";
  participantType: ParticipantType;
}>;

type Workspace = Readonly<{
  plans: readonly AvailableMembershipPlan[];
  memberships: readonly ClientMembership[];
  subjects: readonly Subject[];
}>;

const moneyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

function planPeriod(plan: AvailableMembershipPlan): string {
  if (plan.billingPeriod === "per-session") return "per session";
  return "per month";
}

function participantBand(dateOfBirth: string): ParticipantType {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dateOfBirth);
  if (!parts) return "adult";
  const today = new Date();
  let age = today.getUTCFullYear() - Number(parts[1]);
  const month = Number(parts[2]) - 1;
  const day = Number(parts[3]);
  if (today.getUTCMonth() < month || (today.getUTCMonth() === month && today.getUTCDate() < day)) {
    age -= 1;
  }
  if (age >= 18) return "adult";
  return age >= 12 ? "teens" : "kids";
}

function MembershipContent() {
  const { session } = useClientSession();
  const [workspace, setWorkspace] = useState<Workspace>();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState<PlanId | "">("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Readonly<{ kind: "success" | "error"; text: string }>>();

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
                    .filter((student) => student.active && student.status === "active")
                    .map((student) => ({
                      studentId: student.studentId,
                      familyId: family.family.familyId,
                      displayName: student.fullName,
                      trainingCenter: student.trainingCenter,
                      participantType: participantBand(student.dateOfBirth),
                    })),
            )
          : getClientProfile().then((profile) =>
              profile?.student.familyId === undefined
                ? []
                : [
                    {
                      studentId: profile.student.studentId,
                      familyId: profile.student.familyId,
                      displayName: profile.student.fullName,
                      trainingCenter: profile.student.trainingCenter,
                      participantType: "adult" as const,
                    },
                  ],
            );
      const [plans, memberships, subjects] = await Promise.all([
        listAvailableMembershipPlans(),
        listClientMemberships(),
        subjectsPromise,
      ]);
      const next = Object.freeze({
        plans,
        memberships,
        subjects: Object.freeze(subjects),
      });
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
  const selectedSubject = workspace?.subjects.find(
    (subject) => subject.studentId === selectedStudentId,
  );
  const eligiblePlans = useMemo(
    () =>
      selectedSubject === undefined
        ? []
        : (workspace?.plans.filter(
            (plan) =>
              plan.classSites.includes(selectedSubject.trainingCenter) &&
              plan.eligibleParticipantTypes.includes(selectedSubject.participantType),
          ) ?? []),
    [selectedSubject, workspace?.plans],
  );
  const currentMemberships =
    workspace?.memberships.filter((membership) => membership.studentId === selectedStudentId) ?? [];
  const hasCurrentMembership = currentMemberships.some(
    (membership) => membership.status === "trial" || membership.status === "active",
  );

  useEffect(() => {
    setSelectedPlanId((current) =>
      eligiblePlans.some((plan) => plan.planId === current)
        ? current
        : (eligiblePlans[0]?.planId ?? ""),
    );
  }, [eligiblePlans]);
  async function startTrial(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedSubject || selectedPlanId === "" || busy || hasCurrentMembership) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const created = await startTrialMembership({
        familyId: selectedSubject.familyId,
        studentId: selectedSubject.studentId,
        planId: selectedPlanId,
      });
      setWorkspace((current) =>
        current
          ? { ...current, memberships: Object.freeze([...current.memberships, created]) }
          : current,
      );
      setNotice({ kind: "success", text: "Trial membership started." });
    } catch {
      setNotice({
        kind: "error",
        text: "The trial could not be started. A current accepted waiver is required.",
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="client-destination client-membership-page" aria-labelledby="membership-title">
      <a className="client-membership-back" href="/account">
        <span aria-hidden="true">&larr;</span> Back to account
      </a>
      <p className="account-eyebrow">BPT Jersey / Membership</p>
      <h1 id="membership-title">Plans & membership</h1>
      <p className="client-destination-intro">
        View your current status or start an eligible trial after the waiver has been accepted.
      </p>

      {state === "loading" ? (
        <p className="client-membership-state" aria-live="polite" role="status">
          Loading membership options...
        </p>
      ) : null}
      {state === "error" ? (
        <section className="client-membership-state" role="alert">
          <h2>Memberships are unavailable</h2>
          <p>No membership details were displayed.</p>
          <button className="button button-secondary" onClick={() => void load()} type="button">
            Try again
          </button>
        </section>
      ) : null}

      {state === "ready" && workspace ? (
        <>
          {workspace.subjects.length === 0 ? (
            <section className="client-membership-state">
              <h2>No eligible participant</h2>
              <p>Complete your profile or ask the academy to link your family first.</p>
            </section>
          ) : (
            <>
              <label className="client-membership-subject" htmlFor="membership-student">
                Participant
                <select
                  id="membership-student"
                  onChange={(event) => {
                    setSelectedStudentId(event.target.value);
                    setNotice(undefined);
                  }}
                  value={selectedStudentId}
                >
                  {workspace.subjects.map((subject) => (
                    <option key={subject.studentId} value={subject.studentId}>
                      {subject.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <section
                className="client-current-membership"
                aria-labelledby="current-membership-title"
              >
                <p className="account-eyebrow">Current record</p>
                <h2 id="current-membership-title">Membership status</h2>
                {currentMemberships.length === 0 ? (
                  <p>No membership has been created for this participant.</p>
                ) : (
                  <ul>
                    {currentMemberships.map((membership) => (
                      <li key={membership.membershipId}>
                        <strong>{membership.planId}</strong>
                        <span>{membership.status.replace("_", " ")}</span>
                        <span>
                          Started {new Date(membership.startsAt).toLocaleDateString("en-GB")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="client-plan-list" aria-labelledby="available-plans-title">
                <div>
                  <p className="account-eyebrow">Eligible at {selectedSubject?.trainingCenter}</p>
                  <h2 id="available-plans-title">Available plans</h2>
                </div>
                {eligiblePlans.length === 0 ? (
                  <p>No active plan matches this participant and training centre.</p>
                ) : (
                  <div className="client-plan-grid">
                    {eligiblePlans.map((plan) => (
                      <article className="client-plan-card" key={plan.planId}>
                        <h3>{plan.displayName}</h3>
                        <p>
                          <strong>{moneyFormatter.format(plan.priceMinor / 100)}</strong>{" "}
                          {planPeriod(plan)}
                        </p>
                        <span>
                          {plan.weeklyClassLimit === null
                            ? "Unlimited weekly classes"
                            : `${plan.weeklyClassLimit} class${plan.weeklyClassLimit === 1 ? "" : "es"} per week`}
                        </span>
                      </article>
                    ))}
                  </div>
                )}
              </section>
              <form className="client-trial-form" onSubmit={(event) => void startTrial(event)}>
                <label htmlFor="trial-plan">Trial plan</label>
                <select
                  disabled={busy || hasCurrentMembership || eligiblePlans.length === 0}
                  id="trial-plan"
                  onChange={(event) => setSelectedPlanId(event.target.value as PlanId)}
                  required
                  value={selectedPlanId}
                >
                  {eligiblePlans.map((plan) => (
                    <option key={plan.planId} value={plan.planId}>
                      {plan.displayName}
                    </option>
                  ))}
                </select>
                <p>
                  The backend verifies participant age, training centre and the latest accepted
                  waiver before creating the trial.
                </p>
                <div className="client-trial-actions">
                  <button
                    className="button button-primary"
                    disabled={busy || hasCurrentMembership || selectedPlanId === ""}
                    type="submit"
                  >
                    {busy ? "Starting trial..." : "Start trial membership"}
                  </button>
                  <a className="button button-secondary" href="/account/waiver">
                    Review waiver
                  </a>
                </div>
              </form>
            </>
          )}
          {notice ? (
            <p
              className={`client-membership-notice client-membership-notice-${notice.kind}`}
              role={notice.kind === "error" ? "alert" : "status"}
            >
              {notice.text}
            </p>
          ) : null}
        </>
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
