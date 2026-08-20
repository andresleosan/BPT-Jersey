"use client";

import { useEffect, useState, type FormEvent } from "react";

import { ClientAuthGate, ClientAuthProvider, useClientSession } from "../../../lib/client-auth";
import {
  getClientProfile,
  saveClientProfile,
  type ProfileFormInput,
} from "../../../lib/profile-client";

const preferenceOptions = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
] as const;

const emptyForm: ProfileFormInput = {
  fullName: "",
  dateOfBirth: "",
  phoneNumber: "",
  trainingCenter: "Town",
  trainingTimePreferences: [],
};

type ProfileErrors = Partial<Record<keyof ProfileFormInput, string>>;

function formFromStudent(student: {
  fullName: string;
  dateOfBirth: string;
  phoneNumber?: string;
  trainingCenter: ProfileFormInput["trainingCenter"];
  trainingTimePreferences: readonly ProfileFormInput["trainingTimePreferences"][number][];
}): ProfileFormInput {
  return {
    fullName: student.fullName,
    dateOfBirth: student.dateOfBirth,
    phoneNumber: student.phoneNumber ?? "",
    trainingCenter: student.trainingCenter,
    trainingTimePreferences: [...student.trainingTimePreferences],
  };
}

function validateForm(form: ProfileFormInput): ProfileErrors {
  const errors: ProfileErrors = {};
  if (!form.fullName.trim()) errors.fullName = "Enter your full name.";
  if (!form.dateOfBirth) errors.dateOfBirth = "Enter your date of birth.";
  if (!form.phoneNumber.trim()) errors.phoneNumber = "Enter your phone number.";
  if (!form.trainingCenter) errors.trainingCenter = "Choose your training center.";
  if (form.trainingTimePreferences.length === 0) {
    errors.trainingTimePreferences = "Choose at least one training time.";
  }
  return errors;
}

function FieldError({ id, message }: Readonly<{ id: string; message?: string | undefined }>) {
  return message ? (
    <p className="profile-field-error" id={id}>
      {message}
    </p>
  ) : null;
}

