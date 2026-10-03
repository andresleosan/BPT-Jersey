"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { GraduationNotices as Notices } from "@bpt-jersey/domain/graduations";

import { getGraduationNotices } from "../../../lib/graduations-client";

import "./graduation.css";

type Promotion = NonNullable<Notices["latestPromotion"]>;

const recentMs = 30 * 86_400_000;
const classFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Jersey",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});

// Dismissed celebrations for this page view, for browsers where localStorage throws.
const seenThisView = new Set<string>();
const seenKey = (studentId: string, promotionId: string) =>
  `bpt.graduation.seen.${studentId}.${promotionId}`;

function wasSeen(key: string): boolean {
  if (seenThisView.has(key)) return true;
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function markSeen(key: string): void {
  seenThisView.add(key);
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // Storage blocked: the Set above keeps it hidden until the page reloads.
  }
}

/** Only a promotion from the last 30 days is still news. */
function isRecent(promotedOn: string): boolean {
  return Date.now() - Date.parse(`${promotedOn}T00:00:00Z`) <= recentMs;
}

function nextClass(likely: Notices["likelyNext"]): string | null {
  return likely ? `${classFormat.format(new Date(likely.startAt))} · ${likely.title}` : null;
}

function StageCard({ notices }: Readonly<{ notices: Notices }>) {
  const eyebrow = `${notices.firstName} · Graduation`;
  const target = notices.targetName ?? "your next level";
  const next = nextClass(notices.likelyNext);
  const titleId = useId();

  if (notices.stage === "twoLeft") {
    return (
      <section aria-labelledby={titleId} className="grad-card">
        <span aria-hidden="true" className="grad-marks">
          <i className="grad-mark" />
          <i className="grad-mark" />
        </span>
        <div>
          <p className="account-eyebrow">{eyebrow}</p>
          <h2 id={titleId}>Only 2 classes to {target}</h2>
        </div>
      </section>
    );
  }
  if (notices.stage === "next" || notices.stage === "today") {
    const body = notices.missedLikely
      ? `We missed you — ${target} is still one class away.${next ? ` Next: ${next}` : ""}`
      : (next ?? "Keep training — your next class can count");
    return (
      <section aria-labelledby={titleId} className="grad-card">
        <span aria-hidden="true" className="grad-chip">
          {target}
        </span>
        <div>
          <p className="account-eyebrow">{eyebrow}</p>
          <h2 id={titleId}>Your next class could be a graduation</h2>
          <p>{body}</p>
        </div>
      </section>
    );
  }
  if (notices.stage === "approval") {
    return (
      <section aria-labelledby={titleId} className="grad-card">
        <span aria-hidden="true" className="grad-calm" />
        <div>
          <p className="account-eyebrow">{eyebrow}</p>
          <h2 id={titleId}>Graduation class done</h2>
          <p>The owner will confirm soon.</p>
        </div>
      </section>
    );
  }
  return null;
}

/**
 * The new level, once: the belt slides in and the Classes and Time bars empty, because both count
 * again from here. Native modal dialog (Escape closes it); any close marks the promotion as seen and
 * focus goes back to whatever held it before.
 */
function Celebration({
  firstName,
  promotion,
  onClose,
}: Readonly<{ firstName: string; promotion: Promotion; onClose: () => void }>) {
  const ref = useRef<HTMLDialogElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  // Read at first render, before showModal moves focus.
  const [trigger] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    continueRef.current?.focus();
    return () => {
      if (trigger?.isConnected) trigger.focus();
    };
  }, [trigger]);

  const close = () => {
    const dialog = ref.current;
    if (dialog && typeof dialog.close === "function") dialog.close();
    else onClose();
  };

  return (
    <dialog
      aria-labelledby={titleId}
      aria-modal="true"
      className="grad-dialog"
      onClose={onClose}
      ref={ref}
      role="dialog"
    >
      <div className="grad-belt-track">
        <div aria-hidden="true" className="grad-belt">
          <span>{promotion.toName}</span>
          <i />
        </div>
      </div>
      <p className="account-eyebrow">{firstName} · Graduation</p>
      <h2 id={titleId}>New level: {promotion.toName}</h2>
      <p>
        From {promotion.fromName} ·{" "}
        {dayFormat.format(new Date(`${promotion.promotedOn}T00:00:00Z`))}
      </p>
      <div className="grad-reset">
        {["Classes", "Time"].map((label) => (
          <div className="grad-reset-row" key={label}>
            <span>{label}</span>
            <span aria-hidden="true" className="grad-reset-track">
              <i />
            </span>
          </div>
        ))}
        <p className="grad-reset-hint">Both count again from this level.</p>
      </div>
      <button className="button grad-continue" onClick={close} ref={continueRef} type="button">
        Continue
      </button>
    </dialog>
  );
}

/**
 * Graduation slot under the streak (spec 2026-10-03). Renders nothing while loading, on error or
 * when there is nothing to say. Mounted with `key` per participant, so a guardian sees each child's.
 */
export function GraduationNotices({ studentId }: Readonly<{ studentId: string }>) {
  const [notices, setNotices] = useState<Notices | null>(null);
  const [celebrating, setCelebrating] = useState<Promotion | null>(null);
  const noteId = useId();

  useEffect(() => {
    let active = true;
    getGraduationNotices(studentId).then(
      (result) => {
        if (!active || !result) return;
        setNotices(result);
        const promotion = result.latestPromotion;
        if (
          promotion &&
          isRecent(promotion.promotedOn) &&
          !wasSeen(seenKey(studentId, promotion.promotionId))
        ) {
          setCelebrating(promotion);
        }
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [studentId]);

  if (!notices) return null;
  const showNote = notices.lastNotYetNote !== null && notices.stage !== "approval";
  return (
    <>
      <StageCard notices={notices} />
      {showNote ? (
        <section aria-labelledby={noteId} className="grad-card grad-card--note">
          <div>
            <p className="account-eyebrow">{notices.firstName} · Graduation</p>
            <h2 id={noteId}>Keep going</h2>
            <p>{notices.lastNotYetNote}</p>
          </div>
        </section>
      ) : null}
      {celebrating ? (
        <Celebration
          firstName={notices.firstName}
          onClose={() => {
            markSeen(seenKey(studentId, celebrating.promotionId));
            setCelebrating(null);
          }}
          promotion={celebrating}
        />
      ) : null}
    </>
  );
}
