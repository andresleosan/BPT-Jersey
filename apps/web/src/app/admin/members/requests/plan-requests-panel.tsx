"use client";

import { useEffect, useState } from "react";

import {
  decideMemberPlanRequest,
  FamilyPlanUnavailableError,
  listMemberPlanRequests,
  type MemberPlanRequestRow,
} from "../../../../lib/family-plan-client";

type PanelState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; requests: readonly MemberPlanRequestRow[] }>
  | Readonly<{ status: "error" }>
  | Readonly<{ status: "hidden" }>;

const kindLabels = { child: "Add a child", self: "Train yourself" } as const;

/**
 * "Add a child" / "Train yourself" requests members send from My plan (plan task 2.3). Approving
 * creates the student; the section hides itself when the callable is not deployed.
 */
export function PlanRequestsPanel() {
  const [state, setState] = useState<PanelState>({ status: "loading" });
  const [busyId, setBusyId] = useState<string>();
  const [notice, setNotice] = useState<Readonly<{ tone: "error" | "success"; text: string }>>();
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    listMemberPlanRequests()
      .then((requests) => {
        if (active) setState({ status: "ready", requests });
      })
      .catch((error: unknown) => {
        if (active) setState({ status: error instanceof FamilyPlanUnavailableError ? "hidden" : "error" });
      });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  if (state.status === "hidden") return null;

  async function decide(request: MemberPlanRequestRow, decision: "approve" | "reject"): Promise<void> {
    if (busyId) return;
    setBusyId(request.requestId);
    setNotice(undefined);
    try {
      await decideMemberPlanRequest(request.requestId, decision);
      setNotice({
        tone: "success",
        text: decision === "approve" ? `${request.person.fullName} was added.` : "Request rejected.",
      });
      setReloadToken((value) => value + 1);
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "The request could not be decided. Try again.",
      });
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <section aria-labelledby="plan-requests-title" className="admin-panel-card">
      <div className="admin-panel-card-heading">
        <div>
          <h3 id="plan-requests-title">Plan requests</h3>
          <p>Members asking to add a child or to train themselves from My plan.</p>
        </div>
      </div>
      {notice ? (
        <p
          className={`shop-admin-notice shop-admin-notice-${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}
      {state.status === "loading" ? (
        <div aria-busy="true" aria-label="Loading plan requests" className="plan-requests-skeleton">
          <div />
          <div />
        </div>
      ) : null}
      {state.status === "error" ? (
        <div role="alert">
          <p>Plan requests could not be loaded.</p>
          <button
            className="staff-secondary-button"
            onClick={() => {
              setState({ status: "loading" });
              setReloadToken((value) => value + 1);
            }}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : null}
      {state.status === "ready" && state.requests.length === 0 ? <p>No plan requests waiting.</p> : null}
      {state.status === "ready" && state.requests.length > 0 ? (
        <ul className="plan-requests-list">
          {state.requests.map((request) => (
            <li key={request.requestId}>
              <div>
                <strong>{request.person.fullName}</strong> · {kindLabels[request.kind]}
                <p className="admin-request-meta">
                  Born {new Date(request.person.dateOfBirth).toLocaleDateString("en-GB")} ·{" "}
                  {request.person.trainingCenter} · {request.person.trainingTimePreferences.join(", ")} · sent{" "}
                  {new Date(request.createdAt).toLocaleDateString("en-GB")}
                </p>
              </div>
              <div className="plan-requests-actions">
                <button
                  className="staff-primary-button"
                  disabled={busyId !== undefined}
                  onClick={() => void decide(request, "approve")}
                  type="button"
                >
                  {busyId === request.requestId ? "Working..." : "Approve"}
                </button>
                <button
                  className="staff-secondary-button"
                  disabled={busyId !== undefined}
                  onClick={() => void decide(request, "reject")}
                  type="button"
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
