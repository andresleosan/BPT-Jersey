"use client";

import { useEffect, useState } from "react";
import type { MemberNotification } from "@bpt-jersey/domain";
import { listMemberNotifications, markMemberNotificationRead } from "../../lib/intro-notifications-client";

export function IntroNotices() {
  const [notices, setNotices] = useState<readonly MemberNotification[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void listMemberNotifications().then((value) => { if (live) setNotices(value.filter((notice) => notice.readAt === null)); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  async function dismiss(notificationId: string) {
    try {
      await markMemberNotificationRead(notificationId);
      setNotices((current) => current.filter((notice) => notice.notificationId !== notificationId));
    } catch {
      setFailed(true);
    }
  }

  if (notices.length === 0 && !failed) return null;
  return (
    <section className="intro-notices" aria-labelledby="intro-notices-title">
      {notices.length > 0 ? <h2 id="intro-notices-title">Your next step</h2> : null}
      {notices.map((notice) => (
        <article className="intro-notice" key={notice.notificationId}>
          <div><h3>{notice.title}</h3><p>{notice.body}</p></div>
          <div className="intro-notice-actions">
            <a href={notice.href}>Get a membership</a>
            <button type="button" onClick={() => void dismiss(notice.notificationId)}>Dismiss</button>
          </div>
        </article>
      ))}
      {failed ? <p role="status" className="intro-notice-error">Notices could not be updated. Try again shortly.</p> : null}
    </section>
  );
}
