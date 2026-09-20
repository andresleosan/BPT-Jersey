"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type {
  EnrolmentRequestClientView,
  EnrolmentRequestDetails,
} from "@bpt-jersey/domain/members/enrolment-requests";
import { ClientAuthProvider, useClientSession } from "../../lib/client-auth";
import {
  enrolmentWaiverTermsAcknowledgement,
  enrolmentWaiverTermsSections,
  enrolmentWaiverTermsTitle,
  enrolmentWaiverTermsVersion,
} from "@bpt-jersey/domain/consents/enrolment-waiver";
import {
  createEnrolmentRequestId,
  listMyEnrolmentRequests,
  submitEnrolmentRequest,
  uploadEnrolmentPaymentProof,
  withdrawEnrolmentRequest,
} from "../../lib/enrolment-client";
import {
  parseEnrolmentRequestDetails,
  enrolmentPaymentTotal,
  parseEnrolmentRequestSubmission,
  maximumEnrolmentRequestMinors,
} from "@bpt-jersey/domain/members/enrolment-requests";
import type { PlanId } from "@bpt-jersey/domain/memberships";
import { EnrolmentBankDetails } from "./payment-instructions";
import { EnrolmentPlanChoices } from "./plan-choices";
import "./enrolment-steps.css";

const preferenceOptions = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
] as const;

const centerOptions = ["Town", "West"] as const;
const genderOptions = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "unknown", label: "Prefer not to say" },
] as const;

type Preference = (typeof preferenceOptions)[number]["value"];
type Center = (typeof centerOptions)[number];
type Gender = (typeof genderOptions)[number]["value"];

type MinorForm = {
  selectedPlan: PlanId | "";
  fullName: string;
  dateOfBirth: string;
  gender: Gender;
  trainingCenter: Center;
  trainingTimePreferences: Preference[];
};

type ApplicantForm = {
  selectedPlan: PlanId | "";
  applicantIsStudent: boolean;
  fullName: string;
  dateOfBirth: string;
  phoneNumber: string;
  email: string;
  trainingCenter: Center;
  trainingTimePreferences: Preference[];
  gender: Gender;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  addressLine: string;
  postCode: string;
  minors: MinorForm[];
  waiverAccepted: boolean;
};

const emptyMinor: MinorForm = {
  selectedPlan: "",
  fullName: "",
  dateOfBirth: "",
  gender: "unknown",
  trainingCenter: "Town",
  trainingTimePreferences: [],
};

const emptyForm: ApplicantForm = {
  selectedPlan: "",
  applicantIsStudent: true,
  fullName: "",
  dateOfBirth: "",
  phoneNumber: "",
  email: "",
  trainingCenter: "Town",
  trainingTimePreferences: [],
  gender: "unknown",
  emergencyName: "",
  emergencyRelationship: "",
  emergencyPhone: "",
  addressLine: "",
  postCode: "",
  minors: [],
  waiverAccepted: false,
};

// An applicant is told the truth about every state, including the two the approval introduced: a
// request being processed is not "waiting", and one whose approval stopped is not "approved".
const statusLabels = {
  submitted: "Waiting for the academy",
  returned: "Sent back to you",
  approving: "Being processed by the academy",
  "approval-failed": "The academy is looking into it",
  approved: "Approved",
  withdrawn: "Withdrawn",
} as const;

function trimmed(value: string): string | undefined {
  const text = value.trim();
  return text.length === 0 ? undefined : text;
}

/**
 * Turns the form into the submission contract. Empty optional fields are dropped rather than sent
 * as empty strings, because the contract rejects an empty string where it accepts an absent field.
 */
