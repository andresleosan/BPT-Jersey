"use client";

import { useEffect, useRef, useState } from "react";
import type { StudentReview } from "@bpt-jersey/domain/profiles";
import {
  assignMemberGuardianInputSchema,
  setMemberDateOfBirthInputSchema,
} from "@bpt-jersey/domain/members/migration";
import { assignMemberGuardian, setMemberDateOfBirth } from "../../../lib/member-migration-client";

export function MemberReviewBadge({ guardianStatus, reviewReason }: StudentReview) {
  const label =
    reviewReason === "date-of-birth-missing"
      ? "Date of birth needed"
      : guardianStatus === "pending"
        ? "Guardian required"
        : undefined;
  return label ? (
    <span className="member-review-badge">
      <span aria-hidden="true" className="member-review-dot" />
      {label}
    </span>
  ) : null;
}

export function MemberReviewActions({
  studentId,
  guardianStatus,
  reviewReason,
  onSaved,
}: StudentReview & { studentId: string; onSaved: () => void }) {
  const [action, setAction] = useState<"guardian" | "birth-date">();
  return (
    <div className="member-review-actions">
      <MemberReviewBadge
        {...(guardianStatus === undefined ? {} : { guardianStatus })}
        {...(reviewReason === undefined ? {} : { reviewReason })}
      />
      {guardianStatus === "pending" ? (
        <button
          className="member-record-button"
          type="button"
          onClick={() => setAction("guardian")}
        >
          Assign guardian
        </button>
      ) : null}
      {reviewReason === "date-of-birth-missing" ? (
        <button
          className="member-record-button"
          type="button"
          onClick={() => setAction("birth-date")}
        >
          Set date of birth
        </button>
      ) : null}
      {action ? (
        <ReviewDialog
          studentId={studentId}
          action={action}
          onClose={() => setAction(undefined)}
          onSaved={() => {
            setAction(undefined);
            onSaved();
          }}
        />
      ) : null}
    </div>
  );
}

function ReviewDialog({
  studentId,
  action,
  onClose,
  onSaved,
}: {
  studentId: string;
  action: "guardian" | "birth-date";
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const replay = useRef<{ value: string; requestId: string } | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const title = action === "guardian" ? "Assign guardian" : "Set date of birth";
  useEffect(() => {
    const trigger = document.activeElement;
    dialog.current?.showModal();
    firstField.current?.focus();
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);
  async function save(form: HTMLFormElement) {
    const fields = new FormData(form);
    const fullName = String(fields.get("fullName") ?? "").trim();
    const phoneNumber = String(fields.get("phoneNumber") ?? "").trim();
    const email = String(fields.get("email") ?? "").trim();
    const value =
      action === "guardian"
        ? {
            studentId,
            guardianContact: {
              fullName,
              ...(phoneNumber ? { phoneNumber } : {}),
              ...(email ? { email } : {}),
            },
          }
        : { studentId, dateOfBirth: String(fields.get("dateOfBirth") ?? "") };
    const fingerprint = JSON.stringify(value);
    if (replay.current?.value !== fingerprint)
      replay.current = { value: fingerprint, requestId: crypto.randomUUID() };
    const input = { ...value, requestId: replay.current.requestId };
    const schema =
      action === "guardian" ? assignMemberGuardianInputSchema : setMemberDateOfBirthInputSchema;
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      setError(
        action === "guardian"
          ? "Enter a full name and a valid phone number or email."
          : "Enter a valid date of birth.",
      );
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      if (action === "guardian")
        await assignMemberGuardian(assignMemberGuardianInputSchema.parse(input));
      else await setMemberDateOfBirth(setMemberDateOfBirthInputSchema.parse(input));
      onSaved();
    } catch {
      setError("Could not save this review. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="ibjjf-dialog member-review-dialog"
      aria-labelledby="member-review-title"
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>(
          "input:not(:disabled), button:not(:disabled)",
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
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
    >
      <h3 id="member-review-title">{title}</h3>
      <form
        className="member-record-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void save(event.currentTarget);
        }}
      >
        <fieldset disabled={busy}>
          <legend>{action === "guardian" ? "Guardian contact" : "Member age"}</legend>
          {action === "guardian" ? (
            <>
              <p>Enter a phone number, an email, or both.</p>
              <div className="login-field">
                <label htmlFor="guardian-name">Full name</label>
                <input
                  ref={firstField}
                  id="guardian-name"
                  name="fullName"
                  required
                  maxLength={160}
                  autoComplete="off"
                />
              </div>
              <div className="login-field">
                <label htmlFor="guardian-phone">Phone number</label>
                <input
                  id="guardian-phone"
                  name="phoneNumber"
                  type="tel"
                  maxLength={64}
                  autoComplete="off"
                />
              </div>
              <div className="login-field">
                <label htmlFor="guardian-email">Email</label>
                <input
                  id="guardian-email"
                  name="email"
                  type="email"
                  maxLength={320}
                  autoComplete="off"
                />
              </div>
            </>
          ) : (
            <div className="login-field">
              <label htmlFor="member-birth-date">Date of birth</label>
              <input
                ref={firstField}
                id="member-birth-date"
                name="dateOfBirth"
                type="date"
                required
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>
          )}
        </fieldset>
        {error ? (
          <p className="member-record-notice" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ibjjf-dialog-actions">
          <button
            className="member-record-button"
            type="button"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button className="member-record-button" type="submit" disabled={busy}>
            {busy ? "Saving…" : title}
          </button>
        </div>
      </form>
    </dialog>
  );
}
