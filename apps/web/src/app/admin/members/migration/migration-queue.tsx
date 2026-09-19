"use client";

import { useEffect, useRef, useState } from "react";
import type {
  DecideMemberMigrationResult,
  MemberMigrationDecisionInput,
  MemberMigrationQueueResponse,
  MemberMigrationRejectionCode,
} from "@bpt-jersey/domain/members/migration";
import {
  decideMemberMigration,
  listMemberMigrationQueue,
  memberMigrationErrorMessage,
} from "../../../../lib/member-migration-client";
import { AdminDataTableWrap } from "../../admin-data-table";
import { AdminSectionHeader, AdminStatusBadge } from "../../admin-ui";

type Row = MemberMigrationQueueResponse["rows"][number];
type Enrolment = Exclude<MemberMigrationDecisionInput, { kind: "skip" }>;
const tabs = [
  { key: "strong", label: "Strong" },
  { key: "suggested", label: "Suggested" },
  { key: "ambiguous", label: "Ambiguous" },
  { key: "none", label: "No match" },
  { key: "minors", label: "Under 18 / no date" },
] as const;
type Tab = (typeof tabs)[number]["key"];
const times = ["morning", "afternoon", "evening"] as const;
const loadError = "The migration queue is unavailable. Try again.";

function inTab(row: Row, tab: Tab) {
  return tab === "minors" ? row.isMinor !== false : row.isMinor === false && row.category === tab;
}

function Identity({ person }: { person: Row["member"] }) {
  return (
    <div>
      <strong>{person.fullName}</strong>
      <p>Date of birth: {person.birthDate ?? "Not recorded"}</p>
      <p>Member number: {person.memberNumberMasked ?? "Not recorded"}</p>
      <p>ID number: {person.idCardMasked ?? "Not recorded"}</p>
    </div>
  );
}

