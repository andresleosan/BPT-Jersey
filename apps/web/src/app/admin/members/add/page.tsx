"use client";

import { useRef, useState, type FormEvent } from "react";
import type { MemberGender } from "@bpt-jersey/domain";

import { createMember, type CreateMemberInput } from "../../../../lib/members-client";

import "../../admin.css";

type FieldErrors = Readonly<{ fullName?: string }>;

type FormValues = Readonly<{
  fullName: string;
  membershipNumber: string;
  email: string;
  idCardNumber: string;
  vatNumber: string;
  birthDate: string;
  mobileNumber: string;
  frequency: string;
  gender: "" | MemberGender;
  trainingCenter: string;
}>;

const initialValues: FormValues = {
  fullName: "",
  membershipNumber: "",
  email: "",
  idCardNumber: "",
  vatNumber: "",
  birthDate: "",
  mobileNumber: "",
  frequency: "",
  gender: "",
  trainingCenter: "",
};

const genericFormError = "Unable to add member. Please try again.";

function optionalText(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function inputFromValues(values: FormValues): CreateMemberInput {
  const input: { -readonly [K in keyof CreateMemberInput]?: CreateMemberInput[K] } = {
    fullName: values.fullName.trim(),
  };
  const optionalFields: Readonly<{
    membershipNumber: string;
    email: string;
    idCardNumber: string;
    vatNumber: string;
    birthDate: string;
    mobileNumber: string;
    frequency: string;
    trainingCenter: string;
  }> = values;

  for (const field of [
    "membershipNumber",
    "email",
    "idCardNumber",
    "vatNumber",
    "birthDate",
    "mobileNumber",
    "frequency",
    "trainingCenter",
  ] as const) {
    const value = optionalText(optionalFields[field]);
    if (value !== undefined) {
      (input as { [key in typeof field]?: string })[field] = value;
    }
  }

  const gender = values.gender.trim();
  if (gender.length > 0) {
    input.gender = gender as MemberGender;
  }

  return input as CreateMemberInput;
}

export function AddMemberPage() {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const fullNameRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  function updateField<K extends keyof FormValues>(field: K, value: FormValues[K]): void {
    setValues((current) => ({ ...current, [field]: value }));
    if (field === "fullName" && fieldErrors.fullName) {
      setFieldErrors({});
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submittingRef.current) return;

    setError("");
    setSuccess("");

    if (!values.fullName.trim()) {
      setFieldErrors({ fullName: "Full name is required." });
      fullNameRef.current?.focus();
      return;
    }

    setFieldErrors({});
    submittingRef.current = true;
    setBusy(true);

    try {
      const result = await createMember(inputFromValues(values));
      setValues(initialValues);
      setSuccess(`Member added successfully. ID: ${result.memberId}`);
    } catch {
      setError(genericFormError);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="admin-member-page" aria-labelledby="add-member-title">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">Members / Create record</p>
        <h2 id="add-member-title">Add new member</h2>
        <p>
          Create a clean academy record for a new member. You can add more operational details
          later.
        </p>
      </header>

      <form
        className="login-card login-form"
        id="add-member-form"
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="login-field">
          <label htmlFor="member-full-name">Full name</label>
          <input
            aria-describedby={fieldErrors.fullName ? "member-full-name-error" : undefined}
            aria-invalid={fieldErrors.fullName ? "true" : "false"}
            autoComplete="name"
            id="member-full-name"
            name="fullName"
            onChange={(event) => updateField("fullName", event.target.value)}
            ref={fullNameRef}
            required
            type="text"
            value={values.fullName}
          />
          {fieldErrors.fullName ? (
            <p className="login-field-error" id="member-full-name-error" role="alert">
              {fieldErrors.fullName}
            </p>
          ) : null}
        </div>

        <div className="login-field">
          <label htmlFor="member-membership-number">Membership number</label>
          <input
            autoComplete="off"
            id="member-membership-number"
            name="membershipNumber"
            onChange={(event) => updateField("membershipNumber", event.target.value)}
            type="text"
            value={values.membershipNumber}
          />
        </div>

        <div className="login-field">
          <label htmlFor="member-email">Email address</label>
          <input
            autoComplete="email"
            id="member-email"
            name="email"
            onChange={(event) => updateField("email", event.target.value)}
            type="email"
            value={values.email}
          />
        </div>

        <div className="login-field">
          <label htmlFor="member-id-card-number">ID card number</label>
          <input
            id="member-id-card-number"
            name="idCardNumber"
            onChange={(event) => updateField("idCardNumber", event.target.value)}
            type="text"
            value={values.idCardNumber}
          />
        </div>

        <div className="login-field">
          <label htmlFor="member-vat-number">VAT number</label>
          <input
            id="member-vat-number"
            name="vatNumber"
            onChange={(event) => updateField("vatNumber", event.target.value)}
            type="text"
            value={values.vatNumber}
          />
        </div>

        <div className="login-field">
          <label htmlFor="member-birth-date">Birth date</label>
          <input
            id="member-birth-date"
            name="birthDate"
            onChange={(event) => updateField("birthDate", event.target.value)}
            type="date"
            value={values.birthDate}
          />
        </div>

        <div className="login-field">
          <label htmlFor="member-mobile-number">Mobile number</label>
          <input
            autoComplete="tel"
            id="member-mobile-number"
            name="mobileNumber"
            onChange={(event) => updateField("mobileNumber", event.target.value)}
            type="tel"
            value={values.mobileNumber}
          />
        </div>

        <div className="login-field">
          <label htmlFor="member-frequency">Frequency</label>
          <input
            id="member-frequency"
            name="frequency"
            onChange={(event) => updateField("frequency", event.target.value)}
            type="text"
            value={values.frequency}
          />
        </div>

        <div className="login-field">
          <label htmlFor="member-gender">Gender</label>
          <select
            id="member-gender"
            name="gender"
            onChange={(event) => updateField("gender", event.target.value as FormValues["gender"])}
            value={values.gender}
          >
            <option value="">Select gender</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="unknown">Prefer not to say</option>
          </select>
        </div>

        <div className="login-field">
          <label htmlFor="member-training-center">Training center</label>
          <input
            id="member-training-center"
            name="trainingCenter"
            onChange={(event) => updateField("trainingCenter", event.target.value)}
            type="text"
            value={values.trainingCenter}
          />
        </div>

        {error ? (
          <p aria-live="assertive" className="login-message login-message-error" role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p aria-live="polite" className="login-message" role="status">
            {success}
          </p>
        ) : null}

        <button className="button button-primary login-submit" disabled={busy} type="submit">
          {busy ? "Adding member..." : "Add member"}
        </button>
      </form>
    </section>
  );
}

export default function AddMemberRoute() {
  if (process.env.NODE_ENV === "test") {
    return <AddMemberPage />;
  }

  return <AddMemberPage />;
}
