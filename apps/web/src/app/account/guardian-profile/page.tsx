"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { ClientAuthGate, ClientAuthProvider, useClientSession } from "../../../lib/client-auth";
import {
  createGuardianProfileRequestId,
  getGuardianProfile,
  saveGuardianProfile,
  type GuardianProfileFormInput,
} from "../../../lib/guardian-profile-client";

const emptyForm: GuardianProfileFormInput = {
  displayName: "",
  phoneNumber: "",
};

type GuardianProfileErrors = Partial<Record<keyof GuardianProfileFormInput, string>>;

function validateForm(form: GuardianProfileFormInput): GuardianProfileErrors {
  const errors: GuardianProfileErrors = {};
  if (!form.displayName.trim()) errors.displayName = "Enter your full name.";
  if (!form.phoneNumber.trim()) errors.phoneNumber = "Enter your phone number.";
  return errors;
}

function FieldError({ id, message }: Readonly<{ id: string; message?: string | undefined }>) {
  return message ? (
    <p className="profile-field-error" id={id}>
      {message}
    </p>
  ) : null;
}

function GuardianProfileContent() {
  const router = useRouter();
  const { session } = useClientSession();
  const [form, setForm] = useState<GuardianProfileFormInput>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<GuardianProfileErrors>({});
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const pendingRequestId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (session?.role !== "guardian") {
      setLoading(false);
      return;
    }
    let active = true;
    void getGuardianProfile()
      .then((profile) => {
        if (!active) return;
        setForm(
          profile
            ? { displayName: profile.displayName, phoneNumber: profile.phoneNumber }
            : { displayName: session.displayName, phoneNumber: "" },
        );
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Unable to load your guardian profile. Please try again.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session?.displayName, session?.role]);

  if (!session) return null;

  if (loading) {
    return (
      <main className="profile-loading" aria-busy="true" aria-labelledby="guardian-loading-title">
        <p className="account-eyebrow">BPT Jersey / Guardian</p>
        <h1 id="guardian-loading-title">Loading your profile</h1>
      </main>
    );
  }

  if (session.role !== "guardian") {
    return (
      <main className="client-auth-state" aria-labelledby="guardian-access-title">
        <p className="account-eyebrow">BPT Jersey / Guardian</p>
        <h1 id="guardian-access-title">Guardian access required</h1>
        <p>This profile is available only to an authenticated guardian account.</p>
        <a className="button button-secondary" href="/account">
          Back to account
        </a>
      </main>
    );
  }

  function updateField<K extends keyof GuardianProfileFormInput>(
    field: K,
    value: GuardianProfileFormInput[K],
  ) {
    pendingRequestId.current = undefined;
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSaveError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateForm(form);
    setErrors(nextErrors);
    setSaveError("");
    if (Object.keys(nextErrors).length > 0) return;

    const requestId = pendingRequestId.current ?? createGuardianProfileRequestId();
    pendingRequestId.current = requestId;
    setSaving(true);
    try {
      await saveGuardianProfile({
        requestId,
        displayName: form.displayName.trim(),
        phoneNumber: form.phoneNumber.trim(),
      });
      pendingRequestId.current = undefined;
      router.push("/account/family");
    } catch (error: unknown) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Unable to save your guardian profile. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="profile-page" id="main-content">
      <section className="profile-rail" aria-labelledby="guardian-profile-title">
        <a className="profile-back-link" href="/account">
          <span aria-hidden="true">&larr;</span> Back to account
        </a>
        <p className="profile-kicker">BPT Jersey / Guardian profile</p>
        <h1 id="guardian-profile-title">Set up your family contact</h1>
        <p className="profile-rail-copy">
          Confirm the contact details the academy should use before you connect and support your
          students.
        </p>
        <div className="profile-progress" aria-label="Family setup, guardian profile step">
          <span>01</span>
          <span className="profile-progress-line" aria-hidden="true" />
          <span>Family</span>
        </div>
        <div className="profile-rail-note">
          <p className="profile-note-label">Next step</p>
          <strong>Your linked students</strong>
          <span>Continue to your family view after this profile is saved.</span>
        </div>
      </section>

      <section className="profile-card" aria-labelledby="guardian-form-title">
        <div className="profile-card-heading">
          <p className="account-eyebrow">One trusted contact</p>
          <h2 id="guardian-form-title">Your details</h2>
          <p>Your signed-in email stays fixed. You can maintain only your name and phone number.</p>
        </div>

        {loadError ? (
          <p className="profile-message profile-message-error" role="alert">
            {loadError}
          </p>
        ) : null}

        <form className="profile-form" noValidate onSubmit={(event) => void handleSubmit(event)}>
          <div className="profile-field profile-field-wide">
            <label htmlFor="guardian-display-name">Full name</label>
            <input
              aria-describedby={errors.displayName ? "guardian-display-name-error" : undefined}
              aria-invalid={errors.displayName ? "true" : "false"}
              autoComplete="name"
              id="guardian-display-name"
              maxLength={160}
              onChange={(event) => updateField("displayName", event.target.value)}
              type="text"
              value={form.displayName}
            />
            <FieldError id="guardian-display-name-error" message={errors.displayName} />
          </div>

          <div className="profile-field profile-field-wide">
            <label htmlFor="guardian-phone-number">Phone number</label>
            <input
              aria-describedby={errors.phoneNumber ? "guardian-phone-number-error" : undefined}
              aria-invalid={errors.phoneNumber ? "true" : "false"}
              autoComplete="tel"
              id="guardian-phone-number"
              maxLength={64}
              onChange={(event) => updateField("phoneNumber", event.target.value)}
              type="tel"
              value={form.phoneNumber}
            />
            <FieldError id="guardian-phone-number-error" message={errors.phoneNumber} />
          </div>

          <div className="profile-field profile-field-wide">
            <label htmlFor="guardian-email">Email</label>
            <div className="profile-readonly-field" id="guardian-email">
              {session.email}
              <span>From your signed-in account</span>
            </div>
          </div>

          {saveError ? (
            <p className="profile-message profile-message-error profile-form-message" role="alert">
              {saveError}
            </p>
          ) : null}

          <div className="profile-form-actions profile-field-wide">
            <p>These details are used only for your academy and family account.</p>
            <button
              className="button button-primary profile-submit"
              disabled={saving || Boolean(loadError)}
              type="submit"
            >
              {saving ? "Saving profile..." : "Save and view family"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

export default function GuardianProfilePage() {
  return (
    <ClientAuthProvider>
      <ClientAuthGate returnPath="/account/guardian-profile">
        <GuardianProfileContent />
      </ClientAuthGate>
    </ClientAuthProvider>
  );
}
