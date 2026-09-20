"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  deriveParticipantType,
  trainingCenters,
  trainingTimePreferences,
  type MemberGender,
  type TrainingCenter,
  type TrainingTimePreference,
} from "@bpt-jersey/domain";
import { createMember, type CreateMemberInput } from "../../../../lib/members-client";
import { saveHealthProfile } from "../../../../lib/health-client";

import { RegistrationCompletion } from "./registration-completion";

import "../../admin.css";

type FieldErrors = Readonly<{
  fullName?: string;
  dateOfBirth?: string;
  trainingCenter?: string;
  trainingTimePreferences?: string;
  emergencyContact?: string;
  postalAddress?: string;
}>;

type FormValues = Readonly<{
  fullName: string;
  email: string;
  dateOfBirth: string;
  phoneNumber: string;
  frequencyNote: string;
  membershipNumber: string;
  idCardNumber: string;
  vatNumber: string;
  gender: "" | MemberGender;
  trainingCenter: "" | TrainingCenter;
  trainingTimePreferences: readonly TrainingTimePreference[];
  medicalConditions: string;
  emergencyContactFullName: string;
  emergencyContactRelationship: string;
  emergencyContactPhoneNumber: string;
  emergencyContactAlternatePhoneNumber: string;
  addressLine: string;
  postCode: string;
}>;

const initialValues: FormValues = {
  fullName: "",
  email: "",
  dateOfBirth: "",
  phoneNumber: "",
  frequencyNote: "",
  membershipNumber: "",
  idCardNumber: "",
  vatNumber: "",
  gender: "",
  trainingCenter: "",
  trainingTimePreferences: [],
  medicalConditions: "",
  emergencyContactFullName: "",
  emergencyContactRelationship: "",
  emergencyContactPhoneNumber: "",
  emergencyContactAlternatePhoneNumber: "",
  addressLine: "",
  postCode: "",
};

const genericFormError = "Unable to add member. Please try again.";