function toDetails(form: ApplicantForm, requestId: string): EnrolmentRequestDetails {
  const emergencyContact =
    trimmed(form.emergencyName) &&
    trimmed(form.emergencyRelationship) &&
    trimmed(form.emergencyPhone)
      ? {
          fullName: form.emergencyName.trim(),
          relationship: form.emergencyRelationship.trim(),
          phoneNumber: form.emergencyPhone.trim(),
        }
      : undefined;
  const postalAddress =
    trimmed(form.addressLine) && trimmed(form.postCode)
      ? { line: form.addressLine.trim(), postCode: form.postCode.trim() }
      : undefined;

  return {
    requestId,
    applicantIsStudent: form.applicantIsStudent,
    applicant: {
      fullName: form.fullName.trim(),
      dateOfBirth: form.dateOfBirth,
      trainingCenter: form.applicantIsStudent
        ? form.trainingCenter
        : (form.minors[0]?.trainingCenter ?? form.trainingCenter),
      trainingTimePreferences: form.applicantIsStudent ? [...form.trainingTimePreferences] : [],
      gender: form.gender,
      phoneNumber: form.phoneNumber.trim(),
      ...(trimmed(form.email) === undefined ? {} : { email: form.email.trim() }),
      ...(emergencyContact === undefined ? {} : { emergencyContact }),
      ...(postalAddress === undefined ? {} : { postalAddress }),
    },
    minors: (form.applicantIsStudent ? [] : form.minors).map((minor) => ({
      fullName: minor.fullName.trim(),
      dateOfBirth: minor.dateOfBirth,
      gender: minor.gender,
      trainingCenter: minor.trainingCenter,
      trainingTimePreferences: [...minor.trainingTimePreferences],
      ...(emergencyContact ? { emergencyContact } : {}),
    })),
    // Only the version travels. The server stores the hash of the text it holds, so the acceptance
    // names words the academy can reproduce rather than words this form claims were on screen.
    waiverAcceptance: { version: enrolmentWaiverTermsVersion, accepted: true },
  };
}

function validate(
  form: ApplicantForm,
  requestId: string,
  effectiveDate: string,
): string | undefined {
  if (!form.fullName.trim()) return "Enter your full name.";
  if (!form.dateOfBirth) return "Enter your date of birth.";
  // Required here, unlike on the administrative form: the academy cannot open a client record
  // without a phone number, and office is not standing in front of this applicant to ask.
  if (!form.phoneNumber.trim()) return "Enter a phone number the academy can reach you on.";
  if (form.trainingTimePreferences.length === 0 && form.applicantIsStudent) {
    return "Choose at least one training time.";
  }
  if (!form.applicantIsStudent && form.minors.length === 0) {
    return "Add the child you are enrolling.";
  }
  for (const minor of form.applicantIsStudent ? [] : form.minors) {
    if (!minor.fullName.trim()) return "Enter every child's full name.";
    if (!minor.dateOfBirth) return "Enter every child's date of birth.";
    if (minor.trainingTimePreferences.length === 0) {
      return "Choose at least one training time for every child.";
    }
  }
  const emergencyFields = [form.emergencyName, form.emergencyRelationship, form.emergencyPhone];
  if (
    emergencyFields.some((value) => value.trim()) &&
    !emergencyFields.every((value) => value.trim())
  ) {
    return "Complete the emergency contact name, relationship and phone number.";
  }
  if (Boolean(form.addressLine.trim()) !== Boolean(form.postCode.trim())) {
    return "Enter both the address and the post code.";
  }
  // Last, so somebody who accepted and then missed a field is not told to accept again.
  if (!form.waiverAccepted) {
    return "Read and accept the waiver before sending your request.";
  }
  const parsed = parseEnrolmentRequestDetails(toDetails(form, requestId), effectiveDate);
  if (!parsed.ok) {
    const problem = parsed.error[0];
    if (problem?.path.includes("dateOfBirth")) {
      return "Check the dates of birth: applicants must be 18 or over and children must be under 18.";
    }
    if (problem?.path.includes("email")) return "Enter a valid email address.";
    return "Check that all details are complete and valid before choosing plans.";
  }
  return undefined;
}

