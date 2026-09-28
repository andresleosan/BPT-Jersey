"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type {
  AdminInboxPage,
  AdminInboxQuery,
  AdminNotification,
  AdminNotificationKind,
  SubscriptionEdit,
} from "@bpt-jersey/domain/memberships/admin";
import {
  editSubscription,
  getAdminNotifications,
  getMemberSubscriptions,
  updateNotification,
} from "../../../lib/subscription-admin-client";
import { recordHref } from "../members/profile/member-record";
import "./admin-notifications.css";

// The subscription editor is only needed once a message is open; keep it out of the overview load.
const MemberSubscriptionAction = dynamic(
  () =>
    import("../members/member-subscription-editor").then(
      (module) => module.MemberSubscriptionAction,
    ),
  { ssr: false },
);

type ReadState = AdminInboxQuery["readState"];
type Filters = {
  kind: AdminNotificationKind | null;
  readState: ReadState;
  from: string;
  to: string;
};

const kindLabels: Record<AdminNotificationKind, string> = {
  payment: "Payments",
  registration: "Registrations",
  membership: "Memberships",
  class: "Classes",
  "subscription-expiring": "Ending soon",
};
const sectionLabels: Record<string, string> = {
  "/admin/finance": "Open finance",
  "/admin/members/requests": "Open requests",
  "/admin/members": "Open members",
  "/admin/memberships": "Open memberships",
  "/admin/classes": "Open classes",
};
const noFilters: Filters = { kind: null, readState: "all", from: "", to: "" };

function localDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
function toQuery(filters: Filters): AdminInboxQuery {
  return {
    kind: filters.kind,
    readState: filters.readState,
    from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : null,
    to: filters.to ? new Date(`${filters.to}T23:59:59.999`).toISOString() : null,
    cursor: null,
  };
}
/** Gmail's rule: time today, day and month this year, full date before that. */
function shortTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return date.getFullYear() === now.getFullYear()
    ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : date.toLocaleDateString("en-GB");
}
const fullTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const kindOf = (notice: AdminNotification) =>
  notice.kind === "subscription-expiring"
    ? "Subscription ending"
    : kindLabels[notice.kind].slice(0, -1);
const sender = (notice: AdminNotification) => notice.details?.from ?? kindOf(notice);

