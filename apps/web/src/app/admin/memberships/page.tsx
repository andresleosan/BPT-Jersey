"use client";

import Link from "next/link";
import { startTransition, useEffect, useMemo, useState } from "react";

import {
  PLAN_CATALOG,
  billingPeriods,
  participantTypes,
  planIds,
  siteValues,
  type ParticipantType,
  type PlanDraft,
  type PlanId,
  type Site,
} from "@bpt-jersey/domain/memberships";
import {
  membershipTransitionTargets,
  type MembershipStatus,
} from "@bpt-jersey/domain/memberships/lifecycle";

import {
  cancelMembership,
  createMembership,
  listManagedPlans,
  listMemberships,
  saveMembershipPlan,
  setMembershipPlanActive,
  transitionMembership,
  type AdminMembership,
  type ManagedMembershipPlan,
} from "../../../lib/membership-admin-client";
import { listMembers } from "../../../lib/members-client";
import { AdminSectionHeader, AdminStatusBadge } from "../admin-ui";

import "../admin.css";

type WorkspaceState =
  | Readonly<{ status: "loading" }>
  | Readonly<{
      status: "ready";
      plans: readonly ManagedMembershipPlan[];
      memberships: readonly AdminMembership[];
    }>
  | Readonly<{ status: "error" }>;

type Notice = Readonly<{ tone: "error" | "success"; text: string }>;

/** Minimized directory row: the general canonical row carries no identifiers or contact data. */
type DirectoryStudent = Readonly<{
  studentId: string;
  fullName: string;
  participantType: string;
  trainingCenter: string;
  active: boolean;
  status: string;
}>;
type DirectoryState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; students: readonly DirectoryStudent[] }>
  | Readonly<{ status: "error" }>;

function studentLabel(student: DirectoryStudent): string {
  return `${student.fullName} (${student.participantType}, ${student.trainingCenter})`;
}

const initialPlanId = planIds[0]!;
const initialPlan = PLAN_CATALOG.find((plan) => plan.planId === initialPlanId)!;
const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function copyPlan(plan: PlanDraft): PlanDraft {
  return {
    planId: plan.planId,
    displayName: plan.displayName,
    priceMinor: plan.priceMinor,
    currency: plan.currency,
    billingPeriod: plan.billingPeriod,
    eligibleParticipantTypes: [...plan.eligibleParticipantTypes],
    classSites: [...plan.classSites],
    weeklyClassLimit: plan.weeklyClassLimit,
    openMatSites: [...plan.openMatSites],
    openMatFeeMinor: plan.openMatFeeMinor,
  };
}

function formatMoney(priceMinor: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(priceMinor / 100);
}

function replacePlan(
  plans: readonly ManagedMembershipPlan[],
  replacement: ManagedMembershipPlan,
): readonly ManagedMembershipPlan[] {
  const next = plans.some((plan) => plan.planId === replacement.planId)
    ? plans.map((plan) => (plan.planId === replacement.planId ? replacement : plan))
    : [...plans, replacement];
  return Object.freeze(
    [...next].sort((left, right) => planIds.indexOf(left.planId) - planIds.indexOf(right.planId)),
  );
}

function replaceMembership(
  memberships: readonly AdminMembership[],
  replacement: AdminMembership,
): readonly AdminMembership[] {
  return memberships.some((membership) => membership.membershipId === replacement.membershipId)
    ? Object.freeze(
        memberships.map((membership) =>
          membership.membershipId === replacement.membershipId ? replacement : membership,
        ),
      )
    : Object.freeze([replacement, ...memberships]);
}

function transitionLabel(current: MembershipStatus, target: MembershipStatus): string {
  if (target === "active") return current === "trial" ? "Activate" : "Reactivate";
  if (target === "paused") return "Pause";
  if (target === "overdue") return "Mark overdue";
  return "Change status";
}

function toggleValue<T extends string>(
  values: readonly T[],
  value: T,
  checked: boolean,
): readonly T[] {
  if (checked) return values.includes(value) ? values : [...values, value];
  return values.filter((candidate) => candidate !== value);
}