function optionalText(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

// The official waiver form captures the emergency contact and the postal address at enrolment.
// Both blocks are optional as a whole, but once started they must be complete.
function emergencyContactFromValues(values: FormValues): CreateMemberInput["emergencyContact"] {
  const fullName = optionalText(values.emergencyContactFullName);
  const relationship = optionalText(values.emergencyContactRelationship);
  const phoneNumber = optionalText(values.emergencyContactPhoneNumber);
  const alternatePhoneNumber = optionalText(values.emergencyContactAlternatePhoneNumber);
  if (
    fullName === undefined &&
    relationship === undefined &&
    phoneNumber === undefined &&
    alternatePhoneNumber === undefined
  ) {
    return undefined;
  }
  if (fullName === undefined || relationship === undefined || phoneNumber === undefined) {
    throw new Error("incomplete emergency contact");
  }
  return {
    fullName,
    relationship,
    phoneNumber,
    ...(alternatePhoneNumber === undefined ? {} : { alternatePhoneNumber }),
  };
}

function postalAddressFromValues(values: FormValues): CreateMemberInput["postalAddress"] {
  const line = optionalText(values.addressLine);
  const postCode = optionalText(values.postCode);
  if (line === undefined && postCode === undefined) return undefined;
  if (line === undefined || postCode === undefined) throw new Error("incomplete postal address");
  return { line, postCode };
}

function inputFromValues(values: FormValues, requestId: string): CreateMemberInput {
  const emergencyContact = emergencyContactFromValues(values);
  const postalAddress = postalAddressFromValues(values);
  return {
    requestId,
    fullName: values.fullName.trim(),
    dateOfBirth: values.dateOfBirth,
    trainingCenter: values.trainingCenter as TrainingCenter,
    trainingTimePreferences: values.trainingTimePreferences,
    ...(optionalText(values.email) === undefined ? {} : { email: optionalText(values.email) }),
    ...(optionalText(values.phoneNumber) === undefined
      ? {}
      : { phoneNumber: optionalText(values.phoneNumber) }),
    ...(optionalText(values.frequencyNote) === undefined
      ? {}
      : { frequencyNote: optionalText(values.frequencyNote) }),
    ...(optionalText(values.membershipNumber)
      ? { membershipNumber: values.membershipNumber.trim() }
      : {}),
    ...(optionalText(values.idCardNumber) ? { idCardNumber: values.idCardNumber.trim() } : {}),
    ...(optionalText(values.vatNumber) ? { vatNumber: values.vatNumber.trim() } : {}),
    ...(values.gender === "" ? {} : { gender: values.gender }),
    ...(emergencyContact === undefined ? {} : { emergencyContact }),
    ...(postalAddress === undefined ? {} : { postalAddress }),
  };
}

function effectiveDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AddMemberPage() {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [requestId, setRequestId] = useState(() => globalThis.crypto.randomUUID());
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [createdMember, setCreatedMember] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<"none" | "saving" | "pending" | "saved">("none");
  const healthInFlight = useRef(false);
  const completionHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (createdMember) completionHeading.current?.focus();
  }, [createdMember]);
  useEffect(() => {
    const studentId = new URLSearchParams(window.location.search).get("studentId");
    if (studentId && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(studentId)) {
      setCreatedMember(studentId);
      if (new URLSearchParams(window.location.search).has("healthPending"))
        setHealthStatus("pending");
    }
  }, []);
  useEffect(() => {
    if (healthStatus !== "pending" && healthStatus !== "saving") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [healthStatus]);
  const [busy, setBusy] = useState(false);
  const fullNameRef = useRef<HTMLInputElement>(null);
  const dateOfBirthRef = useRef<HTMLInputElement>(null);
  const trainingCenterRef = useRef<HTMLSelectElement>(null);
  const emergencyContactRef = useRef<HTMLInputElement>(null);
  const addressLineRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  function updateField<K extends keyof FormValues>(field: K, value: FormValues[K]): void {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors({});
  }

  function togglePreference(preference: TrainingTimePreference): void {
    updateField(
      "trainingTimePreferences",
      values.trainingTimePreferences.includes(preference)
        ? values.trainingTimePreferences.filter((value) => value !== preference)
        : trainingTimePreferences.filter(
            (value) => value === preference || values.trainingTimePreferences.includes(value),
          ),
    );
  }

  function validate(): boolean {
    if (!values.fullName.trim()) {
      setFieldErrors({ fullName: "Full name is required." });
      fullNameRef.current?.focus();
      return false;
    }
    if (!values.dateOfBirth) {
      setFieldErrors({ dateOfBirth: "Date of birth is required." });
      dateOfBirthRef.current?.focus();
      return false;
    }
    try {
      if (deriveParticipantType(values.dateOfBirth, effectiveDate()) !== "adult") {
        setFieldErrors({
          dateOfBirth: "Minor students must be created through the family flow.",
        });
        dateOfBirthRef.current?.focus();
        return false;
      }
    } catch {
      setFieldErrors({ dateOfBirth: "Enter a valid date of birth." });
      dateOfBirthRef.current?.focus();
      return false;
    }
    if (values.trainingCenter === "") {
      setFieldErrors({ trainingCenter: "Training center is required." });
      trainingCenterRef.current?.focus();
      return false;
    }
    if (values.trainingTimePreferences.length === 0) {
      setFieldErrors({
        trainingTimePreferences: "Choose at least one training time.",
      });
      return false;
    }
    try {
      emergencyContactFromValues(values);
    } catch {
      setFieldErrors({
        emergencyContact: "Enter the emergency contact name, relationship and phone number.",
      });
      emergencyContactRef.current?.focus();
      return false;
    }
    try {
      postalAddressFromValues(values);
    } catch {
      setFieldErrors({ postalAddress: "Enter both the address and the post code." });
      addressLineRef.current?.focus();
      return false;
    }
    setFieldErrors({});
    return true;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submittingRef.current) return;
    setError("");
    if (!validate()) return;

    submittingRef.current = true;
    setBusy(true);
    try {
      const result = await createMember(inputFromValues(values, requestId));
      setCreatedMember(result.studentId);
      const url = new URL(window.location.href);
      url.searchParams.set("studentId", result.studentId);
      if (values.medicalConditions.trim()) url.searchParams.set("healthPending", "1");
      window.history.replaceState(null, "", url);
      if (values.medicalConditions.trim()) await saveMedicalInformation(result.studentId);
    } catch {
      setError(genericFormError);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  async function saveMedicalInformation(studentId: string): Promise<void> {
    if (healthInFlight.current || !values.medicalConditions.trim()) return;
    healthInFlight.current = true;
    setHealthStatus("saving");
    try {
      await saveHealthProfile({
        studentId,
        minimumOperationalSupport: ["none"],
        conditionSummary: values.medicalConditions.trim(),
        staffReferenceLabel: null,
        expiresAt: null,
      });
      setHealthStatus("saved");
      const url = new URL(window.location.href);
      url.searchParams.delete("healthPending");
      window.history.replaceState(null, "", url);
    } catch {
      setHealthStatus("pending");
    } finally {
      healthInFlight.current = false;
    }
  }

  function restart() {
    setCreatedMember(null);
    setValues(initialValues);
    setHealthStatus("none");
    setRequestId(globalThis.crypto.randomUUID());
    setError("");
    const url = new URL(window.location.href);
    url.searchParams.delete("studentId");
    url.searchParams.delete("healthPending");
    window.history.replaceState(null, "", url);
  }

  if (createdMember)
    return (
      <section className="admin-member-page" aria-labelledby="registration-title">
        <header className="admin-page-heading">
          <p className="admin-eyebrow">Members / Registration</p>
          <h2 id="registration-title" ref={completionHeading} tabIndex={-1}>
            Complete member registration
          </h2>
          {values.fullName ? <p>{values.fullName}</p> : null}
          <p>
            Choose the member’s level and subscription below. An online account is not required for
            manual membership.
          </p>
        </header>
        {healthStatus === "pending" || healthStatus === "saving" ? (
          <section
            className="member-subscription-editor ibjjf-form"
            aria-label="Medical information pending"
          >
            <p role={healthStatus === "pending" ? "alert" : "status"}>
              {healthStatus === "pending"
                ? "Medical information has not been saved. Your member record is saved. Keep this page open and retry."
                : "Saving medical information…"}
            </p>
            <label htmlFor="pending-medical">Medical information to save</label>
            <textarea
              id="pending-medical"
              value={values.medicalConditions}
              maxLength={1000}
              disabled={healthStatus === "saving"}
              onChange={(event) => updateField("medicalConditions", event.target.value)}
              rows={3}
            />
            <button
              className="admin-auth-button"
              type="button"
              disabled={healthStatus === "saving" || !values.medicalConditions.trim()}
              onClick={() => void saveMedicalInformation(createdMember)}
            >
              Retry saving medical information
            </button>
          </section>
        ) : null}
        <RegistrationCompletion
          key={createdMember}
          studentId={createdMember}
          healthComplete={healthStatus === "saved" || healthStatus === "none"}
          onRestart={restart}
        />
      </section>
    );

  return (
    <section className="admin-member-page" aria-labelledby="add-member-title">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">Members / Canonical student</p>
        <h2 id="add-member-title">Add adult student</h2>
        <p>
          This route is for adults aged 18 or over. For a child, use the family flow so the tutor
          relationship is created with the student.
        </p>
        <p>
          Save personal details first, then choose the initial level, subscription and payment
          details here. Manual membership does not require an online account.
        </p>
        <Link href="/admin/families">Create a family and minor student</Link>
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
          <label htmlFor="member-date-of-birth">Date of birth</label>
          <input
            aria-invalid={fieldErrors.dateOfBirth ? "true" : "false"}
            id="member-date-of-birth"
            onChange={(event) => updateField("dateOfBirth", event.target.value)}
            ref={dateOfBirthRef}
            required
            type="date"
            value={values.dateOfBirth}
          />
          {fieldErrors.dateOfBirth ? (
            <p className="login-field-error" role="alert">
              {fieldErrors.dateOfBirth}
            </p>
          ) : null}
        </div>

        <div className="login-field">
          <label htmlFor="member-training-center">Training center</label>
          <select
            aria-invalid={fieldErrors.trainingCenter ? "true" : "false"}
            id="member-training-center"
            onChange={(event) =>
              updateField("trainingCenter", event.target.value as FormValues["trainingCenter"])
            }
            ref={trainingCenterRef}
            required
            value={values.trainingCenter}
          >
            <option value="">Select a training center</option>
            {trainingCenters.map((center) => (
              <option key={center} value={center}>
                {center}
              </option>
            ))}
          </select>
          {fieldErrors.trainingCenter ? (
            <p className="login-field-error" role="alert">
              {fieldErrors.trainingCenter}
            </p>
          ) : null}
        </div>

        <fieldset className="login-field">
          <legend>Training time preferences</legend>
          {trainingTimePreferences.map((preference) => (
            <label key={preference}>
              <input
                checked={values.trainingTimePreferences.includes(preference)}
                onChange={() => togglePreference(preference)}
                type="checkbox"
              />
              {preference[0]?.toUpperCase()}
              {preference.slice(1)}
            </label>
          ))}
          {fieldErrors.trainingTimePreferences ? (
            <p className="login-field-error" role="alert">
              {fieldErrors.trainingTimePreferences}
            </p>
          ) : null}
        </fieldset>

        {[
          ["email", "Email address", "email"],
          ["phoneNumber", "Mobile number", "tel"],
          ["frequencyNote", "Frequency note", "text"],
          ["membershipNumber", "Membership number", "text"],
          ["idCardNumber", "ID card number", "text"],
          ["vatNumber", "VAT number", "text"],
        ].map(([field, label, type]) => (
          <div className="login-field" key={field}>
            <label htmlFor={`member-${field}`}>{label}</label>
            <input
              id={`member-${field}`}
              onChange={(event) =>
                updateField(field as keyof FormValues, event.target.value as never)
              }
              type={type}
              value={values[field as keyof FormValues] as string}
            />
          </div>
        ))}

        <div className="login-field">
          <label htmlFor="member-gender">Gender</label>
          <select
            id="member-gender"
            onChange={(event) => updateField("gender", event.target.value as FormValues["gender"])}
            value={values.gender}
          >
            <option value="">Select gender</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="unknown">Prefer not to say</option>
          </select>
        </div>

        <fieldset className="login-field">
          <legend>Emergency contact (from the waiver form, optional)</legend>
          <div className="login-field">
            <label htmlFor="member-emergency-contact-full-name">Emergency contact name</label>
            <input
              aria-invalid={fieldErrors.emergencyContact ? "true" : "false"}
              autoComplete="off"
              id="member-emergency-contact-full-name"
              maxLength={160}
              onChange={(event) => updateField("emergencyContactFullName", event.target.value)}
              ref={emergencyContactRef}
              type="text"
              value={values.emergencyContactFullName}
            />
          </div>
          <div className="login-field">
            <label htmlFor="member-emergency-contact-relationship">Relationship</label>
            <input
              autoComplete="off"
              id="member-emergency-contact-relationship"
              maxLength={64}
              onChange={(event) => updateField("emergencyContactRelationship", event.target.value)}
              type="text"
              value={values.emergencyContactRelationship}
            />
          </div>
          <div className="login-field">
            <label htmlFor="member-emergency-contact-phone">Emergency contact phone</label>
            <input
              autoComplete="off"
              id="member-emergency-contact-phone"
              maxLength={64}
              onChange={(event) => updateField("emergencyContactPhoneNumber", event.target.value)}
              type="tel"
              value={values.emergencyContactPhoneNumber}
            />
          </div>
          <div className="login-field">
            <label htmlFor="member-emergency-contact-alternate-phone">
              Alternate phone (optional)
            </label>
            <input
              autoComplete="off"
              id="member-emergency-contact-alternate-phone"
              maxLength={64}
              onChange={(event) =>
                updateField("emergencyContactAlternatePhoneNumber", event.target.value)
              }
              type="tel"
              value={values.emergencyContactAlternatePhoneNumber}
            />
          </div>
          {fieldErrors.emergencyContact ? (
            <p className="login-field-error" role="alert">
              {fieldErrors.emergencyContact}
            </p>
          ) : null}
        </fieldset>

        <fieldset className="login-field">
          <legend>Postal address (optional)</legend>
          <div className="login-field">
            <label htmlFor="member-address-line">Address</label>
            <input
              aria-invalid={fieldErrors.postalAddress ? "true" : "false"}
              autoComplete="off"
              id="member-address-line"
              maxLength={240}
              onChange={(event) => updateField("addressLine", event.target.value)}
              ref={addressLineRef}
              type="text"
              value={values.addressLine}
            />
          </div>
          <div className="login-field">
            <label htmlFor="member-post-code">Post code</label>
            <input
              autoComplete="off"
              id="member-post-code"
              maxLength={16}
              onChange={(event) => updateField("postCode", event.target.value)}
              type="text"
              value={values.postCode}
            />
          </div>
          {fieldErrors.postalAddress ? (
            <p className="login-field-error" role="alert">
              {fieldErrors.postalAddress}
            </p>
          ) : null}
        </fieldset>

        <div className="login-field">
          <label htmlFor="member-medical-conditions">
            Medical conditions or special support needs (optional, max 1000 characters)
          </label>
          <textarea
            id="member-medical-conditions"
            maxLength={1000}
            onChange={(event) => updateField("medicalConditions", event.target.value)}
            placeholder="e.g. Asthma (carries inhaler in kit bag), previous joint injury, etc."
            rows={3}
            value={values.medicalConditions}
          />
        </div>

        {error ? (
          <p aria-live="assertive" className="login-message login-message-error" role="alert">
            {error}
          </p>
        ) : null}

        <button className="button button-primary login-submit" disabled={busy} type="submit">
          {busy ? "Adding adult student..." : "Add adult student"}
        </button>
      </form>
    </section>
  );
}

export default function AddMemberRoute() {
  return <AddMemberPage />;
}