function ProfileContent() {
  const { session } = useClientSession();
  const [form, setForm] = useState<ProfileFormInput>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void getClientProfile()
      .then((profile) => {
        if (!active) return;
        if (profile) setForm(formFromStudent(profile.student));
      })
      .catch((error: unknown) => {
        if (active)
          setLoadError(error instanceof Error ? error.message : "Unable to load your profile.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  if (!session) return null;

  if (loading) {
    return (
      <main className="profile-loading" aria-busy="true" aria-labelledby="profile-loading-title">
        <p className="account-eyebrow">BPT Jersey / Client</p>
        <h1 id="profile-loading-title">Loading your profile</h1>
      </main>
    );
  }

  function updateField<K extends keyof ProfileFormInput>(field: K, value: ProfileFormInput[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setNotice("");
    setSaveError("");
  }

  function togglePreference(
    preference: ProfileFormInput["trainingTimePreferences"][number],
    checked: boolean,
  ) {
    const preferences = checked
      ? [...form.trainingTimePreferences, preference]
      : form.trainingTimePreferences.filter((current) => current !== preference);
    updateField("trainingTimePreferences", preferences);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateForm(form);
    setErrors(nextErrors);
    setNotice("");
    setSaveError("");
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    try {
      const saved = await saveClientProfile({
        ...form,
        fullName: form.fullName.trim(),
        phoneNumber: form.phoneNumber.trim(),
      });
      setForm(formFromStudent(saved.student));
      setNotice("Profile saved.");
    } catch (error: unknown) {
      setSaveError(
        error instanceof Error ? error.message : "Unable to save your profile. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="profile-page" id="main-content">
      <section className="profile-rail" aria-labelledby="profile-title">
        <a className="profile-back-link" href="/account">
          <span aria-hidden="true">&larr;</span> Back to account
        </a>
        <p className="profile-kicker">BPT Jersey / Client profile</p>
        <h1 id="profile-title">Build your training profile</h1>
        <p className="profile-rail-copy">
          Keep your training base clear so every future booking, class and progress view starts with
          the right details.
        </p>
        <div className="profile-progress" aria-label="Profile setup, step one of one">
          <span>01</span>
          <span className="profile-progress-line" aria-hidden="true" />
          <span>01</span>
        </div>
        <div className="profile-rail-note">
          <p className="profile-note-label">Your training base</p>
          <strong>{form.trainingCenter}</strong>
          <span>
            {form.trainingTimePreferences.length
              ? form.trainingTimePreferences.join(" / ")
              : "Choose your usual times"}
          </span>
        </div>
      </section>

      <section className="profile-card" aria-labelledby="profile-form-title">
        <div className="profile-card-heading">
          <p className="account-eyebrow">One clear starting point</p>
          <h2 id="profile-form-title">Your details</h2>
          <p>
            Use the name and contact details you want the academy to use when we need to reach you.
          </p>
        </div>

        {loadError ? (
          <p className="profile-message profile-message-error" role="alert">
            {loadError}
          </p>
        ) : null}

        <form className="profile-form" noValidate onSubmit={(event) => void handleSubmit(event)}>
          <div className="profile-field profile-field-wide">
            <label htmlFor="profile-full-name">Full name</label>
            <input
              aria-describedby={errors.fullName ? "profile-full-name-error" : undefined}
              aria-invalid={errors.fullName ? "true" : "false"}
              autoComplete="name"
              id="profile-full-name"
              onChange={(event) => updateField("fullName", event.target.value)}
              type="text"
              value={form.fullName}
            />
            <FieldError id="profile-full-name-error" message={errors.fullName} />
          </div>

          <div className="profile-field">
            <label htmlFor="profile-date-of-birth">Date of birth</label>
            <input
              aria-describedby={errors.dateOfBirth ? "profile-date-of-birth-error" : undefined}
              aria-invalid={errors.dateOfBirth ? "true" : "false"}
              autoComplete="bday"
              id="profile-date-of-birth"
              onChange={(event) => updateField("dateOfBirth", event.target.value)}
              type="date"
              value={form.dateOfBirth}
            />
            <FieldError id="profile-date-of-birth-error" message={errors.dateOfBirth} />
          </div>

          <div className="profile-field">
            <label htmlFor="profile-phone-number">Phone number</label>
            <input
              aria-describedby={errors.phoneNumber ? "profile-phone-number-error" : undefined}
              aria-invalid={errors.phoneNumber ? "true" : "false"}
              autoComplete="tel"
              id="profile-phone-number"
              onChange={(event) => updateField("phoneNumber", event.target.value)}
              type="tel"
              value={form.phoneNumber}
            />
            <FieldError id="profile-phone-number-error" message={errors.phoneNumber} />
          </div>

          <div className="profile-field profile-field-wide">
            <label htmlFor="profile-email">Email</label>
            <div className="profile-readonly-field" id="profile-email">
              {session.email}
              <span>From your signed-in account</span>
            </div>
          </div>

          <div className="profile-field">
            <label htmlFor="profile-training-center">Training center</label>
            <select
              aria-describedby={errors.trainingCenter ? "profile-training-center-error" : undefined}
              aria-invalid={errors.trainingCenter ? "true" : "false"}
              id="profile-training-center"
              onChange={(event) =>
                updateField(
                  "trainingCenter",
                  event.target.value as ProfileFormInput["trainingCenter"],
                )
              }
              value={form.trainingCenter}
            >
              <option value="Town">Town</option>
              <option value="West">West</option>
            </select>
            <FieldError id="profile-training-center-error" message={errors.trainingCenter} />
          </div>

          <fieldset className="profile-preferences profile-field">
            <legend>Preferred training times</legend>
            <div className="profile-preference-list">
              {preferenceOptions.map((option) => {
                const checked = form.trainingTimePreferences.includes(option.value);
                return (
                  <label className="profile-preference" key={option.value}>
                    <input
                      aria-describedby={
                        errors.trainingTimePreferences ? "profile-preferences-error" : undefined
                      }
                      checked={checked}
                      onChange={(event) => togglePreference(option.value, event.target.checked)}
                      type="checkbox"
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>
            <FieldError id="profile-preferences-error" message={errors.trainingTimePreferences} />
          </fieldset>

          {saveError ? (
            <p className="profile-message profile-message-error profile-form-message" role="alert">
              {saveError}
            </p>
          ) : null}
          {notice ? (
            <p
              className="profile-message profile-message-success profile-form-message"
              role="status"
            >
              {notice}
            </p>
          ) : null}

          <div className="profile-form-actions profile-field-wide">
            <p>We only use these details to support your academy experience.</p>
            <button
              className="button button-primary profile-submit"
              disabled={saving}
              type="submit"
            >
              {saving ? "Saving profile..." : "Save profile"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

export default function ProfilePage() {
  return (
    <ClientAuthProvider>
      <ClientAuthGate returnPath="/account/profile">
        <ProfileContent />
      </ClientAuthGate>
    </ClientAuthProvider>
  );
}
