"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { MemberSubscriptionAction } from "../members/member-subscription-editor";
import "./admin-notifications.css";

type ReadState = AdminInboxQuery["readState"];
type Filters = {
  kind: AdminNotificationKind | null;
  readState: ReadState;
  from: string;
  to: string;
};

const kindLabels: Record<AdminNotificationKind, string> = {
  "subscription-expiring": "Subscription ending",
  membership: "Membership",
  registration: "Registration",
  payment: "Payment",
  class: "Class",
};
const noFilters: Filters = { kind: null, readState: "all", from: "", to: "" };
const mobileQuery = "(max-width: 47.99rem)";

function subscribeMobile(callback: () => void): () => void {
  const media = window.matchMedia?.(mobileQuery);
  media?.addEventListener("change", callback);
  return () => media?.removeEventListener("change", callback);
}
function useMobileLayout(): boolean {
  return useSyncExternalStore(
    subscribeMobile,
    () => window.matchMedia?.(mobileQuery).matches ?? false,
    () => false,
  );
}
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
function activeCount(filters: Filters): number {
  return [filters.kind !== null, filters.readState !== "all", filters.from, filters.to].filter(
    Boolean,
  ).length;
}

export function AdminNotificationPanel({ role }: { role?: string | null | undefined } = {}) {
  const [filters, setFilters] = useState<Filters>(noFilters);
  const [rangeError, setRangeError] = useState("");
  const mobile = useMobileLayout();
  const [page, setPage] = useState<AdminInboxPage | null>(null);
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

  const invalidateRequests = useCallback(() => {
    requestSequence.current++;
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
      invalidateRequests();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [load, invalidateRequests]);

  async function act(notice: AdminNotification, action: "read" | "leave" | "extend") {
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
          action === "extend"
            ? "Subscription extended by one month."
            : action === "leave"
              ? "End date kept unchanged."
              : "Notification marked as read.",
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

  const filterFields = (
    <div className="admin-notification-filters">
      <label>
        <span>Type</span>
        <select
          value={filters.kind ?? ""}
          disabled={busy !== null}
          onChange={(event) => {
            const value = event.target.value;
            applyFilters({
              ...filters,
              kind: value in kindLabels ? (value as AdminNotificationKind) : null,
            });
          }}
        >
          <option value="">All types</option>
          {Object.entries(kindLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Status</span>
        <select
          value={filters.readState}
          disabled={busy !== null}
          onChange={(event) => {
            const value = event.target.value;
            applyFilters({
              ...filters,
              readState: value === "unread" || value === "read" ? value : "all",
            });
          }}
        >
          <option value="all">All</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
        </select>
      </label>
      <label>
        <span>From</span>
        <input
          type="date"
          value={filters.from}
          disabled={busy !== null}
          onChange={(event) => applyFilters({ ...filters, from: event.target.value })}
        />
      </label>
      <label>
        <span>To</span>
        <input
          type="date"
          value={filters.to}
          disabled={busy !== null}
          onChange={(event) => applyFilters({ ...filters, to: event.target.value })}
        />
      </label>
      <div className="admin-notification-shortcuts">
        <button
          className="admin-auth-button"
          type="button"
          disabled={busy !== null}
          onClick={() => lastDays(7)}
        >
          Last 7 days
        </button>
        <button
          className="admin-auth-button"
          type="button"
          disabled={busy !== null}
          onClick={() => lastDays(30)}
        >
          Last 30 days
        </button>
      </div>
    </div>
  );

  function actions(notice: AdminNotification) {
    return (
      <>
        <div className="admin-notification-actions">
          {notice.kind === "subscription-expiring" && !notice.resolvedAt ? (
            <>
              <button
                className="admin-auth-button"
                type="button"
                disabled={busy !== null}
                onClick={() => void act(notice, "extend")}
              >
                {busy === notice.notificationId ? "Updating…" : "Extend 1 month"}
              </button>
              <button
                className="admin-auth-button"
                type="button"
                disabled={busy !== null}
                onClick={() => void act(notice, "leave")}
              >
                Keep end date
              </button>
            </>
          ) : null}
          {notice.resolvedAt ? <span>Resolved</span> : null}
          {!notice.readAt ? (
            <button
              className="admin-auth-button"
              type="button"
              disabled={busy !== null}
              onClick={() => void act(notice, "read")}
            >
              Mark read
            </button>
          ) : null}
          <Link className="admin-text-link" href={notice.href}>
            View details
          </Link>
        </div>
        {notice.studentId ? (
          <MemberSubscriptionAction studentId={notice.studentId} role={role} />
        ) : null}
      </>
    );
  }
  const statusText = (notice: AdminNotification) => (notice.readAt ? "Read" : "Unread");
  const rowClass = (notice: AdminNotification) =>
    notice.readAt ? undefined : "admin-notification-unread";
  const receivedAt = (notice: AdminNotification) => (
    <time dateTime={notice.createdAt}>{new Date(notice.createdAt).toLocaleString("en-GB")}</time>
  );
  const body = (notice: AdminNotification) => (
    <>
      <strong>{notice.title}</strong>
      <p>{notice.message}</p>
      {notice.endsAt ? <p>End date: {new Date(notice.endsAt).toLocaleString("en-GB")}</p> : null}
    </>
  );
  const notices = page?.notifications ?? [];
  const count = activeCount(filters);

  return (
    <section
      className="admin-panel-card admin-notifications"
      aria-labelledby="admin-notifications-title"
    >
      <div className="admin-panel-card-heading">
        <div>
          <p className="admin-eyebrow">Academy activity</p>
          <h3 id="admin-notifications-title">
            Notifications {page ? <span>({page.unreadCount} unread)</span> : null}
          </h3>
        </div>
        <button
          className="admin-auth-button"
          type="button"
          disabled={loading || busy !== null}
          onClick={latest}
        >
          Refresh
        </button>
      </div>
      {mobile ? (
        <details className="admin-notification-filter-fold">
          <summary>{`Filters · ${count} active`}</summary>
          {filterFields}
        </details>
      ) : (
        filterFields
      )}
      <p className="admin-notification-help">
        Shared administrator inbox. Subscription reminders appear when there is one day left. Choose
        whether to extend each subscription.
      </p>
      {rangeError ? <p role="alert">{rangeError}</p> : null}
      {/* Always rendered with a reserved height, so the list below never jumps. */}
      <p className="admin-notification-loading" role="status">
        {loading ? "Loading notifications…" : ""}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {page && notices.length === 0 ? (
        <p>{count > 0 ? "No notifications match these filters." : "No notifications yet."}</p>
      ) : null}
      {notices.length === 0 ? null : mobile ? (
        <ol className="admin-notification-list" role="list" aria-label="Notifications">
          {notices.map((notice) => (
            <li key={notice.notificationId} className={rowClass(notice)}>
              <div className="admin-notification-heading">
                <span className="admin-notification-status">{statusText(notice)}</span>
                <span>{kindLabels[notice.kind]}</span>
                {receivedAt(notice)}
              </div>
              {body(notice)}
              {actions(notice)}
            </li>
          ))}
        </ol>
      ) : (
        <table className="admin-notification-table" aria-label="Notifications">
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Type</th>
              <th scope="col">Notification</th>
              <th scope="col">Received</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {notices.map((notice) => (
              <tr key={notice.notificationId} className={rowClass(notice)}>
                <td className="admin-notification-status">{statusText(notice)}</td>
                <td>{kindLabels[notice.kind]}</td>
                <td>{body(notice)}</td>
                <td>{receivedAt(notice)}</td>
                <td>{actions(notice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="admin-notification-actions">
        {olderPage ? (
          <button
            type="button"
            className="admin-auth-button"
            disabled={loading || busy !== null}
            onClick={latest}
          >
            Latest notifications
          </button>
        ) : null}
        {page?.nextCursor ? (
          <button
            type="button"
            className="admin-auth-button"
            disabled={loading || busy !== null}
            onClick={() => changeQuery({ ...query.current, cursor: page.nextCursor })}
          >
            Older notifications
          </button>
        ) : null}
      </div>
    </section>
  );
}
