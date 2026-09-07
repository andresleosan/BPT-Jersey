"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import type {
  EnrolmentRequestClientView,
  EnrolmentRequestSubmission,
} from "@bpt-jersey/domain/members/enrolment-requests";
import { ClientAuthProvider, useClientSession } from "../../lib/client-auth";
import {
  createEnrolmentRequestId,
  listMyEnrolmentRequests,
  submitEnrolmentRequest,
  withdrawEnrolmentRequest,
} from "../../lib/enrolment-client";

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
  fullName: string;
  dateOfBirth: string;
  gender: Gender;
  trainingCenter: Center;
  trainingTimePreferences: Preference[];
};

type ApplicantForm = {
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
};

const emptyMinor: MinorForm = {
  fullName: "",
  dateOfBirth: "",
  gender: "unknown",
  trainingCenter: "Town",
  trainingTimePreferences: [],
};

const emptyForm: ApplicantForm = {
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
function toSubmission(form: ApplicantForm, requestId: string): EnrolmentRequestSubmission {
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
      trainingCenter: form.trainingCenter,
      trainingTimePreferences: [...form.trainingTimePreferences],
      gender: form.gender,
      phoneNumber: form.phoneNumber.trim(),
      ...(trimmed(form.email) === undefined ? {} : { email: form.email.trim() }),
      ...(emergencyContact === undefined ? {} : { emergencyContact }),
      ...(postalAddress === undefined ? {} : { postalAddress }),
    },
    minors: form.minors.map((minor) => ({
      fullName: minor.fullName.trim(),
      dateOfBirth: minor.dateOfBirth,
      gender: minor.gender,
      trainingCenter: minor.trainingCenter,
      trainingTimePreferences: [...minor.trainingTimePreferences],
    })),
  } as EnrolmentRequestSubmission;
}

function validate(form: ApplicantForm): string | undefined {
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
  for (const minor of form.minors) {
    if (!minor.fullName.trim()) return "Enter every child's full name.";
    if (!minor.dateOfBirth) return "Enter every child's date of birth.";
    if (minor.trainingTimePreferences.length === 0) {
      return "Choose at least one training time for every child.";
    }
  }
  return undefined;
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
          onChange={(event) => onChange({ ...minor, dateOfBirth: event.target.value })}
          type="date"
          value={minor.dateOfBirth}
        />
      </label>
      <label className="enrol-field" htmlFor={`${prefix}-center`}>
        Training centre
        <select
          id={`${prefix}-center`}
          onChange={(event) => onChange({ ...minor, trainingCenter: event.target.value as Center })}
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
  const [requests, setRequests] = useState<readonly EnrolmentRequestClientView[]>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const signedIn = status === "signed-in";
  const alreadyStudent = session?.role === "guardian" || session?.role === "adultStudent";

  useEffect(() => {
    if (!signedIn || alreadyStudent) return;
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
  }, [signedIn, alreadyStudent]);

  useEffect(() => {
    if (session?.email && form.email.length === 0) {
      setForm((current) => ({ ...current, email: session.email }));
    }
    if (session?.displayName && form.fullName.length === 0) {
      setForm((current) => ({ ...current, fullName: session.displayName }));
    }
  }, [session?.email, session?.displayName, form.email.length, form.fullName.length]);

  // Anything the applicant still holds, not only what they can still act on. A request the academy
  // is processing, or one whose approval stopped, has to show its state: dropping back to a blank
  // form would invite a second submission the server is going to refuse anyway.
  const openRequest = useMemo(
    () => requests?.find((request) => request.status !== "withdrawn"),
    [requests],
  );

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const problem = validate(form);
    if (problem) {
      setMessage(problem);
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      const saved = await submitEnrolmentRequest(toSubmission(form, createEnrolmentRequestId()));
      setRequests([saved, ...(requests ?? [])]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send your request.");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(enrolmentRequestId: string): Promise<void> {
    setBusy(true);
    setMessage(undefined);
    try {
      const updated = await withdrawEnrolmentRequest(enrolmentRequestId);
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

  if (alreadyStudent) {
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
        Tell the academy who is joining. Reception reviews every request before a place is
        confirmed, and will ask you to sign the waiver in person.
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
        <form className="enrol-form" onSubmit={(event) => void submit(event)}>
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
                onChange={(event) => setForm({ ...form, dateOfBirth: event.target.value })}
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
            <label className="enrol-field" htmlFor="enrol-center">
              Training centre
              <select
                id="enrol-center"
                onChange={(event) =>
                  setForm({ ...form, trainingCenter: event.target.value as Center })
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
                    minors: form.minors.map((item, position) => (position === index ? next : item)),
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
              onClick={() => setForm({ ...form, minors: [...form.minors, { ...emptyMinor }] })}
              type="button"
            >
              Add a child
            </button>
          </section>

          <button className="button button-primary" disabled={busy} type="submit">
            Send request to the academy
          </button>
        </form>
      )}
    </main>
  );
}

export default function EnrolPage() {
  return (
    <ClientAuthProvider>
      <EnrolContent />
    </ClientAuthProvider>
  );
}