function PlanCatalog({ plans }: { plans: readonly ManagedMembershipPlan[] }) {
  const records = new Map(plans.map((plan) => [plan.planId, plan]));

  return (
    <div className="admin-data-table-wrap">
      <table className="admin-data-table">
        <caption className="visually-hidden">Membership plan catalog</caption>
        <thead>
          <tr>
            <th scope="col">Plan</th>
            <th scope="col">Billing</th>
            <th scope="col">Price</th>
            <th scope="col">Participants</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {planIds.map((planId) => {
            const configured = records.get(planId);
            const baseline = PLAN_CATALOG.find((plan) => plan.planId === planId)!;
            const plan = configured ?? baseline;
            const status = configured
              ? configured.active
                ? "Active"
                : "Inactive"
              : "Not configured";
            return (
              <tr key={planId}>
                <td>
                  <strong>{plan.displayName}</strong>
                  <small className="membership-secondary-text">{planId}</small>
                </td>
                <td>{plan.billingPeriod === "monthly" ? "Monthly" : "Per session"}</td>
                <td>{formatMoney(plan.priceMinor)}</td>
                <td>{plan.eligibleParticipantTypes.join(", ")}</td>
                <td>
                  <AdminStatusBadge status={status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MembershipsAdminPage() {
  const [workspace, setWorkspace] = useState<WorkspaceState>({ status: "loading" });
  const [selectedPlanId, setSelectedPlanId] = useState<PlanId>(initialPlanId);
  const [planDraft, setPlanDraft] = useState<PlanDraft>(() => copyPlan(initialPlan));
  const [directory, setDirectory] = useState<DirectoryState>({ status: "loading" });
  const [studentId, setStudentId] = useState("");
  const [membershipPlanId, setMembershipPlanId] = useState<PlanId | "">("");
  const [initialStatus, setInitialStatus] = useState<"trial" | "active">("trial");
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<Notice>();

  useEffect(() => {
    // Entry links (family workspace, member record) preselect the student; the billing family is
    // derived by the backend from the canonical record, so a familyId parameter is ignored.
    const requestedStudentId = new URLSearchParams(window.location.search).get("studentId");
    if (requestedStudentId === null || !opaqueIdPattern.test(requestedStudentId)) return;
    setStudentId(requestedStudentId);
  }, []);

  useEffect(() => {
    let mounted = true;
    void listMembers(50)
      .then((page) => {
        if (!mounted) return;
        startTransition(() => {
          setDirectory({
            status: "ready",
            students: page.rows.filter((row) => row.active && row.status === "active"),
          });
        });
      })
      .catch(() => {
        if (mounted) setDirectory({ status: "error" });
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void Promise.all([listManagedPlans(), listMemberships()])
      .then(([plans, memberships]) => {
        if (!mounted) return;
        const firstConfiguredPlan = plans[0];
        const firstDraft = firstConfiguredPlan ?? initialPlan;
        const firstActivePlan = plans.find((plan) => plan.active);
        startTransition(() => {
          setWorkspace({ status: "ready", plans, memberships });
          setSelectedPlanId(firstDraft.planId);
          setPlanDraft(copyPlan(firstDraft));
          setMembershipPlanId(firstActivePlan?.planId ?? "");
        });
      })
      .catch(() => {
        if (mounted) startTransition(() => setWorkspace({ status: "error" }));
      });
    return () => {
      mounted = false;
    };
  }, []);

  const configuredPlan =
    workspace.status === "ready"
      ? workspace.plans.find((plan) => plan.planId === selectedPlanId)
      : undefined;
  const activePlans = useMemo(
    () => (workspace.status === "ready" ? workspace.plans.filter((plan) => plan.active) : []),
    [workspace],
  );

  function updateWorkspacePlan(plan: ManagedMembershipPlan): void {
    setWorkspace((current) =>
      current.status === "ready"
        ? { ...current, plans: replacePlan(current.plans, plan) }
        : current,
    );
  }

  function updateWorkspaceMembership(membership: AdminMembership): void {
    setWorkspace((current) =>
      current.status === "ready"
        ? { ...current, memberships: replaceMembership(current.memberships, membership) }
        : current,
    );
  }

  function choosePlan(planId: PlanId): void {
    if (workspace.status !== "ready") return;
    const selected =
      workspace.plans.find((plan) => plan.planId === planId) ??
      PLAN_CATALOG.find((plan) => plan.planId === planId);
    if (!selected) return;
    setSelectedPlanId(planId);
    setPlanDraft(copyPlan(selected));
    setNotice(undefined);
  }

  async function handleSavePlan(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy("save-plan");
    setNotice(undefined);
    try {
      const saved = await saveMembershipPlan(planDraft);
      updateWorkspacePlan(saved);
      setPlanDraft(copyPlan(saved));
      setNotice({ tone: "success", text: "Membership plan saved." });
    } catch {
      setNotice({ tone: "error", text: "Unable to save membership plan. Please try again." });
    } finally {
      setBusy(undefined);
    }
  }

  async function handlePlanStatus(): Promise<void> {
    if (!configuredPlan) return;
    const target = !configuredPlan.active;
    setBusy("plan-status");
    setNotice(undefined);
    try {
      const updated = await setMembershipPlanActive(configuredPlan.planId, target);
      updateWorkspacePlan(updated);
      setPlanDraft(copyPlan(updated));
      if (target && membershipPlanId === "") setMembershipPlanId(updated.planId);
      if (!target && membershipPlanId === updated.planId) {
        const fallback = activePlans.find((plan) => plan.planId !== updated.planId);
        setMembershipPlanId(fallback?.planId ?? "");
      }
      setNotice({
        tone: "success",
        text: target ? "Membership plan activated." : "Membership plan deactivated.",
      });
    } catch {
      setNotice({
        tone: "error",
        text: "Unable to change membership plan status. Please try again.",
      });
    } finally {
      setBusy(undefined);
    }
  }

  async function handleCreateMembership(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (studentId === "") {
      setNotice({ tone: "error", text: "Select a student from the member directory." });
      return;
    }
    if (membershipPlanId === "") {
      setNotice({ tone: "error", text: "Select an active membership plan." });
      return;
    }
    setBusy("create-membership");
    setNotice(undefined);
    try {
      const created = await createMembership({
        studentId,
        planId: membershipPlanId,
        status: initialStatus,
      });
      updateWorkspaceMembership(created);
      setStudentId("");
      setNotice({ tone: "success", text: "Membership created." });
    } catch {
      setNotice({
        tone: "error",
        text: "Unable to create membership. Refresh before trying again.",
      });
    } finally {
      setBusy(undefined);
    }
  }

  async function handleTransition(
    membership: AdminMembership,
    targetStatus: MembershipStatus,
  ): Promise<void> {
    if (!membershipTransitionTargets[membership.status].includes(targetStatus)) return;
    setBusy(`membership-${membership.membershipId}`);
    setNotice(undefined);
    try {
      const updated =
        targetStatus === "cancelled"
          ? await cancelMembership(membership.membershipId)
          : await transitionMembership({
              membershipId: membership.membershipId,
              targetStatus,
            });
      updateWorkspaceMembership(updated);
      setNotice({
        tone: "success",
        text: targetStatus === "cancelled" ? "Membership cancelled." : "Membership status updated.",
      });
    } catch {
      setNotice({ tone: "error", text: "Unable to change membership status. Please try again." });
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section
      className="admin-module-page membership-admin-page"
      aria-labelledby="memberships-title"
    >
      <AdminSectionHeader
        description="Configure the closed plan catalog and manage canonical student memberships from connected Firebase data."
        eyebrow="Members / Plans and memberships"
        title="Memberships"
      />

      {workspace.status === "loading" ? (
        <section className="admin-panel-card" aria-live="polite" role="status">
          Loading membership workspace...
        </section>
      ) : workspace.status === "error" ? (
        <section
          className="admin-panel-card membership-message membership-message-error"
          aria-live="assertive"
          role="alert"
        >
          Unable to load plans and memberships. Please try again.
        </section>
      ) : (
        <>
          <section className="admin-panel-card" aria-labelledby="plan-catalog-title">
            <div className="admin-panel-card-heading">
              <div>
                <p className="admin-eyebrow">Connected catalog</p>
                <h3 id="plan-catalog-title">Membership plans</h3>
              </div>
              <span className="membership-count">{workspace.plans.length} configured</span>
            </div>
            <PlanCatalog plans={workspace.plans} />
          </section>

          <div className="membership-workspace-grid">
            <form className="membership-card" onSubmit={(event) => void handleSavePlan(event)}>
              <div>
                <p className="admin-eyebrow">Plan editor</p>
                <h3>Configure plan</h3>
              </div>
              <div className="membership-form-grid">
                <label className="membership-field" htmlFor="membership-plan-editor-id">
                  Plan to edit
                  <select
                    disabled={busy !== undefined}
                    id="membership-plan-editor-id"
                    onChange={(event) => choosePlan(event.target.value as PlanId)}
                    value={selectedPlanId}
                  >
                    {planIds.map((planId) => (
                      <option key={planId} value={planId}>
                        {planId}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="membership-field" htmlFor="membership-plan-display-name">
                  Display name
                  <input
                    disabled={busy !== undefined}
                    id="membership-plan-display-name"
                    maxLength={160}
                    onChange={(event) =>
                      setPlanDraft((plan) => ({ ...plan, displayName: event.target.value }))
                    }
                    required
                    value={planDraft.displayName}
                  />
                </label>
                <label className="membership-field" htmlFor="membership-plan-price">
                  Price in pence
                  <input
                    disabled={busy !== undefined}
                    id="membership-plan-price"
                    min="0"
                    onChange={(event) =>
                      setPlanDraft((plan) => ({ ...plan, priceMinor: Number(event.target.value) }))
                    }
                    required
                    step="1"
                    type="number"
                    value={planDraft.priceMinor}
                  />
                </label>
                <label className="membership-field" htmlFor="membership-plan-billing">
                  Billing period
                  <select
                    disabled={busy !== undefined}
                    id="membership-plan-billing"
                    onChange={(event) =>
                      setPlanDraft((plan) => ({
                        ...plan,
                        billingPeriod: event.target.value as PlanDraft["billingPeriod"],
                      }))
                    }
                    value={planDraft.billingPeriod}
                  >
                    {billingPeriods.map((period) => (
                      <option key={period} value={period}>
                        {period === "monthly" ? "Monthly" : "Per session"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="membership-field" htmlFor="membership-plan-weekly-limit">
                  Weekly class limit
                  <select
                    disabled={busy !== undefined}
                    id="membership-plan-weekly-limit"
                    onChange={(event) =>
                      setPlanDraft((plan) => ({
                        ...plan,
                        weeklyClassLimit:
                          event.target.value === "none"
                            ? null
                            : (Number(event.target.value) as 1 | 2),
                      }))
                    }
                    value={planDraft.weeklyClassLimit ?? "none"}
                  >
                    <option value="none">Unlimited</option>
                    <option value="1">1 class</option>
                    <option value="2">2 classes</option>
                  </select>
                </label>
                <label className="membership-field" htmlFor="membership-plan-open-mat-fee">
                  Open mat fee in pence
                  <input
                    disabled={busy !== undefined}
                    id="membership-plan-open-mat-fee"
                    min="0"
                    onChange={(event) =>
                      setPlanDraft((plan) => ({
                        ...plan,
                        openMatFeeMinor:
                          event.target.value === "" ? null : Number(event.target.value),
                      }))
                    }
                    placeholder="Included"
                    step="1"
                    type="number"
                    value={planDraft.openMatFeeMinor ?? ""}
                  />
                </label>
              </div>

              <div className="membership-choice-grid">
                <fieldset>
                  <legend>Eligible participants</legend>
                  {participantTypes.map((participantType) => (
                    <label key={participantType}>
                      <input
                        checked={planDraft.eligibleParticipantTypes.includes(participantType)}
                        disabled={busy !== undefined}
                        onChange={(event) =>
                          setPlanDraft((plan) => ({
                            ...plan,
                            eligibleParticipantTypes: toggleValue<ParticipantType>(
                              plan.eligibleParticipantTypes,
                              participantType,
                              event.target.checked,
                            ),
                          }))
                        }
                        type="checkbox"
                      />
                      {participantType}
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>Class sites</legend>
                  {siteValues.map((site) => (
                    <label key={site}>
                      <input
                        checked={planDraft.classSites.includes(site)}
                        disabled={busy !== undefined}
                        onChange={(event) =>
                          setPlanDraft((plan) => ({
                            ...plan,
                            classSites: toggleValue<Site>(
                              plan.classSites,
                              site,
                              event.target.checked,
                            ),
                          }))
                        }
                        type="checkbox"
                      />
                      {site}
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>Open mat sites</legend>
                  {siteValues.map((site) => (
                    <label key={site}>
                      <input
                        checked={planDraft.openMatSites.includes(site)}
                        disabled={busy !== undefined}
                        onChange={(event) =>
                          setPlanDraft((plan) => ({
                            ...plan,
                            openMatSites: toggleValue<Site>(
                              plan.openMatSites,
                              site,
                              event.target.checked,
                            ),
                          }))
                        }
                        type="checkbox"
                      />
                      {site}
                    </label>
                  ))}
                </fieldset>
              </div>

              <div className="membership-actions">
                <button
                  className="membership-primary-button"
                  disabled={busy !== undefined}
                  type="submit"
                >
                  {busy === "save-plan" ? "Saving plan..." : "Save plan"}
                </button>
                <button
                  className="membership-secondary-button"
                  disabled={busy !== undefined || configuredPlan === undefined}
                  onClick={() => void handlePlanStatus()}
                  type="button"
                >
                  {configuredPlan?.active ? "Deactivate plan" : "Activate plan"}
                </button>
              </div>
              {!configuredPlan ? (
                <p className="membership-helper">Save this plan before activation.</p>
              ) : null}
            </form>

            <form
              className="membership-card"
              onSubmit={(event) => void handleCreateMembership(event)}
            >
              <div>
                <p className="admin-eyebrow">Canonical enrolment</p>
                <h3>Create membership</h3>
                <p className="membership-helper">
                  Pick the student from the canonical member directory. The billing family is
                  resolved from that record.
                </p>
              </div>
              <label className="membership-field" htmlFor="membership-student">
                Student
                <select
                  disabled={busy !== undefined || directory.status !== "ready"}
                  id="membership-student"
                  onChange={(event) => setStudentId(event.target.value)}
                  required
                  value={studentId}
                >
                  <option value="">
                    {directory.status === "loading"
                      ? "Loading member directory..."
                      : directory.status === "error"
                        ? "Member directory unavailable"
                        : "Select a student"}
                  </option>
                  {directory.status === "ready"
                    ? directory.students.map((student) => (
                        <option key={student.studentId} value={student.studentId}>
                          {studentLabel(student)}
                        </option>
                      ))
                    : null}
                  {directory.status === "ready" &&
                  studentId !== "" &&
                  !directory.students.some((student) => student.studentId === studentId) ? (
                    <option value={studentId}>Preselected student (not in the first page)</option>
                  ) : null}
                </select>
              </label>
              {directory.status === "error" ? (
                <p className="membership-message membership-message-error" role="alert">
                  Unable to load the member directory. Refresh before creating memberships.
                </p>
              ) : null}
              <label className="membership-field" htmlFor="membership-create-plan">
                Membership plan
                <select
                  disabled={busy !== undefined || activePlans.length === 0}
                  id="membership-create-plan"
                  onChange={(event) => setMembershipPlanId(event.target.value as PlanId | "")}
                  required
                  value={membershipPlanId}
                >
                  <option value="">Select an active plan</option>
                  {activePlans.map((plan) => (
                    <option key={plan.planId} value={plan.planId}>
                      {plan.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="membership-field" htmlFor="membership-initial-status">
                Initial status
                <select
                  disabled={busy !== undefined}
                  id="membership-initial-status"
                  onChange={(event) => setInitialStatus(event.target.value as "trial" | "active")}
                  value={initialStatus}
                >
                  <option value="trial">Trial</option>
                  <option value="active">Active</option>
                </select>
              </label>
              <button
                className="membership-primary-button"
                disabled={busy !== undefined || activePlans.length === 0}
                type="submit"
              >
                {busy === "create-membership" ? "Creating membership..." : "Create membership"}
              </button>
            </form>
          </div>

          <section className="admin-panel-card" aria-labelledby="memberships-list-title">
            <div className="admin-panel-card-heading">
              <div>
                <p className="admin-eyebrow">Connected records</p>
                <h3 id="memberships-list-title">Memberships</h3>
              </div>
              <span className="membership-count">{workspace.memberships.length} records</span>
            </div>
            {workspace.memberships.length === 0 ? (
              <p className="membership-empty" role="status">
                No memberships available.
              </p>
            ) : (
              <div className="admin-data-table-wrap">
                <table className="admin-data-table">
                  <caption className="visually-hidden">Memberships</caption>
                  <thead>
                    <tr>
                      <th scope="col">Membership</th>
                      <th scope="col">Student</th>
                      <th scope="col">Plan</th>
                      <th scope="col">Status</th>
                      <th scope="col">Allowed actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workspace.memberships.map((membership) => {
                      const targets = membershipTransitionTargets[membership.status];
                      const normalTargets = targets.filter((target) => target !== "cancelled");
                      const canCancel = targets.includes("cancelled");
                      return (
                        <tr key={membership.membershipId}>
                          <td>
                            <strong>{membership.membershipId}</strong>
                          </td>
                          <td>
                            {directory.status === "ready"
                              ? (directory.students.find(
                                  (student) => student.studentId === membership.studentId,
                                )?.fullName ?? membership.studentId)
                              : membership.studentId}
                          </td>
                          <td>{membership.planId}</td>
                          <td>
                            <AdminStatusBadge status={membership.status} />
                          </td>
                          <td>
                            <div className="membership-row-actions">
                              {normalTargets.map((target) => (
                                <button
                                  aria-label={`${transitionLabel(membership.status, target)} membership ${membership.membershipId}`}
                                  className="membership-table-button"
                                  disabled={busy !== undefined}
                                  key={target}
                                  onClick={() => void handleTransition(membership, target)}
                                  type="button"
                                >
                                  {transitionLabel(membership.status, target)}
                                </button>
                              ))}
                              {canCancel ? (
                                <button
                                  aria-label={`Cancel membership ${membership.membershipId}`}
                                  className="membership-table-button membership-table-button-danger"
                                  disabled={busy !== undefined}
                                  onClick={() => void handleTransition(membership, "cancelled")}
                                  type="button"
                                >
                                  Cancel
                                </button>
                              ) : null}
                              <Link
                                aria-label={`Issue invoice for membership ${membership.membershipId}`}
                                className="membership-table-button"
                                href={`/admin/billing?familyId=${encodeURIComponent(membership.familyId)}&membershipId=${encodeURIComponent(membership.membershipId)}`}
                              >
                                Issue invoice
                              </Link>
                              {targets.length === 0 ? (
                                <span className="membership-secondary-text">No transitions</span>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {notice ? (
        <p
          aria-live={notice.tone === "error" ? "assertive" : "polite"}
          className={`membership-message membership-message-${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}

export default function MembershipsAdminRoute() {
  return <MembershipsAdminPage />;
}
