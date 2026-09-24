"use client";

import { useId, useState, type FormEvent, type InputHTMLAttributes } from "react";
import { z } from "zod";

import { requestEmailChange } from "../../../lib/account-settings-client";

/* Shared by the four account sections: label above, error below, status as text with a left rule. */

export function SettingsField({
  id,
  label,
  error,
  help,
  ...input
}: Readonly<
  { id: string; label: string; error?: string | undefined; help?: string } & Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "id"
  >
>) {
  const describedBy = [help ? `${id}-help` : "", error ? `${id}-error` : ""].filter(Boolean);
  return (
    <div className={error ? "settings-field settings-field-invalid" : "settings-field"}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy.length ? describedBy.join(" ") : undefined}
        {...input}
      />
      {help ? <small id={`${id}-help`}>{help}</small> : null}
      {error ? (
        <p className="settings-field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type SectionStatus = Readonly<{ kind: "success" | "error"; message: string }> | undefined;

export function StatusBand({ status }: Readonly<{ status: SectionStatus }>) {
  if (!status) return null;
  return status.kind === "success" ? (
    <p className="settings-band settings-band-success" role="status">
      {status.message}
    </p>
  ) : (
    <p className="settings-band settings-band-error" role="alert">
      {status.message}
    </p>
  );
}

/** The fallback when a client call throws instead of returning its result. */
export const accountFailed = "We couldn't update your account. Try again later.";

/** The first message zod reports for each field of a form, keyed by field name. */
export function fieldErrors<K extends string>(error: z.ZodError): Partial<Record<K, string>> {
  const found: Partial<Record<K, string>> = {};
  for (const issue of error.issues) {
    const key = issue.path[0] as K | undefined;
    if (key !== undefined && found[key] === undefined) found[key] = issue.message;
  }
  return found;
}

const emailFormSchema = z.object({
  newEmail: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email address.").max(254, "Enter a valid email address.")),
  currentPassword: z.string().min(1, "Enter your current password."),
});
type EmailErrors = Partial<Record<keyof z.infer<typeof emailFormSchema>, string>>;

export function EmailSection({ currentEmail }: Readonly<{ currentEmail: string | null }>) {
  const ids = useId();
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [errors, setErrors] = useState<EmailErrors>({});
  const [status, setStatus] = useState<SectionStatus>();
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const parsed = emailFormSchema.safeParse({ newEmail, currentPassword });
    setErrors(parsed.success ? {} : fieldErrors(parsed.error));
    setStatus(undefined);
    if (!parsed.success) return;
    setSaving(true);
    const result = await requestEmailChange({ currentPassword, newEmail }).catch(() => ({
      ok: false as const,
      message: accountFailed,
    }));
    setSaving(false);
    if (result.ok) {
      setNewEmail("");
      setCurrentPassword("");
      setStatus({ kind: "success", message: `Check ${result.sentTo} to confirm the change.` });
    } else {
      setStatus({ kind: "error", message: result.message });
    }
  }

  return (
    <section className="settings-section" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`}>Email</h2>
      {currentEmail ? (
        <p className="settings-help">
          You sign in with <strong className="settings-email">{currentEmail}</strong>. We send a
          link to the new address; the change takes effect once you open it.
        </p>
      ) : null}
      <form className="settings-form" noValidate onSubmit={(event) => void submit(event)}>
        <SettingsField
          id={`${ids}-email`}
          label="New email"
          type="email"
          autoComplete="email"
          value={newEmail}
          disabled={saving}
          error={errors.newEmail}
          onChange={(event) => setNewEmail(event.target.value)}
        />
        <SettingsField
          id={`${ids}-password`}
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          disabled={saving}
          error={errors.currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
        <div className="settings-actions">
          <button className="button button-primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Change email"}
          </button>
        </div>
      </form>
      <StatusBand status={status} />
    </section>
  );
}
