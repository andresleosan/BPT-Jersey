"use client";

import { useEffect, useState } from "react";

import type { InAppReminderRecord } from "@bpt-jersey/domain/reminders";
import { listClientReminders } from "../../lib/reminders-client";

export function ClientRemindersPanel() {
  const [reminders, setReminders] = useState<readonly InAppReminderRecord[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    void listClientReminders()
      .then((nextReminders) => {
        if (!active) return;
        setReminders(nextReminders);
        setStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        setStatus("error");
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="account-reminders" aria-labelledby="account-reminders-title">
      <div className="account-reminders-heading">
        <p className="account-eyebrow">Follow-up</p>
        <h2 id="account-reminders-title">Account reminders</h2>
      </div>
      <p className="account-reminders-intro">
        These reminders are derived from your current payment and attendance records.
      </p>
      {status === "loading" ? <p role="status">Loading reminders…</p> : null}
      {status === "error" ? (
        <p role="alert">Reminders are temporarily unavailable. Please try again later.</p>
      ) : null}
      {status === "ready" && reminders.length === 0 ? (
        <p className="account-reminders-empty">No follow-up reminders right now.</p>
      ) : null}
      {reminders.length > 0 ? (
        <ul className="account-reminders-list">
          {reminders.map((reminder) => (
            <li className="account-reminder" key={reminder.reminderId}>
              <div>
                <h3>{reminder.title}</h3>
                <p>{reminder.message}</p>
              </div>
              <span className="account-reminder-kind">
                {reminder.kind === "payment" ? "Payment" : "Attendance"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