export function AdminNotificationPanel({ role }: { role?: string | null | undefined } = {}) {
  const [filters, setFilters] = useState<Filters>(noFilters);
  const [rangeError, setRangeError] = useState("");
  const [page, setPage] = useState<AdminInboxPage | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [olderPage, setOlderPage] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const pending = useRef(new Map<string, SubscriptionEdit>());
  const actionLock = useRef(false);
  const mounted = useRef(false);
  const query = useRef<AdminInboxQuery>(toQuery(noFilters));
  const readerRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const load = useCallback(async (input: AdminInboxQuery) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const result = await getAdminNotifications(input);
      if (mounted.current && sequence === requestSequence.current) {
        setPage(result);
        setError("");
      }
    } catch {
      if (mounted.current && sequence === requestSequence.current)
        setError("Unable to load notifications. Please refresh.");
    } finally {
      if (mounted.current && sequence === requestSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load(query.current);
    const refresh = () => {
      if (!document.hidden && !actionLock.current) void load(query.current);
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      mounted.current = false;
      requestSequence.current++;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  const notices = page?.notifications ?? [];
  const selected = notices.find((notice) => notice.notificationId === selectedId) ?? null;

  /** Opening a message reads it, as in any mail client; the list updates before the server answers. */
  function open(notice: AdminNotification) {
    setSelectedId(notice.notificationId);
    setMessage("");
    // Single-pane layout (phones, narrow cards): the list is hidden, so bring the message to the top.
    requestAnimationFrame(() => {
      const reader = readerRef.current;
      if (
        reader &&
        reader.previousElementSibling instanceof HTMLElement &&
        !reader.previousElementSibling.offsetParent
      )
        reader.scrollIntoView({ block: "start" });
    });
    if (notice.readAt || actionLock.current) return;
    const now = new Date().toISOString();
    setPage((current) =>
      current
        ? {
            ...current,
            unreadCount: Math.max(0, current.unreadCount - 1),
            notifications: current.notifications.map((item) =>
              item.notificationId === notice.notificationId ? { ...item, readAt: now } : item,
            ),
          }
        : current,
    );
    void updateNotification({ notificationId: notice.notificationId, action: "read" }).catch(() => {
      if (mounted.current) void load(query.current);
    });
  }

  function backToList() {
    const id = selectedId;
    setSelectedId(null);
    requestAnimationFrame(() =>
      listRef.current
        ?.querySelector<HTMLButtonElement>(`[data-notification="${id}"]`)
        ?.focus({ preventScroll: false }),
    );
  }

  function moveSelection(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }

  async function act(notice: AdminNotification, action: "leave" | "extend") {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(notice.notificationId);
    setError("");
    setMessage("");
    // Ignore any in-flight list response which predates this action.
    requestSequence.current++;
    try {
      if (action === "extend") {
        if (!notice.studentId || !notice.membershipId) throw new Error("Subscription unavailable.");
        let input = pending.current.get(notice.notificationId);
        if (!input) {
          const context = await getMemberSubscriptions(notice.studentId);
          const membership = context.memberships.find(
            (item) => item.membershipId === notice.membershipId,
          );
          if (
            !membership ||
            membership.endsAt !== notice.endsAt ||
            membership.status === "cancelled"
          )
            throw new Error("This subscription has changed. Refresh before trying again.");
          input = {
            operation: "extend-month",
            notificationId: notice.notificationId,
            membershipId: membership.membershipId,
            expectedUpdatedAt: membership.updatedAt,
            requestId: crypto.randomUUID(),
          };
          pending.current.set(notice.notificationId, input);
        }
        await editSubscription(input);
        pending.current.delete(notice.notificationId);
      } else {
        await updateNotification({ notificationId: notice.notificationId, action });
      }
      if (mounted.current) {
        setMessage(
          action === "extend" ? "Subscription extended by one month." : "End date kept unchanged.",
        );
        await load(query.current);
      }
    } catch (failure) {
      if (mounted.current)
        setError(failure instanceof Error ? failure.message : "Unable to update notification.");
    } finally {
      actionLock.current = false;
      if (mounted.current) {
        setBusy(null);
        setLoading(false);
      }
    }
  }

  function changeQuery(input: AdminInboxQuery) {
    query.current = input;
    setOlderPage(input.cursor !== null);
    setPage(null);
    setSelectedId(null);
    void load(input);
  }
  function applyFilters(next: Filters) {
    setFilters(next);
    if (next.from && next.to && next.from > next.to) {
      setRangeError("From must be on or before To.");
      return;
    }
    setRangeError("");
    changeQuery(toQuery(next));
  }
  function lastDays(days: number) {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
    applyFilters({ ...filters, from: localDate(start), to: localDate(today) });
  }
  const latest = () => changeQuery({ ...query.current, cursor: null });
  const dated = Boolean(filters.from || filters.to);
  const locked = busy !== null;

  return (
    <section
      className="admin-panel-card admin-inbox"
      aria-labelledby="admin-notifications-title"
      data-view={selected ? "message" : "list"}
    >
      <header className="admin-inbox-head">
        <div>
          <p className="admin-eyebrow">Academy activity</p>
          <h3 id="admin-notifications-title">Notifications</h3>
        </div>
        <p className="admin-inbox-count" aria-live="polite">
          {page ? (
            <>
              <strong>{page.unreadCount}</strong> unread
            </>
          ) : (
            " "
          )}
        </p>
        <button
          className="admin-inbox-button"
          type="button"
          disabled={loading || locked}
          onClick={latest}
        >
          Refresh
        </button>
      </header>

      <div className="admin-inbox-toolbar">
        <div className="admin-inbox-tabs" role="group" aria-label="Notification type">
          {([null, ...Object.keys(kindLabels)] as (AdminNotificationKind | null)[]).map((kind) => (
            <button
              key={kind ?? "all"}
              type="button"
              aria-pressed={filters.kind === kind}
              disabled={locked}
              onClick={() => applyFilters({ ...filters, kind })}
            >
              {kind ? kindLabels[kind] : "All"}
            </button>
          ))}
        </div>
        <div className="admin-inbox-refine">
          <label className="admin-inbox-select">
            <span>Show</span>
            <select
              value={filters.readState}
              disabled={locked}
              onChange={(event) => {
                const value = event.target.value;
                applyFilters({
                  ...filters,
                  readState: value === "unread" || value === "read" ? value : "all",
                });
              }}
            >
              <option value="all">All messages</option>
              <option value="unread">Unread only</option>
              <option value="read">Read only</option>
            </select>
          </label>
          <details className="admin-inbox-dates">
            <summary>{dated ? "Dates · filtered" : "Dates"}</summary>
            <div className="admin-inbox-date-fields">
              <label>
                <span>From</span>
                <input
                  type="date"
                  value={filters.from}
                  disabled={locked}
                  onChange={(event) => applyFilters({ ...filters, from: event.target.value })}
                />
              </label>
              <label>
                <span>To</span>
                <input
                  type="date"
                  value={filters.to}
                  disabled={locked}
                  onChange={(event) => applyFilters({ ...filters, to: event.target.value })}
                />
              </label>
              <div className="admin-inbox-shortcuts">
                <button type="button" disabled={locked} onClick={() => lastDays(7)}>
                  Last 7 days
                </button>
                <button type="button" disabled={locked} onClick={() => lastDays(30)}>
                  Last 30 days
                </button>
                {dated ? (
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => applyFilters({ ...filters, from: "", to: "" })}
                  >
                    Any date
                  </button>
                ) : null}
              </div>
            </div>
          </details>
        </div>
      </div>

      {rangeError ? (
        <p className="admin-inbox-notice" role="alert">
          {rangeError}
        </p>
      ) : null}
      {error ? (
        <p className="admin-inbox-notice" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="admin-inbox-notice admin-inbox-notice-ok" role="status">
          {message}
        </p>
      ) : null}

      <div className="admin-inbox-body">
        <div className="admin-inbox-list-pane">
          <p className="admin-inbox-visually-hidden" role="status">
            {loading ? "Loading notifications…" : ""}
          </p>
          {!page && loading ? (
            <ul className="admin-inbox-list" aria-hidden="true">
              {Array.from({ length: 6 }, (_, index) => (
                <li key={index} className="admin-inbox-skeleton">
                  <span />
                  <span />
                  <span />
                </li>
              ))}
            </ul>
          ) : null}
          {page && notices.length === 0 ? (
            <div className="admin-inbox-empty">
              <p className="admin-eyebrow">Nothing here</p>
              <p>
                {filters.kind || filters.readState !== "all" || dated
                  ? "No notifications match these filters."
                  : "Payments, registrations and subscription changes will arrive here."}
              </p>
            </div>
          ) : null}
          {notices.length > 0 ? (
            <ul
              ref={listRef}
              className="admin-inbox-list"
              aria-label="Notifications"
              onKeyDown={moveSelection}
            >
              {notices.map((notice) => (
                <li key={notice.notificationId}>
                  <button
                    type="button"
                    className="admin-inbox-row"
                    data-notification={notice.notificationId}
                    data-unread={notice.readAt ? undefined : ""}
                    aria-current={notice.notificationId === selectedId ? "true" : undefined}
                    onClick={() => open(notice)}
                  >
                    <span className="admin-inbox-row-from">
                      {notice.readAt ? null : (
                        <span className="admin-inbox-visually-hidden">Unread. </span>
                      )}
                      {sender(notice)}
                    </span>
                    <time className="admin-inbox-row-time" dateTime={notice.createdAt}>
                      {shortTime(notice.createdAt)}
                    </time>
                    <span className="admin-inbox-row-subject">{notice.title}</span>
                    {notice.details?.amount ? (
                      <span className="admin-inbox-row-amount">{notice.details.amount}</span>
                    ) : null}
                    <span className="admin-inbox-row-snippet">{notice.message}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {olderPage || page?.nextCursor ? (
            <div className="admin-inbox-pager">
              {olderPage ? (
                <button type="button" disabled={loading || locked} onClick={latest}>
                  Newest
                </button>
              ) : null}
              {page?.nextCursor ? (
                <button
                  type="button"
                  disabled={loading || locked}
                  onClick={() => changeQuery({ ...query.current, cursor: page.nextCursor })}
                >
                  Older
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <article
          ref={readerRef}
          className="admin-inbox-reader"
          aria-label={selected ? selected.title : "Selected notification"}
          tabIndex={-1}
        >
          {selected ? (
            <>
              <button type="button" className="admin-inbox-back" onClick={backToList}>
                Back to inbox
              </button>
              <p className="admin-eyebrow">{kindOf(selected)}</p>
              <h4 className="admin-inbox-subject">{selected.title}</h4>
              <div className="admin-inbox-meta">
                <strong>{sender(selected)}</strong>
                <time dateTime={selected.createdAt}>{fullTime(selected.createdAt)}</time>
              </div>
              {selected.details?.amount ? (
                <p className="admin-inbox-amount">{selected.details.amount}</p>
              ) : null}
              <p className="admin-inbox-message">{selected.message}</p>
              {selected.details && selected.details.facts.length > 0 ? (
                <dl className="admin-inbox-facts">
                  {selected.details.facts
                    // The amount already leads the message; do not repeat it in the list.
                    .filter((fact) => fact.label !== "Amount" || !selected.details?.amount)
                    .map((fact) => (
                      <div key={fact.label}>
                        <dt>{fact.label}</dt>
                        <dd>{fact.value}</dd>
                      </div>
                    ))}
                </dl>
              ) : null}
              {selected.kind === "subscription-expiring" ? (
                selected.resolvedAt ? (
                  <p className="admin-inbox-resolved">Resolved</p>
                ) : (
                  <div className="admin-inbox-actions">
                    <button
                      className="admin-inbox-button"
                      type="button"
                      disabled={locked}
                      onClick={() => void act(selected, "extend")}
                    >
                      {busy === selected.notificationId ? "Updating…" : "Extend 1 month"}
                    </button>
                    <button
                      className="admin-inbox-button admin-inbox-button-quiet"
                      type="button"
                      disabled={locked}
                      onClick={() => void act(selected, "leave")}
                    >
                      Keep end date
                    </button>
                  </div>
                )
              ) : null}
              <div className="admin-inbox-links">
                <Link href={selected.href}>{sectionLabels[selected.href] ?? "Open section"}</Link>
                {selected.studentId ? (
                  <Link href={recordHref(selected.studentId)}>Member record</Link>
                ) : null}
              </div>
              {selected.studentId ? (
                <div className="admin-inbox-subscription">
                  <MemberSubscriptionAction studentId={selected.studentId} role={role} />
                </div>
              ) : null}
            </>
          ) : (
            <div className="admin-inbox-placeholder">
              <p className="admin-eyebrow">Reading pane</p>
              <p>Choose a notification to see who, how much and what it was for.</p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
