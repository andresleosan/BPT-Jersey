"use client";

import { useEffect, useState } from "react";

import {
  isReturnableEnrolmentRequest,
  type EnrolmentRequestRow,
} from "@bpt-jersey/domain/members/enrolment-requests";
import { listEnrolmentRequests, returnEnrolmentRequest } from "../../../../lib/enrolment-client";
import { AdminSectionHeader, AdminStatusBadge } from "../../admin-ui";

import "../../admin.css";

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

export default function EnrolmentRequestQueuePage() {
  const [state, setState] = useState<QueueState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [notes, setNotes] = useState<Readonly<Record<string, string>>>({});
  const [busyId, setBusyId] = useState<string>();
  const [notice, setNotice] = useState<Notice>();

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void listEnrolmentRequests()
      .then((queue) => {
        if (active)
          setState({ status: "ready", requests: queue.requests, truncated: queue.truncated });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [reloadToken]);

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

  return (
    <section className="admin-module-page enrolment-admin-page" aria-label="Enrolment requests">
      <AdminSectionHeader
        description="People who asked for a place from the website. Check the detail with the applicant, or send a request back with a note when something is missing."
        eyebrow="People / Enrolment requests"
        title="Enrolment requests"
      />

      {notice ? (
        <p
          className={`admin-panel-card shop-admin-notice shop-admin-notice-${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}

      {state.status === "loading" ? (
        <section className="admin-panel-card" aria-live="polite" role="status">
          Loading enrolment requests...
        </section>
      ) : null}

      {state.status === "error" ? (
        <section className="admin-panel-card" aria-live="assertive" role="alert">
          <p>Unable to load enrolment requests.</p>
          <button
            className="button button-secondary"
            onClick={() => setReloadToken((value) => value + 1)}
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

      {state.status === "ready" && state.requests.length > 0 ? (
        <ul className="admin-request-list" aria-label="Enrolment requests">
          {state.requests.map((request) => {
            // An approval that stopped is handed back the same way, and it has to be: it is the
            // only way out for an applicant whose enrolment failed for a reason only they can fix.
            const open = isReturnableEnrolmentRequest(request.status);
            const noteId = `enrolment-note-${request.enrolmentRequestId}`;
            return (
              <li className="admin-panel-card admin-request-card" key={request.enrolmentRequestId}>
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
                    <label className="shop-admin-field" htmlFor={noteId}>
                      What needs to change
                      <input
                        id={noteId}
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
                    <button
                      className="button button-secondary"
                      disabled={busyId === request.enrolmentRequestId}
                      onClick={() => void sendBack(request)}
                      type="button"
                    >
                      Send back to applicant
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
