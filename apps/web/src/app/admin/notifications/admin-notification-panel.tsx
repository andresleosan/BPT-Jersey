"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AdminInboxPage,
  AdminInboxQuery,
  AdminNotification,
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

export function AdminNotificationPanel({ role }: { role?: string | null | undefined } = {}) {
  const [filter, setFilter] = useState<"all" | "unread">("all");
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
  const query = useRef<AdminInboxQuery>({ filter: "all", cursor: null });

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
          onClick={() => changeQuery({ filter, cursor: null })}
        >
          Refresh
        </button>
      </div>
      <div className="admin-filter-bar">
        <label htmlFor="notification-filter">Show</label>
        <select
          id="notification-filter"
          value={filter}
          disabled={busy !== null}
          onChange={(event) => {
            const value = event.target.value === "unread" ? "unread" : "all";
            setFilter(value);
            changeQuery({ filter: value, cursor: null });
          }}
        >
          <option value="all">All notifications</option>
          <option value="unread">Unread</option>
        </select>
      </div>
      <p className="admin-notification-help">
        Shared administrator inbox. Subscription reminders appear when there is one day left. Choose
        whether to extend each subscription.
      </p>
      {loading ? <p role="status">Loading notifications…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {page?.notifications.length === 0 ? (
        <p>{filter === "unread" ? "No unread notifications." : "No notifications yet."}</p>
      ) : null}
      <ol className="admin-notification-list">
        {page?.notifications.map((notice) => (
          <li
            key={notice.notificationId}
            className={notice.readAt ? "" : "admin-notification-unread"}
          >
            <div className="admin-notification-heading">
              <strong>{notice.title}</strong>
              <time dateTime={notice.createdAt}>
                {new Date(notice.createdAt).toLocaleString("en-GB")}
              </time>
            </div>
            <p>{notice.message}</p>
            {notice.endsAt ? (
              <p>End date: {new Date(notice.endsAt).toLocaleString("en-GB")}</p>
            ) : null}
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
            {notice.studentId ? <MemberSubscriptionAction studentId={notice.studentId} role={role} /> : null}
          </li>
        ))}
      </ol>
      <div className="admin-notification-actions">
        {olderPage ? (
          <button
            type="button"
            className="admin-auth-button"
            disabled={loading || busy !== null}
            onClick={() => changeQuery({ filter, cursor: null })}
          >
            Latest notifications
          </button>
        ) : null}
        {page?.nextCursor ? (
          <button
            type="button"
            className="admin-auth-button"
            disabled={loading || busy !== null}
            onClick={() => changeQuery({ filter, cursor: page.nextCursor })}
          >
            Older notifications
          </button>
        ) : null}
      </div>
    </section>
  );
}
