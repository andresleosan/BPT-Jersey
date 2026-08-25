"use client";

import { useEffect, useState } from "react";

import type { SafeguardingNoticeRecord } from "@bpt-jersey/domain/announcements";
import { listGuardianNotices, markNoticeAsRead } from "../../lib/announcements-client";

export function GuardianNoticesPanel() {
  const [notices, setNotices] = useState<readonly SafeguardingNoticeRecord[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [actionError, setActionError] = useState(false);
  const [busyNoticeId, setBusyNoticeId] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    void listGuardianNotices()
      .then((nextNotices) => {
        if (!active) return;
        setNotices(nextNotices);
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleMarkAsRead(noticeId: string): Promise<void> {
    setBusyNoticeId(noticeId);
    setActionError(false);
    try {
      const updatedNotice = await markNoticeAsRead(noticeId);
      setNotices((current) =>
        current.map((notice) =>
          notice.noticeId === updatedNotice.noticeId ? updatedNotice : notice,
        ),
      );
    } catch {
      setActionError(true);
    } finally {
      setBusyNoticeId(undefined);
    }
  }

  return (
    <section className="account-notices" aria-labelledby="guardian-notices-title">
      <div className="account-notices-heading">
        <p className="account-eyebrow">Safeguarding</p>
        <h2 id="guardian-notices-title">Family notices</h2>
        <p>
          Messages about children are delivered to your guardian account. Private child-to-coach
          channels are not available.
        </p>
      </div>

      {status === "loading" && <p aria-live="polite">Loading family notices…</p>}
      {status === "error" && (
        <p className="family-message family-message-error" role="alert">
          Unable to load family notices. Please try again.
        </p>
      )}
      {actionError && (
        <p className="family-message family-message-error" role="alert">
          Unable to update this notice. Please try again.
        </p>
      )}
      {status === "ready" && notices.length === 0 && (
        <p className="account-notices-empty">No family notices right now.</p>
      )}
      {status === "ready" && notices.length > 0 && (
        <ul className="account-notices-list">
          {notices.map((notice) => (
            <li key={notice.noticeId}>
              <article className={`account-notice${notice.readAt ? "" : " account-notice-unread"}`}>
                <div className="account-notice-meta">
                  <span>{notice.category}</span>
                  <span>{notice.readAt ? "Read" : "Unread"}</span>
                </div>
                <h3>{notice.title}</h3>
                <p>{notice.content}</p>
                {!notice.readAt && (
                  <button
                    className="button button-secondary account-notice-action"
                    disabled={busyNoticeId === notice.noticeId}
                    onClick={() => void handleMarkAsRead(notice.noticeId)}
                    type="button"
                  >
                    {busyNoticeId === notice.noticeId ? "Saving…" : "Mark as read"}
                  </button>
                )}
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
