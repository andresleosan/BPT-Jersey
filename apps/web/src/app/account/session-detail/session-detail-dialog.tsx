"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { MemberPublicCard } from "@bpt-jersey/domain/members/engagement";

import { getSessionDetail, type SessionDetailResponse } from "../../../lib/session-roster-client";
import { MemberAvatar, MemberCardDialog } from "../competitors/member-card-dialog";

import "./session-detail.css";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; detail: SessionDetailResponse };

/**
 * The coach's plan and who is coming, for any ordinary session (booked or not). Opens on mount as a native
 * dialog, closes on Esc or «Close», and gives focus back to the card title that opened it.
 */
export function SessionDetailDialog({
  sessionId,
  studentId,
  heading,
  onClose,
  returnFocus,
}: Readonly<{
  sessionId: string;
  studentId: string;
  /** Time and title of the class, so the dialog says which one it is. */
  heading?: string;
  onClose: () => void;
  /** Safari does not focus a clicked button, so the caller hands over the opener. */
  returnFocus?: HTMLElement | null;
}>) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [open, setOpen] = useState<{ card: MemberPublicCard; opener: HTMLElement } | null>(null);
  // Read at first render, before showModal moves focus, so a StrictMode re-run keeps the real trigger.
  const [trigger] = useState(
    () =>
      returnFocus ??
      (typeof document !== "undefined" && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null),
  );

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    return () => trigger?.focus();
  }, [trigger]);

  const load = useCallback(() => {
    let active = true;
    setState({ kind: "loading" });
    getSessionDetail(sessionId, studentId).then(
      (detail) => {
        if (active) setState({ kind: "ready", detail });
      },
      (error: unknown) => {
        if (active)
          setState({ kind: "error", message: error instanceof Error ? error.message : "" });
      },
    );
    return () => {
      active = false;
    };
  }, [sessionId, studentId]);

  useEffect(() => load(), [load]);

  const close = () => {
    const dialog = ref.current;
    if (dialog && typeof dialog.close === "function") dialog.close();
    else onClose();
  };
  const mine =
    state.kind === "ready"
      ? (state.detail.roster.find((entry) => entry.isYou)?.card ?? null)
      : null;

  // The member card is a sibling, not a child: React would otherwise pass its close event up to this dialog.
  return (
    <>
      <dialog
        ref={ref}
        className="member-card-dialog session-detail-dialog"
        aria-labelledby={heading ? "session-detail-heading" : "session-detail-plan"}
        onClose={onClose}
      >
        {heading ? (
          <p className="session-detail-heading" id="session-detail-heading">
            {heading}
          </p>
        ) : null}
        {state.kind === "loading" ? (
          <div className="session-detail-skeleton" aria-busy="true" role="status">
            <span className="visually-hidden">Loading this class</span>
            <div className="skeleton-card" />
            <div className="skeleton-card competitor-skeleton-row" />
            <div className="skeleton-card competitor-skeleton-row" />
          </div>
        ) : null}
        {state.kind === "error" ? (
          <div className="session-detail-error" role="alert">
            <p>We couldn&apos;t load this class. Try again.</p>
            <button type="button" className="button" onClick={load}>
              Retry
            </button>
          </div>
        ) : null}
        <section className="session-detail-section">
          <h2 id="session-detail-plan">Plan for this class</h2>
          {state.kind === "ready" ? (
            state.detail.curriculum ? (
              <>
                <p className="session-detail-title">{state.detail.curriculum.title}</p>
                <ul className="session-detail-techniques">
                  {state.detail.curriculum.techniques.map((technique) => (
                    <li key={technique}>{technique}</li>
                  ))}
                </ul>
                {state.detail.curriculum.details ? (
                  <p className="session-detail-details">{state.detail.curriculum.details}</p>
                ) : null}
              </>
            ) : (
              <p className="competitor-muted">
                The coach hasn&apos;t published the plan for this class yet.
              </p>
            )
          ) : null}
        </section>
        {state.kind === "ready" ? (
          <section className="session-detail-section">
            <h2>Who&apos;s coming</h2>
            {state.detail.roster.length === 0 && state.detail.hiddenCount === 0 ? (
              <p className="competitor-muted">Nobody has booked this class yet.</p>
            ) : null}
            <ul className="competitor-list">
              {state.detail.roster.map(({ card, isYou }) => {
                const body = (
                  <>
                    <MemberAvatar card={card} size={40} />
                    <span className="competitor-main">
                      <span className="competitor-name">{card.displayName}</span>
                    </span>
                    {isYou ? <span className="session-detail-you">You</span> : null}
                  </>
                );
                return (
                  <li key={card.studentId} className={isYou ? "is-you" : undefined}>
                    {isYou ? (
                      <div className="competitor-row">{body}</div>
                    ) : (
                      <button
                        type="button"
                        className="competitor-row"
                        onClick={(event) => setOpen({ card, opener: event.currentTarget })}
                      >
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {state.detail.hiddenCount > 0 ? (
              <p className="competitor-footer">
                +{state.detail.hiddenCount} members from other age groups
              </p>
            ) : null}
          </section>
        ) : null}
        <div className="member-card-actions">
          <button type="button" className="button" onClick={close}>
            Close
          </button>
        </div>
      </dialog>
      {open ? (
        <MemberCardDialog
          key={open.card.studentId}
          card={open.card}
          mine={mine}
          returnFocus={open.opener}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}
