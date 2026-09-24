"use client";

import { useId, useState, type FormEvent } from "react";
import { z } from "zod";

import { changePassword } from "../../../lib/account-settings-client";
import {
  accountFailed,
  fieldErrors,
  SettingsField,
  StatusBand,
  type SectionStatus,
} from "./email-section";

const passwordFormSchema = z
  .object({
    current: z.string().min(1, "Enter your current password."),
    next: z
      .string()
      .min(12, "Choose a new password of at least 12 characters.")
      .max(128, "Choose a new password of 128 characters or fewer."),
    confirm: z.string(),
  })
  // `when` keeps the match check running even when another field already failed.
  .refine((form) => form.confirm === form.next, {
    path: ["confirm"],
    message: "The new passwords do not match.",
    when: () => true,
  });
type PasswordErrors = Partial<Record<"current" | "next" | "confirm", string>>;

export function PasswordSection() {
  const ids = useId();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [status, setStatus] = useState<SectionStatus>();
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const parsed = passwordFormSchema.safeParse({ current, next, confirm });
    setErrors(parsed.success ? {} : fieldErrors<keyof PasswordErrors>(parsed.error));
    setStatus(undefined);
    if (!parsed.success) return;
    setSaving(true);
    const result = await changePassword({
      currentPassword: current,
      newPassword: next,
      confirmPassword: confirm,
    }).catch(() => ({ ok: false as const, message: accountFailed }));
    setSaving(false);
    if (result.ok) {
      setCurrent("");
      setNext("");
      setConfirm("");
      setStatus({ kind: "success", message: "Password changed." });
    } else {
      setStatus({ kind: "error", message: result.message });
    }
  }

  return (
    <section className="settings-section" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`}>Password</h2>
      <form className="settings-form" noValidate onSubmit={(event) => void submit(event)}>
        <SettingsField
          id={`${ids}-current`}
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          disabled={saving}
          error={errors.current}
          onChange={(event) => setCurrent(event.target.value)}
        />
        <SettingsField
          id={`${ids}-new`}
          label="New password"
          type="password"
          autoComplete="new-password"
          help="At least 12 characters."
          value={next}
          disabled={saving}
          error={errors.next}
          onChange={(event) => setNext(event.target.value)}
        />
        <SettingsField
          id={`${ids}-confirm`}
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          disabled={saving}
          error={errors.confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        <div className="settings-actions">
          <button className="button button-primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Change password"}
          </button>
        </div>
      </form>
      <StatusBand status={status} />
    </section>
  );
}