function SkipDialog({
  row,
  onClose,
  onConfirm,
}: {
  row: Row;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  useEffect(() => {
    const trigger = document.activeElement;
    dialogRef.current?.showModal();
    reasonRef.current?.focus();
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="ibjjf-dialog"
      aria-labelledby="migration-skip-heading"
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>(
          "textarea, button:not(:disabled)",
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <h3 id="migration-skip-heading">Skip {row.member.fullName}</h3>
      <form
        className="member-record-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed.length >= 3 && trimmed.length <= 200) onConfirm(trimmed);
        }}
      >
        <label className="login-field">
          Reason
          <textarea
            ref={reasonRef}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={3}
            maxLength={200}
            required
            aria-describedby="migration-reason-hint"
          />
        </label>
        <p id="migration-reason-hint" className="member-record-hint">
          Use 3 to 200 characters.
        </p>
        <div className="ibjjf-dialog-actions">
          <button
            type="button"
            className="member-record-button"
            onClick={() => dialogRef.current?.close()}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="member-record-button"
            disabled={trimmed.length < 3 || trimmed.length > 200}
          >
            Skip member
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function MigrationQueue() {
  const [queue, setQueue] = useState<MemberMigrationQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("strong");
  const [centre, setCentre] = useState<Enrolment["trainingCenter"] | "">("");
  const [preferences, setPreferences] = useState<Enrolment["trainingTimePreferences"]>([]);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [summary, setSummary] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [rejections, setRejections] = useState<
    Record<string, { name: string; code: MemberMigrationRejectionCode }>
  >({});
  const [skipRow, setSkipRow] = useState<Row>();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const rows = queue?.rows.filter((row) => inTab(row, tab)) ?? [];
  const canEnrol = centre !== "" && preferences.length > 0;
  const disabled = busy || loading || loadFailed;

  useEffect(() => {
    let active = true;
    listMemberMigrationQueue().then(
      (response) => {
        if (active) {
          setQueue(response);
          setLoading(false);
        }
      },
      () => {
        if (active) {
          setLoadFailed(true);
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function refresh() {
    setLoading(true);
    setLoadFailed(false);
    try {
      setQueue(await listMemberMigrationQueue());
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  async function submit(decisions: MemberMigrationDecisionInput[]) {
    if (submitting.current || disabled || decisions.length === 0) return;
    submitting.current = true;
    setBusy(true);
    setSummary(undefined);
    setSaveError(undefined);
    setRejections({});
    const results: DecideMemberMigrationResult["results"] = [];
    try {
      for (let offset = 0; offset < decisions.length; offset += 50) {
        const response = await decideMemberMigration(decisions.slice(offset, offset + 50));
        results.push(...response.results);
      }
    } catch {
      setSaveError("Could not save all decisions. Review the queue before trying again.");
    } finally {
      const rejected = results.filter((result) => result.status === "rejected");
      setSummary(`Applied ${results.length - rejected.length} · Rejected ${rejected.length}`);
      setRejections(
        Object.fromEntries(
          rejected.map((result) => [
            result.legacyMemberId,
            {
              name:
                queue?.rows.find((row) => row.legacyMemberId === result.legacyMemberId)?.member
                  .fullName ?? "Member",
              code: result.code,
            },
          ]),
        ),
      );
      await refresh();
      setBusy(false);
      submitting.current = false;
    }
  }

  function enrol(row: Row, recordId?: string) {
    if (!canEnrol || row.isMinor !== false) return;
    const training = {
      legacyMemberId: row.legacyMemberId,
      requestId: crypto.randomUUID(),
      trainingCenter: centre,
      trainingTimePreferences: preferences,
    };
    void submit([
      recordId === undefined
        ? { ...training, kind: "create-unlinked" }
        : { ...training, kind: "link", recordId },
    ]);
  }

  function approveVisible() {
    if (!canEnrol || tab !== "strong") return;
    void submit(
      rows.flatMap((row): MemberMigrationDecisionInput[] => {
        const candidate = row.candidates[0];
        if (row.candidates.length !== 1 || !candidate) return [];
        return [
          {
            kind: "link",
            legacyMemberId: row.legacyMemberId,
            recordId: candidate.recordId,
            requestId: crypto.randomUUID(),
            trainingCenter: centre,
            trainingTimePreferences: preferences,
          },
        ];
      }),
    );
  }

  return (
    <div className="admin-module-page">
      <AdminSectionHeader
        eyebrow="Members / Office"
        title="Member migration"
        description="Review each member against the imported archive before creating their academy record."
      />
      <section className="admin-panel-card member-migration" aria-label="Member migration queue">
        {summary ? <p role="status">{summary}</p> : null}
        {saveError ? (
          <p role="alert" className="member-record-notice">
            {saveError}
          </p>
        ) : null}
        {Object.entries(rejections)
          .filter(([id]) => loadFailed || !rows.some((row) => row.legacyMemberId === id))
          .map(([id, rejection]) => (
            <p key={id} className="member-record-notice">
              <strong>{rejection.name}</strong>: {memberMigrationErrorMessage(rejection.code)}
            </p>
          ))}
        {loading ? <p role="status">Loading the migration queue…</p> : null}
        {loadFailed ? (
          <div>
            <p role="alert">{loadError}</p>
            <button
              className="member-record-button"
              type="button"
              disabled={busy || loading}
              onClick={() => void refresh()}
            >
              Retry
            </button>
          </div>
        ) : null}
        {queue && !loadFailed ? (
          <>
            <p>
              Decided: {queue.decided} · Remaining: {queue.rows.length}
            </p>
            <div className="member-record-form">
              <fieldset disabled={disabled}>
                <legend>Training for new records</legend>
                <div className="login-field">
                  <label htmlFor="migration-centre">Centre</label>
                  <select
                    id="migration-centre"
                    value={centre}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "Town" || value === "West" || value === "") setCentre(value);
                    }}
                  >
                    <option value="">Choose a centre</option>
                    <option value="Town">Town</option>
                    <option value="West">West</option>
                  </select>
                </div>
                <div className="member-migration-times" role="group" aria-label="Training times">
                  {times.map((time) => (
                    <label key={time}>
                      <input
                        type="checkbox"
                        checked={preferences.includes(time)}
                        onChange={(event) =>
                          setPreferences(
                            event.target.checked
                              ? times.filter(
                                  (value) => value === time || preferences.includes(value),
                                )
                              : preferences.filter((value) => value !== time),
                          )
                        }
                      />
                      {time[0]?.toUpperCase()}
                      {time.slice(1)}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            {!canEnrol ? (
              <p className="member-record-hint">Choose centre and training times first.</p>
            ) : null}
            <div
              className="admin-member-profile-tabs"
              role="tablist"
              aria-label="Migration categories"
            >
              {tabs.map((item, index) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  id={`migration-tab-${item.key}`}
                  aria-selected={tab === item.key}
                  aria-controls={`migration-panel-${item.key}`}
                  tabIndex={tab === item.key ? 0 : -1}
                  className={`admin-member-profile-tab${tab === item.key ? " is-active" : ""}`}
                  ref={(element) => {
                    tabRefs.current[index] = element;
                  }}
                  onClick={() => setTab(item.key)}
                  onKeyDown={(event) => {
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : event.key === "ArrowRight"
                            ? (index + 1) % tabs.length
                            : event.key === "ArrowLeft"
                              ? (index + tabs.length - 1) % tabs.length
                              : undefined;
                    if (next === undefined) return;
                    event.preventDefault();
                    const target = tabs[next];
                    if (target) {
                      setTab(target.key);
                      tabRefs.current[next]?.focus();
                    }
                  }}
                >
                  {item.label} ({queue.rows.filter((row) => inTab(row, item.key)).length})
                </button>
              ))}
            </div>
            <p>Only in the archive: {queue.archiveOnly}</p>
            <div
              role="tabpanel"
              id={`migration-panel-${tab}`}
              aria-labelledby={`migration-tab-${tab}`}
              tabIndex={0}
              aria-busy={disabled}
            >
              {tab === "strong" ? (
                <button
                  type="button"
                  className="member-record-button"
                  disabled={disabled || !canEnrol || rows.length === 0}
                  onClick={approveVisible}
                >
                  Approve all visible ({rows.length})
                </button>
              ) : null}
              {tab === "minors" ? (
                <p className="member-record-hint">
                  Members under 18 or without a date of birth wait for the guardian step.
                </p>
              ) : null}
              {rows.length === 0 ? (
                <p>No members in this category.</p>
              ) : (
                <AdminDataTableWrap label="Migration comparisons">
                  <table className="admin-data-table">
                    <caption className="visually-hidden">Migration comparisons</caption>
                    <thead>
                      <tr>
                        <th scope="col">Member</th>
                        <th scope="col">Archive candidates</th>
                        <th scope="col">Decision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.legacyMemberId}>
                          <td data-label="Member">
                            <div>
                              <Identity person={row.member} />
                              {rejections[row.legacyMemberId] ? (
                                <p className="member-record-notice">
                                  {memberMigrationErrorMessage(
                                    rejections[row.legacyMemberId]!.code,
                                  )}
                                </p>
                              ) : null}
                            </div>
                          </td>
                          <td data-label="Archive candidates">
                            <div className="member-migration-candidates">
                              {row.candidates.length === 0 ? (
                                <p>No archive match.</p>
                              ) : (
                                row.candidates.map((candidate) => (
                                  <div key={candidate.recordId}>
                                    <Identity person={candidate.record} />
                                    <AdminStatusBadge
                                      status={
                                        candidate.reason === "member-number"
                                          ? "Member number match"
                                          : candidate.reason === "id-card"
                                            ? "ID number match"
                                            : "Name and birth date match"
                                      }
                                    />
                                    {row.isMinor === false ? (
                                      <button
                                        type="button"
                                        className="member-record-button"
                                        disabled={disabled || !canEnrol}
                                        onClick={() => enrol(row, candidate.recordId)}
                                      >
                                        Link to this record
                                      </button>
                                    ) : null}
                                  </div>
                                ))
                              )}
                            </div>
                          </td>
                          <td data-label="Decision">
                            <div className="member-migration-actions">
                              {row.isMinor !== false ? (
                                <AdminStatusBadge status="Pending guardian" />
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className="member-record-button"
                                    disabled={disabled || !canEnrol}
                                    onClick={() => enrol(row)}
                                  >
                                    Create without archive record
                                  </button>
                                  <button
                                    type="button"
                                    className="member-record-button"
                                    disabled={disabled}
                                    onClick={() => setSkipRow(row)}
                                  >
                                    Skip…
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </AdminDataTableWrap>
              )}
            </div>
          </>
        ) : null}
        {skipRow ? (
          <SkipDialog
            row={skipRow}
            onClose={() => setSkipRow(undefined)}
            onConfirm={(reason) => {
              setSkipRow(undefined);
              void submit([{ kind: "skip", legacyMemberId: skipRow.legacyMemberId, reason }]);
            }}
          />
        ) : null}
      </section>
    </div>
  );
}