/**
 * The club's waiver, shown in full rather than linked. An acceptance is only worth storing if the
 * person could read what they accepted without leaving the form, and the stored acceptance names
 * this exact version.
 */
function WaiverTerms({
  accepted,
  onChange,
}: Readonly<{ accepted: boolean; onChange: (next: boolean) => void }>) {
  return (
    <fieldset className="enrol-waiver">
      <legend>{enrolmentWaiverTermsTitle}</legend>
      <p className="enrol-hint">
        Version {enrolmentWaiverTermsVersion}. The academy also asks about medical conditions,
        injuries and allergies in person at reception; this form does not collect them.
      </p>
      <div className="enrol-waiver-scroll" tabIndex={0} role="region" aria-label="Waiver terms">
        {enrolmentWaiverTermsSections.map((section) => (
          <article key={section.heading}>
            <h3>{section.heading}</h3>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.bullets === undefined ? null : (
              <ul>
                {section.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
      <label className="enrol-waiver-accept">
        <input
          checked={accepted}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        <span>{enrolmentWaiverTermsAcknowledgement}</span>
      </label>
    </fieldset>
  );
}

function togglePreference(list: readonly Preference[], value: Preference): Preference[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function StatusCard({
  request,
  busy,
  onWithdraw,
}: Readonly<{
  request: EnrolmentRequestClientView;
  busy: boolean;
  onWithdraw: () => void;
}>) {
  return (
    <section className="enrol-status" aria-labelledby="enrol-status-title">
      <p className="account-eyebrow">Your request</p>
      <h2 id="enrol-status-title">{statusLabels[request.status]}</h2>
      <p>Sent on {new Date(request.submittedAt).toLocaleDateString("en-GB")}.</p>
      {request.status === "submitted" ? (
        <p>
          The academy reviews requests in person at reception. You will be able to book classes once
          they confirm your place.
        </p>
      ) : null}
      {request.status === "returned" && request.reviewNote ? (
        <p className="enrol-review-note">
          <strong>The academy asked for a change:</strong> {request.reviewNote}
        </p>
      ) : null}
      <div className="hero-actions">
        {request.status === "submitted" || request.status === "returned" ? (
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={onWithdraw}
            type="button"
          >
            Withdraw this request
          </button>
        ) : null}
        <a className="button button-secondary" href="/">
          Back to the home page
        </a>
      </div>
    </section>
  );
}

function MinorFields({
  minor,
  index,
  onChange,
  onRemove,
}: Readonly<{
  minor: MinorForm;
  index: number;
  onChange: (next: MinorForm) => void;
  onRemove: () => void;
}>) {
  const prefix = `enrol-minor-${index}`;
  return (
    <fieldset className="enrol-minor">
      <legend>Child {index + 1}</legend>
      <label className="enrol-field" htmlFor={`${prefix}-name`}>
        Full name
        <input
          id={`${prefix}-name`}
          maxLength={160}
          onChange={(event) => onChange({ ...minor, fullName: event.target.value })}
          value={minor.fullName}
        />
      </label>
      <label className="enrol-field" htmlFor={`${prefix}-dob`}>
        Date of birth
        <input
          id={`${prefix}-dob`}
          onChange={(event) =>
            onChange({ ...minor, dateOfBirth: event.target.value, selectedPlan: "" })
          }
          type="date"
          value={minor.dateOfBirth}
        />
      </label>
      <label className="enrol-field" htmlFor={`${prefix}-center`}>
        Training centre
        <select
          id={`${prefix}-center`}
          onChange={(event) =>
            onChange({ ...minor, trainingCenter: event.target.value as Center, selectedPlan: "" })
          }
          value={minor.trainingCenter}
        >
          {centerOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="enrol-preferences">
        <legend>Training times</legend>
        {preferenceOptions.map((option) => (
          <label key={option.value} htmlFor={`${prefix}-${option.value}`}>
            <input
              checked={minor.trainingTimePreferences.includes(option.value)}
              id={`${prefix}-${option.value}`}
              onChange={() =>
                onChange({
                  ...minor,
                  trainingTimePreferences: togglePreference(
                    minor.trainingTimePreferences,
                    option.value,
                  ),
                })
              }
              type="checkbox"
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <button className="button button-secondary" onClick={onRemove} type="button">
        Remove child {index + 1}
      </button>
    </fieldset>
  );
}

function EnrolContent() {
  const { session, status } = useClientSession();
  const [form, setForm] = useState<ApplicantForm>(emptyForm);
  const [step, setStep] = useState<"details" | "plans" | "payment">("details");
  const [proof, setProof] = useState<File>();
  const [proofId, setProofId] = useState<string>();
  const [paidOn, setPaidOn] = useState("");
  const [reference, setReference] = useState("");
  const selections = {
    ...(form.applicantIsStudent && form.selectedPlan ? { applicant: form.selectedPlan } : {}),
    minors: form.applicantIsStudent
      ? []
      : form.minors
          .filter((minor) => minor.selectedPlan)
          .map((minor) => minor.selectedPlan as PlanId),
  };
  const paymentTotal = enrolmentPaymentTotal(selections);
  const [requestId, setRequestId] = useState(createEnrolmentRequestId);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const submitting = useRef(false);
  const effectiveDate = new Date().toISOString().slice(0, 10);
  useEffect(() => {
    stepHeading.current?.focus();
  }, [step]);
  const [requests, setRequests] = useState<readonly EnrolmentRequestClientView[]>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const signedIn = status === "signed-in";
  const alreadyStudent = session?.role === "guardian" || session?.role === "adultStudent";

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    void listMyEnrolmentRequests()
      .then((items) => {
        if (active) setRequests(items);
      })
      .catch(() => {
        if (active) {
          setRequests([]);
          setLoadFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [signedIn]);

  /**
   * El prellenado es una cortesía: siembra el nombre y el correo de la sesión una vez y no vuelve
   * a tocarlos. Dejar de sembrarlos cuando el campo está vacío era el bug: `form.email.length` y
   * `form.fullName.length` estaban en el array de dependencias, así que al borrar el último
   * carácter la longitud pasaba a 0, el efecto se volvía a ejecutar y reescribía el valor. Vaciar
   * el campo era imposible.
   *
   * La guarda es una referencia a lo ya sembrado, no la longitud del campo. Con ella un refresco
   * de sesión que devuelve el mismo correo no reescribe lo que el solicitante acaba de vaciar, y
   * un cambio de cuenta —correo distinto— sí siembra de nuevo, que es lo que un usuario esperaría
   * al iniciar sesión con otra identidad.
   */
  const seededEmail = useRef<string | undefined>(undefined);
  const seededFullName = useRef<string | undefined>(undefined);

  useEffect(() => {
    const email = session?.email;
    if (email && seededEmail.current !== email) {
      seededEmail.current = email;
      setForm((current) => ({ ...current, email }));
    }
    const displayName = session?.displayName;
    if (displayName && seededFullName.current !== displayName) {
      seededFullName.current = displayName;
      setForm((current) => ({ ...current, fullName: displayName }));
    }
  }, [session?.email, session?.displayName]);

  // Anything the applicant still holds, not only what they can still act on. A request the academy
  // is processing, or one whose approval stopped, has to show its state: dropping back to a blank
  // form would invite a second submission the server is going to refuse anyway.
  const openRequest = useMemo(
    () => requests?.find((request) => request.status !== "withdrawn"),
    [requests],
  );

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting.current) return;
    const problem = validate(form, requestId, effectiveDate);
    if (problem) {
      setMessage(problem);
      return;
    }
    setMessage(undefined);
    if (step === "details") {
      setStep("plans");
      return;
    }
    if (
      (form.applicantIsStudent && !form.selectedPlan) ||
      (!form.applicantIsStudent && form.minors.some((minor) => !minor.selectedPlan))
    ) {
      setMessage("Choose an available plan for every student.");
      return;
    }
    if (step === "plans") {
      setProofId(undefined);
      setStep("payment");
      return;
    }
    if (
      paymentTotal > 0 &&
      ((!proof && !proofId) || !paidOn || paidOn > effectiveDate || !reference.trim())
    ) {
      setMessage("Add the transfer date, reference and a PNG or JPEG screenshot before sending.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const uploaded =
        paymentTotal > 0
          ? (proofId ?? (await uploadEnrolmentPaymentProof(requestId, proof!)))
          : undefined;
      if (uploaded) setProofId(uploaded);
      const parsed = parseEnrolmentRequestSubmission(
        {
          ...toDetails(form, requestId),
          planSelections: selections,
          ...(uploaded
            ? {
                payment: {
                  proofId: uploaded,
                  amountMinor: paymentTotal,
                  paidOn,
                  reference: reference.trim(),
                },
              }
            : {}),
        },
        effectiveDate,
      );
      if (!parsed.ok)
        throw new Error("Check your selected plans and payment details before sending.");
      const saved = await submitEnrolmentRequest(parsed.value);
      setRequests([saved, ...(requests ?? [])]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send your request.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function withdraw(enrolmentRequestId: string): Promise<void> {
    setBusy(true);
    setMessage(undefined);
    try {
      const updated = await withdrawEnrolmentRequest(enrolmentRequestId);
      setStep("details");
      setRequestId(createEnrolmentRequestId());
      setProof(undefined);
      setProofId(undefined);
      setRequests((current) =>
        (current ?? []).map((item) =>
          item.enrolmentRequestId === updated.enrolmentRequestId ? updated : item,
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to withdraw your request.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") {
    return <div className="client-auth-loading" aria-busy="true" />;
  }

  if (!signedIn) {
    return (
      <main className="enrol-page" id="main-content" aria-labelledby="enrol-title">
        <p className="account-eyebrow">BPT Jersey / Join</p>
        <h1 id="enrol-title">Join the academy</h1>
        <p className="client-destination-intro">
          Sign in first so the academy knows who is asking, then fill in one form. Nothing is
          confirmed until reception reviews it.
        </p>
        <a className="button button-primary" href="/login?returnTo=%2Fenrol">
          Sign in to apply
        </a>
      </main>
    );
  }

  if (alreadyStudent && requests === undefined) {
    return (
      <main className="enrol-page" id="main-content">
        <p role="status">Checking your registration…</p>
      </main>
    );
  }
  if (alreadyStudent && loadFailed) {
    return (
      <main className="enrol-page" id="main-content">
        <p role="alert">
          We could not check your registration. Reload this page to try again, or contact the
          academy.
        </p>
        <a className="button button-primary" href="/account">
          Go to your account
        </a>
      </main>
    );
  }
  if (alreadyStudent && (!openRequest || openRequest.status === "approved")) {
    return (
      <main className="enrol-page" id="main-content" aria-labelledby="enrol-title">
        <p className="account-eyebrow">BPT Jersey / Join</p>
        <h1 id="enrol-title">You are already enrolled</h1>
        <p className="client-destination-intro">
          The academy has your place. Your profile, classes and waiver live in your account.
        </p>
        <a className="button button-primary" href="/account">
          Go to your account
        </a>
      </main>
    );
  }

  return (
    <main className="enrol-page" id="main-content" aria-labelledby="enrol-title">
      <p className="account-eyebrow">BPT Jersey / Join</p>
      <h1 id="enrol-title">Join the academy</h1>
      <p className="client-destination-intro">
        Complete your details, then choose a plan for each student. The academy reviews your request
        before confirming your registration.
      </p>

      {message ? (
        <p className="enrol-message" role="alert">
          {message}
        </p>
      ) : null}
      {loadFailed ? (
        <p className="enrol-message" role="status">
          We could not check whether you already have a request open. You can still send one.
        </p>
      ) : null}

      {openRequest ? (
        <StatusCard
          busy={busy}
          onWithdraw={() => void withdraw(openRequest.enrolmentRequestId)}
          request={openRequest}
        />
      ) : (
        <form className="enrol-form" noValidate onSubmit={(event) => void submit(event)}>
          <ol className="enrol-steps" aria-label="Registration progress">
            <li aria-current={step === "details" ? "step" : undefined}>1. Your details</li>
            <li aria-current={step === "plans" ? "step" : undefined}>2. Choose plans</li>
            <li aria-current={step === "payment" ? "step" : undefined}>3. Payment and review</li>
          </ol>
          {step === "details" ? (
            <>
              <fieldset className="enrol-who">
                <legend>Who is joining</legend>
                <label htmlFor="enrol-self">
                  <input
                    checked={form.applicantIsStudent}
                    id="enrol-self"
                    name="enrol-who"
                    onChange={() => setForm({ ...form, applicantIsStudent: true })}
                    type="radio"
                  />
                  I am joining as an adult student
                </label>
                <label htmlFor="enrol-guardian">
                  <input
                    checked={!form.applicantIsStudent}
                    id="enrol-guardian"
                    name="enrol-who"
                    onChange={() => setForm({ ...form, applicantIsStudent: false })}
                    type="radio"
                  />
                  I am a parent or guardian enrolling a child
                </label>
              </fieldset>

              <fieldset className="enrol-applicant">
                <legend>
                  {form.applicantIsStudent ? "Your details" : "Your details as the guardian"}
                </legend>
                <label className="enrol-field" htmlFor="enrol-name">
                  Full name
                  <input
                    autoComplete="name"
                    id="enrol-name"
                    maxLength={160}
                    onChange={(event) => setForm({ ...form, fullName: event.target.value })}
                    value={form.fullName}
                  />
                </label>
                <label className="enrol-field" htmlFor="enrol-dob">
                  Date of birth
                  <input
                    autoComplete="bday"
                    id="enrol-dob"
                    onChange={(event) =>
                      setForm({ ...form, dateOfBirth: event.target.value, selectedPlan: "" })
                    }
                    type="date"
                    value={form.dateOfBirth}
                  />
                </label>
                <label className="enrol-field" htmlFor="enrol-phone">
                  Phone (required)
                  <input
                    autoComplete="tel"
                    id="enrol-phone"
                    maxLength={64}
                    onChange={(event) => setForm({ ...form, phoneNumber: event.target.value })}
                    type="tel"
                    value={form.phoneNumber}
                  />
                </label>
                <label className="enrol-field" htmlFor="enrol-email">
                  Email
                  <input
                    autoComplete="email"
                    id="enrol-email"
                    maxLength={320}
                    onChange={(event) => setForm({ ...form, email: event.target.value })}
                    type="email"
                    value={form.email}
                  />
                </label>
                <label className="enrol-field" htmlFor="enrol-gender">
                  Gender
                  <select
                    id="enrol-gender"
                    onChange={(event) => setForm({ ...form, gender: event.target.value as Gender })}
                    value={form.gender}
                  >
                    {genderOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {form.applicantIsStudent ? (
                  <>
                    <label className="enrol-field" htmlFor="enrol-center">
                      Training centre
                      <select
                        id="enrol-center"
                        onChange={(event) =>
                          setForm({
                            ...form,
                            trainingCenter: event.target.value as Center,
                            selectedPlan: "",
                          })
                        }
                        value={form.trainingCenter}
                      >
                        {centerOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <fieldset className="enrol-preferences">
                      <legend>Training times</legend>
                      {preferenceOptions.map((option) => (
                        <label key={option.value} htmlFor={`enrol-time-${option.value}`}>
                          <input
                            checked={form.trainingTimePreferences.includes(option.value)}
                            id={`enrol-time-${option.value}`}
                            onChange={() =>
                              setForm({
                                ...form,
                                trainingTimePreferences: togglePreference(
                                  form.trainingTimePreferences,
                                  option.value,
                                ),
                              })
                            }
                            type="checkbox"
                          />
                          {option.label}
                        </label>
                      ))}
                    </fieldset>
                  </>
                ) : null}
              </fieldset>

              <fieldset className="enrol-emergency">
                <legend>Emergency contact</legend>
                <p className="enrol-hint">
                  Optional here, and required before the first class. The academy stores it with the
                  student record and nowhere else.
                </p>
                <label className="enrol-field" htmlFor="enrol-emergency-name">
                  Name
                  <input
                    id="enrol-emergency-name"
                    maxLength={160}
                    onChange={(event) => setForm({ ...form, emergencyName: event.target.value })}
                    value={form.emergencyName}
                  />
                </label>
                <label className="enrol-field" htmlFor="enrol-emergency-relationship">
                  Relationship
                  <input
                    id="enrol-emergency-relationship"
                    maxLength={64}
                    onChange={(event) =>
                      setForm({ ...form, emergencyRelationship: event.target.value })
                    }
                    value={form.emergencyRelationship}
                  />
                </label>
                <label className="enrol-field" htmlFor="enrol-emergency-phone">
                  Phone
                  <input
                    id="enrol-emergency-phone"
                    maxLength={64}
                    onChange={(event) => setForm({ ...form, emergencyPhone: event.target.value })}
                    type="tel"
                    value={form.emergencyPhone}
                  />
                </label>
              </fieldset>

              <fieldset className="enrol-address">
                <legend>Address</legend>
                <label className="enrol-field" htmlFor="enrol-address-line">
                  Address
                  <input
                    autoComplete="street-address"
                    id="enrol-address-line"
                    maxLength={240}
                    onChange={(event) => setForm({ ...form, addressLine: event.target.value })}
                    value={form.addressLine}
                  />
                </label>
                <label className="enrol-field" htmlFor="enrol-postcode">
                  Post code
                  <input
                    autoComplete="postal-code"
                    id="enrol-postcode"
                    maxLength={16}
                    onChange={(event) => setForm({ ...form, postCode: event.target.value })}
                    value={form.postCode}
                  />
                </label>
              </fieldset>

              {!form.applicantIsStudent ? (
                <section className="enrol-minors" aria-labelledby="enrol-minors-title">
                  <h2 id="enrol-minors-title">Children joining</h2>
                  {form.minors.map((minor, index) => (
                    <MinorFields
                      index={index}
                      key={index}
                      minor={minor}
                      onChange={(next) =>
                        setForm({
                          ...form,
                          minors: form.minors.map((item, position) =>
                            position === index ? next : item,
                          ),
                        })
                      }
                      onRemove={() =>
                        setForm({
                          ...form,
                          minors: form.minors.filter((_item, position) => position !== index),
                        })
                      }
                    />
                  ))}
                  <button
                    className="button button-secondary"
                    disabled={form.minors.length >= maximumEnrolmentRequestMinors}
                    onClick={() =>
                      setForm({ ...form, minors: [...form.minors, { ...emptyMinor }] })
                    }
                    type="button"
                  >
                    Add a child
                  </button>
                </section>
              ) : null}

              <WaiverTerms
                accepted={form.waiverAccepted}
                onChange={(next) => setForm({ ...form, waiverAccepted: next })}
              />

              <button className="button button-primary" type="submit">
                Continue to plans
              </button>
            </>
          ) : step === "plans" ? (
            <>
              <h2 ref={stepHeading} tabIndex={-1}>
                Choose your plans
              </h2>
              <p className="enrol-hint">
                Select one plan for each student. Your choices will be sent to the academy for
                approval.
              </p>
              {form.applicantIsStudent ? (
                <EnrolmentPlanChoices
                  id="applicant"
                  fullName={form.fullName}
                  dateOfBirth={form.dateOfBirth}
                  trainingCenter={form.trainingCenter}
                  effectiveDate={effectiveDate}
                  selectedPlan={form.selectedPlan}
                  disabled={busy}
                  onChange={(selectedPlan) => setForm({ ...form, selectedPlan })}
                />
              ) : (
                form.minors.map((minor, index) => (
                  <EnrolmentPlanChoices
                    key={index}
                    id={`child-${index}`}
                    fullName={minor.fullName}
                    dateOfBirth={minor.dateOfBirth}
                    trainingCenter={minor.trainingCenter}
                    effectiveDate={effectiveDate}
                    selectedPlan={minor.selectedPlan}
                    disabled={busy}
                    onChange={(selectedPlan) =>
                      setForm({
                        ...form,
                        minors: form.minors.map((item, position) =>
                          position === index ? { ...item, selectedPlan } : item,
                        ),
                      })
                    }
                  />
                ))
              )}
              <div className="hero-actions">
                <button
                  className="button button-secondary"
                  disabled={busy}
                  type="button"
                  onClick={() => {
                    setStep("details");
                    setMessage(undefined);
                  }}
                >
                  Back to details
                </button>
                <button className="button button-primary" disabled={busy} type="submit">
                  {paymentTotal > 0 ? "Continue to payment" : "Continue to review"}
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 ref={stepHeading} tabIndex={-1}>
                {paymentTotal > 0 ? "Payment and review" : "Review your registration"}
              </h2>
              {paymentTotal > 0 ? (
                <fieldset disabled={busy} className="enrol-applicant">
                  <legend>Bank transfer evidence</legend>
                  <EnrolmentBankDetails />
                  <p>
                    Transfer total: <strong>£{(paymentTotal / 100).toFixed(2)}</strong>. Upload one
                    screenshot covering the prepaid plans. Pay-as-you-go classes are paid
                    separately at class.
                  </p>
                  <label className="enrol-field">
                    Transfer date
                    <input
                      type="date"
                      max={effectiveDate}
                      value={paidOn}
                      onChange={(event) => setPaidOn(event.target.value)}
                    />
                  </label>
                  <label className="enrol-field">
                    Transfer reference
                    <input
                      maxLength={120}
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                    />
                  </label>
                  <label className="enrol-field">
                    Payment screenshot (PNG or JPEG, up to 2 MB)
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      onChange={(event) => {
                        setProof(event.target.files?.[0]);
                        setProofId(undefined);
                      }}
                    />
                  </label>
                  {proof ? (
                    <p role="status">
                      Selected: {proof.name}
                      {proofId ? " · uploaded" : ""}
                    </p>
                  ) : null}
                  <p className="enrol-hint">
                    Only academy administrators can review your screenshot. Registration remains
                    pending until they check the transfer.
                  </p>
                </fieldset>
              ) : (
                <p>
                  No payment or screenshot is required to register for Pay as you go. You can send
                  your request now and pay for each class when you attend.
                </p>
              )}
              <div className="hero-actions">
                <button
                  className="button button-secondary"
                  disabled={busy}
                  type="button"
                  onClick={() => {
                    setStep("plans");
                    setMessage(undefined);
                  }}
                >
                  Back to plans
                </button>
                <button className="button button-primary" disabled={busy} type="submit">
                  {busy ? "Sending request..." : "Send request to the academy"}
                </button>
              </div>
            </>
          )}
        </form>
      )}
    </main>
  );
}

export default function EnrolPage() {
  return (
    <ClientAuthProvider>
      <ScopedEnrolContent />
    </ClientAuthProvider>
  );
}

function ScopedEnrolContent() {
  const { session } = useClientSession();
  return <EnrolContent key={`${session?.uid ?? "signed-out"}:${session?.role ?? "none"}`} />;
}
